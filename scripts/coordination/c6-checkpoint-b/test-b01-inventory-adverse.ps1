# test-b01-inventory-adverse.ps1
# Kiểm tra adverse seam: Native Docker inventory exit code 23 fail-closed trước mutation

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$RunnerScript = Join-Path $ScriptDir "run-checkpoint-b.ps1"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $EvidenceDir = Join-Path $ScriptDir "evidence\test-b01-adverse"
}
if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$reportFile = Join-Path $EvidenceDir "test-b01-adverse-report.json"
$logFile = Join-Path $EvidenceDir "adverse-inventory.log"
$errFile = Join-Path $EvidenceDir "adverse-inventory-err.log"

Write-Host "=== B01 Docker Inventory Native Exit Non-Zero Adverse Test ==="

$adverseEvidence = Join-Path $EvidenceDir "run-attempt-$(Get-Random)"
$p = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$RunnerScript`"", "-EvidenceDir", "`"$adverseEvidence`"", "-SimulateDockerInventoryFailure" -Wait -PassThru -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $errFile

$exitCode = $p.ExitCode
Write-Host "Adverse runner exited with code: $exitCode (Expected non-zero, e.g. 1)"

$outText = ""
if (Test-Path -LiteralPath $logFile) {
    $outText += (Get-Content -LiteralPath $logFile -Raw)
}
if (Test-Path -LiteralPath $errFile) {
    $outText += (Get-Content -LiteralPath $errFile -Raw)
}

$assertExitNonZero = ($exitCode -ne 0)
$assertCorrectCause = $outText.Contains("Docker container inventory failed with native exit code 23")
$assertBeforeMutation = (-not (Test-Path -LiteralPath (Join-Path $adverseEvidence "mysql.private.env")))

$allPassed = $assertExitNonZero -and $assertCorrectCause -and $assertBeforeMutation

$report = [pscustomobject]@{
    TestName              = "B01 Docker Inventory Native Exit Non-Zero Adverse Test"
    SimulatedExitCode     = 23
    ActualRunnerExitCode  = $exitCode
    AssertExitNonZero     = $assertExitNonZero
    AssertCorrectCause    = $assertCorrectCause
    AssertBeforeMutation  = $assertBeforeMutation
    AllPassed             = $allPassed
}

$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportFile -Encoding UTF8
Write-Host "B01 Adverse Report saved: $reportFile (AllPassed: $allPassed)"

if (-not $allPassed) {
    exit 1
}

exit 0

