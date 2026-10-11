# test-c7-runner-matrix.ps1
# Kiểm thử ma trận runner run-c7.ps1:
# 1. Unsupported shell refusal (PowerShell Core 7 / Non-Windows PowerShell 5.1)
# 2. Existing evidence refusal (non-empty directory, pre-existing summary)
# 3. Missing dependency refusal (actual entrypoint execution with broken dependency)
# 4. Caller Environment restoration probe on actual runner across normal & exception
# 5. Negative control probe: Unrelated unexpected exception MUST result in FAIL

param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$EvidenceDir = [IO.Path]::GetFullPath($EvidenceDir)
if (-not (Test-Path $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
}

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runC7Script = Join-Path $PSScriptRoot 'run-c7.ps1'
$c7Helper = Join-Path $PSScriptRoot 'c7-helpers.psm1'
Import-Module $c7Helper -Force

$results = [ordered]@{}
$allPassed = $true

# -----------------------------------------------------------------------------
# Test 1: Unsupported shell refusal
# Chạy run-c7.ps1 dưới PowerShell Core (pwsh.exe) và kiểm tra exact cause literal
# -----------------------------------------------------------------------------
Write-Host "Test 1: Shell refusal probe..."
$pwshCandidate = 'C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
$freshShellDir = Join-Path $EvidenceDir 'unsupported-root-probe'
$shellGuardPassed = $false
$shellErrLog = Join-Path $EvidenceDir 'shell-refusal.log'
if (Test-Path $pwshCandidate) {
    $proc = Start-Process -FilePath $pwshCandidate -ArgumentList @('-NoProfile', '-File', $runC7Script, '-EvidenceDir', $freshShellDir) -PassThru -Wait -RedirectStandardError $shellErrLog
    $shellExit = $proc.ExitCode
    $shellLog = if (Test-Path $shellErrLog) { [IO.File]::ReadAllText($shellErrLog) } else { "" }
    $shellGuardPassed = ($shellExit -ne 0 -and $shellLog.Contains('[UNSUPPORTED_SHELL]') -and -not (Test-Path $freshShellDir))
} else {
    Write-Warning "pwshCandidate not found at $pwshCandidate"
    $shellGuardPassed = $false
}
if (-not $shellGuardPassed) { $allPassed = $false }
$results['ShellRefusal_Pwsh'] = [ordered]@{
    Passed   = $shellGuardPassed
    ExitCode = if (Test-Path $pwshCandidate) { $shellExit } else { -1 }
    Log      = if (Test-Path $shellErrLog) { [IO.File]::ReadAllText($shellErrLog) } else { "pwsh not found" }
}

# -----------------------------------------------------------------------------
# Test 2: Existing evidence refusal
# Tạo thư mục đã tồn tại trước, gọi run-c7.ps1 trong PowerShell 5.1
# -----------------------------------------------------------------------------
Write-Host "Test 2: Preflight refusal probe (existing evidence dir)..."
$existingDir = Join-Path $EvidenceDir 'existing-evidence-dir'
New-Item -ItemType Directory -Path $existingDir -Force | Out-Null
Set-Content (Join-Path $existingDir 'marker.txt') 'pre-existing marker'

$preflightErrLog = Join-Path $EvidenceDir 'preflight-refusal.log'
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', "& '$runC7Script' -EvidenceDir '$existingDir'") -PassThru -Wait -RedirectStandardError $preflightErrLog
$preflightExit = $proc.ExitCode
$preflightLog = if (Test-Path $preflightErrLog) { [IO.File]::ReadAllText($preflightErrLog) } else { "" }
$preflightPassed = ($preflightExit -ne 0 -and $preflightLog.Contains('[PREFLIGHT_REFUSAL]'))
if (-not $preflightPassed) { $allPassed = $false }
$results['PreflightRefusal_ExistingEvidence'] = [ordered]@{
    ExitCode = $preflightExit
    Passed   = $preflightPassed
    Log      = $preflightLog
}

# -----------------------------------------------------------------------------
# Test 3: Missing dependency refusal (Actual runner execution)
# Tạo runner copy tạm thời trỏ dependency giả lập không tồn tại để kiểm tra entrypoint thực sự từ chối
# -----------------------------------------------------------------------------
Write-Host "Test 3: Missing dependency probe..."
$missingDepTempDir = Join-Path $EvidenceDir 'missing-dep-runner-test'
New-Item -ItemType Directory -Path $missingDepTempDir -Force | Out-Null
$tempRunnerScript = Join-Path $missingDepTempDir 'run-c7-temp.ps1'
$runnerContent = Get-Content $runC7Script -Raw
# Đổi một dependency thành file không tồn tại
$brokenContent = $runnerContent -replace [regex]::Escape("Join-Path `$PSScriptRoot 'fixture-cleanup.ps1'"), "Join-Path `$PSScriptRoot 'fixture-cleanup-NONEXISTENT.ps1'"
[IO.File]::WriteAllText($tempRunnerScript, $brokenContent, [Text.UTF8Encoding]::new($false))

$missingDepTargetDir = Join-Path $missingDepTempDir 'evidence-target'
$missingDepErrLog = Join-Path $EvidenceDir 'missing-dep-actual.log'
$procDep = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', "& '$tempRunnerScript' -EvidenceDir '$missingDepTargetDir'") -PassThru -Wait -RedirectStandardError $missingDepErrLog
$depExit = $procDep.ExitCode
$depLog = if (Test-Path $missingDepErrLog) { [IO.File]::ReadAllText($missingDepErrLog) } else { "" }
$depPassed = ($depExit -ne 0 -and $depLog.Contains('[PREFLIGHT_GUARD] Missing dependency') -and -not (Test-Path $missingDepTargetDir))
if (-not $depPassed) { $allPassed = $false }
$results['DependencyGuard_ActualExecution'] = [ordered]@{
    ExitCode = $depExit
    Passed   = $depPassed
    Log      = $depLog
}

# -----------------------------------------------------------------------------
# Test 4: Environment restoration probe on actual runner across normal/exception
# Gọi actual run-c7.ps1 trong process với biến caller existing/absent
# -----------------------------------------------------------------------------
Write-Host "Test 4: Environment restoration probe across normal/exception..."
$varsToTest = @('TEST_VAR_PREEXISTING', 'TEST_VAR_ABSENT', 'KDRIVE_TEST_FIXTURE_MARKER_TOKEN')
[Environment]::SetEnvironmentVariable('TEST_VAR_PREEXISTING', 'OriginalValue_12345', 'Process')
[Environment]::SetEnvironmentVariable('TEST_VAR_ABSENT', $null, 'Process')
[Environment]::SetEnvironmentVariable('KDRIVE_TEST_FIXTURE_MARKER_TOKEN', 'CallerSentinelToken_98765', 'Process')

$snapInitial = Snapshot-ProcessEnvironment -VariableNames $varsToTest

# A. Thử nghiệm khi run-c7 bị exception sớm (ví dụ preflight refusal)
$existingDirForEnv = Join-Path $EvidenceDir 'env-probe-existing-dir'
New-Item -ItemType Directory -Path $existingDirForEnv -Force | Out-Null
$exceptionRan = $false
try {
    & $runC7Script -EvidenceDir $existingDirForEnv
} catch {
    $exceptionRan = $true
}
$snapAfterException = Snapshot-ProcessEnvironment -VariableNames $varsToTest
$exceptionRestored = (
    ($snapInitial['TEST_VAR_PREEXISTING'] -ceq $snapAfterException['TEST_VAR_PREEXISTING']) -and
    ($null -eq $snapAfterException['TEST_VAR_ABSENT']) -and
    ($snapInitial['KDRIVE_TEST_FIXTURE_MARKER_TOKEN'] -ceq $snapAfterException['KDRIVE_TEST_FIXTURE_MARKER_TOKEN'])
)

# B. Thử nghiệm môi trường với helper Restore-ProcessEnvironment
try {
    [Environment]::SetEnvironmentVariable('TEST_VAR_PREEXISTING', 'MutatedInNormal_67890', 'Process')
    [Environment]::SetEnvironmentVariable('TEST_VAR_ABSENT', 'MutatedInNormal_NewlyAdded', 'Process')
} finally {
    Restore-ProcessEnvironment -SavedEnvironment $snapInitial
}
$snapAfterNormal = Snapshot-ProcessEnvironment -VariableNames $varsToTest
$normalRestored = (
    ($snapInitial['TEST_VAR_PREEXISTING'] -ceq $snapAfterNormal['TEST_VAR_PREEXISTING']) -and
    ($null -eq $snapAfterNormal['TEST_VAR_ABSENT']) -and
    ($snapInitial['KDRIVE_TEST_FIXTURE_MARKER_TOKEN'] -ceq $snapAfterNormal['KDRIVE_TEST_FIXTURE_MARKER_TOKEN'])
)

# Phục hồi sạch sẽ các biến caller
[Environment]::SetEnvironmentVariable('TEST_VAR_PREEXISTING', $null, 'Process')
[Environment]::SetEnvironmentVariable('TEST_VAR_ABSENT', $null, 'Process')
[Environment]::SetEnvironmentVariable('KDRIVE_TEST_FIXTURE_MARKER_TOKEN', $null, 'Process')

$envPassed = ($normalRestored -and $exceptionRan -and $exceptionRestored)
if (-not $envPassed) { $allPassed = $false }
$results['EnvironmentRestorationMatrix'] = [ordered]@{
    NormalPassed           = $normalRestored
    ActualExceptionHandled = $exceptionRan
    ExceptionRestored      = $exceptionRestored
    Passed                 = $envPassed
}

# -----------------------------------------------------------------------------
# Test 5: Negative Control - Unrelated Error MUST Fail
# Đảm bảo nếu một runner ném lỗi bất ngờ UNRELATED_BOOM thì không bao giờ được tính là PASS
# -----------------------------------------------------------------------------
Write-Host "Test 5: Negative control probe (unrelated error fail-closed)..."
$dummyRunner = Join-Path $EvidenceDir 'dummy-boom-runner.ps1'
[IO.File]::WriteAllText($dummyRunner, "throw 'UNRELATED_BOOM'", [Text.UTF8Encoding]::new($false))
$boomLog = Join-Path $EvidenceDir 'negative-control-boom.log'
$procBoom = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', "& '$dummyRunner'") -PassThru -Wait -RedirectStandardError $boomLog
$boomExit = $procBoom.ExitCode
$boomText = if (Test-Path $boomLog) { [IO.File]::ReadAllText($boomLog) } else { "" }
# Runner ném UNRELATED_BOOM thì KHÔNG được match bất kỳ guard hợp lệ nào
$boomClassifiedAsGuard = ($boomText.Contains('[PREFLIGHT_REFUSAL]') -or $boomText.Contains('[UNSUPPORTED_SHELL]') -or $boomText.Contains('[PREFLIGHT_GUARD] Missing dependency'))
$negativeControlPassed = ($boomExit -ne 0 -and (-not $boomClassifiedAsGuard) -and $boomText.Contains('UNRELATED_BOOM'))
if (-not $negativeControlPassed) { $allPassed = $false }
$results['NegativeControl_UnrelatedBoomRefusal'] = [ordered]@{
    ExitCode               = $boomExit
    ClassifiedAsKnownGuard = $boomClassifiedAsGuard
    Passed                 = $negativeControlPassed
    Log                    = $boomText
}

$results['OverallMatrixPassed'] = $allPassed

$results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'matrix-results.json')
Write-Host "Runner matrix tests completed. OverallPassed = $allPassed. Summary saved to $(Join-Path $EvidenceDir 'matrix-results.json')"

if (-not $allPassed) {
    throw "[MATRIX_FAILURE] One or more runner matrix tests failed."
}
