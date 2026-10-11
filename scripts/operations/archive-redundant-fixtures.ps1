param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [Parameter(Mandatory=$true)][string]$ArchiveRoot,
    [ValidateSet('Archive','Remove')][string]$Phase='Archive'
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'fixture-cleanup-guard.psm1') -Force
$plan = @(Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json)
$selected = @($plan | Where-Object Action -eq 'ARCHIVE_THEN_REMOVE')
$protected = @($plan | Where-Object Action -eq 'KEEP' | ForEach-Object Name)
if (-not $selected.Count) { throw 'No explicitly selected fixtures' }
$root = [IO.Path]::GetFullPath($ArchiveRoot).TrimEnd('\')
$allowed = 'E:\Tools\Docker\Archives\'
if (-not $root.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive root outside approved directory' }
function Read-Target($expected) {
    $raw = & docker inspect $expected.Id
    if ($LASTEXITCODE -ne 0) { throw 'Container inspect failed' }
    $actual = @($raw | ConvertFrom-Json)[0]
    $refs = @(& docker ps -a --no-trunc --filter "volume=$($expected.Volumes[0].Name)" --format '{{.ID}}')
    if ($LASTEXITCODE -ne 0) { throw 'Volume reference inventory failed' }
    Assert-FixtureCleanupTarget -Expected $expected -Actual $actual -VolumeReferences $refs -ProtectedNames $protected
    return $actual
}
$manifestPath=Join-Path $root 'manifest.json'
if ($Phase -eq 'Archive') {
    if (Test-Path -LiteralPath $root) { throw 'Refuse existing archive root' }
    foreach ($target in $selected) { Read-Target $target | Out-Null }
    New-Item -ItemType Directory -Path $root | Out-Null
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $root '/inheritance:r' '/grant:r' "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Private archive ACL failed' }
    $manifest=@()
    foreach ($target in $selected) {
        $actual=Read-Target $target
        $group=if ($target.Name -match 'c([3456])') { 'C'+$Matches[1] } else { 'CB' }
        $directory=Join-Path (Join-Path $root $group) $target.Name
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $actual | ConvertTo-Json -Depth 30 | Set-Content (Join-Path $directory 'private-container.json')
        $volume=$target.Volumes[0].Name
        & docker run --rm --network none --entrypoint sh --mount "type=volume,src=$volume,dst=/source,readonly" --mount "type=bind,src=$directory,dst=/backup" $target.Image -c 'tar -czf /backup/volume.tgz -C /source .'
        if ($LASTEXITCODE -ne 0) { throw "Archive failed: $($target.Name)" }
        $list=& docker run --rm --network none --entrypoint sh --mount "type=bind,src=$directory,dst=/backup,readonly" $target.Image -c 'tar -tzf /backup/volume.tgz'
        if ($LASTEXITCODE -ne 0 -or -not $list -or './ibdata1' -notin $list) { throw 'Archive missing expected MySQL data' }
        $list | Set-Content (Join-Path $directory 'archive-files.txt')
        $archive=Join-Path $directory 'volume.tgz'
        $manifest += [pscustomobject]@{Name=$target.Name;Id=$target.Id;Image=$target.Image;Volume=$volume;Archive=$archive;SHA256=(Get-FileHash $archive).Hash;Bytes=(Get-Item $archive).Length;Reason=$target.Reason;Evidence=$target.Evidence;Verified=$true}
        [pscustomobject]@{PlanSHA256=(Get-FileHash $PlanPath).Hash;Entries=$manifest} | ConvertTo-Json -Depth 10 | Set-Content $manifestPath
        Write-Output "Archived $($target.Name)"
    }
    Write-Output "PASS: $($manifest.Count) stopped fixtures archived; no source volume deleted"
    return
}
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.PlanSHA256 -ne (Get-FileHash $PlanPath).Hash -or $manifest.Entries.Count -ne $selected.Count) { throw 'Archive plan/count mismatch' }
$proof=Get-Content (Join-Path $root 'restore-proof.json') -Raw | ConvertFrom-Json
if ($proof.Verified -ne $true -or $proof.ArchiveSHA256 -notin $manifest.Entries.SHA256) { throw 'Representative restore proof missing' }
foreach ($target in $selected) {
    $entry=@($manifest.Entries | Where-Object Id -eq $target.Id)
    if ($entry.Count -ne 1 -or $entry[0].Name -ne $target.Name -or $entry[0].Volume -ne $target.Volumes[0].Name -or
        $entry[0].Verified -ne $true -or (Get-FileHash -LiteralPath $entry[0].Archive).Hash -ne $entry[0].SHA256) { throw 'Archive proof mismatch' }
    Read-Target $target | Out-Null
}
foreach ($target in $selected) {
    $actual=Read-Target $target
    $refs=@(& docker ps -a --no-trunc --filter "volume=$($target.Volumes[0].Name)" --format '{{.ID}}')
    if ($LASTEXITCODE -ne 0) { throw 'Final reference check failed' }
    Assert-FixtureCleanupTarget -Expected $target -Actual $actual -VolumeReferences $refs -ProtectedNames $protected -RequireArchive -ArchiveVerified $true
    & docker rm $target.Id | Add-Content (Join-Path $root 'removal.log')
    if ($LASTEXITCODE -ne 0) { throw 'Container removal failed' }
    & docker volume rm $target.Volumes[0].Name | Add-Content (Join-Path $root 'removal.log')
    if ($LASTEXITCODE -ne 0) { throw 'Volume removal failed' }
    Write-Output "Removed archived $($target.Name)"
}
Write-Output "PASS: removed $($selected.Count) explicitly selected archived fixtures"
