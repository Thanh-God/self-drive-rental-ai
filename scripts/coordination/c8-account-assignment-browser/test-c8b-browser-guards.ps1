[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runner = Join-Path $PSScriptRoot 'run-c8b-browser.ps1'
$helper = Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'

if (Test-Path -LiteralPath $EvidenceDir) {
    throw '[PREFLIGHT_REFUSAL] Guard evidence directory already exists'
}
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
$EvidenceDir = (Resolve-Path -LiteralPath $EvidenceDir).Path

Import-Module $helper -Force

$variables = @(
    'JAVA_HOME', 'PORT', 'DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET',
    'FRONTEND_ORIGIN', 'SEED_ENABLED', 'SEED_PASSWORD', 'SPRING_PROFILES_ACTIVE',
    'VITE_DATA_MODE', 'VITE_API_BASE_URL',
    'C8B_BASE_URL', 'C8B_API_BASE_URL', 'C8B_CONTAINER', 'C8B_SCHEMA',
    'C8B_MARKER_SCHEMA', 'C8B_MARKER_TOKEN', 'C8B_DB_PASSWORD', 'C8B_SEED_PASSWORD',
    'C8B_PLAYWRIGHT_MODULE', 'C8B_EVIDENCE_DIR'
)
$originalEnv = Snapshot-ProcessEnvironment -VariableNames $variables
$checks = @()
$sentinel = $null

function Check([string]$name, [bool]$passed) {
    if (-not $passed) {
        throw "[ASSERTION_FAILURE] $name"
    }
    $script:checks += [pscustomobject]@{ Name = $name; Passed = $passed }
}

function Refused([scriptblock]$action, [string]$cause) {
    $actual = ''
    try {
        & $action
    } catch {
        $actual = $_.Exception.Message
    }
    if (-not $actual.Contains($cause)) {
        throw "[ASSERTION_FAILURE] Expected refusal '$cause' but got '$actual'"
    }
}

try {
    # 1. Unsupported ControlProbe refused before any mutation
    $targetUnsupported = Join-Path $EvidenceDir 'unsupported-probe'
    Refused { & $runner -EvidenceDir $targetUnsupported -ControlProbe 'UnsupportedMode' } '[PREFLIGHT_GUARD]'
    Check 'Unsupported ControlProbe refused before directory creation' (-not (Test-Path $targetUnsupported))

    # 2. Existing evidence directory refused
    $targetExisting = Join-Path $EvidenceDir 'existing-dir'
    New-Item -ItemType Directory -Path $targetExisting | Out-Null
    Set-Content (Join-Path $targetExisting 'sentinel.txt') 'keep'
    Refused { & $runner -EvidenceDir $targetExisting } '[PREFLIGHT_REFUSAL]'
    Check 'Existing evidence directory refused and content unmodified' ((Get-Content (Join-Path $targetExisting 'sentinel.txt')) -eq 'keep')

    # 3. Non-runtime evidence directory refused
    $outsideTarget = Join-Path $env:TEMP ("c8b-guard-" + [Guid]::NewGuid().ToString('N'))
    Refused { & $runner -EvidenceDir $outsideTarget } '[PREFLIGHT_REFUSAL]'
    Check 'Outside runtime evidence directory refused' (-not (Test-Path $outsideTarget))

    # 4. Port occupied refused before spawn (test port 8080)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8080)
    $portTarget = Join-Path $EvidenceDir 'occupied-port'
    try {
        $listener.Start()
        Refused { & $runner -EvidenceDir $portTarget -ControlProbe '' } '[PREFLIGHT_GUARD] Port 8080 occupied'
        Check 'Occupied port 8080 refused before spawn' (-not (Test-Path $portTarget))
    } finally {
        $listener.Stop()
    }

    # 5. Caller Sentinel Survival & Adverse Cleanup Failure Injection
    $sentinel = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $null = $sentinel.Handle

    $adverseTarget = Join-Path $EvidenceDir 'adverse-cleanup'
    $adverseCaught = ''
    try {
        & $runner -EvidenceDir $adverseTarget -ControlProbe 'CleanupFailure'
    } catch {
        $adverseCaught = $_.Exception.Message
    }
    Check 'Runner failed closed on injected cleanup failure' ($adverseCaught.Contains('[RUNNER_FAILURE]'))
    Check 'Caller sentinel remained alive despite runner cleanup failure' (-not $sentinel.HasExited)

    $adverseReadback = Get-Content (Join-Path $adverseTarget 'adverse-cleanup.json') -Raw | ConvertFrom-Json
    Check 'Adverse cleanup recorded owned process survival' (-not $adverseReadback.HasExited)

    # 6. ControlMode Explicit Semantics
    $controlTarget = Join-Path $EvidenceDir 'control-semantics'
    & $runner -EvidenceDir $controlTarget -ControlProbe 'Normal'
    $controlSummary = Get-Content (Join-Path $controlTarget 'summary.json') -Raw | ConvertFrom-Json
    Check 'ControlMode records explicit CONTROL_ONLY status' ($controlSummary.Status -eq 'CONTROL_ONLY')
    Check 'ControlMode records BusinessVerified=false' ($controlSummary.BusinessVerified -eq $false)
    Check 'ControlMode records BrowserVerified=false' ($controlSummary.BrowserVerified -eq $false)
    Check 'ControlMode does not invent container' ($null -eq $controlSummary.Container)
    Check 'ControlMode does not invent volume' ($null -eq $controlSummary.Volume)

    # 7. Caller Environment Snapshot & Restore (Existing vs Absent x Normal vs Exception)
    foreach ($presence in @('existing', 'absent')) {
        foreach ($v in $variables) {
            [Environment]::SetEnvironmentVariable($v, $(if ($presence -eq 'existing') { 'CALLER_' + $v } else { $null }), 'Process')
        }
        $callerSnap = Snapshot-ProcessEnvironment -VariableNames $variables

        foreach ($mode in @('Normal', 'Exception')) {
            $modeTarget = Join-Path $EvidenceDir "env-$presence-$mode"
            $modeException = ''
            try {
                & $runner -EvidenceDir $modeTarget -ControlProbe $mode
            } catch {
                $modeException = $_.Exception.Message
            }
            if ($mode -eq 'Exception') {
                Check "Injected exception caught ($presence)" ($modeException.Contains('[CONTROL_EXCEPTION]'))
            }

            $afterSnap = Snapshot-ProcessEnvironment -VariableNames $variables
            $restoredExact = $true
            foreach ($v in $variables) {
                if ($callerSnap[$v] -cne $afterSnap[$v]) {
                    $restoredExact = $false
                }
            }
            Check "Caller environment restored exactly ($presence/$mode)" $restoredExact
        }
    }

    [pscustomobject]@{
        Passed = $true
        TotalChecks = $checks.Count
        Checks = $checks
    } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'matrix-results.json')
    Write-Output "ALL $($checks.Count)/$($checks.Count) GUARD CHECKS PASSED SUCCESSFULLY."

} catch {
    [pscustomobject]@{
        Passed = $false
        Checks = $checks
        Failure = $_.Exception.Message
    } | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'matrix-failure.json')
    throw
} finally {
    if ($sentinel -and -not $sentinel.HasExited) {
        $null = Invoke-OwnedProcessCleanup -OwnedProcesses @($sentinel)
    }
    Restore-ProcessEnvironment -SavedEnvironment $originalEnv
}
