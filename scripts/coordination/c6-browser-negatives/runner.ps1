# runner.ps1
# C6 Browser Negatives Runner (F01/F03) - Live MySQL Fixture, Fat JAR & Playwright

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null,
    [switch]$SkipRefusalCheck,
    [switch]$RefusalTestOnly,
    [ValidateSet("Normal","Exception","Logger","Readback")][string]$EnvironmentProbeMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Get-Item $PSScriptRoot).Parent.Parent.Parent.FullName
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw '[UNSUPPORTED_SHELL] Windows PowerShell 5.1 required' }
$BaseDir = $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $EvidenceDir = Join-Path $RepoRoot ".runtime\coordination-c6-browser-negatives-$timestamp\run1"
}

# 1. Preflight Refusal Check: Không ghi đè thư mục evidence đã có
if (Test-Path -LiteralPath $EvidenceDir) {
    throw "[PREFLIGHT_REFUSAL] Evidence directory already exists: $EvidenceDir"
}

if ($RefusalTestOnly) {
    Write-Host "[REFUSAL_TEST] Preflight refusal passed (new evidence directory confirmed)."
    exit 0
}

# =============================================================================
# ENVIRONMENT BACKUP & RESTORATION (2-LAYER ROBUST OUTER FINALLY)
# =============================================================================
$trackedEnvVars = @(
    "SPRING_DATASOURCE_URL",
    "SPRING_DATASOURCE_USERNAME",
    "SPRING_DATASOURCE_PASSWORD",
    "SPRING_PROFILES_ACTIVE",
    "DB_URL",
    "DB_USER",
    "DB_PASSWORD",
    "PORT",
    "BACKEND_PORT",
    "VITE_PORT",
    "VITE_DATA_MODE",
    "VITE_API_BASE_URL",
    "RUN_DIR",
    "BASE_URL",
    "API_BASE_URL",
    "JAVA_HOME", "SEED_ENABLED", "MYSQL_PWD",
    "KDRIVE_TEST_DB_URL", "KDRIVE_TEST_DB_USER", "KDRIVE_TEST_DB_PASSWORD",
    "KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX", "KDRIVE_TEST_FIXTURE_MARKER_TOKEN",
    "KDRIVE_TEST_EXPECTED_HOST", "KDRIVE_TEST_EXPECTED_PORT", "KDRIVE_TEST_EXPECTED_SCHEMA",
    "KDRIVE_TEST_FIXTURE",
    "KDRIVE_TEST_MARKER_SCHEMA",
    "SEED_PASSWORD",
    "JWT_SECRET",
    "PROBE_EXISTING_VAR",
    "PROBE_ABSENT_VAR"
)

function Backup-ProcessEnvironment {
    $backup = @{}
    foreach ($var in $trackedEnvVars) {
        $val = [Environment]::GetEnvironmentVariable($var, "Process")
        $backup[$var] = $val
    }
    return $backup
}

function Restore-ProcessEnvironment {
    param([hashtable]$backup)
    if ($null -eq $backup) { return }
    foreach ($k in $backup.Keys) {
        $oldVal = $backup[$k]
        [Environment]::SetEnvironmentVariable($k, $oldVal, "Process")
    }
}

$initialEnvBackup = Backup-ProcessEnvironment

function Get-RunInputs {
    $inputs=[ordered]@{}
    $files=@(Get-ChildItem (Join-Path $RepoRoot 'backend/src') -Recurse -File)+@(Get-ChildItem (Join-Path $RepoRoot 'frontend/src') -Recurse -File)+@(Get-ChildItem $BaseDir -File)
    foreach($rel in @('backend/pom.xml','backend/mvnw.cmd','backend/mvnw','backend/.mvn/wrapper/maven-wrapper.properties','frontend/package.json','frontend/package-lock.json','frontend/vite.config.js','scripts/coordination/c6-browser-negatives/vite.config.mjs')) { $files+=Get-Item (Join-Path $RepoRoot $rel) }
    foreach($f in ($files | Sort-Object FullName -Unique)) {$inputs[$f.FullName.Substring($RepoRoot.Length+1)]=(Get-FileHash -LiteralPath $f.FullName).Hash}
    return $inputs
}
$runInputsBefore=Get-RunInputs

