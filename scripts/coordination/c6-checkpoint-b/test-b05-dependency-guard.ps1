# test-b05-dependency-guard.ps1
# Kiểm tra Preflight Dependency Guard (B05) trước mọi mutation/fixture

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = "E:\AI\BERT_Project\codepython\KLTN"
$ScriptDir = $PSScriptRoot
$RunnerScript = Join-Path $ScriptDir "run-checkpoint-b.ps1"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $EvidenceDir = Join-Path $ScriptDir "evidence\test-b05-dependencies"
}
if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$summaryFile = Join-Path $EvidenceDir "test-b05-summary.json"

Write-Host "=== B05 Dependency Guard Test ==="

# 1. Normal Check: Xác thực tất cả dependency thực tế tồn tại trong scripts/coordination/c6-checkpoint-b/
$depsToCheck = @(
    "vite.config.mjs",
    "verify-c6-smoke.cjs",
    "build-fat-jar.ps1",
    "run-checkpoint-b.ps1"
)

$allNormalDepsExist = $true
$depHashes = [ordered]@{}
foreach ($d in $depsToCheck) {
    $fp = Join-Path $ScriptDir $d
    $exists = Test-Path -LiteralPath $fp
    if (-not $exists) {
        $allNormalDepsExist = $false
        Write-Host "Missing dependency: $fp"
    } else {
        $depHashes[$d] = (Get-FileHash -Algorithm SHA256 -LiteralPath $fp).Hash
    }
}

# 2. Adverse Check: Mô phỏng missing dependency fail-closed
$adverseEvidence = Join-Path $EvidenceDir "adverse-run-$(Get-Random)"
$adverseErrorCaught = $false
$adverseErrorMessage = ""
$mutationOccurred = $false

try {
    & $RunnerScript -EvidenceDir $adverseEvidence -SimulateMissingDependency
} catch {
    $adverseErrorCaught = $true
    $adverseErrorMessage = $_.Exception.Message
}

$assertCorrectError = $adverseErrorCaught -and $adverseErrorMessage.Contains("[PREFLIGHT_GUARD]") -and $adverseErrorMessage.Contains("Required dependency missing")
$assertBeforeMutation = (-not (Test-Path -LiteralPath (Join-Path $adverseEvidence "mysql.private.env")))

$allPassed = $allNormalDepsExist -and $assertCorrectError -and $assertBeforeMutation

$summary = [pscustomobject]@{
    TestName              = "B05 Preflight Dependency Guard Test"
    NormalDepsExist       = $allNormalDepsExist
    DependencyHashes      = $depHashes
    AdverseErrorCaught    = $adverseErrorCaught
    AdverseErrorMessage   = $adverseErrorMessage
    AssertCorrectError    = $assertCorrectError
    AssertBeforeMutation  = $assertBeforeMutation
    AllPassed             = $allPassed
}

$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $summaryFile -Encoding UTF8
Write-Host "Summary saved: $summaryFile (AllPassed: $allPassed)"

if (-not $allPassed) {
    exit 1
}

exit 0
