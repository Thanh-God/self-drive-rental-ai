param([Parameter(Mandatory=$true)][string]$EvidenceDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop'){throw '[UNSUPPORTED_SHELL] Matrix requires Windows PowerShell 5.1'}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Matrix evidence exists'}
$EvidenceDir=[IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory $EvidenceDir | Out-Null
$runner=Join-Path $PSScriptRoot 'run-c7.ps1'
Import-Module (Join-Path $PSScriptRoot 'c7-helpers.psm1') -Force
$results=[Collections.Generic.List[object]]::new()
function Record($name,[bool]$passed,$detail){
    $results.Add([pscustomobject]@{Name=$name;Passed=$passed;Detail=$detail})
    if(-not $passed){throw "[MATRIX_FAILURE] $name"}
}
function Cause($message,$code){return $message.Contains($code)}
$vars=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE','TEST_VAR_PREEXISTING','TEST_VAR_ABSENT')
$original=Snapshot-ProcessEnvironment -VariableNames $vars
$sentinel=$null;$owned=$null
$dockerStubInstalled=$false
try {
    $pwsh='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    $log=Join-Path $EvidenceDir 'shell.log'
    $p=Start-Process $pwsh -ArgumentList @('-NoProfile','-File',$runner,'-EvidenceDir',(Join-Path $EvidenceDir 'shell-root')) -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $log
    Record 'UnsupportedShell' ($p.ExitCode -ne 0 -and (Cause ([IO.File]::ReadAllText($log)) '[UNSUPPORTED_SHELL]') -and -not(Test-Path (Join-Path $EvidenceDir 'shell-root'))) $p.ExitCode
    foreach($variant in @('empty','summary','session')){
        $root=Join-Path $EvidenceDir $variant
        New-Item -ItemType Directory $root | Out-Null
        if($variant -ne 'empty'){'immutable' | Set-Content (Join-Path $root "$variant.json")}
        $before=@(Get-ChildItem $root -Recurse -File | ForEach-Object {$_.Name+':'+(Get-FileHash $_.FullName).Hash}) -join '|'
        $caught='';try {& $runner -EvidenceDir $root} catch {$caught=$_.Exception.Message}
        $after=@(Get-ChildItem $root -Recurse -File | ForEach-Object {$_.Name+':'+(Get-FileHash $_.FullName).Hash}) -join '|'
        Record "ExistingRoot-$variant" ((Cause $caught '[PREFLIGHT_REFUSAL]') -and $before -ceq $after) 'Unchanged identity/count/hash'
    }
    # Copy actual entrypoint and keep every other required dependency present.
    $repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
    $copyRoot=Join-Path $EvidenceDir 'missing-cleanup'
    $copyScripts=Join-Path $copyRoot 'scripts/coordination/c7-incident-report'
    New-Item -ItemType Directory $copyScripts -Force | Out-Null
    Copy-Item $runner,(Join-Path $PSScriptRoot 'c7-helpers.psm1') $copyScripts
    $copyBuild=Join-Path $copyRoot 'scripts/coordination/c6-checkpoint-b'
    New-Item -ItemType Directory $copyBuild | Out-Null
    Copy-Item (Join-Path $repo 'scripts/coordination/c6-checkpoint-b/build-fat-jar.ps1') $copyBuild
    $caught='';try {& (Join-Path $copyScripts 'run-c7.ps1') -EvidenceDir (Join-Path $copyRoot 'target')} catch {$caught=$_.Exception.Message}
    Record 'MissingCleanupDependency' ((Cause $caught '[PREFLIGHT_GUARD] Missing dependency') -and -not(Test-Path (Join-Path $copyRoot 'target'))) 'Other required dependencies present; actual source copied unchanged'
    Record 'UnrelatedCauseRejected' (-not(Cause 'UNRELATED_BOOM' '[PREFLIGHT_REFUSAL]')) 'Literal comparison rejects unrelated cause'

    $sentinel=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $owned=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $failure=Invoke-OwnedProcessCleanup -OwnedProcesses @($owned) -CustomStopProcess {param($id) throw 'Injected stop failure'}
    Record 'OwnedProcessStopFailure' (-not $failure.Success -and -not $owned.HasExited -and -not $sentinel.HasExited) 'Fail closed; both processes alive'
    $success=Invoke-OwnedProcessCleanup -OwnedProcesses @($owned)
    Record 'OwnedProcessStopNormal' ($success.Success -and $owned.HasExited -and -not $sentinel.HasExited) 'Owned exited, caller sentinel remains alive'

    if(Test-Path Function:global:docker){throw 'Caller Docker function already exists'}
    function global:docker {
        $global:LASTEXITCODE=0
        switch($args[0]){
            'ps' {return}
            'volume' {return}
            'run' {return 'synthetic-owned-fixture'}
            'exec' {return '1'}
            'stop' {if($global:C7MatrixStopFailure){$global:LASTEXITCODE=23}; return 'synthetic-stopped'}
            'inspect' {return 'false'}
            default {throw 'Unexpected synthetic Docker operation'}
        }
    }
    $dockerStubInstalled=$true
    foreach($presence in @('existing','absent')){
        foreach($mode in @('normal','exception','cleanup-failure','restore-failure')){
            foreach($v in $vars){[Environment]::SetEnvironmentVariable($v, $(if($presence -eq 'existing'){'CALLER_SYNTHETIC_'+$v}else{$null}), 'Process')}
            $caller=Snapshot-ProcessEnvironment -VariableNames $vars
            $global:C7MatrixStopFailure=($mode -eq 'cleanup-failure')
            $global:C7MatrixObservedMutation=$false
            $global:C7MatrixThrow=($mode -eq 'exception')
            $probe={
                $global:C7MatrixObservedMutation=($env:KDRIVE_TEST_DB_USER -ceq 'root' -and $env:KDRIVE_TEST_EXPECTED_PORT -ceq '33615' -and $env:KDRIVE_TEST_DB_PASSWORD -notlike 'CALLER_SYNTHETIC_*')
                if($global:C7MatrixThrow){throw '[INJECTED_NATIVE_FAILURE] Execution failed after environment mutation'}
            }
            $afterRestore=if($mode -eq 'restore-failure'){{[Environment]::SetEnvironmentVariable('JAVA_HOME','INJECTED_RESTORE_DRIFT','Process')}}else{$null}
            $target=Join-Path $EvidenceDir "$presence-$mode"
            $caught=''
            try {& $runner -EvidenceDir $target -ControlProbe $probe -AfterRestoreProbe $afterRestore} catch {$caught=$_.Exception.Message}
            $result=Get-Content (Join-Path $target 'summary.json') -Raw | ConvertFrom-Json
            $restored=$true
            foreach($v in $vars){if($caller[$v] -cne [Environment]::GetEnvironmentVariable($v,'Process')){$restored=$false}}
            $expected= switch($mode){'normal' {''}; 'exception' {'[INJECTED_NATIVE_FAILURE]'}; 'cleanup-failure' {'[CLEANUP_FAILURE]'}; 'restore-failure' {'[RUNNER_FAILURE]'}}
            $causeOK=if($expected){Cause $caught $expected}else{[string]::IsNullOrEmpty($caught)}
            $statusOK=if($mode -eq 'normal'){$result.OverallSuccess}else{-not $result.OverallSuccess}
            $restoreOK=if($mode -eq 'restore-failure'){-not $restored -and -not $result.EnvironmentRestoredActual}else{$restored -and $result.EnvironmentRestoredActual}
            Record "ActualRunner-$presence-$mode" ($causeOK -and $statusOK -and $restoreOK -and $global:C7MatrixObservedMutation -and -not $result.TestsPassed -and -not $sentinel.HasExited) 'Synthetic native seam; actual entrypoint, mutation/finally/summary, never database PASS'
            Restore-ProcessEnvironment -SavedEnvironment $caller
            $raw=[IO.File]::ReadAllText((Join-Path $target 'environment-before.json'))+[IO.File]::ReadAllText((Join-Path $target 'environment-restoration-report.json'))
            Record "Privacy-$presence-$mode" (-not $raw.Contains('CALLER_SYNTHETIC_KDRIVE_TEST_DB_PASSWORD') -and -not $raw.Contains('CALLER_SYNTHETIC_KDRIVE_TEST_FIXTURE_MARKER_TOKEN')) 'No raw caller secrets'
        }
    }
} finally {
    if($dockerStubInstalled){Remove-Item Function:global:docker}
    foreach($p in @($owned,$sentinel)){if($null -ne $p -and -not $p.HasExited){Stop-Process -Id $p.Id -Force; $null=$p.WaitForExit(5000)}}
    Restore-ProcessEnvironment -SavedEnvironment $original
    foreach($name in @('C7MatrixStopFailure','C7MatrixObservedMutation','C7MatrixThrow')){Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue}
    [pscustomobject]@{Results=$results.ToArray();OverallPassed=($results.Count -eq 24 -and @($results | Where-Object {-not $_.Passed}).Count -eq 0);VerificationMode='SyntheticControlProbes';NoRealDockerUsed=$true} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $EvidenceDir 'matrix-results.json')
}
if($results.Count -ne 24){throw '[MATRIX_FAILURE] Missing checks'}
'PASS: 24 matrix checks; caller restored; no real Docker fixture'