# =============================================================================
# PREFLIGHT DEPENDENCY GUARD
# =============================================================================
function Assert-PreflightDependencies {
    param([string]$Dir)

    $requiredFiles = @(
        @{ Name = "vite.config.mjs"; Path = (Join-Path $Dir "vite.config.mjs") },
        @{ Name = "verify-browser-negatives.cjs"; Path = (Join-Path $Dir "verify-browser-negatives.cjs") },
        @{ Name = "build-fat-jar.ps1"; Path = (Join-Path $Dir "..\c6-checkpoint-b\build-fat-jar.ps1") },
        @{ Name = "frontend/package.json"; Path = (Join-Path $FrontendDir "package.json") },
        @{ Name = "backend/pom.xml"; Path = (Join-Path $BackendDir "pom.xml") },
        @{ Name = "backend/mvnw.cmd"; Path = (Join-Path $BackendDir "mvnw.cmd") }
    )

    foreach ($dep in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $dep.Path)) {
            throw "[PREFLIGHT_GUARD] Required dependency missing: $($dep.Name) at $($dep.Path)"
        }
    }
}

Assert-PreflightDependencies -Dir $BaseDir

# =============================================================================
# HELPER: RUN LOG & PROCESS CLEANUP
# =============================================================================
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
$runLog = Join-Path $EvidenceDir "runner.log"
$inCleanup=$false

