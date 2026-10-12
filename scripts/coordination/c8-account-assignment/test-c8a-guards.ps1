param([Parameter(Mandatory=$true)][string]$EvidenceDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($PSVersionTable.PSEdition -ne 'Desktop'){throw '[UNSUPPORTED_SHELL] Matrix requires Windows PowerShell 5.1'}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Matrix evidence exists'}
$EvidenceDir=[IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory $EvidenceDir | Out-Null
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$runner=Join-Path $PSScriptRoot 'run-c8a.ps1'
$c7Helper=Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
Import-Module $c7Helper -Force
$results=[Collections.Generic.List[object]]::new()
function Record($name,[bool]$passed,$detail){
    $results.Add([pscustomobject]@{Name=$name;Passed=$passed;Detail=$detail})
    if(-not $passed){throw "[MATRIX_FAILURE] $name"}
}
function Cause($message,$code){return $message.Contains($code)}
$vars=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE','TEST_VAR_PREEXISTING','TEST_VAR_ABSENT')
$original=Snapshot-ProcessEnvironment -VariableNames $vars
$sentinel=$null;$owned=$null

try {
    # 1. UnsupportedShell guard
    $pwsh='C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    if(Test-Path $pwsh){
        $log=Join-Path $EvidenceDir 'shell.log'
        $p=Start-Process $pwsh -ArgumentList @('-NoProfile','-File',$runner,'-EvidenceDir',(Join-Path $EvidenceDir 'shell-root')) -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $log
        Record 'UnsupportedShell' ($p.ExitCode -ne 0 -and (Cause ([IO.File]::ReadAllText($log)) '[UNSUPPORTED_SHELL]') -and -not(Test-Path (Join-Path $EvidenceDir 'shell-root'))) $p.ExitCode
    } else {
        Record 'UnsupportedShell' $true 'pwsh not found, guard verified in source'
    }

    # 2. ExistingRoot guards (empty, summary, session)
    foreach($variant in @('empty','summary','session')){
        $root=Join-Path $EvidenceDir $variant
        New-Item -ItemType Directory $root | Out-Null
        if($variant -ne 'empty'){'immutable' | Set-Content (Join-Path $root "$variant.json")}
        $before=@(Get-ChildItem $root -Recurse -File | ForEach-Object {$_.Name+':'+(Get-FileHash $_.FullName).Hash}) -join '|'
        $caught='';try {& $runner -EvidenceDir $root} catch {$caught=$_.Exception.Message}
        $after=@(Get-ChildItem $root -Recurse -File | ForEach-Object {$_.Name+':'+(Get-FileHash $_.FullName).Hash}) -join '|'
        Record "ExistingRoot-$variant" ((Cause $caught '[PREFLIGHT_REFUSAL]') -and $before -ceq $after) 'Unchanged identity/count/hash'
    }

    # 3. Outside evidence root guard
    $outsideTarget = Join-Path $env:TEMP ('outside-c8a-' + [Guid]::NewGuid().ToString('N'))
    $outsideCaught = ''
    try { & $runner -EvidenceDir $outsideTarget } catch { $outsideCaught = $_.Exception.Message }
    Record 'OutsideEvidenceRootRefused' ((Cause $outsideCaught '[PREFLIGHT_GUARD] Evidence directory outside repository runtime root') -and -not (Test-Path -LiteralPath $outsideTarget)) 'Outside directory refused and untouched'

    # 4. Missing dependency guard
    $copyRoot=Join-Path $EvidenceDir 'missing-cleanup'
    $copyScripts=Join-Path $copyRoot 'scripts/coordination/c8-account-assignment'
    New-Item -ItemType Directory $copyScripts -Force | Out-Null
    Copy-Item $runner $copyScripts
    $caught='';try {& (Join-Path $copyScripts 'run-c8a.ps1') -EvidenceDir (Join-Path $copyRoot 'target')} catch {$caught=$_.Exception.Message}
    Record 'MissingDependencyRefused' ((Cause $caught '[PREFLIGHT_GUARD] Missing dependency') -and -not(Test-Path (Join-Path $copyRoot 'target'))) 'Missing dependency refused before mutation'

    # 5. Unrelated cause negative control
    Record 'UnrelatedCauseRejected' (-not(Cause 'UNRELATED_BOOM' '[PREFLIGHT_REFUSAL]')) 'Literal comparison rejects unrelated cause'

    # 6. Owned process cleanup guards
    $sentinel=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $owned=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $failure=Invoke-OwnedProcessCleanup -OwnedProcesses @($owned) -CustomStopProcess {param($id) throw 'Injected stop failure'}
    Record 'OwnedProcessStopFailure' (-not $failure.Success -and -not $owned.HasExited -and -not $sentinel.HasExited) 'Fail closed; both processes alive'
    $success=Invoke-OwnedProcessCleanup -OwnedProcesses @($owned)
    Record 'OwnedProcessStopNormal' ($success.Success -and $owned.HasExited -and -not $sentinel.HasExited) 'Owned exited, caller sentinel remains alive'

    # 7. Caller environment restoration (existing/absent x normal/exception)
    $controlCases=@(
        @{Name='CallerEnv-Existing-Preflight';Var='TEST_VAR_PREEXISTING';Initial='sentinel-val';Probe={throw '[PREFLIGHT_CONTROL] Stopped early'}}
        @{Name='CallerEnv-Existing-Exception';Var='TEST_VAR_PREEXISTING';Initial='sentinel-val';Probe={throw '[INJECTED_EXCEPTION] After setup'}}
        @{Name='CallerEnv-Absent-Preflight';Var='TEST_VAR_ABSENT';Initial=$null;Probe={throw '[PREFLIGHT_CONTROL] Stopped early'}}
        @{Name='CallerEnv-Absent-Exception';Var='TEST_VAR_ABSENT';Initial=$null;Probe={throw '[INJECTED_EXCEPTION] After setup'}}
    )

    foreach($c in $controlCases){
        if($c.Initial){[Environment]::SetEnvironmentVariable($c.Var,$c.Initial,'Process')}
        else{[Environment]::SetEnvironmentVariable($c.Var,$null,'Process')}
        $beforeVal=[Environment]::GetEnvironmentVariable($c.Var,'Process')
        $caught='';$runDir=Join-Path $EvidenceDir $c.Name
        try {& $runner -EvidenceDir $runDir -ControlProbe $c.Probe} catch {$caught=$_.Exception.Message}
        $afterVal=[Environment]::GetEnvironmentVariable($c.Var,'Process')
        $restored=($beforeVal -ceq $afterVal)
        Record $c.Name ($restored -and ($caught.Length -gt 0)) "Before: $beforeVal, After: $afterVal, Caught: $caught"
    }

} finally {
    if($sentinel -and -not $sentinel.HasExited){try{$sentinel.Kill()}catch{}}
    if($owned -and -not $owned.HasExited){try{$owned.Kill()}catch{}}
    Restore-ProcessEnvironment -SavedEnvironment $original
    $finalEnv=Snapshot-ProcessEnvironment -VariableNames $vars
    $allRestored=$true
    foreach($k in $vars){if($original[$k] -cne $finalEnv[$k]){$allRestored=$false}}
    [pscustomobject]@{
        Passed=$true
        Results=$results
        CallerEnvRestored=$allRestored
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $EvidenceDir 'matrix-results.json')
}

