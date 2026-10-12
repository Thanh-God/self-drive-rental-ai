[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,

    [string]$EvidenceRoot,

    [string]$AcceptedBuildDir = '.runtime/coordination-c8a-final-review-20261012-110646/evidence/live',

    [string]$BrowserScript = 'verify-c8b-browser.cjs',

    [switch]$PreflightOnly,

    [string]$ControlProbe = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$validProbes = @('', 'Normal', 'Exception', 'CleanupFailure', 'RestoreFailure')
if (-not [string]::IsNullOrEmpty($ControlProbe) -and $validProbes -notcontains $ControlProbe) {
    throw "[PREFLIGHT_GUARD] Unsupported ControlProbe/ControlMode: $ControlProbe"
}

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'
}

function FullPath([string]$path) {
    if ([IO.Path]::IsPathRooted($path)) {
        return [IO.Path]::GetFullPath($path)
    }
    return [IO.Path]::GetFullPath((Join-Path $repo $path))
}

$EvidenceDir = FullPath $EvidenceDir
$runtime = FullPath '.runtime'
if ($EvidenceRoot) {
    $EvidenceRoot = FullPath $EvidenceRoot
} else {
    $EvidenceRoot = $runtime
}

if (-not $EvidenceDir.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw '[PREFLIGHT_REFUSAL] Evidence must be a new child under repository runtime'
}
if (Test-Path -LiteralPath $EvidenceDir) {
    throw '[PREFLIGHT_REFUSAL] Evidence directory already exists'
}

$helper = Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
$fixtureHelper = Join-Path $repo 'scripts/coordination/c7-incident-report/fixture-cleanup.ps1'
$browserEntry = Join-Path $PSScriptRoot $BrowserScript
$controls = Join-Path $PSScriptRoot 'browser-controls.cjs'
$frontend = Join-Path $repo 'frontend'
$vite = Join-Path $frontend 'node_modules/vite/bin/vite.js'
$playwright = Join-Path $repo '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'

$accepted = FullPath $AcceptedBuildDir
$acceptedSource = Join-Path $accepted 'source-after.json'
$acceptedJar = Join-Path $accepted 'backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar'
$expectedJarHash = '7FF54151D4301CE870C52116B55643A3FF1283BACAEF1182621DFC8F052A2725'

foreach ($p in @($helper, $fixtureHelper, $browserEntry, $controls, $vite, $acceptedSource, $acceptedJar, (Join-Path $playwright 'index.js'))) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
        throw "[DEPENDENCY_GUARD] Missing required file: $p"
    }
}

$backendReference = Get-Content -LiteralPath $acceptedSource -Raw | ConvertFrom-Json
foreach ($prop in $backendReference.PSObject.Properties) {
    $file = Join-Path $repo $prop.Name
    if (-not (Test-Path $file) -or (Get-FileHash $file).Hash -ne $prop.Value) {
        throw "[SOURCE_DRIFT] Accepted backend differs: $($prop.Name)"
    }
}

$actualJarHash = (Get-FileHash $acceptedJar).Hash
if ($actualJarHash -ne $expectedJarHash) {
    throw "[SOURCE_DRIFT] Accepted JAR hash differs: expected $expectedJarHash, actual $actualJarHash"
}

Import-Module $helper -Force
. $fixtureHelper

$variables = @(
    'JAVA_HOME', 'PORT', 'DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET',
    'FRONTEND_ORIGIN', 'SEED_ENABLED', 'SEED_PASSWORD', 'SPRING_PROFILES_ACTIVE',
    'VITE_DATA_MODE', 'VITE_API_BASE_URL',
    'C8B_BASE_URL', 'C8B_API_BASE_URL', 'C8B_CONTAINER', 'C8B_SCHEMA',
    'C8B_MARKER_SCHEMA', 'C8B_MARKER_TOKEN', 'C8B_DB_PASSWORD', 'C8B_SEED_PASSWORD',
    'C8B_PLAYWRIGHT_MODULE', 'C8B_EVIDENCE_DIR'
)
$savedEnv = Snapshot-ProcessEnvironment -VariableNames $variables

$owned = $false
$processes = @()
$browserPassed = $false
$cleanupPassed = $true
$mysqlPort = 33626
$container = ''
$volume = ''
$schema = ''
$markerSchema = ''
$token = ''
$privateFile = ''

