[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,

    [string]$EvidenceRoot,

    [string]$AcceptedBuildDir = '.runtime/coordination-c9-codexa-20261012-162636/evidence/backend-live-b',

    [string]$BrowserScript = 'verify-c9-browser.cjs',

    [switch]$PreflightOnly,

    [string]$ReferenceManifestPath = '',
    [string]$ControlProbe = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$validProbes = @('', 'Normal', 'Exception', 'CleanupFailure', 'RestoreFailure', 'ContainerFailure')
if (-not [string]::IsNullOrEmpty($ControlProbe) -and $validProbes -notcontains $ControlProbe) {
    throw "[PREFLIGHT_GUARD] Unsupported ControlProbe/ControlMode: $ControlProbe"
}

if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'
}

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName

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
$controls = Join-Path $repo 'scripts/coordination/c8-account-assignment-browser/browser-controls.cjs'
$frontend = Join-Path $repo 'frontend'
$vite = Join-Path $frontend 'node_modules/vite/bin/vite.js'
$playwright = Join-Path $repo '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'

$accepted = FullPath $AcceptedBuildDir
$acceptedSource = Join-Path $accepted 'source-after.json'
$acceptedJar = Join-Path $accepted 'backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar'
if (-not (Test-Path (Join-Path $accepted 'build/build-provenance-report.json'))) { throw '[DEPENDENCY_GUARD] Missing JAR provenance report' }
$expectedJarHash = (Get-Content (Join-Path $accepted 'build/build-provenance-report.json') -Raw | ConvertFrom-Json).JarSHA256

foreach ($p in @($helper, $fixtureHelper, $browserEntry, $controls, $vite, $acceptedSource, $acceptedJar, (Join-Path $playwright 'index.js'))) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
        throw "[DEPENDENCY_GUARD] Missing required file: $p"
    }
}

$c8bManifestFile = if ($ReferenceManifestPath) { FullPath $ReferenceManifestPath } else { Join-Path $PSScriptRoot 'c9-browser-reference-manifest.json' }
if (-not (Test-Path -LiteralPath $c8bManifestFile)) { throw '[DEPENDENCY_GUARD] Missing C8B reference manifest' }
. (Join-Path $PSScriptRoot 'c9-inputs.ps1')
$inputBefore = Get-C9Inputs $repo $accepted
if (Test-Path -LiteralPath $c8bManifestFile) {
    $c8bManifest = Get-Content -LiteralPath $c8bManifestFile -Raw | ConvertFrom-Json
    if (@($c8bManifest.PSObject.Properties).Count -ne $inputBefore.Count -or $inputBefore.Count -eq 0) { throw '[SOURCE_DRIFT] C8B input keyset differs' }
    foreach ($prop in $c8bManifest.PSObject.Properties) {
        $file = Join-Path $repo $prop.Name
        if (-not (Test-Path $file)) {
            throw "[PREFLIGHT_GUARD] Missing dependency: $($prop.Name)"
        }
        $h = (Get-FileHash $file).Hash
        if ($h -ne $prop.Value) {
            throw "[PREFLIGHT_GUARD] Source drift: $($prop.Name) expected $($prop.Value), actual $h"
        }
    }
}

$backendReference = Get-Content -LiteralPath $acceptedSource -Raw | ConvertFrom-Json
foreach ($prop in ($backendReference.PSObject.Properties | Where-Object { $_.Name.StartsWith('backend/') })) {
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
    'C9_BASE_URL', 'C9_API_BASE_URL', 'C9_CONTAINER', 'C9_SCHEMA',
    'C9_MARKER_SCHEMA', 'C9_MARKER_TOKEN', 'C9_DB_PASSWORD', 'C9_SEED_PASSWORD',
    'C9_PLAYWRIGHT_MODULE', 'C9_EVIDENCE_DIR'
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
    if ($LASTEXITCODE -ne 0 -or $originalIdentity.Count -ne 1 -or $originalIdentity[0] -notmatch '\|(true|false)\|') {
        throw '[PREFLIGHT_GUARD] Protected original identity unavailable'
    }

    & docker image inspect mysql:8.4.11 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw '[DEPENDENCY_GUARD] MySQL image unavailable'
    }

    $id = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $container = "kltn-c9-browser-$id"
    $volume = "vol-$container"
    $schema = "kdrive_c9_$id"
    $markerSchema = "kdrive_c9_meta_$id"

    $names = @(& docker ps -a --format '{{.Names}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker inventory failed' }
    $volumes = @(& docker volume ls --format '{{.Name}}')
    if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Volume inventory failed' }
    if ($names -contains $container -or $volumes -contains $volume) {
        throw '[PREFLIGHT_REFUSAL] Fixture identity collision'
    }
}

