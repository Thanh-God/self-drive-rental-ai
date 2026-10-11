param([Parameter(Mandatory=$true)][string]$EvidenceDir,
    [scriptblock]$ControlProbe,
    [scriptblock]$AfterRestoreProbe)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=(Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5){throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required'}
if(Test-Path -LiteralPath $EvidenceDir){throw '[PREFLIGHT_REFUSAL] Evidence exists'}
$EvidenceDir=[IO.Path]::GetFullPath($EvidenceDir)
$build=Join-Path $repo 'scripts/coordination/c6-checkpoint-b/build-fat-jar.ps1'
$c7Helper=Join-Path $PSScriptRoot 'c7-helpers.psm1'
$cleanupHelper=Join-Path $PSScriptRoot 'fixture-cleanup.ps1'
foreach($dep in @($build,$c7Helper,$cleanupHelper)){if(-not(Test-Path $dep)){throw '[PREFLIGHT_GUARD] Missing dependency'}}
. $cleanupHelper
Import-Module $c7Helper -Force

function Manifest {
    $files=@(Get-ChildItem (Join-Path $repo 'backend/src') -Recurse -File)+@(Get-ChildItem (Join-Path $repo 'backend/.mvn') -Recurse -File)+@(Get-ChildItem $PSScriptRoot -File)
    foreach($rel in @('backend/pom.xml','backend/mvnw','backend/mvnw.cmd')){$files+=Get-Item (Join-Path $repo $rel)}
    $files+=Get-Item $build
    $result=[ordered]@{}
    foreach($file in ($files | Sort-Object FullName -Unique)){$result[$file.FullName.Substring($repo.Length+1)]=(Get-FileHash $file.FullName).Hash}
    return $result
}

$before=Manifest
$suites=@('IncidentReportIntegrationTest', 'IncidentReportHttpServerTest')
$expectedMethods=[ordered]@{}
foreach($suite in $suites){
    $text=Get-Content (Join-Path $repo "backend/src/test/java/com/carrental/$suite.java") -Raw
    $methods=@([regex]::Matches($text,'@Test\s+void\s+(\w+)\s*\(') | ForEach-Object {$_.Groups[1].Value})
    if(-not $methods.Count){throw "No expected test methods in $suite"}
    $expectedMethods[$suite]=$methods
}

$port=33615
$name='kltn-c7-ag-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$volume='vol-'+$name
$db='kdrive_c7_ag'
$meta='kdrive_c7_ag_meta'
$names=@(& docker ps -a --format '{{.Names}}')
if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Docker inventory failed'}
$volumes=@(& docker volume ls --format '{{.Name}}')
if($LASTEXITCODE -ne 0){throw '[PREFLIGHT_GUARD] Volume inventory failed'}
if($names -contains $name -or $volumes -contains $volume){throw '[PREFLIGHT_GUARD] Existing fixture'}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
try {$listener.Start()} catch {throw '[PREFLIGHT_GUARD] Fixture port occupied'} finally {$listener.Stop()}

New-Item -ItemType Directory $EvidenceDir | Out-Null
$before | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
$expectedMethods | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'expected-methods.json')

