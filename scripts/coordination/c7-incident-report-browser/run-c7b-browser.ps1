[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$EvidenceDir,
 [Parameter(Mandatory=$true)][string]$EvidenceRoot,
 [string]$AcceptedBuildDir='.runtime/coordination-c7a-codexa-complete-20261011-140830/evidence/full-verify',
 [string]$DependencyManifestPath,
 [string]$ResumeStatePath,
 [switch]$PreflightOnly,
 [ValidateSet('','Normal','Exception','CleanupFailure','RestoreFailure')][string]$ControlProbe=''
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'}
function FullPath([string]$path){if([IO.Path]::IsPathRooted($path)){return [IO.Path]::GetFullPath($path)};return [IO.Path]::GetFullPath((Join-Path $repo $path))}
$EvidenceRoot=FullPath $EvidenceRoot
$EvidenceDir=FullPath $EvidenceDir
$runtime=FullPath '.runtime'
if(-not $EvidenceRoot.StartsWith($runtime+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $EvidenceDir.StartsWith($EvidenceRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '[PREFLIGHT_REFUSAL] Evidence must be a new child under repository runtime'}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Evidence directory already exists'}
$helper=Join-Path $repo 'scripts/coordination/c7-incident-report/c7-helpers.psm1'
$fixtureHelper=Join-Path $repo 'scripts/coordination/c7-incident-report/fixture-cleanup.ps1'
$browserScript=Join-Path $PSScriptRoot 'verify-c7b-browser.cjs'
$controls=Join-Path $PSScriptRoot 'browser-controls.cjs'
$frontend=Join-Path $repo 'frontend'
$vite=Join-Path $frontend 'node_modules/vite/bin/vite.js'
$playwright=Join-Path $repo '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'
$accepted=FullPath $AcceptedBuildDir
$acceptedSource=Join-Path $accepted 'source-after.json'
$acceptedHash=Join-Path $accepted 'jar-hash.txt'
$jar=Join-Path $repo '.runtime/coordination-c7a-codexa-complete-20261011-140830/evidence/live1/backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar'
foreach($p in @($helper,$fixtureHelper,$browserScript,$controls,$vite,$acceptedSource,$acceptedHash,$jar,(Join-Path $playwright 'index.js'))){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw "[DEPENDENCY_GUARD] Missing required file: $p"}}
$backendReference=Get-Content -LiteralPath $acceptedSource -Raw | ConvertFrom-Json
foreach($p in $backendReference.PSObject.Properties){$file=Join-Path (Join-Path $repo 'backend') $p.Name;if(-not(Test-Path $file) -or (Get-FileHash $file).Hash -ne $p.Value){throw "[SOURCE_DRIFT] Accepted backend differs: $($p.Name)"}}
if((Get-FileHash $jar).Hash -ne (Get-Content -LiteralPath $acceptedHash -Raw).Trim()){throw '[SOURCE_DRIFT] Accepted JAR hash differs'}
function Manifest {
 $paths=@($helper,$fixtureHelper,$browserScript,$controls,$vite,$acceptedSource,$acceptedHash,$jar,(Join-Path $playwright 'package.json'),(Join-Path $frontend 'index.html'),(Join-Path $frontend 'vite.config.js'),(Join-Path $frontend 'package.json'),(Join-Path $frontend 'package-lock.json'))
 $paths+=@(Get-ChildItem (Join-Path $frontend 'src') -File -Recurse | ForEach-Object FullName)
 $paths+=@(Get-ChildItem (Join-Path $frontend 'dist') -File -Recurse | ForEach-Object FullName)
 $paths+=@(Get-ChildItem $PSScriptRoot -File | ForEach-Object FullName)
 $map=[ordered]@{};foreach($p in ($paths | Sort-Object -Unique)){$map[$p.Substring($repo.Length+1)]=(Get-FileHash -LiteralPath $p).Hash};return $map
}
$sourceBefore=Manifest
if($DependencyManifestPath){$reference=Get-Content -LiteralPath $DependencyManifestPath -Raw | ConvertFrom-Json;if(@($reference.PSObject.Properties).Count -ne $sourceBefore.Count){throw '[SOURCE_DRIFT] Dependency keyset differs'};foreach($p in $reference.PSObject.Properties){if(-not $sourceBefore.Contains($p.Name) -or $sourceBefore[$p.Name] -ne $p.Value){throw "[SOURCE_DRIFT] Dependency differs: $($p.Name)"}}}
Import-Module $helper -Force
. $fixtureHelper
$variables=@('JAVA_HOME','PORT','DB_URL','DB_USER','DB_PASSWORD','JWT_SECRET','FRONTEND_ORIGIN','SEED_ENABLED','SEED_PASSWORD','SPRING_PROFILES_ACTIVE','VITE_DATA_MODE','VITE_API_BASE_URL','C7B_BASE_URL','C7B_API_BASE_URL','C7B_CONTAINER','C7B_SCHEMA','C7B_MARKER_SCHEMA','C7B_MARKER_TOKEN','C7B_DB_PASSWORD','C7B_SEED_PASSWORD','C7B_PLAYWRIGHT_MODULE','C7B_EVIDENCE_DIR','C7B_CREATED_SENTINEL')
$saved=Snapshot-ProcessEnvironment -VariableNames $variables
$owned=$false;$processes=@();$readbacks=@();$failure='';$browserPassed=$false;$cleanupPassed=$true;$restoreExact=$false;$protectedUnchanged=$false
$mysqlPort=33616;$container='';$volume='';$schema='';$markerSchema='';$originalIdentity='';$privateFile=Join-Path $EvidenceDir 'mysql.private.env'
# Control probes execute the same mutation/try/finally cleanup path with an
# explicit synthetic mode. They never claim MySQL or browser proof.
if(-not $ControlProbe){
 foreach($port in @(8080,5173)){ $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port);try{$probe.Start()}catch{throw "[PREFLIGHT_GUARD] Port $port occupied"}finally{$probe.Stop()} }
 for(;$mysqlPort -le 33715;$mysqlPort++){ $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$mysqlPort);$free=$false;try{$probe.Start();$free=$true}catch{}finally{$probe.Stop()};if($free){break} }
 if($mysqlPort -gt 33715){throw '[PREFLIGHT_GUARD] No free MySQL test port'}
 $info=@(& docker info --format '{{.ServerVersion}}|{{.OSType}}' 2>&1);if($LASTEXITCODE -ne 0 -or $info.Count -ne 1 -or $info[0] -notmatch '^\d+(\.\d+)+\|linux$'){throw '[PREFLIGHT_GUARD] Docker unavailable'}
 $originalIdentity=@(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' kltn-phase5-rerun);if($LASTEXITCODE -ne 0 -or $originalIdentity.Count -ne 1 -or $originalIdentity[0] -notmatch '\|true\|'){throw '[PREFLIGHT_GUARD] Protected original identity unavailable'}
 & docker image inspect mysql:8.4.11 | Out-Null;if($LASTEXITCODE -ne 0){throw '[DEPENDENCY_GUARD] MySQL image unavailable'}
 $id=[Guid]::NewGuid().ToString('N').Substring(0,12);$container="kltn-c7b-browser-$id";$volume="vol-$container";$schema="kdrive_c7b_$id";$markerSchema="kdrive_c7b_meta_$id"
 $names=@(& docker ps -a --format '{{.Names}}');if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Inventory failed'};$volumes=@(& docker volume ls --format '{{.Name}}');if($LASTEXITCODE -ne 0 -or $names -contains $container -or $volumes -contains $volume){throw '[PREFLIGHT_REFUSAL] Fixture identity collision'}
 if($ResumeStatePath){
  $ResumeStatePath=FullPath $ResumeStatePath
  if(-not $ResumeStatePath.StartsWith($runtime+'\',[StringComparison]::OrdinalIgnoreCase)){throw '[PREFLIGHT_REFUSAL] Resume state outside runtime'}
  $resume=Get-Content -LiteralPath $ResumeStatePath -Raw | ConvertFrom-Json
  if($resume.Container -notmatch '^kltn-c7b-browser-[a-f0-9]{12}$' -or $resume.Schema -notmatch '^kdrive_c7b_[a-f0-9]{12}$' -or $resume.MarkerSchema -notmatch '^kdrive_c7b_meta_[a-f0-9]{12}$' -or $resume.Port -ne $mysqlPort){throw '[PREFLIGHT_GUARD] Invalid resume fixture state'}
  $identity=@(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' $resume.Container)
  if($LASTEXITCODE -ne 0 -or $identity.Count -ne 1 -or $identity[0] -cne ($resume.Identity+'|false|'+$resume.Volume+';')){throw '[PREFLIGHT_GUARD] Resume exact stopped fixture mismatch'}
  $container=$resume.Container;$volume=$resume.Volume;$schema=$resume.Schema;$markerSchema=$resume.MarkerSchema
 }
}
New-Item -ItemType Directory -Path $EvidenceDir | Out-Null
$sourceBefore | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
try {
 if($PreflightOnly){return}
 if($ControlProbe){
  $env:DB_URL='SYNTHETIC_CONTROL';$env:C7B_CREATED_SENTINEL='created'
  $p=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 300') -PassThru -WindowStyle Hidden;$null=$p.Handle;$processes+=,$p
  if($ControlProbe -eq 'Exception'){throw '[CONTROL_EXCEPTION] Injected after actual mutation/spawn'}
 }else{
  if($ResumeStatePath){$password=$resume.Password;$seedPassword=$resume.SeedPassword;$token=$resume.MarkerToken}else{$password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N');$seedPassword=[Guid]::NewGuid().ToString('N')+'Aa9!';$token=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')}
  [IO.File]::WriteAllLines($privateFile,@("MYSQL_ROOT_PASSWORD=$password","MYSQL_DATABASE=$schema"),[Text.UTF8Encoding]::new($false))
  if($ResumeStatePath){& docker start $container | Out-Null}else{& docker run -d --name $container --publish "127.0.0.1:${mysqlPort}:3306" --env-file $privateFile --mount "source=${volume},target=/var/lib/mysql" mysql:8.4.11 | Out-Null}
  if($LASTEXITCODE -ne 0){throw '[DOCKER_RUN_FAILURE] Fixture start failed'};$owned=$true
  $ready=$false;for($i=0;$i -lt 60;$i++){try{$probe=@(& docker exec -e "MYSQL_PWD=$password" $container mysql -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$schema';" 2>&1);if($LASTEXITCODE -eq 0 -and ($probe -join '').Trim() -eq '1'){$ready=$true;break}}catch{};Start-Sleep -Seconds 1};if(-not $ready){throw '[MYSQL_READY_TIMEOUT] Final schema not ready'}
  if($ResumeStatePath){$marker=@(& docker exec -e "MYSQL_PWD=$password" $container mysql -uroot --batch --skip-column-names -e "SELECT COUNT(*) FROM $markerSchema.__kdrive_test_fixture_marker WHERE id=1 AND target_schema='$schema' AND marker_token='$token';");if($LASTEXITCODE -ne 0 -or ($marker -join '').Trim() -ne '1'){throw '[PREFLIGHT_GUARD] Resume marker mismatch'}}else{& docker exec -e "MYSQL_PWD=$password" $container mysql -uroot -e "CREATE DATABASE $markerSchema; CREATE TABLE $markerSchema.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO $markerSchema.__kdrive_test_fixture_marker VALUES(1,'$schema','$token');" | Out-Null}
  if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Marker creation failed'}
  $identity=& docker inspect --format '{{.Id}}' $container;if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Owned fixture identity missing'}
  [pscustomobject]@{Container=$container;Identity=$identity;Volume=$volume;Schema=$schema;MarkerSchema=$markerSchema;Port=$mysqlPort;Password=$password;SeedPassword=$seedPassword;MarkerToken=$token}|ConvertTo-Json|Set-Content (Join-Path $EvidenceDir 'fixture.private.json')
  $env:JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1';$env:PORT='8080';$env:DB_URL="jdbc:mysql://127.0.0.1:${mysqlPort}/${schema}?connectionTimeZone=UTC";$env:DB_USER='root';$env:DB_PASSWORD=$password;$env:JWT_SECRET=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N');$env:FRONTEND_ORIGIN='http://127.0.0.1:5173';$env:SEED_ENABLED='true';$env:SEED_PASSWORD=$seedPassword;[Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE',$null,'Process')
  $java=Join-Path $env:JAVA_HOME 'bin/java.exe'
  $backend=Start-Process $java -ArgumentList @('-jar',$jar) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'backend.log') -RedirectStandardError (Join-Path $EvidenceDir 'backend-error.log');$null=$backend.Handle;$processes+=,$backend
  $ready=$false;for($i=0;$i -lt 90;$i++){if($backend.HasExited){throw '[BACKEND_FAILURE] Owned backend exited'};try{if((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8080/api/v1/vehicles' -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Seconds 1};if(-not $ready){throw '[BACKEND_TIMEOUT] API unavailable'}
  $env:VITE_DATA_MODE='api';$env:VITE_API_BASE_URL='/api/v1'
  $front=Start-Process (Get-Command node.exe).Source -ArgumentList @($vite,'preview','--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'frontend.log') -RedirectStandardError (Join-Path $EvidenceDir 'frontend-error.log');$null=$front.Handle;$processes+=,$front
  $ready=$false;for($i=0;$i -lt 45;$i++){if($front.HasExited){throw '[FRONTEND_FAILURE] Vite exited'};try{if((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/' -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Seconds 1};if(-not $ready){throw '[FRONTEND_TIMEOUT] Vite unavailable'}
  $env:C7B_BASE_URL='http://127.0.0.1:5173';$env:C7B_API_BASE_URL='http://127.0.0.1:8080/api/v1';$env:C7B_CONTAINER=$container;$env:C7B_SCHEMA=$schema;$env:C7B_MARKER_SCHEMA=$markerSchema;$env:C7B_MARKER_TOKEN=$token;$env:C7B_DB_PASSWORD=$password;$env:C7B_SEED_PASSWORD=$seedPassword;$env:C7B_PLAYWRIGHT_MODULE=$playwright;$env:C7B_EVIDENCE_DIR=$EvidenceDir
  $browser=Start-Process (Get-Command node.exe).Source -ArgumentList @($browserScript) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'browser.log') -RedirectStandardError (Join-Path $EvidenceDir 'browser-error.log');$null=$browser.Handle;$processes+=,$browser
  if(-not $browser.WaitForExit(180000)){throw '[BROWSER_TIMEOUT] No completion within three minutes'};if($browser.ExitCode -ne 0){throw "[BROWSER_FAILURE] Exit $($browser.ExitCode); inspect browser-failure.json"};$browserPassed=$true
 }
}catch{$failure=$_.Exception.Message}
finally {
 try {
   [array]::Reverse($processes)
  foreach($p in $processes){
   if($ControlProbe -eq 'CleanupFailure'){
    $result=Invoke-OwnedProcessCleanup -OwnedProcesses @($p) -CustomStopProcess {param($target) throw 'Injected cleanup failure'}
    $cleanupPassed=$cleanupPassed -and $result.Success
    $null=Invoke-OwnedProcessCleanup -OwnedProcesses @($p)
   }else{$result=Invoke-OwnedProcessCleanup -OwnedProcesses @($p);$cleanupPassed=$cleanupPassed -and $result.Success}
   $readbacks+=[pscustomobject]@{PID=$p.Id;Exited=$p.HasExited;Cleanup=$result}
   if(-not $p.HasExited){$cleanupPassed=$false}
  }
  if($owned){$result=Stop-C7Fixture -Container $container -Port $mysqlPort -Owned $true -ReadbackPath (Join-Path $EvidenceDir 'mysql-cleanup.json');$cleanupPassed=$cleanupPassed -and $result.Passed}
 }catch{$cleanupPassed=$false;if(-not $failure){$failure=$_.Exception.Message}}
 finally{
  try{
   Restore-ProcessEnvironment -SavedEnvironment $saved
   if($ControlProbe -eq 'RestoreFailure'){$env:DB_URL='INJECTED_RESTORE_FAILURE'}
   $after=Snapshot-ProcessEnvironment -VariableNames $variables;$restoreExact=$true;foreach($v in $variables){if($saved[$v] -cne $after[$v]){$restoreExact=$false}}
  }finally{Restore-ProcessEnvironment -SavedEnvironment $saved}
  if(Test-Path -LiteralPath $privateFile){Remove-Item -LiteralPath $privateFile -Force}
  if($ControlProbe){$protectedUnchanged=$true}else{$protectedAfter=@(& docker inspect --format '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}' kltn-phase5-rerun);$protectedUnchanged=$LASTEXITCODE -eq 0 -and $protectedAfter.Count -eq 1 -and $protectedAfter[0] -ceq $originalIdentity[0]}
  $sourceAfter=Manifest;$sourceAfter | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
  $stable=($sourceBefore | ConvertTo-Json -Compress) -ceq ($sourceAfter | ConvertTo-Json -Compress)
  $readbacks | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'process-readback.json')
  $status=if(-not $failure -and $cleanupPassed -and $restoreExact -and $stable -and $protectedUnchanged){if($ControlProbe){'CONTROL_ONLY'}elseif($PreflightOnly){'PREFLIGHT_ONLY'}elseif($browserPassed){'PASS_SCOPED'}else{'NOT_VERIFIED'}}else{'FAIL'}
  [pscustomobject]@{Status=$status;VerificationMode=if($ControlProbe){'SyntheticControlProbe'}else{'Live'};BrowserPassed=$browserPassed;CleanupPassed=$cleanupPassed;EnvironmentRestored=$restoreExact;SourceStable=$stable;ProtectedOriginalIdentityUnchanged=$protectedUnchanged;Container=$container;Volume=$volume;VolumeRetained=$owned;Processes=$readbacks;Failure=$failure;JarSHA256=(Get-FileHash $jar).Hash} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $EvidenceDir 'summary.json')
 }
}
if($failure){throw $failure}
if(-not $cleanupPassed -or -not $restoreExact -or -not $stable -or -not $protectedUnchanged){throw '[CLEANUP_FAILURE] Lifecycle or provenance verification failed'}
