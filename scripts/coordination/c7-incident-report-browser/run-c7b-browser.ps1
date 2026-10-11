[CmdletBinding()]
param(
    [string]$EvidenceDir,
    [string]$AcceptedBuildDir = '.runtime/coordination-c7a-codexa-complete-20261011-140830/evidence/live1/build',
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'
}
if (-not $EvidenceDir) {
    $EvidenceDir = Join-Path $repo ('.runtime/coordination-c7b-review-20261011-145207/evidence/followup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
if ([IO.Path]::IsPathRooted($EvidenceDir)) { $EvidenceDir = [IO.Path]::GetFullPath($EvidenceDir) }
else { $EvidenceDir = [IO.Path]::GetFullPath((Join-Path $repo $EvidenceDir)) }
if (Test-Path -LiteralPath $EvidenceDir) { throw '[PREFLIGHT_REFUSAL] Evidence directory already exists' }

$runner = Join-Path $PSScriptRoot 'run-c7b-browser.ps1'
$browserTest = Join-Path $PSScriptRoot 'verify-c7b-browser.cjs'
$buildScript = Join-Path $repo 'scripts/coordination/c6-checkpoint-b/build-fat-jar.ps1'
$c7Helper = Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
$cleanupHelper = Join-Path $repo 'scripts/coordination/c7-incident-report/fixture-cleanup.ps1'
$frontendRoot = Join-Path $repo 'frontend'
$viteEntry = Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'
$acceptedRoot = Join-Path $repo $AcceptedBuildDir
$acceptedManifest = Join-Path $acceptedRoot 'build-inputs-before.json'
$playwrightModule = Join-Path $repo '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'
if ([string]::IsNullOrWhiteSpace($EvidenceDir)) { throw '[PREFLIGHT_REFUSAL] Evidence root is required' }
$evidenceRoot = [IO.Path]::GetFullPath((Join-Path $repo '.runtime/coordination-c7b-review-20261011-145207/evidence'))
if (-not $EvidenceDir.StartsWith($evidenceRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw '[PREFLIGHT_REFUSAL] Evidence directory must be a new child of this task evidence root' }
foreach ($dependency in @($runner,$browserTest,$buildScript,$c7Helper,$cleanupHelper,$viteEntry,$acceptedManifest,(Join-Path $playwrightModule 'index.js'))) {
    if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "[DEPENDENCY_GUARD] Missing required file: $dependency" }
}

Import-Module $c7Helper -Force
. $cleanupHelper
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$ephemeralPort = ([Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$mysqlPort = 33616
while ($mysqlPort -le 33715) {
    if ($mysqlPort -notin @(3306,33385) -and $mysqlPort -ne $ephemeralPort) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$mysqlPort)
        $free = $true
        try { $probe.Start() } catch { $free = $false } finally { $probe.Stop() }
        if ($free) { break }
    }
    $mysqlPort++
}
if ($mysqlPort -gt 33715) { throw '[PREFLIGHT_GUARD] No free isolated MySQL port in 33616-33715' }
foreach ($servicePort in @(8080,5173)) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$servicePort)
    try { $probe.Start() } catch { throw "[PREFLIGHT_GUARD] Required owned service port $servicePort is occupied" } finally { $probe.Stop() }
}

