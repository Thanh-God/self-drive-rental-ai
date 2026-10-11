param(
    [ValidateSet('Snapshot','Compare')][string]$Mode='Snapshot',
    [string]$OutputDirectory,
    [string]$BeforeDirectory,
    [string]$AfterDirectory
)
$ErrorActionPreference='Stop'
if($Mode -eq 'Compare'){
    if(-not $BeforeDirectory -or -not $AfterDirectory){throw 'Before and after directories required'}
    foreach($name in @('containers.txt','volumes.txt','images.txt','kdrive-private.sql','flyway.txt','summary.json')){
        $before=Join-Path $BeforeDirectory $name
        $after=Join-Path $AfterDirectory $name
        if(-not(Test-Path -LiteralPath $before -PathType Leaf) -or -not(Test-Path -LiteralPath $after -PathType Leaf)){throw "Missing required snapshot: $name"}
        if($name -ne 'summary.json' -and (Get-FileHash -LiteralPath $before).Hash -ne (Get-FileHash -LiteralPath $after).Hash){throw "Snapshot mismatch: $name"}
    }
    $a=Get-Content (Join-Path $BeforeDirectory 'summary.json') -Raw | ConvertFrom-Json
    $b=Get-Content (Join-Path $AfterDirectory 'summary.json') -Raw | ConvertFrom-Json
    if(-not $a.ServerVersion -or $a.ServerVersion -ne $b.ServerVersion){throw 'Docker server version changed; assess compatibility'}
    if($a.MySQLPort33385 -ne $true -or $b.MySQLPort33385 -ne $true){throw 'MySQL endpoint not verified'}
    Write-Output 'PASS: same container/image/volume inventory, DB data, Flyway and engine version; endpoint verified'
    return
}
if(-not $OutputDirectory){throw 'OutputDirectory required'}
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw 'Refuse existing snapshot directory'}
$version=docker version --format '{{.Server.Version}}'
if($LASTEXITCODE -ne 0 -or -not $version){throw 'Docker engine unavailable'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$containers=@(docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}' | Sort-Object)
if($LASTEXITCODE -ne 0){throw 'Container inventory failed'}
$volumes=@(docker volume ls --format '{{.Name}}|{{.Driver}}' | Sort-Object)
if($LASTEXITCODE -ne 0){throw 'Volume inventory failed'}
$images=@(docker image ls --format '{{.ID}}|{{.Repository}}:{{.Tag}}' | Sort-Object)
if($LASTEXITCODE -ne 0){throw 'Image inventory failed'}
$containers | Set-Content "$OutputDirectory/containers.txt"
$volumes | Set-Content "$OutputDirectory/volumes.txt"
$images | Set-Content "$OutputDirectory/images.txt"
$running=docker inspect --format '{{.State.Running}}' kltn-phase5-rerun
if($LASTEXITCODE -ne 0){throw 'User MySQL container missing'}
$running | Set-Content "$OutputDirectory/mysql-initial-state.txt"
if($running -ne 'true'){docker start kltn-phase5-rerun | Out-Null; if($LASTEXITCODE -ne 0){throw 'MySQL start failed'}}
$ready=$false
for($i=0;$i -lt 30;$i++){
    docker exec kltn-phase5-rerun sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT 1"' 2>$null | Out-Null
    if($LASTEXITCODE -eq 0){$ready=$true;break}
    Start-Sleep -Seconds 2
}
if(-not $ready){throw 'MySQL not ready after60seconds'}
$dump=docker exec kltn-phase5-rerun sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --no-tablespaces --skip-comments --skip-dump-date --order-by-primary --hex-blob --single-transaction --routines --events --databases kdrive'
if($LASTEXITCODE -ne 0 -or -not $dump){throw 'Business DB read-only snapshot failed'}
$dump | Set-Content -Encoding utf8 "$OutputDirectory/kdrive-private.sql"
$sql='SELECT installed_rank,version,description,checksum,success FROM kdrive.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=''kdrive'';'
$query='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "'+$sql+'"'
$history=docker exec kltn-phase5-rerun sh -c $query
if($LASTEXITCODE -ne 0 -or -not $history){throw 'Flyway readback failed'}
$history | Set-Content "$OutputDirectory/flyway.txt"
$port=Test-NetConnection 127.0.0.1 -Port 33385 -InformationLevel Quiet -WarningAction SilentlyContinue
if(-not $port){throw 'MySQL host port33385 blocked'}
$manifest=[ordered]@{ServerVersion=$version;Containers=$containers.Count;Volumes=$volumes.Count;Images=$images.Count;MySQLPort33385=$port;SQLSHA256=(Get-FileHash "$OutputDirectory/kdrive-private.sql").Hash;FlywaySHA256=(Get-FileHash "$OutputDirectory/flyway.txt").Hash}
$manifest | ConvertTo-Json | Set-Content "$OutputDirectory/summary.json"
Write-Output 'PASS: engine inventory, MySQL startup/query, private DB snapshot, Flyway, port33385'
