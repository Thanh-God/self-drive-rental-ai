# test-b02-cleanup-adverse.ps1
# Kiểm tra toàn diện B02: Cleanup failure invalidation, Outer finally env restore (4 cases same-process) & Sentinel

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$RunnerScript = Join-Path $ScriptDir "run-checkpoint-b.ps1"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $EvidenceDir = Join-Path $ScriptDir "evidence\test-b02-adverse"
}
if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$reportFile = Join-Path $EvidenceDir "test-b02-adverse-report.json"

Write-Host "=== B02 Cleanup Failure Invalidation & Caller Same-Process Env Restore Test ==="

# -----------------------------------------------------------------------------
# 1. Khởi tạo tiến trình sentinel độc lập (unrelated process)
# -----------------------------------------------------------------------------
$sentinel = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-Command", "Start-Sleep -Seconds 120" -WindowStyle Hidden -PassThru
$sentinelPid = $sentinel.Id
Write-Host "Spawned sentinel process: PID=$sentinelPid"

$case1Passed = $false
$case2Passed = $false
$case3Passed = $false
$case4Passed = $false
$cleanupInvalidatePassed = $false
$sentinelAlivePassed = $false

try {
    # -----------------------------------------------------------------------------
    # 2. Test External Caller SAME-PROCESS 4 Cases: (existing vs absent) × (normal vs exception)
    # -----------------------------------------------------------------------------
    Write-Host "--- Testing External Caller Same-Process 4 Cases ---"

    # Case 1: Existing variable x Normal execution
    $env:PROBE_EXISTING_VAR = "INITIAL_VAL_NORMAL_1"
    $refusalEv1 = Join-Path $EvidenceDir "probe-norm-1-$(Get-Random)"
    & $RunnerScript -EvidenceDir $refusalEv1 -RefusalTestOnly
    $case1Passed = ($env:PROBE_EXISTING_VAR -eq "INITIAL_VAL_NORMAL_1")
    Write-Host "Case 1 (Existing x Normal): $case1Passed (Value: $env:PROBE_EXISTING_VAR)"

    # Case 2: Absent variable x Normal execution
    [Environment]::SetEnvironmentVariable("PROBE_ABSENT_VAR", $null, "Process")
    $refusalEv2 = Join-Path $EvidenceDir "probe-norm-2-$(Get-Random)"
    & $RunnerScript -EvidenceDir $refusalEv2 -RefusalTestOnly
    $case2Val = [Environment]::GetEnvironmentVariable("PROBE_ABSENT_VAR", "Process")
    $case2Passed = [string]::IsNullOrEmpty($case2Val)
    Write-Host "Case 2 (Absent x Normal): $case2Passed (Value is null/empty: $($null -eq $case2Val))"

    # Case 3: Existing variable x Exception execution
    $env:PROBE_EXISTING_VAR = "INITIAL_VAL_EXCEPTION_3"
    $adverseEv3 = Join-Path $EvidenceDir "probe-ex-3-$(Get-Random)"
    try {
        & $RunnerScript -EvidenceDir $adverseEv3 -SimulateDockerInventoryFailure
    } catch {
        # Exception expected
    }
    $case3Passed = ($env:PROBE_EXISTING_VAR -eq "INITIAL_VAL_EXCEPTION_3")
    Write-Host "Case 3 (Existing x Exception): $case3Passed (Value: $env:PROBE_EXISTING_VAR)"

    # Case 4: Absent variable x Exception execution
    [Environment]::SetEnvironmentVariable("PROBE_ABSENT_VAR", $null, "Process")
    $adverseEv4 = Join-Path $EvidenceDir "probe-ex-4-$(Get-Random)"
    try {
        & $RunnerScript -EvidenceDir $adverseEv4 -SimulateDockerInventoryFailure
    } catch {
        # Exception expected
    }
    $case4Val = [Environment]::GetEnvironmentVariable("PROBE_ABSENT_VAR", "Process")
    $case4Passed = [string]::IsNullOrEmpty($case4Val)
    Write-Host "Case 4 (Absent x Exception): $case4Passed (Value is null/empty: $($null -eq $case4Val))"

    # -----------------------------------------------------------------------------
    # 3. Test Cleanup Failure Invalidates Success (Exit Code Non-Zero)
    # -----------------------------------------------------------------------------
    Write-Host "--- Testing Cleanup Failure Invalidates Success ---"
    $cleanupFailEv = Join-Path $EvidenceDir "cleanup-fail-$(Get-Random)"
    $logFile = Join-Path $EvidenceDir "cleanup-fail.log"
    $errFile = Join-Path $EvidenceDir "cleanup-fail-err.log"

    $pCleanup = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$RunnerScript`"", "-EvidenceDir", "`"$cleanupFailEv`"", "-SimulateCleanupFailureEarly" -Wait -PassThru -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $errFile

    $cleanupExit = $pCleanup.ExitCode
    $cleanupLogs = ""
    if (Test-Path -LiteralPath $logFile) { $cleanupLogs += (Get-Content -LiteralPath $logFile -Raw) }
    if (Test-Path -LiteralPath $errFile) { $cleanupLogs += (Get-Content -LiteralPath $errFile -Raw) }

    $cleanupInvalidatePassed = ($cleanupExit -ne 0) -and $cleanupLogs.Contains("[CLEANUP_FAILURE]")
    Write-Host "Cleanup Invalidation: $cleanupInvalidatePassed (ExitCode: $cleanupExit)"

    # -----------------------------------------------------------------------------
    # 4. Kiểm tra Sentinel process không bị ảnh hưởng
    # -----------------------------------------------------------------------------
    $sentinelAlivePassed = (-not $sentinel.HasExited)
    Write-Host "Sentinel Process Alive: $sentinelAlivePassed (PID: $sentinelPid)"

} finally {
    # Dọn sentinel process do test tạo ra
    if ($null -ne $sentinel -and -not $sentinel.HasExited) {
        $sentinel.Kill()
        $sentinel.WaitForExit(3000) | Out-Null
    }
    # Dọn biến môi trường test
    [Environment]::SetEnvironmentVariable("PROBE_EXISTING_VAR", $null, "Process")
    [Environment]::SetEnvironmentVariable("PROBE_ABSENT_VAR", $null, "Process")
}

$allPassed = $case1Passed -and $case2Passed -and $case3Passed -and $case4Passed -and $cleanupInvalidatePassed -and $sentinelAlivePassed

$report = [pscustomobject]@{
    TestName                = "B02 Cleanup Failure Invalidation & Caller Same-Process Env Restore Test"
    Case1_ExistingNormal    = $case1Passed
    Case2_AbsentNormal      = $case2Passed
    Case3_ExistingException = $case3Passed
    Case4_AbsentException   = $case4Passed
    CleanupInvalidation     = $cleanupInvalidatePassed
    SentinelAlive           = $sentinelAlivePassed
    AllPassed               = $allPassed
}

$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportFile -Encoding UTF8
Write-Host "B02 Report saved: $reportFile (AllPassed: $allPassed)"

if (-not $allPassed) {
    exit 1
}

exit 0
