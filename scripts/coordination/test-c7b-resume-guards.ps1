[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EvidenceDir,[Parameter(Mandatory=$true)][string]$StatePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(Test-Path -LiteralPath $EvidenceDir){throw 'Evidence exists'}
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
$EvidenceDir=(Resolve-Path $EvidenceDir).Path
$runner=Join-Path $PSScriptRoot 'c7-incident-report-browser/run-c7b-browser.ps1'
$state=Get-Content -LiteralPath $StatePath -Raw|ConvertFrom-Json
$checks=@()
function Denied([string]$name,[string]$resumePath,[string]$cause){
 $out=Join-Path $EvidenceDir $name;$caught=''
 try{& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $out -ResumeStatePath $resumePath}catch{$caught=$_.Exception.Message}
 if(-not $caught.Contains($cause) -or (Test-Path $out)){throw "[ASSERTION_FAILURE] $name wrong cause/mutation"}
 $script:checks+=[pscustomobject]@{Name=$name;Passed=$true;OutputCreated=$false}
}
$before=@(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' $state.Container);if($LASTEXITCODE -ne 0){throw 'Fixture readback failed'}
Denied 'outside-state' (Join-Path $env:TEMP 'nonexistent-c7b-private-state.json') '[PREFLIGHT_REFUSAL]'
$state.Identity='WRONG_IDENTITY';$bad=Join-Path $EvidenceDir 'wrong-identity.private.json'
$state|ConvertTo-Json|Set-Content -LiteralPath $bad
Denied 'wrong-stopped-identity' $bad '[PREFLIGHT_GUARD]'
$state.Container='kltn-phase5-rerun';$state|ConvertTo-Json|Set-Content -LiteralPath $bad
Denied 'protected-container-refused' $bad '[PREFLIGHT_GUARD]'
$after=@(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' ($before[0] -split '\|')[0]);if($LASTEXITCODE -ne 0 -or ($before -join '') -cne ($after -join '')){throw 'Fixture changed on refusal'}
[pscustomobject]@{Passed=$true;Checks=$checks;IdentityBefore=$before;IdentityAfter=$after}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $EvidenceDir 'results.json')
Write-Output 'PASS 3 resume guard checks and immutable identity'