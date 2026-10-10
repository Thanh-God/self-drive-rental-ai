# test-b03-provenance.ps1
# Kiểm tra toàn diện B03: Build Provenance, Full Manifest, Drift Detection & Output Isolation

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$BuildScript = Join-Path $ScriptDir "build-fat-jar.ps1"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $EvidenceDir = Join-Path $ScriptDir "evidence\test-b03-provenance"
}
if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$summaryFile = Join-Path $EvidenceDir "test-b03-summary.json"

Write-Host "=== B03 Full Build Provenance & Output Isolation Test ==="

# 1. Normal Test: Chạy build-fat-jar.ps1 với OutputDir riêng biệt
$isolatedDir = Join-Path $EvidenceDir "isolated-jar"
$normalResult = & $BuildScript -EvidenceDir $EvidenceDir -OutputDir $isolatedDir -SkipBuildIfJarMatches

$reportPath = Join-Path $EvidenceDir "build-provenance-report.json"
if (-not (Test-Path -LiteralPath $reportPath)) {
    throw "Build provenance report was not generated: $reportPath"
}
$reportJson = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json

$hasInputNested = $false
$hasModerationNested = $false
foreach ($c in $reportJson.ClassComparisons) {
    if ($c.JarPath.Contains("ReviewController`$Input.class")) { $hasInputNested = $true }
    if ($c.JarPath.Contains("ReviewController`$Moderation.class")) { $hasModerationNested = $true }
}

$assertInputsSufficient = ($reportJson.BuildInputsCount -gt 15)
$assertClassesMatched = ($reportJson.ClassesComparedCount -eq 7) -and $reportJson.AllClassesMatched
$assertNestedPresent = $hasInputNested -and $hasModerationNested
$assertOutputIsolated = $reportJson.OutputIsolationActive -and (Test-Path -LiteralPath (Join-Path $isolatedDir "kdrive-fat-isolated.jar"))

Write-Host "Build Inputs Count: $($reportJson.BuildInputsCount) (Sufficient: $assertInputsSufficient)"
Write-Host "Classes Matched: $($reportJson.ClassesComparedCount) (AllMatched: $($reportJson.AllClassesMatched))"
Write-Host "Nested Classes Present: $assertNestedPresent"
Write-Host "Output Isolation Active: $assertOutputIsolated"

# 2. Adverse Test: Phát hiện Source Drift khi so sánh với manifest sai khác
Write-Host "--- Testing Source Drift Detection against altered manifest ---"
$manifestPath = Join-Path $EvidenceDir "build-input-manifest.json"
$fakeManifestPath = Join-Path $EvidenceDir "fake-manifest.json"
$manifestObj = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
# Giả lập sửa hash của pom.xml
$fakeObj = [ordered]@{}
foreach ($prop in $manifestObj.psobject.Properties) {
    if ($prop.Name -eq "backend/pom.xml") {
        $fakeObj[$prop.Name] = "0000000000000000000000000000000000000000000000000000000000000000"
    } else {
        $fakeObj[$prop.Name] = $prop.Value
    }
}
$fakeObj | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $fakeManifestPath -Encoding UTF8

$driftCaught = $false
$driftMessage = ""
try {
    & $BuildScript -EvidenceDir (Join-Path $EvidenceDir "drift-test") -ManifestReferencePath $fakeManifestPath -SkipBuildIfJarMatches
} catch {
    $driftCaught = $true
    $driftMessage = $_.Exception.Message
}

$assertDriftDetected = $driftCaught -and $driftMessage.Contains("[SOURCE_DRIFT]")
Write-Host "Drift Caught: $assertDriftDetected (Message: $driftMessage)"

$allPassed = $assertInputsSufficient -and $assertClassesMatched -and $assertNestedPresent -and $assertOutputIsolated -and $assertDriftDetected

$summary = [pscustomobject]@{
    TestName                = "B03 Expanded Build Provenance Test"
    BuildInputsCount        = $reportJson.BuildInputsCount
    ClassesCount            = $reportJson.ClassesComparedCount
    HasInputNested          = $hasInputNested
    HasModerationNested     = $hasModerationNested
    AllClassesMatched       = $reportJson.AllClassesMatched
    OutputIsolationActive   = $assertOutputIsolated
    DriftDetected           = $assertDriftDetected
    AllPassed               = $allPassed
}

$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $summaryFile -Encoding UTF8
Write-Host "B03 Summary saved: $summaryFile (AllPassed: $allPassed)"

if (-not $allPassed) {
    exit 1
}

exit 0
