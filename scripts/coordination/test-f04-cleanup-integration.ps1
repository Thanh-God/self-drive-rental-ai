param([Parameter(Mandatory=$true)][string]$EvidenceDir)
$ErrorActionPreference='Stop'
$nativeDocker=(Get-Command docker.exe).Source
$runner=Join-Path $PSScriptRoot 'c6-f04-codexa/run-f04.ps1'
$variables=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE')
$original=@{};$before=@{}
foreach($v in $variables){$original[$v]=[Environment]::GetEnvironmentVariable($v,'Process')}
# Inject native stop failure only. Every inventory/create/query/build/test is real.
function docker {
    if($args[0] -eq 'stop') {
        if($args[1] -notlike 'kltn-c6-f04-a-*'){throw 'Refuse stop injection for foreign container'}
        $global:LASTEXITCODE=23
        return
    }
    & $nativeDocker @args
    $global:LASTEXITCODE=$LASTEXITCODE
}
$cause='';$restored=$false;$cleanup=$false
try {
    for($i=0;$i -lt $variables.Count;$i++) {
        $value=if($i%2 -eq 0){'adverse-caller-sentinel'}else{$null}
        [Environment]::SetEnvironmentVariable($variables[$i],$value,'Process')
        $before[$variables[$i]]=$value
    }
    try {& $runner -EvidenceDir $EvidenceDir} catch {$cause=$_.Exception.Message}
    if(-not $cause.Contains('[CLEANUP_FAILURE]')){throw "Expected cleanup failure, actual: $cause"}
    foreach($v in $variables){if([Environment]::GetEnvironmentVariable($v,'Process') -cne $before[$v]){throw "Environment restore failed $v"}}
    $restored=$true
    $summary=Get-Content (Join-Path $EvidenceDir 'summary.json') -Raw | ConvertFrom-Json
    if($summary.OverallSuccess -or $summary.CleanupPassed -or -not $summary.TestsPassed){throw 'Cleanup failure did not invalidate real test success'}
} finally {
    try {
        $path=Join-Path $EvidenceDir 'summary.json'
        if(Test-Path $path) {
            $s=Get-Content $path -Raw | ConvertFrom-Json
            if($s.Container -notmatch '^kltn-c6-f04-a-[a-f0-9]{12}$'){throw 'Owned fixture identity invalid'}
            & $nativeDocker stop $s.Container | Out-Null
            if($LASTEXITCODE -ne 0){throw 'External owned stop failed'}
            $state=& $nativeDocker inspect --format '{{.State.Running}}' $s.Container
            if($LASTEXITCODE -ne 0 -or $state -cne 'false'){throw 'External owned readback failed'}
            $cleanup=$true
        }
    } finally {
        foreach($v in $variables){[Environment]::SetEnvironmentVariable($v,$original[$v],'Process')}
    }
}
if(-not $cleanup){throw 'External owned fixture cleanup not verified'}
[pscustomobject]@{Cause=$cause;NativeStopExitInjected=23;ActualRunnerFailed=$true;SuccessInvalidated=$true;CallerRestored=$restored;OwnedFixtureFinallyStopped=$cleanup} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'adverse-caller-readback.json')
Write-Output 'PASS actual runner cleanup-failure invalidation and caller restore; owned fixture stopped externally'
