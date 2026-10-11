[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runner = Join-Path $PSScriptRoot 'run-c7b-browser.ps1'
$existingTarget = Join-Path $repo '.runtime/coordination-c7b-review-20261011-145207/TASK.md'
$outsideTarget = Join-Path $env:TEMP ('c7b-outside-' + [guid]::NewGuid().ToString('N'))
$before = (Get-FileHash -LiteralPath $existingTarget -Algorithm SHA256).Hash
$checks = @()
try {
    try { & $runner -EvidenceDir $existingTarget; throw '[ASSERTION_FAILURE] existing target was not refused' }
    catch { if (-not $_.Exception.Message.Contains('[PREFLIGHT_REFUSAL]')) { throw }; $checks += 'existing target refused before mutation' }
    if ((Get-FileHash -LiteralPath $existingTarget -Algorithm SHA256).Hash -cne $before) { throw '[ASSERTION_FAILURE] existing target content changed' }
    try { & $runner -EvidenceDir $outsideTarget; throw '[ASSERTION_FAILURE] outside evidence root was not refused' }
    catch { if (-not $_.Exception.Message.Contains('[PREFLIGHT_REFUSAL]')) { throw }; $checks += 'outside evidence root refused before mutation' }
    if (Test-Path -LiteralPath $outsideTarget) { throw '[ASSERTION_FAILURE] outside target was created' }
    [pscustomobject]@{Passed=$true;Checks=$checks;ExistingTargetHashBefore=$before;ExistingTargetHashAfter=(Get-FileHash -LiteralPath $existingTarget -Algorithm SHA256).Hash;OutsideTargetCreated=$false} | ConvertTo-Json -Depth 4
} catch {
    [pscustomobject]@{Passed=$false;Checks=$checks;Failure=$_.Exception.Message} | ConvertTo-Json -Depth 4
    exit 1
}
