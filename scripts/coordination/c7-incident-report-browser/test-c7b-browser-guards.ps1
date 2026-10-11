[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$EvidenceDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runner=Join-Path $PSScriptRoot 'run-c7b-browser.ps1'
$helper=Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Guard evidence exists'}
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
$EvidenceDir=(Resolve-Path -LiteralPath $EvidenceDir).Path
Import-Module $helper -Force
$variables=@('JAVA_HOME','PORT','DB_URL','DB_USER','DB_PASSWORD','JWT_SECRET','FRONTEND_ORIGIN','SEED_ENABLED','SEED_PASSWORD','SPRING_PROFILES_ACTIVE','VITE_DATA_MODE','VITE_API_BASE_URL','C7B_BASE_URL','C7B_API_BASE_URL','C7B_CONTAINER','C7B_SCHEMA','C7B_MARKER_SCHEMA','C7B_MARKER_TOKEN','C7B_DB_PASSWORD','C7B_SEED_PASSWORD','C7B_PLAYWRIGHT_MODULE','C7B_EVIDENCE_DIR','C7B_CREATED_SENTINEL')
$original=Snapshot-ProcessEnvironment -VariableNames $variables
$checks=@();$sentinel=$null
function Check([string]$name,[bool]$passed){if(-not $passed){throw "[ASSERTION_FAILURE] $name"};$script:checks+=[pscustomobject]@{Name=$name;Passed=$passed}}
function Refused([scriptblock]$action,[string]$cause){$actual='';try{& $action}catch{$actual=$_.Exception.Message};if(-not $actual.Contains($cause)){throw "[ASSERTION_FAILURE] Wrong refusal cause: $actual"}}
function Tree([string]$root){return @((Get-Item $root).FullName)+@(Get-ChildItem $root -Recurse | ForEach-Object { if($_.PSIsContainer){'DIR:'+$_.FullName}else{$_.FullName+':'+(Get-FileHash $_.FullName).Hash} }) -join '|'}
try{
 $pwsh='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
 if(-not(Test-Path $pwsh)){throw '[DEPENDENCY_GUARD] Required unsupported-shell probe binary missing'}
 $target=Join-Path $EvidenceDir 'unsupported'
 $log=Join-Path $EvidenceDir 'unsupported.log'
 $proc=Start-Process $pwsh -ArgumentList @('-NoProfile','-File',$runner,'-EvidenceRoot',$EvidenceDir,'-EvidenceDir',$target) -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $log
 Check 'unsupported shell refuses before mutation' ($proc.ExitCode -ne 0 -and ([IO.File]::ReadAllText($log)).Contains('[UNSUPPORTED_SHELL]') -and -not(Test-Path $target))
 foreach($kind in @('file','empty','summary','session')){
  $target=Join-Path $EvidenceDir "existing-$kind"
  if($kind -eq 'file'){Set-Content $target 'keep'}else{New-Item -ItemType Directory $target|Out-Null;if($kind -ne 'empty'){Set-Content (Join-Path $target "$kind.json") 'keep'}}
  $before=Tree $target
  Refused {& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $target} '[PREFLIGHT_REFUSAL]'
  Check "existing $kind immutable" ((Tree $target) -ceq $before)
 }
 $outside=Join-Path $env:TEMP ('c7b-guard-'+[guid]::NewGuid().ToString('N'))
 Refused {& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $outside} '[PREFLIGHT_REFUSAL]'
 Check 'outside root not created' (-not(Test-Path $outside))
 $target=Join-Path $EvidenceDir 'missing-dependency'
 Refused {& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $target -AcceptedBuildDir '.runtime/nonexistent-c7b-build'} '[DEPENDENCY_GUARD]'
 Check 'missing dependency before write' (-not(Test-Path $target))
 $negativeRejected=$false
 try{Refused {throw '[UNRELATED_FAILURE] wrong error'} '[DEPENDENCY_GUARD]'}catch{$negativeRejected=$_.Exception.Message.Contains('[ASSERTION_FAILURE] Wrong refusal cause')}
 Check 'actual unrelated failure rejected' $negativeRejected
 $sentinel=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru;$null=$sentinel.Handle
 foreach($presence in @('existing','absent')){
  foreach($v in $variables){[Environment]::SetEnvironmentVariable($v, $(if($presence -eq 'existing'){'CALLER_'+$v}else{$null}), 'Process')}
  $caller=Snapshot-ProcessEnvironment -VariableNames $variables
  foreach($mode in @('Normal','Exception','CleanupFailure','RestoreFailure')){
   $target=Join-Path $EvidenceDir "$presence-$mode"
   $caught='';try{& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $target -ControlProbe $mode}catch{$caught=$_.Exception.Message}
   $summary=Get-Content (Join-Path $target 'summary.json') -Raw|ConvertFrom-Json
   $after=Snapshot-ProcessEnvironment -VariableNames $variables;$same=$true;foreach($v in $variables){if($caller[$v] -cne $after[$v]){$same=$false}}
   Check "outer caller $presence/$mode exact" $same
   Check "owned stopped/sentinel alive $presence/$mode" (@($summary.Processes | Where-Object {-not $_.Exited}).Count -eq 0 -and -not $sentinel.HasExited)
   Check "no synthetic browser PASS $presence/$mode" (-not $summary.BrowserPassed -and $summary.VerificationMode -eq 'SyntheticControlProbe')
   switch($mode){
    Normal{Check "normal lifecycle $presence" (-not $caught -and $summary.Status -eq 'CONTROL_ONLY' -and $summary.EnvironmentRestored -and $summary.CleanupPassed)}
    Exception{Check "exception actual path $presence" ($caught.Contains('[CONTROL_EXCEPTION]') -and $summary.EnvironmentRestored -and $summary.CleanupPassed)}
    CleanupFailure{Check "cleanup failure invalidates $presence" ($caught.Contains('[CLEANUP_FAILURE]') -and -not $summary.CleanupPassed)}
    RestoreFailure{Check "restore failure invalidates $presence" ($caught.Contains('[CLEANUP_FAILURE]') -and -not $summary.EnvironmentRestored)}
   }
  }
 }
 $reference=Get-Content (Join-Path $EvidenceDir 'existing-Normal/source-before.json') -Raw|ConvertFrom-Json
 $first=$reference.PSObject.Properties | Select-Object -First 1;$first.Value='DRIFTED_EXPECTATION'
 $manifest=Join-Path $EvidenceDir 'drift-reference.json';$reference|ConvertTo-Json|Set-Content $manifest
 $target=Join-Path $EvidenceDir 'source-drift'
 Refused {& $runner -EvidenceRoot $EvidenceDir -EvidenceDir $target -DependencyManifestPath $manifest -ControlProbe Normal} '[SOURCE_DRIFT]'
 Check 'dependency drift refuses before write' (-not(Test-Path $target))
 [pscustomobject]@{Passed=$true;Count=$checks.Count;Checks=$checks}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $EvidenceDir 'guard-results.json')
 Write-Output "PASS $($checks.Count) actual guard/lifecycle assertions"
}catch{[pscustomobject]@{Passed=$false;Checks=$checks;Failure=$_.Exception.Message}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $EvidenceDir 'guard-failure.json');throw}
finally{if($sentinel -and -not $sentinel.HasExited){$null=Invoke-OwnedProcessCleanup -OwnedProcesses @($sentinel)};Restore-ProcessEnvironment -SavedEnvironment $original}