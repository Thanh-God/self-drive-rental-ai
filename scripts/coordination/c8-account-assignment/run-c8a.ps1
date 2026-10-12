param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [int]$Port = 33626,
    [switch]$KeepVolumeOnSuccess,
    [string]$ControlMode = $null,
    [scriptblock]$ControlProbe = $null,
    [scriptblock]$AfterRestoreProbe = $null
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 1. Shell guard
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'
}

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName

$EvidenceDir = [System.IO.Path]::GetFullPath($EvidenceDir)

# 2. Preflight refusal for existing evidence
if (Test-Path -LiteralPath $EvidenceDir) {
    throw '[PREFLIGHT_REFUSAL] Evidence exists'
}

# 3. Canonical containment guard (C8A-R03)
$canonicalEvidence = $EvidenceDir.TrimEnd('\') + '\'
$canonicalRuntime = [System.IO.Path]::GetFullPath((Join-Path $repo '.runtime')).TrimEnd('\') + '\'
if (-not $canonicalEvidence.StartsWith($canonicalRuntime, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "[PREFLIGHT_GUARD] Evidence directory outside repository runtime root: $EvidenceDir"
}

# 4. Transitive reference manifest guard (C8A-R02)
$refManifestPath = Join-Path $PSScriptRoot 'c8a-reference-manifest.json'
if (-not (Test-Path -LiteralPath $refManifestPath)) {
    throw '[PREFLIGHT_GUARD] Missing dependency: reference manifest'
}
$refManifest = Get-Content -LiteralPath $refManifestPath -Raw | ConvertFrom-Json
foreach ($prop in $refManifest.PSObject.Properties) {
    $relPath = $prop.Name
    $expectedHash = $prop.Value
    $fullPath = Join-Path $repo $relPath
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw "[PREFLIGHT_GUARD] Missing dependency: $relPath"
    }
    $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        throw "[PREFLIGHT_GUARD] Source drift: $relPath"
    }
}

$build = Join-Path $repo 'scripts/coordination/c6-checkpoint-b/build-fat-jar.ps1'
$c7Helper = Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
$cleanupHelper = Join-Path $repo 'scripts/coordination/c7-incident-report/fixture-cleanup.ps1'
. $cleanupHelper
Import-Module $c7Helper -Force

function Manifest {
    $result = [ordered]@{}
    foreach ($prop in $refManifest.PSObject.Properties) {
        $fullPath = Join-Path $repo $prop.Name
        if (Test-Path -LiteralPath $fullPath) {
            $result[$prop.Name] = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
        }
    }
    foreach ($scriptFile in @('run-c8a.ps1', 'test-c8a-guards.ps1', 'c8a-reference-manifest.json')) {
        $p = Join-Path $PSScriptRoot $scriptFile
        if (Test-Path -LiteralPath $p) {
            $rel = $p.Substring($repo.Length + 1).Replace('\', '/')
            $result[$rel] = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
        }
    }
    return $result
}

$before = Manifest
$suites = @('AccountAssignmentHttpServerTest', 'RouteVersionGuardTest')
$expectedMethods = [ordered]@{}
foreach ($suite in $suites) {
    $text = Get-Content (Join-Path $repo "backend/src/test/java/com/carrental/$suite.java") -Raw
    $methods = @([regex]::Matches($text, '@Test\s+(?:public\s+)?void\s+(\w+)\s*\(') | ForEach-Object { $_.Groups[1].Value })
    if (-not $methods.Count) { throw "No expected test methods in $suite" }
    $expectedMethods[$suite] = $methods
}

$name = 'kltn-c8a-ag-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$volume = 'vol-' + $name
$db = 'kdrive_c8a_ag'
$meta = 'kdrive_c8a_ag_meta'

if (-not $ControlMode) {
    $names = @(& docker ps -a --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker inventory failed' }
    $volumes = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Volume inventory failed' }
    if ($names -contains $name -or $volumes -contains $volume) { throw '[PREFLIGHT_GUARD] Existing fixture' }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch { throw '[PREFLIGHT_GUARD] Fixture port occupied' } finally { $listener.Stop() }
}

New-Item -ItemType Directory $EvidenceDir | Out-Null
$before | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
$expectedMethods | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'expected-methods.json')

$variables = @('JAVA_HOME', 'KDRIVE_TEST_DB_URL', 'KDRIVE_TEST_DB_USER', 'KDRIVE_TEST_DB_PASSWORD', 'KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX', 'KDRIVE_TEST_FIXTURE_MARKER_TOKEN', 'KDRIVE_TEST_EXPECTED_HOST', 'KDRIVE_TEST_EXPECTED_PORT', 'KDRIVE_TEST_EXPECTED_SCHEMA', 'KDRIVE_TEST_MARKER_SCHEMA', 'SPRING_PROFILES_ACTIVE')
$environment = Snapshot-ProcessEnvironment -VariableNames $variables
$safeEnvironment = [ordered]@{}
foreach ($v in $variables) {
    $val = $environment[$v]
    if ($v -in @('KDRIVE_TEST_DB_PASSWORD', 'KDRIVE_TEST_FIXTURE_MARKER_TOKEN')) {
        $safeEnvironment[$v] = @{ Present = (-not [string]::IsNullOrEmpty($val)); Length = if ($null -ne $val) { $val.Length } else { 0 } }
    } else {
        $safeEnvironment[$v] = $val
    }
}
$safeEnvironment | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'environment-before.json')

$owned = $false
$testsPassed = $false
$cleanupPassed = $false
$processCleanupPassed = $true
$originalException = $null

try {
    try {
        if ($ControlMode -eq 'Normal') {
            # Mutate real tracked variables to verify caller preservation
            $env:KDRIVE_TEST_DB_URL = 'jdbc:mysql://127.0.0.1:9999/control_mutated'
            $env:JAVA_HOME = 'control-mutated-java'
            if ($ControlProbe) { & $ControlProbe }
            $testsPassed = $true
            $cleanupPassed = $true
            $processCleanupPassed = $true
        }
        elseif ($ControlMode -eq 'AdverseCleanup') {
            $env:KDRIVE_TEST_DB_URL = 'jdbc:mysql://127.0.0.1:9999/control_mutated'
            if ($ControlProbe) { & $ControlProbe }
            $testsPassed = $true
            $cleanupPassed = $true
            $processCleanupPassed = $false
        }
        elseif ($ControlMode -eq 'Exception') {
            $env:KDRIVE_TEST_DB_URL = 'jdbc:mysql://127.0.0.1:9999/control_mutated'
            if ($ControlProbe) { & $ControlProbe } else { throw '[INJECTED_EXCEPTION] Control probe triggered exception' }
        }
        else {
            # Real live execution
            $password = [Guid]::NewGuid().ToString('N')
            $token = [Guid]::NewGuid().ToString('N')
            $private = Join-Path $EvidenceDir 'mysql.private.env'
            [IO.File]::WriteAllLines($private, @("MYSQL_ROOT_PASSWORD=$password", "MYSQL_DATABASE=$db"), [Text.UTF8Encoding]::new($false))
            & docker run -d --name $name -p "127.0.0.1:${Port}:3306" --env-file $private -v "${volume}:/var/lib/mysql" mysql:8.4 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '[DOCKER_RUN_FAILED] Fixture not created' }
            $owned = $true
            $ready = $false
            $consecutiveSuccess = 0
            for ($i = 0; $i -lt 45; $i++) {
                try {
                    $probe = @(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --batch --skip-column-names -e 'SELECT 1;' 2>&1)
                    if ($LASTEXITCODE -eq 0 -and ($probe -join '').Trim() -eq '1') {
                        $consecutiveSuccess++
                        if ($consecutiveSuccess -ge 2) { $ready = $true; break }
                    } else {
                        $consecutiveSuccess = 0
                    }
                } catch { $consecutiveSuccess = 0 }
                Start-Sleep -Seconds 1
            }
            if (-not $ready) { throw 'MySQL query ready timeout' }
            Start-Sleep -Seconds 1
            $sql = "CREATE DATABASE $meta; CREATE TABLE $meta.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO $meta.__kdrive_test_fixture_marker VALUES(1,'$db','$token');"
            & docker exec -e "MYSQL_PWD=$password" $name mysql -uroot -e $sql | Out-Null
            if ($LASTEXITCODE -ne 0) { throw '[SQL_FAILURE] Marker setup' }

            $env:JAVA_HOME = 'E:/Tools/Java/jdk-21.0.12.1+1'
            [Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE', $null, 'Process')
            $env:KDRIVE_TEST_DB_URL = "jdbc:mysql://127.0.0.1:${Port}/${db}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
            $env:KDRIVE_TEST_DB_USER = 'root'
            $env:KDRIVE_TEST_DB_PASSWORD = $password
            $env:KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX = $db
            $env:KDRIVE_TEST_FIXTURE_MARKER_TOKEN = $token
            $env:KDRIVE_TEST_EXPECTED_HOST = '127.0.0.1'
            $env:KDRIVE_TEST_EXPECTED_PORT = "$Port"
            $env:KDRIVE_TEST_EXPECTED_SCHEMA = $db
            $env:KDRIVE_TEST_MARKER_SCHEMA = $meta

            if ($ControlProbe) {
                & $ControlProbe
            } else {
                # Build fat jar
                $built = & $build -EvidenceDir (Join-Path $EvidenceDir 'build') -OutputDir (Join-Path $EvidenceDir 'backend-copy')

                # C8A-R04: Fat JAR Startup Verification on isolated MySQL fixture
                $jarPort = 8188
                $jarLog = Join-Path $EvidenceDir 'fatjar-startup.log'
                $jarErr = Join-Path $EvidenceDir 'fatjar-startup-error.log'
                $javaExe = 'E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe'
                if (-not (Test-Path $javaExe)) { $javaExe = 'java.exe' }
                $jarArgs = @(
                    "-Dserver.port=$jarPort",
                    "-Dspring.datasource.url=jdbc:mysql://127.0.0.1:${Port}/${db}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
                    "-Dspring.datasource.username=root",
                    "-Dspring.datasource.password=$password",
                    "-Dapp.jwt-secret=integration-test-only-secret-at-least-32-bytes",
                    "-Dapp.token-minutes=30",
                    "-Dapp.seed-enabled=true",
                    "-Dapp.seed-password=IntegrationOnly123!",
                    '-jar',
                    $built.EffectiveJarPath
                )
                $jarProc = Start-Process -FilePath $javaExe -ArgumentList $jarArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $jarLog -RedirectStandardError $jarErr
                $jarStarted = $false
                try {
                    for ($k = 0; $k -lt 45; $k++) {
                        if ($jarProc.HasExited) { break }
                        try {
                            $tcp = [System.Net.Sockets.TcpClient]::new()
                            $tcp.Connect('127.0.0.1', $jarPort)
                            $tcp.Close()
                            $jarStarted = $true
                            break
                        } catch {
                            Start-Sleep -Seconds 1
                        }
                    }
                    if (-not $jarStarted) {
                        throw "[JAR_STARTUP_FAILURE] Fat JAR did not start within 45s. Exit code: $($jarProc.ExitCode)"
                    }

                    # Auth probe on fat JAR
                    $loginBody = '{"email":"admin@example.test","password":"IntegrationOnly123!"}'
                    $loginRes = Invoke-RestMethod -Uri "http://127.0.0.1:$jarPort/api/v1/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 10
                    if (-not $loginRes.token) {
                        throw '[JAR_AUTH_FAILURE] Login failed on fat JAR'
                    }

                    $jarLogText = Get-Content $jarLog -Raw
                    $flywayMatch = $jarLogText.Contains('Flyway') -or $jarLogText.Contains('schema_history')
                    $hibernateMatch = $jarLogText.Contains('Hibernate') -or $jarLogText.Contains('Tomcat started')
                    if (-not ($flywayMatch -and $hibernateMatch)) {
                        throw '[JAR_LOG_FAILURE] Flyway or Hibernate verification missing from fat JAR log'
                    }

                    [pscustomobject]@{
                        FatJarPath = $built.EffectiveJarPath
                        Port = $jarPort
                        Started = $true
                        AuthLoginPassed = $true
                        FlywayValidated = $flywayMatch
                        HibernateValidated = $hibernateMatch
                    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'fatjar-verification.json')
                } finally {
                    $cleanupJar = Invoke-OwnedProcessCleanup -OwnedProcesses @($jarProc)
                    if (-not $cleanupJar.Success) {
                        $processCleanupPassed = $false
                    }
                }

                # Run HTTP/MySQL test suites
                $cwd = Get-Location
                try {
                    Set-Location (Split-Path $built.CompiledOutput -Parent)
                    foreach ($suite in $suites) {
                        $suiteMethods = $expectedMethods[$suite]
                        $maven = Start-Process -FilePath (Join-Path (Get-Location) 'mvnw.cmd') -ArgumentList @('-o', '-B', '-ntp', "-Dmaven.repo.local=$repo/.runtime/m2", "-Dtest=$suite", 'test') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir "maven-$suite.log") -RedirectStandardError (Join-Path $EvidenceDir "maven-$suite-error.log")
                        $null = $maven.Handle
                        try {
                            if (-not $maven.WaitForExit(300000)) { throw "[TEST_TIMEOUT] Maven exceeded five minutes on $suite" }
                            $mavenExit = $maven.ExitCode
                        } finally {
                            $cleanupProc = Invoke-OwnedProcessCleanup -OwnedProcesses @($maven)
                            if (-not $cleanupProc.Success) {
                                $processCleanupPassed = $false
                            }
                            [pscustomobject]@{ PID = $maven.Id; HasExited = $maven.HasExited; CleanupResult = $cleanupProc } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir "maven-process-$suite.json")
                        }
                        if ($mavenExit -ne 0) { throw "[TEST_FAILURE] Maven exit $mavenExit on $suite" }
                        if (-not $processCleanupPassed) { throw "[CLEANUP_FAILURE] Process cleanup failed on $suite" }

                        $saved = Join-Path $EvidenceDir "TEST-com.carrental.$suite.xml"
                        Copy-Item (Join-Path $built.CompiledOutput "surefire-reports/TEST-com.carrental.$suite.xml") $saved
                        Assert-SurefireXmlStrict -XmlPath $saved -ExpectedTests $suiteMethods.Count -ExpectedFailures 0 -ExpectedErrors 0 -ExpectedSkipped 0 | Out-Null
                        [xml]$xml = Get-Content $saved -Raw
                        $actual = @($xml.testsuite.testcase | ForEach-Object { $_.name } | Sort-Object)
                        if (($actual -join '|') -cne (($suiteMethods | Sort-Object) -join '|')) { throw "[XML_METHODS] Unexpected methods in $suite" }
                    }
                } finally { Set-Location $cwd }
            }

            $readSql = "SELECT DATABASE(),@@port; SELECT version,success,checksum FROM flyway_schema_history ORDER BY installed_rank; SELECT role,status,COUNT(*) FROM users GROUP BY role,status ORDER BY role,status; SELECT COUNT(*) FROM staff_branches;"
            $read = @(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --database=$db --batch -e $readSql)
            if ($LASTEXITCODE -ne 0) { throw '[SQL_FAILURE] Readback' }
            $read | Set-Content (Join-Path $EvidenceDir 'mysql-readback.txt')

            $after = Manifest
            $after | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
            if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) { throw '[SOURCE_DRIFT] Test inputs changed' }
            $testsPassed = $true
        }
    } finally {
        if ($owned) {
            $cleanup = Stop-C7Fixture -Container $name -Port $Port -Owned $owned -ReadbackPath (Join-Path $EvidenceDir 'cleanup.json')
            $cleanupPassed = $cleanup.Passed
        } else {
            $cleanupPassed = $true
        }
    }
} catch {
    $originalException = $_
} finally {
    Restore-ProcessEnvironment -SavedEnvironment $environment
    if ($AfterRestoreProbe) { & $AfterRestoreProbe }
    $envReadback = Snapshot-ProcessEnvironment -VariableNames $variables
    $envDiffs = [ordered]@{}
    $envRestoredActual = $true
    foreach ($v in $variables) {
        $orig = $environment[$v]
        $cur = $envReadback[$v]
        if ($orig -cne $cur) { $envRestoredActual = $false; $envDiffs[$v] = @{ Original = $orig; Current = $cur } }
    }
    $safeAfter = [ordered]@{}
    foreach ($v in $variables) {
        $val = $envReadback[$v]
        if ($v -in @('KDRIVE_TEST_DB_PASSWORD', 'KDRIVE_TEST_FIXTURE_MARKER_TOKEN')) {
            $safeAfter[$v] = @{ Present = (-not [string]::IsNullOrEmpty($val)); Length = if ($null -ne $val) { $val.Length } else { 0 } }
        } else {
            $safeAfter[$v] = $val
        }
    }
    [pscustomobject]@{
        EnvironmentRestoredActual = $envRestoredActual
        EnvironmentDifferences = $envDiffs
        SafeEnvironmentAfter = $safeAfter
    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'environment-after.json')

    $status = if ($testsPassed -and $cleanupPassed -and $processCleanupPassed -and $envRestoredActual -and ($null -eq $originalException)) { 'PASS_SCOPED' } else { 'FAILED' }
    $summary = [pscustomobject]@{
        Status = $status
        TestsPassed = $testsPassed
        CleanupPassed = $cleanupPassed
        ProcessCleanupPassed = $processCleanupPassed
        EnvironmentRestored = $envRestoredActual
        Container = $name
        Volume = $volume
        Port = $Port
        Database = $db
    }
    $summary | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')

    # C8A-R01: Preserve original error if one occurred in try block
    if ($null -ne $originalException) {
        throw $originalException
    }
    elseif ($status -ne 'PASS_SCOPED') {
        throw '[RUNNER_FAILURE] Execution did not meet all pass criteria'
    }
}
