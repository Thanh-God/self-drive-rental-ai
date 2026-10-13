[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runner = Join-Path $PSScriptRoot 'run-c10b-browser.ps1'
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
    'VITE_DATA_MODE', 'VITE_API_BASE_URL', 'VITE_PROXY_TARGET',
    'C10B_BASE_URL', 'C10B_API_BASE_URL', 'C10B_CONTAINER', 'C10B_SCHEMA',
    'C10B_MARKER_SCHEMA', 'C10B_MARKER_TOKEN', 'C10B_DB_PASSWORD', 'C10B_SEED_PASSWORD',
    'C10B_PLAYWRIGHT_MODULE', 'C10B_EVIDENCE_DIR'
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

    # 2. Unsupported shell version refused before any mutation
    $targetUnsupportedShell = Join-Path $EvidenceDir 'unsupported-shell'
    $coreShell = 'C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    if (-not (Test-Path $coreShell)) { throw '[DEPENDENCY_GUARD] PowerShell Core required for adverse shell test' }
    $shellLog = Join-Path $EvidenceDir 'unsupported-shell.log'
    $core = Start-Process $coreShell -ArgumentList @('-NoProfile','-File',$runner,'-EvidenceDir',$targetUnsupportedShell) -WindowStyle Hidden -PassThru -Wait -RedirectStandardError $shellLog
    $shellOutput = Get-Content $shellLog -Raw
    Check 'Unsupported shell version refused with UNSUPPORTED_SHELL' ($core.ExitCode -ne 0 -and $shellOutput.Contains('[UNSUPPORTED_SHELL]'))
    Check 'Unsupported shell left no evidence directory' (-not (Test-Path $targetUnsupportedShell))

    # 3. Canonical containment: outside repository runtime refused
    $outsideTarget = Join-Path $env:TEMP ("c8b-outside-" + [Guid]::NewGuid().ToString('N'))
    Refused { & $runner -EvidenceDir $outsideTarget } '[PREFLIGHT_REFUSAL]'
    Check 'Outside runtime evidence directory refused' (-not (Test-Path $outsideTarget))

    # 4. Canonical containment: sibling prefix directory refused (.runtime-sibling)
    $siblingTarget = Join-Path $repo ('.runtime-sibling-' + [Guid]::NewGuid().ToString('N'))
    Refused { & $runner -EvidenceDir $siblingTarget } '[PREFLIGHT_REFUSAL]'
    Check 'Sibling prefix evidence directory refused' (-not (Test-Path $siblingTarget))

    # 5. Canonical containment: nonexistent parent directory refused
    $nonexistentTarget = "C:\nonexistent-parent-" + [Guid]::NewGuid().ToString('N') + "\evidence"
    Refused { & $runner -EvidenceDir $nonexistentTarget } '[PREFLIGHT_REFUSAL]'
    Check 'Nonexistent parent evidence directory refused' (-not (Test-Path $nonexistentTarget))

    # 6. Existing evidence directory refused: empty directory
    $emptyTarget = Join-Path $EvidenceDir 'existing-empty-dir'
    New-Item -ItemType Directory -Path $emptyTarget | Out-Null
    Refused { & $runner -EvidenceDir $emptyTarget } '[PREFLIGHT_REFUSAL]'
    $emptyItems = @(Get-ChildItem -LiteralPath $emptyTarget)
    Check 'Existing empty directory refused and remains empty' ($emptyItems.Count -eq 0)

    # 7. Existing evidence directory refused: directory with summary
    $summaryTarget = Join-Path $EvidenceDir 'existing-summary-dir'
    New-Item -ItemType Directory -Path $summaryTarget | Out-Null
    Set-Content (Join-Path $summaryTarget 'summary.json') '{"Status":"EXISTING"}'
    $initialSummaryHash = (Get-FileHash (Join-Path $summaryTarget 'summary.json')).Hash
    Refused { & $runner -EvidenceDir $summaryTarget } '[PREFLIGHT_REFUSAL]'
    $afterSummaryHash = (Get-FileHash (Join-Path $summaryTarget 'summary.json')).Hash
    Check 'Existing summary directory refused and content unmodified' ($initialSummaryHash -eq $afterSummaryHash)

    # 8. Existing evidence directory refused: directory with session artifacts
    $sessionTarget = Join-Path $EvidenceDir 'existing-session-dir'
    New-Item -ItemType Directory -Path $sessionTarget | Out-Null
    Set-Content (Join-Path $sessionTarget 'session.txt') 'old-session-data'
    $initialSessionHash = (Get-FileHash (Join-Path $sessionTarget 'session.txt')).Hash
    Refused { & $runner -EvidenceDir $sessionTarget } '[PREFLIGHT_REFUSAL]'
    $afterSessionHash = (Get-FileHash (Join-Path $sessionTarget 'session.txt')).Hash
    Check 'Existing session directory refused and content unmodified' ($initialSessionHash -eq $afterSessionHash)

    # 9. Port occupied refused before spawn (port 8293)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8293)
    $portTarget = Join-Path $EvidenceDir 'occupied-port'
    try {
        $listener.Start()
        Refused { & $runner -EvidenceDir $portTarget -ControlProbe '' } '[PREFLIGHT_GUARD] Port 8293 occupied'
        Check 'Occupied port 8293 refused before spawn' (-not (Test-Path $portTarget))
    } finally {
        $listener.Stop()
    }

    # 10. Missing dependency refused fail-closed
    $missingTarget = Join-Path $EvidenceDir 'missing-dep'
    Refused { & $runner -EvidenceDir $missingTarget -AcceptedBuildDir '.runtime/nonexistent-build-evidence' } '[DEPENDENCY_GUARD]'
    Check 'Missing dependency refused fail-closed' (-not (Test-Path $missingTarget))

    $manifest = Join-Path $PSScriptRoot 'c10b-browser-reference-manifest.json'
    $driftMap = Get-Content $manifest -Raw | ConvertFrom-Json
    $driftMap.'frontend/package.json' = ('0' * 64)
    $driftPath = Join-Path $EvidenceDir 'drift-reference.json'
    $driftMap | ConvertTo-Json | Set-Content $driftPath
    $driftTarget = Join-Path $EvidenceDir 'drift-target'
    Refused { & $runner -EvidenceDir $driftTarget -ReferenceManifestPath $driftPath -ControlProbe Normal } '[PREFLIGHT_GUARD] Source drift'
    Check 'Actual runner refuses content drift without mutation' (-not (Test-Path $driftTarget))
    $missingManifestTarget = Join-Path $EvidenceDir 'missing-manifest-target'
    Refused { & $runner -EvidenceDir $missingManifestTarget -ReferenceManifestPath (Join-Path $EvidenceDir 'absent.json') -ControlProbe Normal } '[DEPENDENCY_GUARD]'
    Check 'Required manifest cannot be omitted' (-not (Test-Path $missingManifestTarget))

    # 11. Caller Sentinel Survival & Adverse Cleanup Failure Injection through common finally
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

    $adverseSummary = Get-Content (Join-Path $adverseTarget 'summary.json') -Raw | ConvertFrom-Json
    Check 'Adverse cleanup summary recorded FAILED status' ($adverseSummary.Status -eq 'FAILED')
    Check 'Adverse cleanup summary recorded CleanupPassed=false' ($adverseSummary.CleanupPassed -eq $false)

    # 12. Adverse Container Failure through common finally
    $adverseContainerTarget = Join-Path $EvidenceDir 'adverse-container'
    $containerCaught = ''
    try {
        & $runner -EvidenceDir $adverseContainerTarget -ControlProbe 'ContainerFailure'
    } catch {
        $containerCaught = $_.Exception.Message
    }
    Check 'Adverse container stop failure caught fail-closed' ($containerCaught.Contains('[CONTAINER_FAILURE]'))
    $containerSummary = Get-Content (Join-Path $adverseContainerTarget 'summary.json') -Raw | ConvertFrom-Json
    $stopReadback = Get-Content (Join-Path $adverseContainerTarget 'container-stop.json') -Raw | ConvertFrom-Json
    Check 'Actual container stop helper propagates native nonzero exit' ($stopReadback.ExitCode -eq 23 -and $stopReadback.Passed -eq $false)
    Check 'Adverse container summary recorded FAILED status' ($containerSummary.Status -eq 'FAILED')
    Check 'Adverse container summary recorded CleanupPassed=false' ($containerSummary.CleanupPassed -eq $false)

    # 13. Adverse Environment Restore Failure through common finally
    $adverseRestoreTarget = Join-Path $EvidenceDir 'adverse-restore'
    $restoreCaught = ''
    try {
        & $runner -EvidenceDir $adverseRestoreTarget -ControlProbe 'RestoreFailure'
    } catch {
        $restoreCaught = $_.Exception.Message
    }
    Check 'Adverse environment restore caught fail-closed' ($restoreCaught.Contains('[RESTORE_FAILURE]'))
    $restoreSummary = Get-Content (Join-Path $adverseRestoreTarget 'summary.json') -Raw | ConvertFrom-Json
    Check 'Adverse restore summary recorded FAILED status' ($restoreSummary.Status -eq 'FAILED')
    Check 'Adverse restore summary recorded CleanupPassed=false' ($restoreSummary.CleanupPassed -eq $false)

    # 14. Original exception preserved through common finally
    $exceptionTarget = Join-Path $EvidenceDir 'control-exception'
    $exceptionCaught = ''
    try {
        & $runner -EvidenceDir $exceptionTarget -ControlProbe 'Exception'
    } catch {
        $exceptionCaught = $_.Exception.Message
    }
    Check 'Original exception preserved through common finally' ($exceptionCaught.Contains('[CONTROL_EXCEPTION]'))
    $exceptionSummary = Get-Content (Join-Path $exceptionTarget 'summary.json') -Raw | ConvertFrom-Json
    Check 'Exception summary recorded FAILED status' ($exceptionSummary.Status -eq 'FAILED')

    # 15. ControlMode Normal explicit semantics
    $controlTarget = Join-Path $EvidenceDir 'control-semantics'
    & $runner -EvidenceDir $controlTarget -ControlProbe 'Normal'
    $controlSummary = Get-Content (Join-Path $controlTarget 'summary.json') -Raw | ConvertFrom-Json
    Check 'ControlMode records explicit CONTROL_ONLY status' ($controlSummary.Status -eq 'CONTROL_ONLY')
    Check 'ControlMode records BusinessVerified=false' ($controlSummary.BusinessVerified -eq $false)
    Check 'ControlMode records BrowserVerified=false' ($controlSummary.BrowserVerified -eq $false)
    Check 'ControlMode does not invent container' ($null -eq $controlSummary.Container)
    Check 'ControlMode does not invent volume' ($null -eq $controlSummary.Volume)
    Check 'ControlMode records CleanupPassed=true' ($controlSummary.CleanupPassed -eq $true)

    # 16. Caller Environment Snapshot & Restore (Existing vs Absent x Normal vs Exception)
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