New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$privateFile = Join-Path $EvidenceDir 'mysql.private.env'
$inputBefore | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')

$originalError = $null
$cleanupError = $null
$envRestoreError = $null

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

        if ($ControlProbe -eq 'Exception') {
            throw '[CONTROL_EXCEPTION] Injected exception after control spawn'
        }
    } else {
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
        for ($i = 0; $i -lt 120; $i++) {
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

        for ($i = 0; $i -lt 30; $i++) {
            $p8080 = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8080)
            $free = $false
            try {
                $p8080.Start()
                $free = $true
            } catch {} finally {
                $p8080.Stop()
            }
            if ($free) { break }
            Start-Sleep -Milliseconds 500
        }

        for ($i = 0; $i -lt 30; $i++) {
            $tcp = [Net.Sockets.TcpClient]::new()
            $connected = $false
            try {
                $tcp.Connect('127.0.0.1', $mysqlPort)
                $connected = $tcp.Connected
            } catch {} finally {
                $tcp.Dispose()
            }
            if ($connected) { break }
            Start-Sleep -Milliseconds 500
        }

        $java = Join-Path $env:JAVA_HOME 'bin/java.exe'
        $backend = Start-Process $java -ArgumentList @('-Xms128m', '-Xmx512m', '-jar', $acceptedJar) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'backend.log') -RedirectStandardError (Join-Path $EvidenceDir 'backend-error.log')
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

        $env:C9_BASE_URL = 'http://127.0.0.1:5173'
        $env:C9_API_BASE_URL = 'http://127.0.0.1:8080/api/v1'
        $env:C9_CONTAINER = $container
        $env:C9_SCHEMA = $schema
        $env:C9_MARKER_SCHEMA = $markerSchema
        $env:C9_MARKER_TOKEN = $token
        $env:C9_DB_PASSWORD = $password
        $env:C9_SEED_PASSWORD = $seedPassword
        $env:C9_PLAYWRIGHT_MODULE = $playwright
        $env:C9_EVIDENCE_DIR = $EvidenceDir

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
    }

} catch {
    $originalError = $_
} finally {
    $cleanupLog = [Collections.Generic.List[string]]::new()
    $logScript = { param($msg) $cleanupLog.Add($msg) }

    try {
        if ($processes.Count -gt 0) {
            $customStop = $null
            if ($ControlProbe -eq 'CleanupFailure') {
                $customStop = { param($p) throw '[INJECTED_CLEANUP_FAILURE] Injected owned process cleanup failure' }
            }
            $cleanupRes = if ($customStop) {
                Invoke-OwnedProcessCleanup -OwnedProcesses $processes -LogAction $logScript -CustomStopProcess $customStop
            } else {
                Invoke-OwnedProcessCleanup -OwnedProcesses $processes -LogAction $logScript
            }
            if (-not $cleanupRes.Success -or $cleanupRes.CleanupFailed) {
                $cleanupPassed = $false
                if (-not $cleanupError) {
                    $cleanupError = '[RUNNER_FAILURE] Injected cleanup failure on owned processes'
                }
            }
        }
    } catch {
        $cleanupPassed = $false
        $cleanupLog.Add("Process cleanup failed: $($_.Exception.Message)")
        if (-not $cleanupError) {
            $cleanupError = $_
        }
    }

    if ($ControlProbe -eq 'CleanupFailure') {
        $fallback = Invoke-OwnedProcessCleanup -OwnedProcesses $processes
        $cleanupLog.Add("Adverse-test owned process fallback stopped: $($fallback.Success)")
    }

    if ($ControlProbe -eq 'ContainerFailure' -or ($owned -and $container)) {
        try {
            $stopResult = if ($ControlProbe -eq 'ContainerFailure') {
                Stop-C9OwnedContainer -Container 'kltn-c9-control-fixture' -Owned $true -InvokeCommand { param($verb, $name) [pscustomobject]@{ExitCode=23;Output=@('Injected native stop failure')} }
            } else { Stop-C9OwnedContainer -Container $container -Owned $owned }
            $stopResult | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'container-stop.json')
            if (-not $stopResult.Passed) { throw "[CONTAINER_FAILURE] $($stopResult.Stage) exited $($stopResult.ExitCode) or invalid stopped-state readback" }
            $cleanupLog.Add("Stopped fixture container $container (volume $volume retained)")
        } catch {
            $cleanupPassed = $false
            $cleanupLog.Add($_.Exception.Message)
            if (-not $cleanupError) { $cleanupError = $_ }
        }
    }

    try {
        if ($ControlProbe -eq 'RestoreFailure') {
            throw '[RESTORE_FAILURE] Injected environment restore failure'
        }
        Restore-ProcessEnvironment -SavedEnvironment $savedEnv
        $envAfter = Snapshot-ProcessEnvironment -VariableNames $variables
        foreach ($v in $variables) { if ($savedEnv[$v] -cne $envAfter[$v]) { throw "[RESTORE_FAILURE] Caller environment differs: $v" } }
        $cleanupLog.Add("Process environment restored and independently compared")
    } catch {
        $cleanupPassed = $false
        $cleanupLog.Add("Environment restore failed: $($_.Exception.Message)")
        if (-not $envRestoreError) {
            $envRestoreError = $_
        }
    }

    if ($ControlProbe -eq 'RestoreFailure') { Restore-ProcessEnvironment -SavedEnvironment $savedEnv }
    $inputAfter = Get-C9Inputs $repo $accepted
    $inputAfter | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
    if (($inputBefore | ConvertTo-Json -Compress) -cne ($inputAfter | ConvertTo-Json -Compress)) { $cleanupPassed = $false; $cleanupError = '[SOURCE_DRIFT] Inputs changed during execution' }
    if (Test-Path -LiteralPath $EvidenceDir) {
        [pscustomobject]@{
            CleanupPassed = $cleanupPassed
            Log = $cleanupLog
        } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'cleanup.json')

        $finalStatus = if ($originalError) {
            'FAILED'
        } elseif ($ControlProbe -eq 'Normal' -and $cleanupPassed) {
            'CONTROL_ONLY'
        } elseif ($ControlProbe -in @('CleanupFailure', 'RestoreFailure', 'ContainerFailure', 'Exception')) {
            'FAILED'
        } elseif ($browserPassed -and $cleanupPassed) {
            'PASS_SCOPED'
        } else {
            'FAILED'
        }

        $isBusinessVerified = ($finalStatus -eq 'PASS_SCOPED')
        $isBrowserVerified = ($finalStatus -eq 'PASS_SCOPED')

        [pscustomobject]@{
            Status = $finalStatus
            BusinessVerified = $isBusinessVerified
            BrowserVerified = $isBrowserVerified
            Container = if ($container) { $container } else { $null }
            Volume = if ($volume) { $volume } else { $null }
            Schema = if ($schema) { $schema } else { $null }
            MysqlPort = if ($container) { $mysqlPort } else { $null }
            CleanupPassed = $cleanupPassed
            ControlProbe = if ($ControlProbe) { $ControlProbe } else { $null }
        } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
    }

    if ($originalError) {
        throw $originalError
    }
    if ($cleanupError) {
        throw $cleanupError
    }
    if ($envRestoreError) {
        throw $envRestoreError
    }
}