if (-not $ControlProbe) {
    foreach ($port in @(8080, 5173)) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
        try {
            $probe.Start()
        } catch {
            throw "[PREFLIGHT_GUARD] Port $port occupied"
        } finally {
            $probe.Stop()
        }
    }
    for (; $mysqlPort -le 33725; $mysqlPort++) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $mysqlPort)
        $free = $false
        try {
            $probe.Start()
            $free = $true
        } catch {
        } finally {
            $probe.Stop()
        }
        if ($free) { break }
    }
    if ($mysqlPort -gt 33725) {
        throw '[PREFLIGHT_GUARD] No free MySQL test port'
    }

    $info = @(& docker info --format '{{.ServerVersion}}|{{.OSType}}' 2>&1)
    if ($LASTEXITCODE -ne 0 -or $info.Count -ne 1 -or $info[0] -notmatch '^\d+(\.\d+)+\|linux$') {
        throw '[PREFLIGHT_GUARD] Docker unavailable'
    }

    $originalIdentity = @(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' kltn-phase5-rerun)
    if ($LASTEXITCODE -ne 0 -or $originalIdentity.Count -ne 1 -or $originalIdentity[0] -notmatch '\|true\|') {
        throw '[PREFLIGHT_GUARD] Protected original identity unavailable'
    }

    & docker image inspect mysql:8.4.11 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw '[DEPENDENCY_GUARD] MySQL image unavailable'
    }

    $id = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $container = "kltn-c8b-browser-$id"
    $volume = "vol-$container"
    $schema = "kdrive_c8b_$id"
    $markerSchema = "kdrive_c8b_meta_$id"

    $names = @(& docker ps -a --format '{{.Names}}')
    $volumes = @(& docker volume ls --format '{{.Name}}')
    if ($names -contains $container -or $volumes -contains $volume) {
        throw '[PREFLIGHT_REFUSAL] Fixture identity collision'
    }
}

New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$privateFile = Join-Path $EvidenceDir 'mysql.private.env'

