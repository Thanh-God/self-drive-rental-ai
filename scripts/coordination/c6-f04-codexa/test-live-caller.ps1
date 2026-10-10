param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$names=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE')
$original=@{};$before=@{}
foreach($n in $names){$original[$n]=[Environment]::GetEnvironmentVariable($n,'Process')}
try {
    for($i=0;$i -lt $names.Count;$i++){
        $v=if($i%2 -eq 0){'caller-sentinel'}else{$null}
        [Environment]::SetEnvironmentVariable($names[$i],$v,'Process')
        $before[$names[$i]]=$v
    }
    & (Join-Path $PSScriptRoot 'run-f04.ps1') -EvidenceDir $EvidenceDir
    foreach($n in $names){if([Environment]::GetEnvironmentVariable($n,'Process') -cne $before[$n]){throw "Caller restore failed $n"}}
    $manifest=Get-ChildItem $EvidenceDir -Recurse -File | ForEach-Object {[pscustomobject]@{Path=$_.FullName;Hash=(Get-FileHash $_.FullName).Hash}}
    $cause=''
    try {& (Join-Path $PSScriptRoot 'run-f04.ps1') -EvidenceDir $EvidenceDir} catch {$cause=$_.Exception.Message}
    if(-not $cause.Contains('[PREFLIGHT_REFUSAL]')){throw 'Expected refusal cause'}
    foreach($entry in $manifest){if((Get-FileHash $entry.Path).Hash -cne $entry.Hash){throw 'Refusal overwrote evidence'}}
    [pscustomobject]@{EnvironmentRestored=$true;Variables=$names.Count;ExistingAndAbsent=$true;RefusalCauseVerified=$true;EvidenceUnchanged=$true} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'caller-readback.json')
} finally {foreach($n in $names){[Environment]::SetEnvironmentVariable($n,$original[$n],'Process')}}