$dockerInfo = @(& docker info --format '{{.ServerVersion}}|{{.OSType}}' 2>&1)
if ($LASTEXITCODE -ne 0 -or $dockerInfo.Count -ne 1 -or $dockerInfo[0] -notmatch '^\d+(?:\.\d+)+\|linux$') {
    throw '[PREFLIGHT_GUARD] Docker Linux engine is unavailable'
}
$existingNames = @(& docker ps -a --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker container inventory failed' }
$existingVolumes = @(& docker volume ls --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker volume inventory failed' }
$image = 'mysql:8.4.11'
$imageReadback = @(& docker image inspect --format '{{.Id}}' $image 2>&1)
if ($LASTEXITCODE -ne 0 -or $imageReadback.Count -ne 1) { throw '[PREFLIGHT_GUARD] Accepted MySQL test image is unavailable locally' }
$originalContainer = 'kltn-phase5-rerun'
$originalIdentity = @(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}}:{{.Destination}};{{end}}' $originalContainer 2>&1)
if ($LASTEXITCODE -ne 0 -or $originalIdentity.Count -ne 1 -or $originalIdentity[0] -notmatch '\|true\|') {
    throw '[PREFLIGHT_GUARD] Expected user MySQL identity is not running; no fixture was created'
}

$runId = [Guid]::NewGuid().ToString('N').Substring(0,12)
$container = "kltn-c7b-browser-$runId"
$volume = "vol-$container"
if ($existingNames -contains $container -or $existingVolumes -contains $volume) { throw '[PREFLIGHT_GUARD] Generated fixture identity already exists' }
$schema = "kdrive_c7b_$runId"
$markerSchema = "kdrive_c7b_meta_$runId"
$markerToken = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$dbPassword = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$seedPassword = [Guid]::NewGuid().ToString('N') + 'Aa9!'
$jwtSecret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$variables = @('JAVA_HOME','PORT','DB_URL','DB_USER','DB_PASSWORD','JWT_SECRET','FRONTEND_ORIGIN','SEED_ENABLED','SEED_PASSWORD','SPRING_PROFILES_ACTIVE','VITE_DATA_MODE','VITE_API_BASE_URL','C7B_BASE_URL','C7B_API_BASE_URL','C7B_CONTAINER','C7B_SCHEMA','C7B_MARKER_SCHEMA','C7B_MARKER_TOKEN','C7B_DB_PASSWORD','C7B_SEED_PASSWORD','C7B_PLAYWRIGHT_MODULE','C7B_EVIDENCE_DIR')
$savedEnvironment = Snapshot-ProcessEnvironment -VariableNames $variables
$owned = $false
$backendProcess = $null
$frontendProcess = $null
$browserProcess = $null
$cleanupPassed = $false
$sourceStable = $false
$browserPassed = $false
$fixtureCleanup = $null
$processReadbacks = @()
$startedAt = Get-Date

New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$safeEnvironment = [ordered]@{}
foreach ($key in $variables) {
    $value = $savedEnvironment[$key]
    if ($key -match 'PASSWORD|TOKEN|SECRET') { $safeEnvironment[$key] = @{Present=(-not [string]::IsNullOrEmpty($value));Length=if($null -ne $value){$value.Length}else{0}} }
    else { $safeEnvironment[$key] = $value }
}
$safeEnvironment | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $EvidenceDir 'environment-before.json')
$inventory = [pscustomobject]@{DockerServer=$dockerInfo[0];Image=$image;ImageId=$imageReadback[0];Container=$container;Volume=$volume;Schema=$schema;MarkerSchema=$markerSchema;MysqlPort=$mysqlPort;ProtectedUserContainer=$originalContainer;ProtectedUserIdentity=$originalIdentity[0];PreflightOnly=[bool]$PreflightOnly}
$inventory | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $EvidenceDir 'preflight.json')
if ($PreflightOnly) {
    [pscustomobject]@{Status='PREFLIGHT_ONLY';FixtureCreated=$false;ProtectedUserServiceUnchanged=$true;EvidenceDir=$EvidenceDir} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
    return
}

