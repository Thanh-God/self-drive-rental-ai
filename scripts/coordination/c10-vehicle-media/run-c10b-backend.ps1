param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [int]$Port = 33652,
    [int]$JarPort = 8192,
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

# F02: Unsupported ControlMode refusal before any writes or spawn
if ($ControlMode -and $ControlMode -notin @('Normal', 'AdverseCleanup', 'Exception')) {
    throw "[PREFLIGHT_GUARD] Unsupported ControlMode: $ControlMode"
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
$refManifestPath = Join-Path $PSScriptRoot 'c10b-reference-manifest.json'
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
    foreach ($scriptFile in @('run-c10b-backend.ps1', 'test-c10b-backend-guards.ps1', 'c10b-reference-manifest.json')) {
        $p = Join-Path $PSScriptRoot $scriptFile
        if (Test-Path -LiteralPath $p) {
            $rel = $p.Substring($repo.Length + 1).Replace('\', '/')
            $result[$rel] = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
        }
    }
    return $result
}

$before = Manifest
$suites = @('VehicleImageHttpServerTest', 'VehicleAmenityHttpServerTest', 'VehicleCatalogHttpServerTest')
$expectedMethods = [ordered]@{}
foreach ($suite in $suites) {
    $text = Get-Content (Join-Path $repo "backend/src/test/java/com/carrental/$suite.java") -Raw
    $methods = @([regex]::Matches($text, '@Test(?:\s+@[^\r\n]+)*\s+(?:public\s+)?void\s+(\w+)\s*\(') | ForEach-Object { $_.Groups[1].Value })
    if (-not $methods.Count) { throw "No expected test methods in $suite" }
    $expectedMethods[$suite] = $methods
}

$name = 'kltn-c10b-backend-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$volume = 'vol-' + $name
$db = 'kdrive_c10b_backend'
$meta = 'kdrive_c10b_backend_meta'

if (-not $ControlMode) {
    $names = @(& docker ps -a --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker inventory failed' }
    $volumes = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Volume inventory failed' }
    if ($names -contains $name -or $volumes -contains $volume) { throw '[PREFLIGHT_GUARD] Existing fixture' }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } catch { throw '[PREFLIGHT_GUARD] Fixture port occupied' } finally { $listener.Stop() }
    $jarPreListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $JarPort)
    try { $jarPreListener.Start() } catch { throw "[PREFLIGHT_GUARD] Fat JAR port $JarPort occupied" } finally { $jarPreListener.Stop() }
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
$controlOwnedProc = $null

try {
    try {
        if ($ControlMode -eq 'Normal') {
            # F01 & F02: Control Normal executes owned process cleanup normally
            $controlOwnedProc = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
            $env:KDRIVE_TEST_DB_URL = 'jdbc:mysql://127.0.0.1:9999/control_mutated'
            $env:JAVA_HOME = 'control-mutated-java'
            if ($ControlProbe) { & $ControlProbe }

            $cleanupProc = Invoke-OwnedProcessCleanup -OwnedProcesses @($controlOwnedProc)
            $processCleanupPassed = $cleanupProc.Success
            $testsPassed = $false
            $cleanupPassed = $true
        }
        elseif ($ControlMode -eq 'AdverseCleanup') {
            # F01: Control AdverseCleanup injects failure at actual common cleanup function on owned process
            $controlOwnedProc = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
            $env:KDRIVE_TEST_DB_URL = 'jdbc:mysql://127.0.0.1:9999/control_mutated'
            if ($ControlProbe) { & $ControlProbe }

            $cleanupProc = Invoke-OwnedProcessCleanup -OwnedProcesses @($controlOwnedProc) -CustomStopProcess { param($p) throw 'Injected cleanup failure' }
            $processCleanupPassed = $cleanupProc.Success
            [pscustomobject]@{ PID = $controlOwnedProc.Id; HasExited = $controlOwnedProc.HasExited; CleanupResult = $cleanupProc } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'maven-process-adverse.json')
            $testsPassed = $false
            $cleanupPassed = $true
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

                # F03: Preflight occupancy check for Fat JAR port before spawn
                $jarListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $JarPort)
                try { $jarListener.Start() } catch { throw "[PREFLIGHT_GUARD] Fat JAR port $JarPort occupied" } finally { $jarListener.Stop() }

                $jarLog = Join-Path $EvidenceDir 'fatjar-startup.log'
                $jarErr = Join-Path $EvidenceDir 'fatjar-startup-error.log'
                $javaExe = 'E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe'
                if (-not (Test-Path $javaExe)) { $javaExe = 'java.exe' }
                $jarArgs = @(
                    "-Dserver.port=$JarPort",
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
                if ($jarProc.Id -le 0 -or $jarProc.HasExited) {
                    throw '[JAR_STARTUP_FAILURE] Fat JAR process failed to spawn'
                }

                $jarStarted = $false
                try {
                    for ($k = 0; $k -lt 45; $k++) {
                        if ($jarProc.HasExited) { break }
                        try {
                            $tcp = [System.Net.Sockets.TcpClient]::new()
                            $tcp.Connect('127.0.0.1', $JarPort)
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

                    # F03: Auth probe on fat JAR
                    $loginBody = '{"email":"admin@example.test","password":"IntegrationOnly123!"}'
                    $loginRes = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 10
                    $token = $loginRes.token
                    if (-not $token) {
                        throw '[JAR_AUTH_FAILURE] Login failed on fat JAR, token missing'
                    }

                    # F03: Protected authenticated HTTP request using issued JWT
                    $headers = @{ Authorization = "Bearer $token" }
                    $branchesRes = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/auth/me" -Method Get -Headers $headers -TimeoutSec 10
                    $protectedGetPassed = ($null -ne $branchesRes)
                    if (-not $protectedGetPassed) {
                        throw '[JAR_AUTH_FAILURE] Protected GET /me/branches failed with issued token'
                    }

                    $amenityId = [Guid]::NewGuid().ToString()
                    $newAmenity = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/admin/amenities" -Method Post -Headers $headers -Body ('{"name":"JAR amenity '+$amenityId+'"}') -ContentType 'application/json'
                    $linksBefore = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/admin/vehicles/v1/amenities" -Headers $headers
                    $body = @{ amenityIds=@($newAmenity.id); expectedRevision=$linksBefore.revision } | ConvertTo-Json
                    $linksAfter = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/admin/vehicles/v1/amenities" -Method Put -Headers $headers -Body $body -ContentType 'application/json'
                    $publicVehicle = Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/vehicles/v1"
                    if ($linksAfter.amenities.Count -ne 1 -or $linksAfter.amenities[0].id -cne $newAmenity.id -or $publicVehicle.amenities[0].id -cne $newAmenity.id) { throw '[JAR_AMENITY_FAILURE] Link read/write/public mismatch' }
                    @{ AdminWriteRead=$true; PublicRead=$true; AmenityId=$newAmenity.id; Revision=$linksAfter.revision } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'jar-amenity-http.json')


                    $mediaUrl = "http://127.0.0.1:$JarPort/api/v1/admin/vehicles/v1/images"
                    $mediaBefore = Invoke-RestMethod -Uri $mediaUrl -Headers $headers
                    $mediaBody = @{url='/media/vehicles/jar-one.jpg'; attribution='Fixture illustration, not a licensed fleet photo'; expectedRevision=$mediaBefore.revision} | ConvertTo-Json
                    $mediaPost = Invoke-WebRequest -UseBasicParsing -Uri $mediaUrl -Method Post -Headers $headers -Body $mediaBody -ContentType 'application/json' -TimeoutSec 10
                    if ($mediaPost.StatusCode -ne 201) {throw '[JAR_IMAGE_FAILURE] Create status is not 201'}
                    $mediaOne = $mediaPost.Content | ConvertFrom-Json
                    $mediaBody = @{url='/media/vehicles/jar-two.jpg'; attribution='Fixture two'; expectedRevision=$mediaOne.revision} | ConvertTo-Json
                    $mediaTwo = Invoke-RestMethod -Uri $mediaUrl -Method Post -Headers $headers -Body $mediaBody -ContentType 'application/json' -TimeoutSec 10
                    $imageA=$mediaTwo.images[0].id; $imageB=$mediaTwo.images[1].id
                    $mediaBody = @{url='/media/vehicles/jar-edited.jpg'; attribution='<b>Literal fixture credit</b>'; expectedRevision=$mediaTwo.revision} | ConvertTo-Json
                    $mediaEdit=Invoke-RestMethod -Uri "$mediaUrl/$imageA" -Method Put -Headers $headers -Body $mediaBody -ContentType 'application/json' -TimeoutSec 10
                    $mediaOrderBody=@{imageIds=@($imageB,$imageA);expectedRevision=$mediaEdit.revision}|ConvertTo-Json
                    $mediaOrdered=Invoke-RestMethod -Uri "$mediaUrl/order" -Method Put -Headers $headers -Body $mediaOrderBody -ContentType 'application/json' -TimeoutSec 10
                    $mediaPublic=Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/vehicles/v1" -TimeoutSec 10
                    $mediaList=@(Invoke-RestMethod -Uri "http://127.0.0.1:$JarPort/api/v1/vehicles" -TimeoutSec 10)
                    $mediaListed=@($mediaList|Where-Object {$_.id -eq 'v1'})[0]
                    if ($mediaPublic.images.Count -ne 2 -or $mediaOrdered.images[0].id -cne $imageB -or $mediaPublic.images[0].id -cne $imageB -or $mediaListed.images[1].url -cne '/media/vehicles/jar-edited.jpg' -or $mediaPublic.images[1].attribution -cne '<b>Literal fixture credit</b>') {throw '[JAR_IMAGE_FAILURE] Public/order/metadata mismatch'}
                    $mediaSql=@(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --database=$db --batch --skip-column-names -e "SELECT id,sort_order,url,attribution FROM vehicle_images WHERE vehicle_id='v1' ORDER BY sort_order,id;")
                    if ($LASTEXITCODE -ne 0 -or $mediaSql.Count -ne 2 -or $mediaSql[0] -notmatch [regex]::Escape($imageB)) {throw '[JAR_IMAGE_FAILURE] SQL readback mismatch'}
                    $mediaSql|Set-Content (Join-Path $EvidenceDir 'jar-image-sql.txt')
                    @{CreatedStatus=201;Edited=$true;Reordered=$true;PublicRead=$true;ListRead=$true;Images=$mediaPublic.images;Revision=$mediaOrdered.revision}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $EvidenceDir 'jar-image-http.json')

                    # F03: Accurate Flyway & Hibernate validation evidence from log
                    $jarLogText = Get-Content $jarLog -Raw
                    $flywayMatch = $jarLogText.Contains('org.flywaydb.core.FlywayExecutor') -and $jarLogText.Contains('flyway_schema_history')
                    $hibernateMatch = $jarLogText.Contains('HHH000412: Hibernate ORM core version') -and $jarLogText.Contains('HHH10001005: Database info')
                    if (-not ($flywayMatch -and $hibernateMatch)) {
                        throw '[JAR_LOG_FAILURE] Flyway or Hibernate exact validation missing from fat JAR log'
                    }

                    $cleanupJar = Invoke-OwnedProcessCleanup -OwnedProcesses @($jarProc)
                    if (-not $cleanupJar.Success -or -not $jarProc.HasExited) {
                        $processCleanupPassed = $false
                    }

                    [pscustomobject]@{
                        FatJarPath = $built.EffectiveJarPath
                        Port = $JarPort
                        PID = $jarProc.Id
                        HasExited = $jarProc.HasExited
                        CleanupResult = $cleanupJar
                        Started = $true
                        AuthLoginPassed = $true
                        ProtectedGetPassed = $protectedGetPassed
                        FlywayValidated = $flywayMatch
                        HibernateValidated = $hibernateMatch
                    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'fatjar-verification.json')
                } finally {
                    if (-not $jarProc.HasExited) {
                        try { Stop-Process -Id $jarProc.Id -Force } catch {}
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

            $readSql = "SELECT DATABASE(),@@port; SELECT version,success,checksum FROM flyway_schema_history ORDER BY installed_rank; SELECT role,status,COUNT(*) FROM users GROUP BY role,status ORDER BY role,status; SELECT COUNT(*) FROM staff_branches; SELECT COUNT(*) AS tables_total FROM information_schema.tables WHERE table_schema=DATABASE(); SELECT COUNT(*) AS foreign_keys_total FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE(); SELECT vehicle_id,id,url,sort_order,attribution FROM vehicle_images ORDER BY vehicle_id,sort_order,id; SELECT vehicle_id,amenity_id FROM vehicle_amenities ORDER BY vehicle_id,amenity_id;"
            $read = @(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --database=$db --batch -e $readSql)
            if ($LASTEXITCODE -ne 0) { throw '[SQL_FAILURE] Readback' }
            $read | Set-Content (Join-Path $EvidenceDir 'mysql-readback.txt')

            $after = Manifest
            $after | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
            if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) { throw '[SOURCE_DRIFT] Test inputs changed' }
            $testsPassed = $true
        }
    } finally {
        if ($controlOwnedProc -and -not $controlOwnedProc.HasExited) {
            try { Stop-Process -Id $controlOwnedProc.Id -Force } catch {}
        }
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

    # F02: Explicit CONTROL_ONLY status and BusinessVerified=false when in ControlMode
    if ($ControlMode) {
        $status = if ($envRestoredActual -and $cleanupPassed -and $processCleanupPassed -and ($null -eq $originalException)) { 'CONTROL_ONLY' } else { 'FAILED' }
        $summary = [pscustomobject]@{
            Status = $status
            BusinessVerified = $false
            TestsPassed = $false
            CleanupPassed = $cleanupPassed
            ProcessCleanupPassed = $processCleanupPassed
            EnvironmentRestored = $envRestoredActual
            Container = $null
            Volume = $null
            Port = $null
            Database = $null
        }
    } else {
        $status = if ($testsPassed -and $cleanupPassed -and $processCleanupPassed -and $envRestoredActual -and ($null -eq $originalException)) { 'PASS_SCOPED' } else { 'FAILED' }
        $summary = [pscustomobject]@{
            Status = $status
            BusinessVerified = $testsPassed
            TestsPassed = $testsPassed
            CleanupPassed = $cleanupPassed
            ProcessCleanupPassed = $processCleanupPassed
            EnvironmentRestored = $envRestoredActual
            Container = $name
            Volume = $volume
            Port = $Port
            Database = $db
        }
    }
    $summary | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')

    # C8A-R01: Preserve original error if one occurred in try block
    if ($null -ne $originalException) {
        throw $originalException
    }
    elseif ($status -notin @('PASS_SCOPED', 'CONTROL_ONLY')) {
        throw '[RUNNER_FAILURE] Execution did not meet all pass criteria'
    }
}
