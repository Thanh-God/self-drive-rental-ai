param([Parameter(Mandatory=$true)][string]$EvidenceDir)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Evidence exists'}
$EvidenceDir=[IO.Path]::GetFullPath($EvidenceDir)
$build=Join-Path $repo 'scripts/coordination/c6-checkpoint-b/build-fat-jar.ps1'
$xmlHelper=Join-Path $repo '.runtime/coordination-c6-checkpoint-a-20261010-122848/c6-checkpoint-a-helpers.psm1'
foreach($dep in @($build,$xmlHelper,(Join-Path $PSScriptRoot 'fixture-cleanup.ps1'))){if(-not(Test-Path $dep)){throw '[PREFLIGHT_GUARD] Missing dependency'}}
. (Join-Path $PSScriptRoot 'fixture-cleanup.ps1')
function Manifest {
    $files=@(Get-ChildItem (Join-Path $repo 'backend/src') -Recurse -File)+@(Get-ChildItem (Join-Path $repo 'backend/.mvn') -Recurse -File)+@(Get-ChildItem $PSScriptRoot -File)
    foreach($rel in @('backend/pom.xml','backend/mvnw','backend/mvnw.cmd')){$files+=Get-Item (Join-Path $repo $rel)}
    $files+=Get-Item $build,$xmlHelper
    $result=[ordered]@{}
    foreach($file in ($files | Sort-Object FullName -Unique)){$result[$file.FullName.Substring($repo.Length+1)]=(Get-FileHash $file.FullName).Hash}
    return $result
}
$before=Manifest
$methods=@{}
foreach($suite in @('ReviewHttpIntegrationTest','ReviewIntegrationTest')) {
    $text=Get-Content (Join-Path $repo "backend/src/test/java/com/carrental/$suite.java") -Raw
    $methods[$suite]=@([regex]::Matches($text,'@Test\s+void\s+(\w+)\s*\(') | ForEach-Object {$_.Groups[1].Value})
    if(-not $methods[$suite].Count){throw 'No expected test methods'}
}
$port=33612
$name='kltn-c6-f04-a-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$volume='vol-'+$name
$db='kdrive_c6_f04_a'
$meta='kdrive_c6_f04_a_meta'
$names=@(& docker ps -a --format '{{.Names}}')
if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Docker inventory failed'}
$volumes=@(& docker volume ls --format '{{.Name}}')
if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Volume inventory failed'}
if($names -contains $name -or $volumes -contains $volume){throw '[PREFLIGHT_GUARD] Existing fixture'}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
try {$listener.Start()} catch {throw '[PREFLIGHT_GUARD] Fixture port occupied'} finally {$listener.Stop()}
New-Item -ItemType Directory $EvidenceDir | Out-Null
$before | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
$methods | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'expected-methods.json')
$variables=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE')
$environment=@{};foreach($v in $variables){$environment[$v]=[Environment]::GetEnvironmentVariable($v,'Process')}
$owned=$false;$testsPassed=$false;$cleanupPassed=$false
try {
    try {
        $password=[Guid]::NewGuid().ToString('N')
        $token=[Guid]::NewGuid().ToString('N')
        $private=Join-Path $EvidenceDir 'mysql.private.env'
        [IO.File]::WriteAllLines($private,@("MYSQL_ROOT_PASSWORD=$password","MYSQL_DATABASE=$db"),[Text.UTF8Encoding]::new($false))
        & docker run -d --name $name -p "127.0.0.1:${port}:3306" --env-file $private -v "${volume}:/var/lib/mysql" mysql:8.4 | Out-Null
        if($LASTEXITCODE -ne 0){throw '[DOCKER_RUN_FAILED] Fixture not created'}
        $owned=$true
        $ready=$false
        for($i=0;$i -lt 45;$i++) {
            try {
                $probe=@(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --batch --skip-column-names -e 'SELECT 1;' 2>&1)
                if($LASTEXITCODE -eq 0 -and ($probe -join '').Trim() -eq '1'){$ready=$true;break}
            } catch {}
            Start-Sleep -Seconds 1
        }
        if(-not $ready){throw 'MySQL query ready timeout'}
        $sql="CREATE DATABASE $meta; CREATE TABLE $meta.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO $meta.__kdrive_test_fixture_marker VALUES(1,'$db','$token');"
        & docker exec -e "MYSQL_PWD=$password" $name mysql -uroot -e $sql | Out-Null
        if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Marker setup'}
        $env:JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1'
        [Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE',$null,'Process')
        $env:KDRIVE_TEST_DB_URL="jdbc:mysql://127.0.0.1:${port}/${db}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
        $env:KDRIVE_TEST_DB_USER='root';$env:KDRIVE_TEST_DB_PASSWORD=$password
        $env:KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX=$db;$env:KDRIVE_TEST_FIXTURE_MARKER_TOKEN=$token
        $env:KDRIVE_TEST_EXPECTED_HOST='127.0.0.1';$env:KDRIVE_TEST_EXPECTED_PORT="$port"
        $env:KDRIVE_TEST_EXPECTED_SCHEMA=$db;$env:KDRIVE_TEST_MARKER_SCHEMA=$meta
        # Reuse accepted isolated source build; workspace target remains untouched.
        $built=& $build -EvidenceDir (Join-Path $EvidenceDir 'build') -OutputDir (Join-Path $EvidenceDir 'backend-copy')
        $cwd=Get-Location
        try {
            Set-Location (Split-Path $built.CompiledOutput -Parent)
            $maven=Start-Process -FilePath (Join-Path (Get-Location) 'mvnw.cmd') -ArgumentList @('-o','-B','-ntp',"-Dmaven.repo.local=$repo/.runtime/m2",'-Dtest=ReviewHttpIntegrationTest,ReviewIntegrationTest',"-Df04.evidenceDir=$EvidenceDir/snapshots",'test') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir 'maven.log') -RedirectStandardError (Join-Path $EvidenceDir 'maven-error.log')
            # Cache the OS handle before exit; Windows PowerShell otherwise may return null ExitCode.
            $null=$maven.Handle
            try {
                if(-not $maven.WaitForExit(300000)){throw '[TEST_TIMEOUT] Maven exceeded five minutes'}
                $mavenExit=$maven.ExitCode
            } finally {
                if(-not $maven.HasExited){& taskkill /PID $maven.Id /T /F | Out-Null;$maven.WaitForExit(5000) | Out-Null}
                if(-not $maven.HasExited){throw '[CLEANUP_FAILURE] Owned Maven did not exit'}
                [pscustomobject]@{PID=$maven.Id;HasExited=$maven.HasExited} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'maven-process.json')
            }
        } finally {Set-Location $cwd}
        if($mavenExit -ne 0){throw "[TEST_FAILURE] Maven exit $mavenExit"}
        Import-Module $xmlHelper -Force
        foreach($suite in $methods.Keys) {
            $saved=Join-Path $EvidenceDir "TEST-com.carrental.$suite.xml"
            Copy-Item (Join-Path $built.CompiledOutput "surefire-reports/TEST-com.carrental.$suite.xml") $saved
            Assert-SurefireXmlStrict -XmlPath $saved -ExpectedTests $methods[$suite].Count -ExpectedFailures 0 -ExpectedErrors 0 -ExpectedSkipped 0 | Out-Null
            [xml]$xml=Get-Content $saved -Raw
            $actual=@($xml.testsuite.testcase | ForEach-Object {$_.name} | Sort-Object)
            if(($actual -join '|') -cne (($methods[$suite] | Sort-Object) -join '|')){throw '[XML_METHODS] Unexpected methods'}
        }
        $readSql="SELECT DATABASE(),@@port; SELECT version,success,checksum FROM flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM reviews;"
        $read=@(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --database=$db --batch -e $readSql)
        if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Readback'}
        $read | Set-Content (Join-Path $EvidenceDir 'mysql-readback.txt')
        $after=Manifest
        $after | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
        if(($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)){throw '[SOURCE_DRIFT] Test inputs changed'}
        $testsPassed=$true
    } finally {
        $cleanup=Stop-F04Fixture -Container $name -Port $port -Owned $owned -ReadbackPath (Join-Path $EvidenceDir 'cleanup.json')
        $cleanupPassed=$cleanup.Passed
    }
} finally {
    foreach($v in $variables){[Environment]::SetEnvironmentVariable($v,$environment[$v],'Process')}
    [pscustomobject]@{TestsPassed=$testsPassed;CleanupPassed=$cleanupPassed;OverallSuccess=($testsPassed -and $cleanupPassed);Container=$name;VolumeRetained=$volume;Port=$port;EnvironmentRestored=$true} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
}
if(-not($testsPassed -and $cleanupPassed)){throw 'F04 did not pass'}
