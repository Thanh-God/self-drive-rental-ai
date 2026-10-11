param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.FullName
$runner=Join-Path $repo 'scripts/coordination/c6-browser-negatives/runner.ps1'
if(Test-Path -LiteralPath $EvidenceDir){throw 'Refuse existing verifier evidence'}
$EvidenceDir=[IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory $EvidenceDir | Out-Null
$names=@('PROBE_EXISTING_VAR','PROBE_ABSENT_VAR','DB_URL')
$original=@{}
foreach($name in $names){$original[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$results=@()
try {
 $env:PROBE_EXISTING_VAR='caller-sentinel'
 [Environment]::SetEnvironmentVariable('PROBE_ABSENT_VAR',$null,'Process')
 $before=[Environment]::GetEnvironmentVariable('DB_URL','Process')
 foreach($mode in @('Normal','Exception','Logger','Readback')) {
  $caught=$false
  try { & $runner -EvidenceDir (Join-Path $EvidenceDir $mode) -EnvironmentProbeMode $mode } catch {$caught=$true}
  if(($mode -eq 'Normal') -eq $caught){throw "Unexpected outcome $mode"}
  if($env:PROBE_EXISTING_VAR -cne 'caller-sentinel' -or $null -ne [Environment]::GetEnvironmentVariable('PROBE_ABSENT_VAR','Process') -or $before -cne [Environment]::GetEnvironmentVariable('DB_URL','Process')){throw "Environment drift $mode"}
  $results+=[pscustomobject]@{Case=$mode;Passed=$true;ExistingPreserved=$true;AbsentPreserved=$true;DbPreserved=$true;ExpectedFailureCaught=$caught}
 }
 $occupied=Join-Path $EvidenceDir 'Normal'
 'immutable evidence' | Set-Content (Join-Path $occupied 'sentinel.txt')
 $hash=(Get-FileHash (Join-Path $occupied 'sentinel.txt')).Hash
 $refused=$false
 try { & $runner -EvidenceDir $occupied -RefusalTestOnly } catch {if($_.Exception.Message.Contains('[PREFLIGHT_REFUSAL]')){$refused=$true}else{throw}}
 if(-not $refused -or (Get-FileHash (Join-Path $occupied 'sentinel.txt')).Hash -ne $hash){throw 'Refusal invalid'}
 $results+=[pscustomobject]@{Case='RefuseExisting';Passed=$true}
 # Exercise the actual preflight function extracted from the entrypoint, not a replacement helper.
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile($runner,[ref]$tokens,[ref]$errors)
 if($errors){throw 'Runner parse failed'}
 $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-PreflightDependencies'},$true)
 if(-not $fn){throw 'Actual dependency guard missing'}
 Invoke-Expression $fn.Extent.Text
 $FrontendDir=Join-Path $repo 'frontend';$BackendDir=Join-Path $repo 'backend'
 $empty=Join-Path $EvidenceDir 'missing-dependency';New-Item -ItemType Directory $empty | Out-Null
 $caught=$false
 try {Assert-PreflightDependencies -Dir $empty} catch {if($_.Exception.Message.Contains('[PREFLIGHT_GUARD] Required dependency missing: vite.config.mjs')){$caught=$true}else{throw}}
 if(-not $caught -or @(Get-ChildItem $empty).Count -ne 0){throw 'Actual dependency guard invalid'}
 $results+=[pscustomobject]@{Case='ActualMissingDependency';Passed=$true}
 $results | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'results.json')
 Write-Output "PASS: $($results.Count) runner checks"
} finally {foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$original[$name],'Process')}}
