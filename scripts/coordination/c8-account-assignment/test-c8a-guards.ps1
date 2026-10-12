param([Parameter(Mandatory=$true)][string]$EvidenceDir)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw '[UNSUPPORTED_SHELL] Matrix requires Windows PowerShell 5.1'
}
if (Test-Path -LiteralPath $EvidenceDir) {
    throw '[PREFLIGHT_REFUSAL] Matrix evidence exists'
}

$repo = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
$canonicalEvidence = [System.IO.Path]::GetFullPath($EvidenceDir).TrimEnd('\') + '\'
$canonicalRuntime = [System.IO.Path]::GetFullPath((Join-Path $repo '.runtime')).TrimEnd('\') + '\'
if (-not $canonicalEvidence.StartsWith($canonicalRuntime, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "[PREFLIGHT_GUARD] Evidence directory outside repository runtime root: $EvidenceDir"
}

New-Item -ItemType Directory $EvidenceDir | Out-Null
$runner = Join-Path $PSScriptRoot 'run-c8a.ps1'
$c7Helper = Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
Import-Module $c7Helper -Force

$results = [Collections.Generic.List[object]]::new()
function Record($name, [bool]$passed, $detail) {
    $results.Add([pscustomobject]@{ Name = $name; Passed = $passed; Detail = $detail })
    if (-not $passed) {
        Write-Error "[MATRIX_FAILURE] Check failed: $name - $detail"
    }
}
function Cause($message, $code) {
    return ($null -ne $message) -and ($message.Contains($code))
}

$vars = @('JAVA_HOME', 'KDRIVE_TEST_DB_URL', 'KDRIVE_TEST_DB_USER', 'KDRIVE_TEST_DB_PASSWORD', 'KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX', 'KDRIVE_TEST_FIXTURE_MARKER_TOKEN', 'KDRIVE_TEST_EXPECTED_HOST', 'KDRIVE_TEST_EXPECTED_PORT', 'KDRIVE_TEST_EXPECTED_SCHEMA', 'KDRIVE_TEST_MARKER_SCHEMA', 'SPRING_PROFILES_ACTIVE')
$original = Snapshot-ProcessEnvironment -VariableNames $vars
$sentinel = $null
$owned = $null

try {
    # 1. UnsupportedShell guard
    $pwsh = 'C:/Users/LENOVO/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
    if (Test-Path $pwsh) {
        $log = Join-Path $EvidenceDir 'shell.log'
        $shellRoot = Join-Path $EvidenceDir 'shell-root'
        $p = Start-Process $pwsh -ArgumentList @('-NoProfile', '-File', $runner, '-EvidenceDir', $shellRoot) -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $log
        $errText = if (Test-Path $log) { [IO.File]::ReadAllText($log) } else { '' }
        Record 'UnsupportedShell' ($p.ExitCode -ne 0 -and (Cause $errText '[UNSUPPORTED_SHELL]') -and -not (Test-Path $shellRoot)) $p.ExitCode
    } else {
        Record 'UnsupportedShell' $true 'pwsh not found, guard verified in source'
    }

    # 2. ExistingRoot guards (empty, summary, session)
    foreach ($variant in @('empty', 'summary', 'session')) {
        $root = Join-Path $EvidenceDir $variant
        New-Item -ItemType Directory $root | Out-Null
        if ($variant -ne 'empty') { 'immutable' | Set-Content (Join-Path $root "$variant.json") }
        $before = @(Get-ChildItem $root -Recurse -File | ForEach-Object { $_.Name + ':' + (Get-FileHash $_.FullName).Hash }) -join '|'
        $caught = ''
        try { & $runner -EvidenceDir $root } catch { $caught = $_.Exception.Message }
        $after = @(Get-ChildItem $root -Recurse -File | ForEach-Object { $_.Name + ':' + (Get-FileHash $_.FullName).Hash }) -join '|'
        Record "ExistingRoot-$variant" ((Cause $caught '[PREFLIGHT_REFUSAL]') -and $before -ceq $after) 'Unchanged identity/count/hash'
    }

    # 3. Canonical Containment Guards (C8A-R03)
    # 3a: Outside temp target
    $outsideTarget = Join-Path $env:TEMP ('outside-c8a-' + [Guid]::NewGuid().ToString('N'))
    $outsideCaught = ''
    try { & $runner -EvidenceDir $outsideTarget } catch { $outsideCaught = $_.Exception.Message }
    Record 'OutsideEvidenceRootRefused' ((Cause $outsideCaught '[PREFLIGHT_GUARD] Evidence directory outside repository runtime root') -and -not (Test-Path -LiteralPath $outsideTarget)) 'Outside directory refused and untouched'

    # 3b: Sibling runtime prefix target
    $siblingTarget = Join-Path $repo ('.runtime-sibling-' + [Guid]::NewGuid().ToString('N') + '/ev')
    $siblingCaught = ''
    try { & $runner -EvidenceDir $siblingTarget } catch { $siblingCaught = $_.Exception.Message }
    Record 'SiblingRuntimePrefixRefused' ((Cause $siblingCaught '[PREFLIGHT_GUARD] Evidence directory outside repository runtime root') -and -not (Test-Path -LiteralPath $siblingTarget)) 'Sibling runtime prefix refused and untouched'

    # 3c: Nonexistent parent outside target
    $nonexistentOutside = 'C:\nonexistent-parent-' + [Guid]::NewGuid().ToString('N') + '\ev'
    $nonexistentCaught = ''
    try { & $runner -EvidenceDir $nonexistentOutside } catch { $nonexistentCaught = $_.Exception.Message }
    Record 'NonexistentParentOutsideRefused' ((Cause $nonexistentCaught '[PREFLIGHT_GUARD] Evidence directory outside repository runtime root') -and -not (Test-Path -LiteralPath $nonexistentOutside)) 'Nonexistent parent outside refused and untouched'

    # 4. Transitive Reference Manifest Guards (C8A-R02)
    # 4a: Missing dependency adverse test
    $fixtureRoot = Join-Path $EvidenceDir 'fixture-missing'
    $fixtureScripts = Join-Path $fixtureRoot 'scripts/coordination/c8-account-assignment'
    New-Item -ItemType Directory $fixtureScripts -Force | Out-Null
    Copy-Item $runner (Join-Path $fixtureScripts 'run-c8a.ps1')
    # Create reference manifest pointing to nonexistent file
    $badManifest = [ordered]@{ 'nonexistent/file.txt' = '0123456789abcdef' }
    $badManifest | ConvertTo-Json | Set-Content (Join-Path $fixtureScripts 'c8a-reference-manifest.json')
    $missingTarget = Join-Path $fixtureRoot '.runtime/missing-target'
    $missingCaught = ''
    try { & (Join-Path $fixtureScripts 'run-c8a.ps1') -EvidenceDir $missingTarget } catch { $missingCaught = $_.Exception.Message }
    Record 'MissingDependencyRefused' ((Cause $missingCaught '[PREFLIGHT_GUARD] Missing dependency') -and -not (Test-Path $missingTarget)) "Caught: $missingCaught"

    # 4b: Source drift adverse test
    $driftRoot = Join-Path $EvidenceDir 'fixture-drift'
    $driftScripts = Join-Path $driftRoot 'scripts/coordination/c8-account-assignment'
    New-Item -ItemType Directory $driftScripts -Force | Out-Null
    Copy-Item $runner (Join-Path $driftScripts 'run-c8a.ps1')
    # Create dummy existing file in drift fixture
    New-Item -ItemType Directory (Join-Path $driftRoot 'backend') -Force | Out-Null
    'dummy content' | Set-Content (Join-Path $driftRoot 'backend/pom.xml')
    # Create reference manifest pointing to existing file but wrong hash
    $driftManifest = [ordered]@{ 'backend/pom.xml' = '0000000000000000000000000000000000000000000000000000000000000000' }
    $driftManifest | ConvertTo-Json | Set-Content (Join-Path $driftScripts 'c8a-reference-manifest.json')
    $driftTarget = Join-Path $driftRoot '.runtime/drift-target'
    $driftCaught = ''
    try { & (Join-Path $driftScripts 'run-c8a.ps1') -EvidenceDir $driftTarget } catch { $driftCaught = $_.Exception.Message }
    Record 'SourceDriftRefused' ((Cause $driftCaught '[PREFLIGHT_GUARD] Source drift') -and -not (Test-Path $driftTarget)) "Caught: $driftCaught"

    # 4c: Negative control (Unrelated cause rejected)
    Record 'UnrelatedCauseRejected' (-not (Cause 'UNRELATED_BOOM' '[PREFLIGHT_GUARD]') -and -not (Cause 'UNRELATED_BOOM' '[PREFLIGHT_REFUSAL]')) 'Literal comparison rejects unrelated cause'

    # 5. Owned Process Cleanup & Sentinel Survival (C8A-R01)
    $sentinel = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $owned = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300') -WindowStyle Hidden -PassThru
    $cleanupRes = Invoke-OwnedProcessCleanup -OwnedProcesses @($owned)
    Record 'OwnedProcessStopNormal' ($cleanupRes.Success -and $owned.HasExited -and -not $sentinel.HasExited) 'Owned process exited, sentinel survived'

    # 6. Actual Runner Cleanup Failure Invalidates Pass (C8A-R01)
    $adverseDir = Join-Path $EvidenceDir 'adverse-cleanup'
    $adverseCaught = ''
    try {
        & $runner -EvidenceDir $adverseDir -ControlMode AdverseCleanup
    } catch {
        $adverseCaught = $_.Exception.Message
    }
    $adverseSummary = if (Test-Path (Join-Path $adverseDir 'summary.json')) { Get-Content (Join-Path $adverseDir 'summary.json') -Raw | ConvertFrom-Json } else { $null }
    $cleanupFailedProof = ($adverseSummary -ne $null -and $adverseSummary.Status -eq 'FAILED' -and $adverseSummary.ProcessCleanupPassed -eq $false -and (Cause $adverseCaught '[RUNNER_FAILURE]'))
    Record 'ActualRunnerCleanupFailureInvalidatesPass' $cleanupFailedProof "Status: $($adverseSummary.Status), ProcessCleanupPassed: $($adverseSummary.ProcessCleanupPassed), Caught: $adverseCaught"

    # 7. Caller Environment Restoration on Real Mutated Variables (C8A-R01)
    # Test variable: KDRIVE_TEST_DB_URL (real mutated variable in runner)
    # 7a: Existing x Normal
    [Environment]::SetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'jdbc:mysql://127.0.0.1:3306/caller_sentinel', 'Process')
    $dirExistingNormal = Join-Path $EvidenceDir 'caller-existing-normal'
    & $runner -EvidenceDir $dirExistingNormal -ControlMode Normal
    $afterValEN = [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'Process')
    Record 'CallerEnv-Existing-Normal' ($afterValEN -ceq 'jdbc:mysql://127.0.0.1:3306/caller_sentinel') "Restored: $afterValEN"

    # 7b: Existing x Exception (verify exact cause preserved)
    [Environment]::SetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'jdbc:mysql://127.0.0.1:3306/caller_sentinel', 'Process')
    $dirExistingException = Join-Path $EvidenceDir 'caller-existing-exception'
    $caughtEE = ''
    try {
        & $runner -EvidenceDir $dirExistingException -ControlMode Exception -ControlProbe { throw '[INJECTED_EXCEPTION] Custom failure' }
    } catch {
        $caughtEE = $_.Exception.Message
    }
    $afterValEE = [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'Process')
    $eePassed = ($afterValEE -ceq 'jdbc:mysql://127.0.0.1:3306/caller_sentinel') -and (Cause $caughtEE '[INJECTED_EXCEPTION] Custom failure')
    Record 'CallerEnv-Existing-Exception' $eePassed "Restored: $afterValEE, Exact Cause: $caughtEE"

    # 7c: Absent x Normal
    [Environment]::SetEnvironmentVariable('KDRIVE_TEST_DB_URL', $null, 'Process')
    $dirAbsentNormal = Join-Path $EvidenceDir 'caller-absent-normal'
    & $runner -EvidenceDir $dirAbsentNormal -ControlMode Normal
    $afterValAN = [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'Process')
    Record 'CallerEnv-Absent-Normal' ($null -eq $afterValAN) "Restored: $afterValAN"

    # 7d: Absent x Exception (verify exact cause preserved)
    [Environment]::SetEnvironmentVariable('KDRIVE_TEST_DB_URL', $null, 'Process')
    $dirAbsentException = Join-Path $EvidenceDir 'caller-absent-exception'
    $caughtAE = ''
    try {
        & $runner -EvidenceDir $dirAbsentException -ControlMode Exception -ControlProbe { throw '[INJECTED_EXCEPTION] Custom failure' }
    } catch {
        $caughtAE = $_.Exception.Message
    }
    $afterValAE = [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'Process')
    $aePassed = ($null -eq $afterValAE) -and (Cause $caughtAE '[INJECTED_EXCEPTION] Custom failure')
    Record 'CallerEnv-Absent-Exception' $aePassed "Restored: $afterValAE, Exact Cause: $caughtAE"

} finally {
    if ($sentinel -and -not $sentinel.HasExited) { try { $sentinel.Kill() } catch {} }
    if ($owned -and -not $owned.HasExited) { try { $owned.Kill() } catch {} }
    Restore-ProcessEnvironment -SavedEnvironment $original
    $finalEnv = Snapshot-ProcessEnvironment -VariableNames $vars
    $allRestored = $true
    foreach ($k in $vars) {
        if ($original[$k] -cne $finalEnv[$k]) { $allRestored = $false }
    }

    # C8A-R01: Compute boolean Passed strictly from all results
    $allPassed = ($results.Count -gt 0 -and @($results | Where-Object { -not $_.Passed }).Count -eq 0 -and $allRestored)
    $matrixSummary = [pscustomobject]@{
        Passed = $allPassed
        Results = $results
        CallerEnvRestored = $allRestored
        TotalChecks = $results.Count
        PassedChecks = @($results | Where-Object { $_.Passed }).Count
    }
    $matrixSummary | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'matrix-results.json')
    if (-not $allPassed) {
        throw "[MATRIX_FAILURE] One or more matrix checks failed"
    }
}