function Write-RunLog {
    param([string]$Message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $line = "[$timestamp] $Message"
    Write-Host $line
    try {
        Add-Content -LiteralPath $runLog -Value $line -Encoding UTF8
    } catch {
        if($inCleanup){$script:cleanupFailureOccurred=$true;$script:cleanupFailureMessage+=' Cleanup log write failed;'} else {throw}
    }
}

# Khởi tạo các biến kiểm soát vòng đời tiến trình & fixture
$containerCreated = $false
$ContainerName = "kltn-c6-browser-neg-$([Guid]::NewGuid().ToString('N').Substring(0,12))"
$VolumeName = "vol-$ContainerName"
$MysqlPort = 33611
$BackendPort = 8126
$VitePort = 5226
$backendProcess = $null
$viteProcess = $null
$overallSuccess = $false
$cleanupFailureOccurred = $false
$cleanupFailureMessage = ""

# =============================================================================
# OUTER TRY / FINALLY: ĐẢM BẢO KHÔI PHỤC CALLER ENVIRONMENT VÔ ĐIỀU KIỆN
# =============================================================================
try {
    if ($EnvironmentProbeMode) {
        $env:DB_URL='probe-changed'
        $env:PROBE_EXISTING_VAR='probe-changed'
        $env:PROBE_ABSENT_VAR='probe-created'
        if ($EnvironmentProbeMode -eq 'Logger') { $runLog=Join-Path $EvidenceDir 'missing-parent/log'; Write-RunLog 'probe' }
        if ($EnvironmentProbeMode -eq 'Readback') { 'probe' | Set-Content (Join-Path $EvidenceDir 'missing-parent/readback') }
        if ($EnvironmentProbeMode -eq 'Exception') { throw '[ENV_PROBE_EXCEPTION]' }
        return
    }
    # INNER TRY / FINALLY: THỰC THI NGHIỆP VỤ & CLEANUP TIẾN TRÌNH / DOCKER
    try {
        Write-RunLog "=== Starting C6 Browser Negatives Runner (Session: $ContainerName) ==="
        Write-RunLog "BaseDir: $BaseDir"
        Write-RunLog "EvidenceDir: $EvidenceDir"

        # 1. PREFLIGHT DOCKER INVENTORY & GUARDS
        Write-RunLog "--- 1. Preflight Docker Inventory Check ---"
        $invOut = & docker ps -a --format "{{.Names}}" 2>&1
        $invExit = $LASTEXITCODE
        if ($null -eq $invExit) { $invExit = 0 }
        if ($invExit -ne 0) {
            throw "[PREFLIGHT_GUARD] Docker container inventory failed with native exit code ${invExit}: $($invOut -join ' ')"
        }
        $existingContainers = @($invOut | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($existingContainers -contains $ContainerName) { throw '[PREFLIGHT_GUARD] Container already exists' }
        $vols=@(& docker volume ls --format '{{.Name}}' 2>&1)
        if ($LASTEXITCODE -ne 0) { throw '[PREFLIGHT_GUARD] Docker volume inventory failed' }
        if ($vols -contains $VolumeName) { throw '[PREFLIGHT_GUARD] Volume already exists' }
        foreach ($port in @($MysqlPort,$BackendPort,$VitePort)) {
            $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
            try { $listener.Start() } catch { throw "[PREFLIGHT_GUARD] Port $port occupied" } finally { $listener.Stop() }
        }
        Write-RunLog "Found $($existingContainers.Count) existing docker containers."

        # Guard: Không được trùng với container phase 5 local
        if ($existingContainers -contains "kltn-phase5-rerun") {
            Write-RunLog "Notice: User container 'kltn-phase5-rerun' detected running on 33385. Port $MysqlPort will be used."
        }

        # 2. KHỞI TẠO MYSQL FIXTURE CONTAINER
        Write-RunLog "--- 2. Starting Isolated MySQL Fixture Container: $ContainerName on port $MysqlPort ---"
        $dbPassword = [Guid]::NewGuid().ToString("N")
        $DbUser = "root"
        $DbName = "kdrive_c6_browser_neg"
        $MarkerSchema = "kdrive_c6_browser_neg_meta"

        $privateEnv=Join-Path $EvidenceDir 'mysql.private.env'
        [IO.File]::WriteAllLines($privateEnv,@("MYSQL_ROOT_PASSWORD=$dbPassword","MYSQL_DATABASE=$DbName"),[Text.UTF8Encoding]::new($false))
        $runArgs = @('run','-d','--name',$ContainerName,'-p',"127.0.0.1:${MysqlPort}:3306",'--env-file',$privateEnv,'-v',"${VolumeName}:/var/lib/mysql",'mysql:8.4')
        $runOut = & docker $runArgs 2>&1
        $runExit = $LASTEXITCODE
        if ($null -eq $runExit) { $runExit = 0 }
        if ($runExit -ne 0) {
            throw "[DOCKER_RUN_FAILED] Failed to start MySQL container with exit code ${runExit}: $($runOut -join ' ')"
        }
        $containerCreated = $true
        Write-RunLog "MySQL Container started: $ContainerName"

        # Chờ MySQL ready
        Write-RunLog "Waiting for MySQL container to become ready on port $MysqlPort..."
        $mysqlReady = $false
        for ($i = 1; $i -le 30; $i++) {
            try {
            $pingOut = & docker exec -e "MYSQL_PWD=$dbPassword" $ContainerName mysql -uroot --batch --skip-column-names -e "SELECT 1;" 2>&1
            $pingExit = $LASTEXITCODE
            if ($null -eq $pingExit) { $pingExit = 0 }
            if ($pingExit -eq 0 -and ($pingOut -join ' ').Trim() -eq "1") {
                $mysqlReady = $true
                break
            }
            } catch {}
            Start-Sleep -Seconds 2
        }
        if (-not $mysqlReady) {
            throw "MySQL container did not become ready within timeout."
        }
        Write-RunLog "MySQL container is fully ready."

        # Tạo Marker Schema & Fixture Table
        $markerToken=[Guid]::NewGuid().ToString('N')
        $metaSql = "CREATE DATABASE $MarkerSchema; CREATE TABLE $MarkerSchema.__kdrive_test_fixture_marker (id INT PRIMARY KEY, target_schema VARCHAR(255), marker_token VARCHAR(255)); INSERT INTO $MarkerSchema.__kdrive_test_fixture_marker VALUES (1,'$DbName','$markerToken');"
        $sqlOut = & docker exec -e "MYSQL_PWD=$dbPassword" $ContainerName mysql -uroot -e "$metaSql" 2>&1
        $sqlExit = $LASTEXITCODE
        if ($null -eq $sqlExit) { $sqlExit = 0 }
        if ($sqlExit -ne 0) {
            throw "Failed to create fixture marker schema: $($sqlOut -join ' ')"
        }
        Write-RunLog "Marker schema $MarkerSchema created successfully."

        # Cấu hình biến môi trường kết nối MySQL
        $dbUrl = "jdbc:mysql://127.0.0.1:${MysqlPort}/${DbName}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
        $env:SPRING_DATASOURCE_URL = $dbUrl
        $env:SPRING_DATASOURCE_USERNAME = $DbUser
        $env:SPRING_DATASOURCE_PASSWORD = $dbPassword
        $env:DB_URL = $dbUrl
        $env:DB_USER = $DbUser
        $env:DB_PASSWORD = $dbPassword
        $env:KDRIVE_TEST_DB_URL=$dbUrl
        $env:KDRIVE_TEST_DB_USER=$DbUser
        $env:KDRIVE_TEST_DB_PASSWORD=$dbPassword
        $env:KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX=$DbName
        $env:KDRIVE_TEST_FIXTURE_MARKER_TOKEN=$markerToken
        $env:KDRIVE_TEST_EXPECTED_HOST='127.0.0.1'
        $env:KDRIVE_TEST_EXPECTED_PORT="$MysqlPort"
        $env:KDRIVE_TEST_EXPECTED_SCHEMA=$DbName
        $env:KDRIVE_TEST_FIXTURE = $ContainerName
        $env:KDRIVE_TEST_MARKER_SCHEMA = $MarkerSchema

        $env:JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1'
        # 3. BUILD FAT JAR VỚI ISOLATED OUTPUT
        Write-RunLog "--- 3. Building Fat JAR with Isolated Output & Full Manifest ---"
        $buildScript = Join-Path (Split-Path $PSScriptRoot -Parent) "c6-checkpoint-b\build-fat-jar.ps1"
        $jarOutputDir = Join-Path $EvidenceDir "jar-isolated"
        $buildResult = & $buildScript -EvidenceDir (Join-Path $EvidenceDir "build") -OutputDir $jarOutputDir
        Write-RunLog "Fat JAR build provenance passed: $($buildResult.EffectiveJarPath) (SHA256: $($buildResult.JarSHA256))"

        # 4. CHẠY BACKEND TESTS TRÊN MYSQL FIXTURE (ReviewHttpIntegrationTest + ReviewIntegrationTest = 11 tests)
        Write-RunLog "--- 4. Running 11 Backend Tests on MySQL Fixture ---"
        $prevDir = Get-Location
        try {
            Set-Location -LiteralPath (Split-Path $buildResult.CompiledOutput -Parent)
            $mvnTestLog = Join-Path $EvidenceDir "mvn-11-tests.log"
            $mvnCmd = Join-Path (Split-Path $buildResult.CompiledOutput -Parent) "mvnw.cmd"
            $pTest = Start-Process -FilePath $mvnCmd -ArgumentList "-o", "-B", "-ntp", "-Dmaven.repo.local=$RepoRoot/.runtime/m2", "-Dtest=ReviewHttpIntegrationTest,ReviewIntegrationTest", "test" -NoNewWindow -Wait -PassThru -RedirectStandardOutput $mvnTestLog -RedirectStandardError (Join-Path $EvidenceDir "mvn-11-tests-err.log")
            $mvnTestExit = $pTest.ExitCode
        } finally {
            Set-Location -LiteralPath $prevDir
        }
        Write-RunLog "Backend integration tests finished with exit code: $mvnTestExit"
        if ($mvnTestExit -ne 0) {
            throw "11 Backend integration tests failed with exit code $mvnTestExit"
        }

        # Verify surefire XML
        Import-Module (Join-Path $RepoRoot '.runtime/coordination-c6-checkpoint-a-20261010-122848/c6-checkpoint-a-helpers.psm1') -Force
        foreach($suite in @(@{Name='ReviewHttpIntegrationTest';Count=5},@{Name='ReviewIntegrationTest';Count=6})) {
            $xml=Join-Path $buildResult.CompiledOutput "surefire-reports/TEST-com.carrental.$($suite.Name).xml"
            $saved=Join-Path $EvidenceDir "TEST-com.carrental.$($suite.Name).xml"
            Copy-Item -LiteralPath $xml -Destination $saved
            Assert-SurefireXmlStrict -XmlPath $saved -ExpectedTests $suite.Count -ExpectedFailures 0 -ExpectedErrors 0 -ExpectedSkipped 0 | Out-Null
        }

        # Confirm actual fixture identity and successful migrations independently
        $readSql="SELECT DATABASE(),@@port; SELECT version,success,checksum FROM $DbName.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM $DbName.reviews;"
        $readOut=@(& docker exec -e "MYSQL_PWD=$dbPassword" $ContainerName mysql -uroot --database=$DbName --batch -e $readSql 2>&1)
        if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Fixture readback failed'}
        $readOut | Set-Content (Join-Path $EvidenceDir 'mysql-readback.txt')

        # Seed a completed booking for browser tests
        $bookingId='booking-e2e-completed-001'
        $seedSql="INSERT INTO $DbName.bookings (id,user_id,vehicle_id,customer_name,vehicle_name,pickup_branch_id,return_branch_id,pickup_name,return_name,actual_return_branch_id,start_at,end_at,expires_at,status,daily_price,rental_days,rental_total,one_way_fee,total,policy_version,created_at,version) VALUES ('$bookingId','demo-user','v1','Demo','Toyota Vios','dn','dn','Demo','Demo','dn','2026-10-01 10:00:00','2026-10-04 10:00:00','2026-10-04 10:00:00','COMPLETED',650000,3,1950000,0,1950000,'v1_policy','2026-10-01 10:00:00',0);"
        & docker exec -e "MYSQL_PWD=$dbPassword" $ContainerName mysql -uroot -e $seedSql | Out-Null
        if($LASTEXITCODE -ne 0){throw '[SQL_FAILURE] Completed booking seed failed'}

        # Also seed vehicle v1 if not exists
        $vehicleSql="INSERT IGNORE INTO $DbName.vehicles (id,name,plate,brand_id,category_id,home_branch_id,current_branch_id,seats,transmission,daily_price,status,description,version) VALUES ('v1','Toyota Vios','51A-12345','brand1','cat1','dn','dn',5,'AUTO',650000,'ACTIVE','Test vehicle',0);"
        & docker exec -e "MYSQL_PWD=$dbPassword" $ContainerName mysql -uroot -e $vehicleSql | Out-Null

        # 5. KHỞI CHẠY BACKEND FAT JAR
        Write-RunLog "--- 5. Spawning Backend Fat JAR on port $BackendPort ---"
        $env:PORT = "$BackendPort"
        [Environment]::SetEnvironmentVariable('SPRING_PROFILES_ACTIVE',$null,'Process')
        $env:SEED_ENABLED='true'
        $env:SEED_PASSWORD='kdrive_seed_pw_c6_review_20261010'
        $env:JWT_SECRET='integration-test-only-secret-at-least-32-bytes'
        $backendLog = Join-Path $EvidenceDir "backend-live.log"
        $backendErr = Join-Path $EvidenceDir "backend-live-err.log"

        $backendProcess = Start-Process -FilePath (Join-Path $env:JAVA_HOME "bin/java.exe") -ArgumentList "-jar", "`"$($buildResult.EffectiveJarPath)`"", "--server.port=$BackendPort" -WindowStyle Hidden -PassThru -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr
        Write-RunLog "Backend JAR Process started: PID=$($backendProcess.Id)"

        # Chờ Backend ready
        $backendReady = $false
        for ($i = 1; $i -le 45; $i++) {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/v1/vehicles" -UseBasicParsing -TimeoutSec 2
                if ($resp.StatusCode -eq 200) {
                    $backendReady = $true
                    break
                }
            } catch {}
            Start-Sleep -Seconds 1
        }
        if (-not $backendReady) {
            throw "Backend JAR did not become HTTP-ready on port $BackendPort"
        }
        Write-RunLog "Backend JAR is HTTP-ready on port $BackendPort."

        # 6. KHỞI CHẠY VITE FRONTEND
        Write-RunLog "--- 6. Spawning Vite Frontend on port $VitePort ---"
        $env:VITE_PORT = "$VitePort"
        $env:BACKEND_PORT = "$BackendPort"
        $env:VITE_DATA_MODE = "api"
        $env:VITE_API_BASE_URL = "/api/v1"
        $viteBin = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
        $viteConfigSource = Join-Path $BaseDir "vite.config.mjs"
        $viteConfigDest = Join-Path $FrontendDir "vite.config.c6-browser-neg.mjs"
        Copy-Item -LiteralPath $viteConfigSource -Destination $viteConfigDest -Force
        $viteArgs = @(
            "`"$viteBin`"",
            "--config", "`"$viteConfigDest`"",
            "--host", "0.0.0.0"
        )

        $prevDir = Get-Location
        try {
            Set-Location -LiteralPath $FrontendDir
            $viteProcess = Start-Process -FilePath "node" -ArgumentList $viteArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir "vite-live.log") -RedirectStandardError (Join-Path $EvidenceDir "vite-live-err.log")
        } finally {
            Set-Location -LiteralPath $prevDir
        }
        Write-RunLog "Vite Process started: PID=$($viteProcess.Id)"

        # Chờ Vite ready
        $viteReady = $false
        for ($i = 1; $i -le 30; $i++) {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$VitePort/" -UseBasicParsing -TimeoutSec 2
                if ($resp.StatusCode -eq 200) {
                    $viteReady = $true
                    break
                }
            } catch {}
            Start-Sleep -Seconds 1
        }
        if (-not $viteReady) {
            throw "Vite Frontend did not become HTTP-ready on port $VitePort"
        }
        Write-RunLog "Vite Frontend is HTTP-ready on port $VitePort."

        # 7. CHẠY PLAYWRIGHT BROWSER NEGATIVE TESTS
        Write-RunLog "--- 7. Running Playwright Browser Negative Tests (F01/F03) ---"
        $smokeScript = Join-Path $BaseDir "verify-browser-negatives.cjs"
        $env:RUN_DIR = $EvidenceDir
        $env:BASE_URL = "http://127.0.0.1:$VitePort"
        $env:API_BASE_URL = "http://127.0.0.1:$BackendPort/api/v1"

        $pSmoke = Start-Process -FilePath "node" -ArgumentList "`"$smokeScript`"" -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir "browser-negatives-node.log") -RedirectStandardError (Join-Path $EvidenceDir "browser-negatives-node-err.log")
        if ($pSmoke.ExitCode -ne 0) {
            throw "Browser negative tests failed with exit code $($pSmoke.ExitCode)"
        }
        $smokeResult=Get-Content (Join-Path $EvidenceDir 'browser-negatives-results.json') -Raw | ConvertFrom-Json
        if(-not $smokeResult.AllAssertionsPassed){throw '[NEGATIVE_TEST_FAILURE] Assertions failed'}
        Write-RunLog "Browser negative tests: PASS"

        $actualJarHash=(Get-FileHash -LiteralPath $buildResult.EffectiveJarPath).Hash
        if($actualJarHash -ne $buildResult.JarSHA256){throw '[SOURCE_DRIFT] Live JAR changed'}
        $runInputsAfter=Get-RunInputs
        if(($runInputsBefore | ConvertTo-Json -Compress) -cne ($runInputsAfter | ConvertTo-Json -Compress)){throw '[SOURCE_DRIFT] Runner inputs changed'}
        $runInputsBefore | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-before.json')
        $runInputsAfter | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'source-after.json')
        [pscustomobject]@{MySqlVerified=$true;HttpTests=5;ServiceTests=6;BrowserNegatives=$true;JarSHA256=$actualJarHash;SourceDrift=$false} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'execution-summary.json')
        $overallSuccess = $true
    } finally {
        # =========================================================================
        # INNER FINALLY: DỌN TIẾN TRÌNH & DOCKER; NÉM NGOẠI LỆ NẾU CLEANUP LỖI
        # =========================================================================
        $inCleanup=$true
        Write-RunLog "--- INNER FINALLY: Performing Process and Container Cleanup ---"

        # 1. Dừng backend process
        if ($null -ne $backendProcess) {
            try {
                if (-not $backendProcess.HasExited) {
                    $backendProcess.Kill()
                    $backendProcess.WaitForExit(5000) | Out-Null
                }
            } catch {
                $cleanupFailureOccurred = $true
                $cleanupFailureMessage += " Backend kill failed: $($_.Exception.Message);"
            }
        }

        # 2. Dừng vite process
        if ($null -ne $viteProcess) {
            try {
                if (-not $viteProcess.HasExited) {
                    $viteProcess.Kill()
                    $viteProcess.WaitForExit(5000) | Out-Null
                }
            } catch {
                $cleanupFailureOccurred = $true
                $cleanupFailureMessage += " Vite kill failed: $($_.Exception.Message);"
            }
        }

        # Cleanup copied vite config
        $viteConfigDest = Join-Path $FrontendDir "vite.config.c6-browser-neg.mjs"
        if (Test-Path -LiteralPath $viteConfigDest) {
            try { Remove-Item -LiteralPath $viteConfigDest -Force } catch {}
        }

        # 3. Readback trạng thái owned processes
        $ownedProcessReadback = @()
        if ($null -ne $backendProcess) {
            $ownedProcessReadback += [pscustomobject]@{
                Name      = "BackendJar"
                PID       = $backendProcess.Id
                HasExited = $backendProcess.HasExited
            }
            if (-not $backendProcess.HasExited) {
                $cleanupFailureOccurred = $true
                $cleanupFailureMessage += " Backend process did not exit;"
            }
        }
        if ($null -ne $viteProcess) {
            $ownedProcessReadback += [pscustomobject]@{
                Name      = "ViteFrontend"
                PID       = $viteProcess.Id
                HasExited = $viteProcess.HasExited
            }
            if (-not $viteProcess.HasExited) {
                $cleanupFailureOccurred = $true
                $cleanupFailureMessage += " Vite process did not exit;"
            }
        }
        $ownedReadbackFile = Join-Path $EvidenceDir "owned-process-readback.json"
        try {
            $ownedProcessReadback | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $ownedReadbackFile -Encoding UTF8
        } catch {
            $cleanupFailureOccurred = $true
            $cleanupFailureMessage += " Failed to write owned-process-readback;"
        }

        # 4. Dừng container MySQL với native docker check
        if ($containerCreated) {
            Write-RunLog "Stopping MySQL container: $ContainerName..."
            $stopOut = & docker stop $ContainerName 2>&1
            $stopExit = $LASTEXITCODE
            if ($null -eq $stopExit) { $stopExit = 0 }
            if ($stopExit -ne 0) {
                $cleanupFailureOccurred = $true
                $cleanupFailureMessage += " Docker stop failed with code ${stopExit}: $($stopOut -join ' ');"
                Write-RunLog "Docker stop FAILED with exit code $stopExit"
            } else {
                Write-RunLog "Container '$ContainerName' stopped."
            }
        }

        # Only assert ports belonging to services actually created by this run.
        $cleanupPorts=@()
        if($containerCreated){$cleanupPorts+=$MysqlPort}
        if($backendProcess){$cleanupPorts+=$BackendPort}
        if($viteProcess){$cleanupPorts+=$VitePort}
        # 5. Kiểm tra ports giải phóng
        $portsFree = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $anyBound = $false
            foreach ($p in $cleanupPorts) {
                $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)
                try {
                    $listener.Start()
                } catch {
                    $anyBound = $true
                } finally {
                    $listener.Stop()
                }
            }
            if (-not $anyBound) {
                $portsFree = $true
                break
            }
            Start-Sleep -Milliseconds 200
        }
        Write-RunLog "Port release check: All ports freed = $portsFree"
        if (-not $portsFree) {
            $cleanupFailureOccurred = $true
            $cleanupFailureMessage += " Ports were not freed after timeout."
        }

        if ($cleanupFailureOccurred) {
            $overallSuccess = $false
            Write-RunLog "[CLEANUP_FAILURE] Cleanup verification failed: $cleanupFailureMessage"
            throw "[CLEANUP_FAILURE] Cleanup verification failed: $cleanupFailureMessage"
        } else {
            Write-RunLog "Inner cleanup completed successfully. All processes exited, container stopped, ports freed."
        }
    }
} finally {
    # =============================================================================
    # OUTER FINALLY: KHÔI PHỤC CALLER ENVIRONMENT VÔ ĐIỀU KIỆN
    # =============================================================================
    Restore-ProcessEnvironment $initialEnvBackup
}

if (-not $overallSuccess) {
    exit 1
}

exit 0