$variables=@('JAVA_HOME','KDRIVE_TEST_DB_URL','KDRIVE_TEST_DB_USER','KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX','KDRIVE_TEST_FIXTURE_MARKER_TOKEN','KDRIVE_TEST_EXPECTED_HOST','KDRIVE_TEST_EXPECTED_PORT','KDRIVE_TEST_EXPECTED_SCHEMA','KDRIVE_TEST_MARKER_SCHEMA','SPRING_PROFILES_ACTIVE')
$environment=Snapshot-ProcessEnvironment -VariableNames $variables
# Privacy: Redact sensitive environment variables in persisted evidence (Presence & Equality only)
$safeEnvironment=[ordered]@{}
foreach($v in $variables){
    $val=$environment[$v]
    if($v -in @('KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_FIXTURE_MARKER_TOKEN')){
        $safeEnvironment[$v]=@{Present=(-not [string]::IsNullOrEmpty($val));Length=if($null -ne $val){$val.Length}else{0}}
    } else {
        $safeEnvironment[$v]=$val
    }
}
$safeEnvironment | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'environment-before.json')
$owned=$false;$testsPassed=$false;$cleanupPassed=$false;$processCleanupPassed=$true

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
        $consecutiveSuccess=0
        for($i=0;$i -lt 45;$i++) {
            try {
                $probe=@(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --batch --skip-column-names -e 'SELECT 1;' 2>&1)
                if($LASTEXITCODE -eq 0 -and ($probe -join '').Trim() -eq '1'){
                    $consecutiveSuccess++
                    if($consecutiveSuccess -ge 2){$ready=$true;break}
                } else {
                    $consecutiveSuccess=0
                }
            } catch {$consecutiveSuccess=0}
            Start-Sleep -Seconds 1
        }
        if(-not $ready){throw 'MySQL query ready timeout'}
        Start-Sleep -Seconds 1
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

        if($ControlProbe){
            # Explicit control-flow seam; never counts as database verification.
            & $ControlProbe
        } else {
        # Re-use isolated source build; workspace target remains untouched.
        $built=& $build -EvidenceDir (Join-Path $EvidenceDir 'build') -OutputDir (Join-Path $EvidenceDir 'backend-copy')
        $cwd=Get-Location
        $suitesPassed=$true
        try {
            Set-Location (Split-Path $built.CompiledOutput -Parent)
            foreach($suite in $suites) {
                $suiteMethods=$expectedMethods[$suite]
                $maven=Start-Process -FilePath (Join-Path (Get-Location) 'mvnw.cmd') -ArgumentList @('-o','-B','-ntp',"-Dmaven.repo.local=$repo/.runtime/m2","-Dtest=$suite",'test') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir "maven-$suite.log") -RedirectStandardError (Join-Path $EvidenceDir "maven-$suite-error.log")
                $null=$maven.Handle
                try {
                    if(-not $maven.WaitForExit(300000)){throw "[TEST_TIMEOUT] Maven exceeded five minutes on $suite"}
                    $mavenExit=$maven.ExitCode
                } finally {
                    $cleanupProc=Invoke-OwnedProcessCleanup -OwnedProcesses @($maven)
                    if(-not $cleanupProc.Success){
                        $processCleanupPassed=$false
                    }
                    [pscustomobject]@{PID=$maven.Id;HasExited=$maven.HasExited;CleanupResult=$cleanupProc} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir "maven-process-$suite.json")
                }
                if($mavenExit -ne 0){throw "[TEST_FAILURE] Maven exit $mavenExit on $suite"}
                if(-not $processCleanupPassed){throw "[CLEANUP_FAILURE] Process cleanup failed on $suite"}

                $saved=Join-Path $EvidenceDir "TEST-com.carrental.$suite.xml"
                Copy-Item (Join-Path $built.CompiledOutput "surefire-reports/TEST-com.carrental.$suite.xml") $saved
                Assert-SurefireXmlStrict -XmlPath $saved -ExpectedTests $suiteMethods.Count -ExpectedFailures 0 -ExpectedErrors 0 -ExpectedSkipped 0 | Out-Null
                [xml]$xml=Get-Content $saved -Raw
                $actual=@($xml.testsuite.testcase | ForEach-Object {$_.name} | Sort-Object)
                if(($actual -join '|') -cne (($suiteMethods | Sort-Object) -join '|')){throw "[XML_METHODS] Unexpected methods in $suite"}
            }
        } finally {Set-Location $cwd}

        }
        $readSql="SELECT DATABASE(),@@port; SELECT version,success,checksum FROM flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM incident_cases; SELECT COUNT(*) FROM incident_events;"
        $read=@(& docker exec -e "MYSQL_PWD=$password" $name mysql -uroot --database=$db --batch -e $readSql)
        if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Readback'}
        $read | Set-Content (Join-Path $EvidenceDir 'mysql-readback.txt')

        $after=Manifest
        $after | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
        if(($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)){throw '[SOURCE_DRIFT] Test inputs changed'}
        $testsPassed=$true
    } finally {
        $cleanup=Stop-C7Fixture -Container $name -Port $port -Owned $owned -ReadbackPath (Join-Path $EvidenceDir 'cleanup.json')
        $cleanupPassed=$cleanup.Passed
    }
} finally {
    Restore-ProcessEnvironment -SavedEnvironment $environment
    if($AfterRestoreProbe){& $AfterRestoreProbe}
    $envReadback=Snapshot-ProcessEnvironment -VariableNames $variables
    $envDiffs=[ordered]@{}
    $envRestoredActual=$true
    foreach($v in $variables){
        if($environment[$v] -cne $envReadback[$v]){
            $envRestoredActual=$false
            $envDiffs[$v]=@{
                Match=$false;
                BeforePresent=(-not [string]::IsNullOrEmpty($environment[$v]));
                AfterPresent=(-not [string]::IsNullOrEmpty($envReadback[$v]))
            }
        }
    }
    # Privacy: Safe environment after restoration report
    $safeEnvAfter=[ordered]@{}
    foreach($v in $variables){
        $val=$envReadback[$v]
        if($v -in @('KDRIVE_TEST_DB_PASSWORD','KDRIVE_TEST_FIXTURE_MARKER_TOKEN')){
            $safeEnvAfter[$v]=@{Present=(-not [string]::IsNullOrEmpty($val));Length=if($null -ne $val){$val.Length}else{0}}
        } else {
            $safeEnvAfter[$v]=$val
        }
    }
    [pscustomobject]@{
        EnvironmentBefore=$safeEnvironment;
        EnvironmentAfterRestoration=$safeEnvAfter;
        EnvironmentRestoredActual=$envRestoredActual;
        Differences=$envDiffs
    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'environment-restoration-report.json')

    $overallSuccess = ($testsPassed -and $cleanupPassed -and $processCleanupPassed -and $envRestoredActual)
    [pscustomobject]@{
        TestsPassed=($testsPassed -and -not $ControlProbe);
        ControlFlowPassed=$testsPassed;
        VerificationMode=if($ControlProbe){'SyntheticControlProbe'}else{'LiveMySQL'};
        CleanupPassed=$cleanupPassed;
        ProcessCleanupPassed=$processCleanupPassed;
        EnvironmentRestoredActual=$envRestoredActual;
        OverallSuccess=$overallSuccess;
        Container=$name;
        VolumeRetained=$volume;
        Port=$port;
        SuitesExecuted=if($ControlProbe){@()}else{$suites}
    } | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'summary.json')
}
if(-not($testsPassed -and $cleanupPassed -and $processCleanupPassed -and $envRestoredActual)){throw '[RUNNER_FAILURE] C7 runner did not pass fail-closed validation'}