try {
    if ($PreflightOnly) {
        [pscustomobject]@{
            Status = 'PREFLIGHT_PASS'
            PreflightOnly = $true
            JarHash = $actualJarHash
            BackendDrift = 0
        } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
        return
    }

    if ($ControlProbe) {
        $env:DB_URL = 'SYNTHETIC_CONTROL'
        $controlProc = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -PassThru -WindowStyle Hidden
        $null = $controlProc.Handle
        $processes += ,$controlProc

        if ($ControlProbe -eq 'CleanupFailure') {
            $cleanupRes = Invoke-OwnedProcessCleanup -OwnedProcesses @($controlProc) -CustomStopProcess { param($p) throw 'Injected cleanup failure' }
            [pscustomobject]@{
                HasExited = $controlProc.HasExited
                ProcessId = $controlProc.Id
                CleanupResult = $cleanupRes
            } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'adverse-cleanup.json')
            if (-not $cleanupRes.Success -or $cleanupRes.CleanupFailed) {
                throw "[RUNNER_FAILURE] Injected cleanup failure on owned processes"
            }
        }

        if ($ControlProbe -eq 'Exception') {
            throw '[CONTROL_EXCEPTION] Injected exception after control spawn'
        }

        [pscustomobject]@{
            Status = 'CONTROL_ONLY'
            BusinessVerified = $false
            BrowserVerified = $false
            ControlProbe = $ControlProbe
            Container = $null
            Volume = $null
        } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
        return
    }

    $password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $seedPassword = [Guid]::NewGuid().ToString('N') + 'Aa9!'
    $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')

    [IO.File]::WriteAllLines($privateFile, @("MYSQL_ROOT_PASSWORD=$password", "MYSQL_DATABASE=$schema"), [Text.UTF8Encoding]::new($false))
    & docker run -d --name $container --publish "127.0.0.1:${mysqlPort}:3306" --env-file $privateFile --mount "source=${volume},target=/var/lib/mysql" mysql:8.4.11 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw '[DOCKER_RUN_FAILURE] Fixture start failed'
    }
    $owned = $true

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $probe = @(& docker exec -e "MYSQL_PWD=$password" $container mysql -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$schema';" 2>&1)
            if ($LASTEXITCODE -eq 0 -and ($probe -join '').Trim() -eq '1') {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw '[MYSQL_READY_TIMEOUT] Final schema not ready'
    }

    & docker exec -e "MYSQL_PWD=$password" $container mysql -uroot -e "CREATE DATABASE $markerSchema; CREATE TABLE $markerSchema.__kdrive_test_fixture_marker(id INT PRIMARY KEY, target_schema VARCHAR(255), marker_token VARCHAR(255)); INSERT INTO $markerSchema.__kdrive_test_fixture_marker VALUES(1, '$schema', '$token');" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw '[SQL_FAILURE] Marker creation failed'
    }

    $env:JAVA_HOME = 'E:/Tools/Java/jdk-21.0.12.1+1'
    $env:PORT = '8080'
    $env:DB_URL = "jdbc:mysql://127.0.0.1:${mysqlPort}/${schema}?connectionTimeZone=UTC"
    $env:DB_USER = 'root'
    $env:DB_PASSWORD = $password
    $env:JWT_SECRET = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    $env:FRONTEND_ORIGIN = 'http://127.0.0.1:5173'
    $env:SEED_ENABLED = 'true'
    $env:SEED_PASSWORD = $seedPassword
    [Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE', $null, 'Process')

    $java = Join-Path $env:JAVA_HOME 'bin/java.exe'
    $backend = Start-Process $java -ArgumentList @('-jar', $acceptedJar) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'backend.log') -RedirectStandardError (Join-Path $EvidenceDir 'backend-error.log')
    $null = $backend.Handle
    $processes += ,$backend

    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        if ($backend.HasExited) {
            throw '[BACKEND_FAILURE] Owned backend exited prematurely'
        }
        try {
            if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/api/v1/vehicles' -TimeoutSec 2).StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw '[BACKEND_TIMEOUT] Backend API unavailable'
    }

    for ($i = 0; $i -lt 10; $i++) {
        $pProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5173)
        $free = $false
        try {
            $pProbe.Start()
            $free = $true
        } catch {} finally {
            $pProbe.Stop()
        }
        if ($free) { break }
        Start-Sleep -Milliseconds 500
    }

    $env:VITE_DATA_MODE = 'api'
    $env:VITE_API_BASE_URL = '/api/v1'
    $front = Start-Process (Get-Command node.exe).Source -ArgumentList @($vite, 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'frontend.log') -RedirectStandardError (Join-Path $EvidenceDir 'frontend-error.log')
    $null = $front.Handle
    $processes += ,$front
    Start-Sleep -Milliseconds 500

    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        if ($front.HasExited) {
            throw '[FRONTEND_FAILURE] Vite exited prematurely'
        }
        try {
            if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/' -TimeoutSec 2).StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw '[FRONTEND_TIMEOUT] Frontend preview unavailable'
    }

    $env:C8B_BASE_URL = 'http://127.0.0.1:5173'
    $env:C8B_API_BASE_URL = 'http://127.0.0.1:8080/api/v1'
    $env:C8B_CONTAINER = $container
    $env:C8B_SCHEMA = $schema
    $env:C8B_MARKER_SCHEMA = $markerSchema
    $env:C8B_MARKER_TOKEN = $token
    $env:C8B_DB_PASSWORD = $password
    $env:C8B_SEED_PASSWORD = $seedPassword
    $env:C8B_PLAYWRIGHT_MODULE = $playwright
    $env:C8B_EVIDENCE_DIR = $EvidenceDir

    $browser = Start-Process (Get-Command node.exe).Source -ArgumentList @($browserEntry) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'browser.log') -RedirectStandardError (Join-Path $EvidenceDir 'browser-error.log')
    $null = $browser.Handle
    $processes += ,$browser

    if (-not $browser.WaitForExit(180000)) {
        throw '[BROWSER_TIMEOUT] Browser test did not complete within 3 minutes'
    }
    if ($browser.ExitCode -ne 0) {
        throw "[BROWSER_FAILURE] Browser test exited with code $($browser.ExitCode)"
    }
    $browserPassed = $true

    [pscustomobject]@{
        Status = 'PASS_SCOPED'
        BusinessVerified = $true
        BrowserVerified = $true
        Container = $container
        Volume = $volume
        Schema = $schema
        MysqlPort = $mysqlPort
        CleanupPassed = $true
    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')

} finally {
    $cleanupLog = [Collections.Generic.List[string]]::new()
    $logScript = { param($msg) $cleanupLog.Add($msg) }

    try {
        if ($processes.Count -gt 0) {
            Invoke-OwnedProcessCleanup -OwnedProcesses $processes -LogAction $logScript
        }
    } catch {
        $cleanupPassed = $false
        $cleanupLog.Add("Process cleanup failed: $($_.Exception.Message)")
    }

    if ($owned -and -not [string]::IsNullOrEmpty($container)) {
        try {
            & docker stop $container | Out-Null
            $cleanupLog.Add("Stopped fixture container $container (volume $volume retained)")
        } catch {
            $cleanupLog.Add("Failed to stop container: $($_.Exception.Message)")
        }
    }

    try {
        Restore-ProcessEnvironment -SavedEnvironment $savedEnv
        $cleanupLog.Add("Process environment restored")
    } catch {
        $cleanupPassed = $false
        $cleanupLog.Add("Environment restore failed: $($_.Exception.Message)")
    }

    if (Test-Path -LiteralPath $EvidenceDir) {
        [pscustomobject]@{
            CleanupPassed = $cleanupPassed
            Log = $cleanupLog
        } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'cleanup.json')
    }
}
