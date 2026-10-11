param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $EvidenceDirectory) { throw 'Refuse existing evidence' }
New-Item -ItemType Directory -Path $EvidenceDirectory | Out-Null
Import-Module (Join-Path $PSScriptRoot 'fixture-cleanup-guard.psm1') -Force
function New-Case {
    $expected = [pscustomobject]@{Action='ARCHIVE_THEN_REMOVE';Name='kltn-c6-fixture';Id='id';Image='image';Volumes=@([pscustomobject]@{Name='volume'})}
    $actual = [pscustomobject]@{Name='/kltn-c6-fixture';Id='id';Image='image';State=[pscustomobject]@{Running=$false};Mounts=@([pscustomobject]@{Type='volume';Name='volume';Destination='/var/lib/mysql'})}
    @{Expected=$expected;Actual=$actual;VolumeReferences=@('id');ProtectedNames=@();RequireArchive=$true;ArchiveVerified=$true}
}
$case = New-Case
Assert-FixtureCleanupTarget @case
$results = @('PASS: valid stopped owned archived target')
foreach ($name in @('kltn-c4b-fixture','kltn-c5a-fixture','kltn-staff-c4a-fixture')) {
    $case = New-Case
    $case.Expected.Name=$name
    $case.Actual.Name='/'+$name
    Assert-FixtureCleanupTarget @case
    $results += "PASS: supported $name"
}
$checks = @(
    @{Code='NOT_SELECTED';Change={param($c) $c.Expected.Action='KEEP'}},
    @{Code='PROTECTED_TARGET';Change={param($c) $c.ProtectedNames=@('kltn-c6-fixture')}},
    @{Code='PROTECTED_TARGET';Change={param($c) $c.Expected.Name='kltn-phase5-rerun'}},
    @{Code='PROTECTED_TARGET';Change={param($c) $c.Expected.Name='quiz_mysql'}},
    @{Code='IDENTITY_DRIFT';Change={param($c) $c.Actual.Id='other'}},
    @{Code='IDENTITY_DRIFT';Change={param($c) $c.Actual.Image='other'}},
    @{Code='NOT_STOPPED';Change={param($c) $c.Actual.State.Running=$true}},
    @{Code='MOUNT_DRIFT';Change={param($c) $c.Actual.Mounts[0].Name='other'}},
    @{Code='MOUNT_DRIFT';Change={param($c) $c.Actual.Mounts[0].Destination='/unexpected'}},
    @{Code='SHARED_VOLUME';Change={param($c) $c.VolumeReferences=@('id','other')}},
    @{Code='ARCHIVE_NOT_VERIFIED';Change={param($c) $c.ArchiveVerified=$false}}
)
foreach ($check in $checks) {
    $case = New-Case
    & $check.Change $case
    $caught = $false
    try { Assert-FixtureCleanupTarget @case }
    catch { if ($_.Exception.Message -eq "[$($check.Code)]") { $caught=$true } else { throw } }
    if (-not $caught) { throw "Guard accepted unsafe case $($check.Code)" }
    $results += "PASS: rejected $($check.Code)"
}
$results | Set-Content (Join-Path $EvidenceDirectory 'results.txt')
Write-Output "PASS: $($results.Count) actual cleanup guard checks"
