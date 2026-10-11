param(
    [Parameter(Mandatory=$true)][string]$ArchiveRoot,
    [string]$FixtureName,
    [ValidatePattern('^[a-zA-Z0-9-]+\.json$')][string]$ProofFileName='restore-proof.json'
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($ArchiveRoot).TrimEnd('\')
if (-not $root.StartsWith('E:\Tools\Docker\Archives\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected archive root' }
$proofPath=Join-Path $root $ProofFileName
if (Test-Path -LiteralPath $proofPath) { throw 'Refuse existing restore proof' }
$manifest=Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$entry=$null
foreach ($candidate in $manifest.Entries) {
    if ($FixtureName -and $candidate.Name -ne $FixtureName) { continue }
    $listing=Get-Content (Join-Path (Split-Path $candidate.Archive -Parent) 'archive-files.txt')
    $business=@($listing | Where-Object { $_ -match '^\./([a-zA-Z0-9_]+)/bookings\.ibd$' })
    if ($business.Count) { $entry=$candidate; $schema=($business[0] -split '/')[1]; break }
}
if (-not $entry -or (Get-FileHash -LiteralPath $entry.Archive).Hash -ne $entry.SHA256) { throw 'Archive not verified' }
$directory=Split-Path -Parent $entry.Archive
$config=Get-Content (Join-Path $directory 'private-container.json') -Raw | ConvertFrom-Json
$name='kltn-retention-restore-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$volume='vol-'+$name
$envFile=Join-Path $directory 'private-restore.env'
$config.Config.Env | Set-Content $envFile
$ownedContainer=$false
$ownedVolume=$false
$success=$false
try {
    & docker volume create --label 'kltn.owner=fixture-retention-probe' $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Restore volume create failed' }
    $ownedVolume=$true
    & docker run --rm --network none --entrypoint sh --mount "type=volume,src=$volume,dst=/restored" --mount "type=bind,src=$directory,dst=/backup,readonly" $entry.Image -c 'tar -xzf /backup/volume.tgz -C /restored'
    if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed' }
    $auto=& docker run --rm --network none --entrypoint sh --mount "type=volume,src=$volume,dst=/restored,readonly" $entry.Image -c 'cat /restored/auto.cnf'
    if ($LASTEXITCODE -ne 0) { throw 'Restored UUID readback failed' }
    $uuid=@($auto | Where-Object { $_ -match '^server-uuid=' })[0] -replace '^server-uuid=',''
    if (-not $uuid) { throw 'Archive UUID missing' }
    $restoreArgs=@('run','--detach','--network','none','--label','kltn.owner=fixture-retention-probe','--name',$name,'--env-file',$envFile,'--mount',"type=volume,src=$volume,dst=/var/lib/mysql",$entry.Image)+@($config.Config.Cmd)
    & docker @restoreArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Restored MySQL startup failed' }
    $ownedContainer=$true
    for ($i=0;$i -lt 40;$i++) {
        $readback=& docker exec $name sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT @@server_uuid; SELECT TABLE_SCHEMA,COUNT(*) FROM information_schema.tables GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA;"' 2>$null
        if ($LASTEXITCODE -eq 0 -and $readback) { break }
        Start-Sleep -Seconds 2
    }
    if ($LASTEXITCODE -ne 0 -or -not $readback -or $readback[0] -ne $uuid) { throw 'Restored SQL/UUID proof failed' }
    $proofStem=[IO.Path]::GetFileNameWithoutExtension($ProofFileName)
    $readback | Set-Content (Join-Path $root "$proofStem-mysql-readback.txt")
    $sql="SELECT COUNT(*) FROM $schema.bookings; SELECT COUNT(*) FROM $schema.reviews; SELECT COUNT(*) FROM $schema.flyway_schema_history WHERE success=1;"
    $query='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "'+$sql+'"'
    $rows=@(& docker exec $name sh -c $query)
    if ($LASTEXITCODE -ne 0 -or $rows.Count -ne 3 -or @($rows | Where-Object { $_ -notmatch '^\d+$' }).Count -or [int]$rows[2] -lt 1) { throw 'Restored business/Flyway query failed' }
    $rows | Set-Content (Join-Path $root "$proofStem-business-readback.txt")
    $success=$true
} finally {
    if ($ownedContainer) {
        & docker rm --force $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Probe container cleanup failed' }
    }
    if ($ownedVolume) {
        & docker volume rm $volume | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Probe volume cleanup failed' }
    }
}
if (-not $success) { throw 'Restore probe did not complete' }
[pscustomobject]@{Verified=$true;SourceFixture=$entry.Name;ArchiveSHA256=$entry.SHA256;Image=$entry.Image;RestoredUUID=$uuid;BusinessSchema=$schema;BusinessCounts=$rows;ProbeContainer=$name;ProbeVolume=$volume;ProbeRemoved=$true;Scope='One populated stopped MySQL physical archive; startup/UUID/catalog/business/Flyway queried, no application suite'} | ConvertTo-Json | Set-Content $proofPath
Write-Output 'PASS: archive restored into isolated volume; MySQL queried, original UUID preserved, probe resources removed'