function Get-RunManifest {
    $paths = @($runner,$browserTest,$buildScript,$c7Helper,$cleanupHelper,$viteEntry,
        (Join-Path $repo 'frontend/package.json'),(Join-Path $repo 'frontend/package-lock.json'),(Join-Path $repo 'frontend/vite.config.js'),
        (Join-Path $repo 'frontend/src/pages/api/ApiScreens.jsx'),(Join-Path $repo 'frontend/src/api/client.js'),(Join-Path $repo 'frontend/src/hooks/useApiData.js'),
        (Join-Path $repo 'frontend/src/utils/incidentEvents.js'),(Join-Path $repo 'frontend/src/utils/incidentReport.test.js'),(Join-Path $repo 'frontend/src/utils/reviewState.test.js'),
        (Join-Path $acceptedRoot 'build-provenance-report.json'),(Join-Path $acceptedRoot 'build-inputs-before.json'),(Join-Path $playwrightModule 'package.json'))
    $manifest = [ordered]@{}
    foreach ($path in ($paths | Sort-Object -Unique)) { $manifest[$path.Substring($repo.Length+1).Replace('\','/')] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    return $manifest
}

try {
    $manifestBefore = Get-RunManifest
    $manifestBefore | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
    $privateEnv = Join-Path $EvidenceDir 'mysql.private.env'
    [IO.File]::WriteAllLines($privateEnv,@("MYSQL_ROOT_PASSWORD=$dbPassword","MYSQL_DATABASE=$schema"),[Text.UTF8Encoding]::new($false))
    & docker run -d --name $container --publish "127.0.0.1:${mysqlPort}:3306" --env-file $privateEnv --mount "source=${volume},target=/var/lib/mysql" $image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '[DOCKER_RUN_FAILED] Isolated MySQL fixture did not start' }
    $owned = $true
    Remove-Item -LiteralPath $privateEnv -Force
    $ready = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        $probe = @(& docker exec -e "MYSQL_PWD=$dbPassword" $container mysql -uroot --batch --skip-column-names -e 'SELECT 1;' 2>&1)
        if ($LASTEXITCODE -eq 0 -and $probe.Count -eq 1 -and $probe[0].Trim() -eq '1') { $ready=$true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw '[MYSQL_READY_TIMEOUT] Isolated MySQL did not become query-ready' }
    $markerSql = "CREATE DATABASE $markerSchema; CREATE TABLE $markerSchema.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO $markerSchema.__kdrive_test_fixture_marker VALUES(1,'$schema','$markerToken');"
    & docker exec -e "MYSQL_PWD=$dbPassword" $container mysql -uroot -e $markerSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '[SQL_FAILURE] Fixture identity marker creation failed' }

    $backendEvidence = Join-Path $EvidenceDir 'backend-build'
    $backendCopy = Join-Path $EvidenceDir 'backend-copy'
    $acceptedInputs = Join-Path $acceptedRoot 'build-inputs-before.json'
    $built = & $buildScript -EvidenceDir $backendEvidence -OutputDir $backendCopy -ManifestReferencePath $acceptedInputs
    if ($LASTEXITCODE -ne 0 -or -not $built.AllClassesMatched) { throw '[BUILD_PROVENANCE_FAILURE] Accepted backend source manifest/JAR verification failed' }

    $env:JAVA_HOME = 'E:/Tools/Java/jdk-21.0.12.1+1'
    $env:PORT = '8080'
    $env:DB_URL = "jdbc:mysql://127.0.0.1:${mysqlPort}/${schema}?connectionTimeZone=UTC"
    $env:DB_USER = 'root'
    $env:DB_PASSWORD = $dbPassword
    $env:JWT_SECRET = $jwtSecret
    $env:FRONTEND_ORIGIN = 'http://127.0.0.1:5173'
    $env:SEED_ENABLED = 'true'
    $env:SEED_PASSWORD = $seedPassword
    [Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE',$null,'Process')
    $java = Join-Path $env:JAVA_HOME 'bin/java.exe'
    if (-not (Test-Path $java)) { throw '[JDK_GUARD] Accepted JDK 21 executable is missing' }
    $backendProcess = Start-Process -FilePath $java -ArgumentList @('-jar',$built.EffectiveJarPath) -WorkingDirectory $backendCopy -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir 'backend.log') -RedirectStandardError (Join-Path $EvidenceDir 'backend-error.log')
    $backendReady = $false
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        if ($backendProcess.HasExited) { throw '[BACKEND_START_FAILURE] Owned Java process exited before API readiness' }
        try { $apiReady = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/v1/vehicles' -TimeoutSec 2; if ($apiReady.StatusCode -eq 200) { $backendReady=$true; break } } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $backendReady) { throw '[BACKEND_READY_TIMEOUT] API did not become ready' }

    $env:VITE_DATA_MODE = 'api'
    $env:VITE_API_BASE_URL = '/api/v1'
    $frontendProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @($viteEntry,'--host','127.0.0.1','--strictPort') -WorkingDirectory $frontendRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir 'frontend.log') -RedirectStandardError (Join-Path $EvidenceDir 'frontend-error.log')
    $frontendReady = $false
    for ($attempt=0; $attempt -lt 45; $attempt++) {
        if ($frontendProcess.HasExited) { throw '[FRONTEND_START_FAILURE] Owned Vite process exited before readiness' }
        try { $frontReady = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; if ($frontReady.StatusCode -eq 200) { $frontendReady=$true; break } } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $frontendReady) { throw '[FRONTEND_READY_TIMEOUT] Vite API mode did not become ready' }

    $env:C7B_BASE_URL = 'http://127.0.0.1:5173'
    $env:C7B_API_BASE_URL = 'http://127.0.0.1:8080/api/v1'
    $env:C7B_CONTAINER = $container
    $env:C7B_SCHEMA = $schema
    $env:C7B_MARKER_SCHEMA = $markerSchema
    $env:C7B_MARKER_TOKEN = $markerToken
    $env:C7B_DB_PASSWORD = $dbPassword
    $env:C7B_SEED_PASSWORD = $seedPassword
    $env:C7B_PLAYWRIGHT_MODULE = $playwrightModule
    $env:C7B_EVIDENCE_DIR = $EvidenceDir
    $node = (Get-Command node.exe).Source
    $browserProcess = Start-Process -FilePath $node -ArgumentList @($browserTest) -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $EvidenceDir 'browser.log') -RedirectStandardError (Join-Path $EvidenceDir 'browser-error.log')
    if (-not $browserProcess.WaitForExit(600000)) { throw '[BROWSER_TIMEOUT] Browser verification exceeded ten minutes' }
    if ($browserProcess.ExitCode -ne 0) { throw "[BROWSER_FAILURE] Browser verification exit $($browserProcess.ExitCode)" }
    $browserPassed = $true

    $manifestAfter = Get-RunManifest
    $manifestAfter | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
    $sourceStable = (($manifestBefore | ConvertTo-Json -Compress) -ceq ($manifestAfter | ConvertTo-Json -Compress))
    if (-not $sourceStable) { throw '[SOURCE_DRIFT] Browser execution inputs changed during verification' }
} finally {
    foreach ($process in @($browserProcess,$frontendProcess,$backendProcess)) {
        if ($null -ne $process) {
            $cleanupResult = Invoke-OwnedProcessCleanup -OwnedProcesses @($process)
            $processReadbacks += [pscustomobject]@{PID=$process.Id;HasExited=$process.HasExited;Cleanup=$cleanupResult}
        }
    }
    try {
        $fixtureCleanup = Stop-C7Fixture -Container $container -Port $mysqlPort -Owned $owned -ReadbackPath (Join-Path $EvidenceDir 'mysql-cleanup.json')
        $cleanupPassed = $fixtureCleanup.Passed
    } finally {
        Restore-ProcessEnvironment -SavedEnvironment $savedEnvironment
        $restored = Snapshot-ProcessEnvironment -VariableNames $variables
        $restoreExact = $true
        foreach ($key in $variables) { if ($savedEnvironment[$key] -cne $restored[$key]) { $restoreExact=$false } }
        $safeAfter = [ordered]@{}
        foreach ($key in $variables) {
            $value=$restored[$key]
            if ($key -match 'PASSWORD|TOKEN|SECRET') { $safeAfter[$key]=@{Present=(-not [string]::IsNullOrEmpty($value));Length=if($null -ne $value){$value.Length}else{0}} }
            else { $safeAfter[$key]=$value }
        }
        [pscustomobject]@{AfterRestoration=$safeAfter;EnvironmentRestoredActual=$restoreExact} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $EvidenceDir 'environment-after.json')
        $protectedAfter = @(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}}:{{.Destination}};{{end}}' $originalContainer 2>&1)
        $protectedUnchanged = ($LASTEXITCODE -eq 0 -and $protectedAfter.Count -eq 1 -and $protectedAfter[0] -ceq $originalIdentity[0])
        $processesStopped = @($processReadbacks | Where-Object { -not $_.HasExited -or -not $_.Cleanup.Success }).Count -eq 0
        $summary = [pscustomobject]@{Status=if($browserPassed -and $sourceStable -and $cleanupPassed -and $processesStopped -and $restoreExact -and $protectedUnchanged){'PASS_SCOPED'}else{'PARTIAL_BLOCKED'};BrowserPassed=$browserPassed;SourceStable=$sourceStable;CleanupPassed=$cleanupPassed;OwnedProcessesStopped=$processesStopped;EnvironmentRestored=$restoreExact;ProtectedUserMySqlUnchanged=$protectedUnchanged;Container=$container;Volume=$volume;Image=$image;Port=$mysqlPort;VolumeRetained=($owned -and $cleanupPassed);StartedAt=$startedAt.ToString('o');FinishedAt=(Get-Date).ToString('o')}
        $summary | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'summary.json')
        if (-not $restoreExact -or -not $processesStopped -or -not $protectedUnchanged) { throw '[CLEANUP_FAILURE] Owned services/env restoration or protected MySQL readback failed' }
    }
}
if (-not ($browserPassed -and $sourceStable -and $cleanupPassed)) { throw '[RUNNER_FAILURE] C7B browser verification did not pass' }
