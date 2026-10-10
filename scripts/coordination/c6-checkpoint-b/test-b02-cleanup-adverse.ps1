param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
if(Test-Path $EvidenceDir){throw 'Evidence already exists'}
New-Item -ItemType Directory $EvidenceDir | Out-Null
$runner=Join-Path $PSScriptRoot 'run-checkpoint-b.ps1'
$names=@('DB_URL','PROBE_EXISTING_VAR','PROBE_ABSENT_VAR')
$original=@{}
foreach($n in $names){$original[$n]=[Environment]::GetEnvironmentVariable($n,'Process')}
$sentinel=Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 120' -WindowStyle Hidden -PassThru
$results=@()
try {
 foreach($state in @('Existing','Absent')) {
  foreach($mode in @('Normal','Exception','Logger','Readback')) {
   foreach($n in $names){$v=if($state -eq 'Existing'){'caller-sentinel'}else{$null};[Environment]::SetEnvironmentVariable($n,$v,'Process')}
   $before=@{};foreach($n in $names){$before[$n]=[Environment]::GetEnvironmentVariable($n,'Process')}
   $cause=''
   try {& $runner -EvidenceDir (Join-Path $EvidenceDir "$state-$mode") -EnvironmentProbeMode $mode} catch {$cause=$_.Exception.Message}
   foreach($n in $names){if([Environment]::GetEnvironmentVariable($n,'Process') -cne $before[$n]){throw "Restore failed: $state/$mode/$n"}}
   if($mode -eq 'Normal' -and $cause){throw "Unexpected normal error $cause"}
   if($mode -ne 'Normal' -and -not $cause){throw "Exception not exercised $mode"}
   $results+=[pscustomobject]@{State=$state;Mode=$mode;Restored=$true;Error=$cause;SentinelAlive=(-not $sentinel.HasExited)}
  }
 }
 if($sentinel.HasExited){throw 'Unrelated sentinel unexpectedly exited'}
} finally {
 foreach($n in $names){[Environment]::SetEnvironmentVariable($n,$original[$n],'Process')}
 if(-not $sentinel.HasExited){$sentinel.Kill();$sentinel.WaitForExit(3000)|Out-Null}
}
if(-not $sentinel.HasExited){throw 'Owned sentinel did not exit'}
$results | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'cases.json')
[pscustomobject]@{Cases=$results.Count;SentinelStopped=$sentinel.HasExited;AllPassed=$true} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
