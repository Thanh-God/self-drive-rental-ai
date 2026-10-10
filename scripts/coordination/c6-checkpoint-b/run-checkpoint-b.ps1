# run-checkpoint-b.ps1
# C6 Checkpoint B Live MySQL Fixture, Fat JAR & Browser Smoke Runner (B01..B05 Hardened)

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null,
    [switch]$SkipRefusalCheck,
    [switch]$RefusalTestOnly,
    [switch]$SimulateDockerInventoryFailure,
    [switch]$SimulateCleanupFailure,
    [switch]$SimulateCleanupFailureEarly,
    [switch]$SimulateMissingDependency
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = "E:\AI\BERT_Project\codepython\KLTN"
$BaseDir = $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$FrontendDir = Join-Path $RepoRoot "frontend"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $EvidenceDir = Join-Path $RepoRoot ".runtime\coordination-c6-b-live-$timestamp\run1"
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

# =============================================================================
# PREFLIGHT DEPENDENCY GUARD (B05)
# Phải kiểm tra trước mọi mutation, Docker spawn hoặc fixture setup
# =============================================================================
function Assert-PreflightDependencies {
    param([string]$Dir)

    if ($SimulateMissingDependency) {
        throw "[PREFLIGHT_GUARD] Required dependency missing: vite.config.mjs"
    }

    $requiredFiles = @(
        @{ Name = "vite.config.mjs"; Path = (Join-Path $Dir "vite.config.mjs") },
        @{ Name = "verify-c6-smoke.cjs"; Path = (Join-Path $Dir "verify-c6-smoke.cjs") },
        @{ Name = "build-fat-jar.ps1"; Path = (Join-Path $Dir "build-fat-jar.ps1") },
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

function Write-RunLog {
    param([string]$Message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $line = "[$timestamp] $Message"
    Write-Host $line
    try {
        Add-Content -LiteralPath $runLog -Value $line -Encoding UTF8
    } catch {}
}

# Khởi tạo các biến kiểm soát vòng đời tiến trình & fixture
$containerCreated = $false
$ContainerName = "kltn-c6-b-ag-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$VolumeName = "vol-$ContainerName"
$MysqlPort = 33610
$BackendPort = 8125
$VitePort = 5225
$backendProcess = $null
$viteProcess = $null
$overallSuccess = $false
$cleanupFailureOccurred = $false
$cleanupFailureMessage = ""

# =============================================================================
# OUTER TRY / FINALLY: ĐẢM BẢO KHÔI PHỤC CALLER ENVIRONMENT VÔ ĐIỀU KIỆN
# =============================================================================
try {
    # INNER TRY / FINALLY: THỰC THI NGHIỆP VỤ & CLEANUP TIẾN TRÌNH / DOCKER
    try {
        Write-RunLog "=== Starting Checkpoint B Live Runner (Session: $ContainerName) ==="
        Write-RunLog "BaseDir: $BaseDir"
        Write-RunLog "EvidenceDir: $EvidenceDir"

        # 1. PREFLIGHT DOCKER INVENTORY & GUARDS (B01)
        Write-RunLog "--- 1. Preflight Docker Inventory Check ---"
        if ($SimulateDockerInventoryFailure) {
            Write-RunLog "[SIMULATION] Simulating native docker inventory failure with exit code 23..."
            throw "[PREFLIGHT_GUARD] Docker container inventory failed with native exit code 23"
        }

        $invOut = & docker ps -a --format "{{.Names}}" 2>&1
        $invExit = $LASTEXITCODE
        if ($null -eq $invExit) { $invExit = 0 }
        if ($invExit -ne 0) {
            throw "[PREFLIGHT_GUARD] Docker container inventory failed with native exit code ${invExit}: $($invOut -join ' ')"
        }
        $existingContainers = $invOut -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        Write-RunLog "Found $($existingContainers.Count) existing docker containers."

        # Guard: Không được trùng với container phase 5 local
        if ($existingContainers -contains "kltn-phase5-rerun") {
            Write-RunLog "Notice: User container 'kltn-phase5-rerun' detected running on 33385. Port 33610 will be used."
        }

        # 2. KHỞI TẠO MYSQL FIXTURE CONTAINER
        Write-RunLog "--- 2. Starting Isolated MySQL Fixture Container: $ContainerName on port $MysqlPort ---"
        $dbPassword = "kdrive_test_pw_c6_$(Get-Random -Minimum 100000 -Maximum 999999)"
        $DbUser = "root"
        $DbName = "kdrive_c6_b"
        $MarkerSchema = "kdrive_c6_b_meta"

        $runArgs = @("run", "-d", "--name", $ContainerName, "-p", "${MysqlPort}:3306", "-e", "MYSQL_ROOT_PASSWORD=$dbPassword", "-e", "MYSQL_DATABASE=$DbName", "-v", "${VolumeName}:/var/lib/mysql", "mysql:8.4")
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
            $pingOut = & docker exec $ContainerName mysqladmin ping -u$DbUser -p$dbPassword 2>&1
            $pingExit = $LASTEXITCODE
            if ($null -eq $pingExit) { $pingExit = 0 }
            if ($pingExit -eq 0 -and ($pingOut -join ' ').Contains("mysqld is alive")) {
                $mysqlReady = $true
                break
            }
            Start-Sleep -Seconds 2
        }
        if (-not $mysqlReady) {
            throw "MySQL container did not become ready within timeout."
        }
        Write-RunLog "MySQL container is fully ready."

        # Tạo Marker Schema & Fixture Table
        $metaSql = "CREATE DATABASE IF NOT EXISTS $MarkerSchema; CREATE TABLE $MarkerSchema.__kdrive_test_fixture_marker (id INT PRIMARY KEY, session_name VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP); INSERT INTO $MarkerSchema.__kdrive_test_fixture_marker (id, session_name) VALUES (1, '$ContainerName');"
        $sqlOut = & docker exec $ContainerName mysql -u$DbUser -p$dbPassword -e "$metaSql" 2>&1
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
        $env:KDRIVE_TEST_FIXTURE = $ContainerName
        $env:KDRIVE_TEST_MARKER_SCHEMA = $MarkerSchema

        # 3. BUILD FAT JAR VỚI ISOLATED OUTPUT (B03)
        Write-RunLog "--- 3. Building Fat JAR with Isolated Output & Full Manifest (B03) ---"
        $buildScript = Join-Path $BaseDir "build-fat-jar.ps1"
        $jarOutputDir = Join-Path $EvidenceDir "jar-isolated"
        $buildResult = & $buildScript -EvidenceDir $EvidenceDir -OutputDir $jarOutputDir -SkipBuildIfJarMatches
        Write-RunLog "Fat JAR build provenance passed: $($buildResult.EffectiveJarPath) (SHA256: $($buildResult.JarSHA256))"

        # 4. CHẠY 11 BACKEND TESTS TRÊN MYSQL FIXTURE
        Write-RunLog "--- 4. Running 11 Backend Tests on MySQL Fixture ---"
        $prevDir = Get-Location
        try {
            Set-Location -LiteralPath $BackendDir
            $mvnTestLog = Join-Path $EvidenceDir "mvn-11-tests.log"
            $mvnCmd = Join-Path $BackendDir "mvnw.cmd"
            $pTest = Start-Process -FilePath $mvnCmd -ArgumentList "-Dtest=ReviewHttpIntegrationTest,ReviewIntegrationTest", "test" -NoNewWindow -Wait -PassThru -RedirectStandardOutput $mvnTestLog -RedirectStandardError (Join-Path $EvidenceDir "mvn-11-tests-err.log")
            $mvnTestExit = $pTest.ExitCode
        } finally {
            Set-Location -LiteralPath $prevDir
        }
        Write-RunLog "Backend integration tests finished with exit code: $mvnTestExit"
        if ($mvnTestExit -ne 0) {
            throw "11 Backend integration tests failed with exit code $mvnTestExit"
        }

        # 5. KHỞI CHẠY BACKEND FAT JAR
        Write-RunLog "--- 5. Spawning Backend Fat JAR on port $BackendPort ---"
        $env:PORT = "$BackendPort"
        $env:SPRING_PROFILES_ACTIVE = "test"
        $backendLog = Join-Path $EvidenceDir "backend-live.log"
        $backendErr = Join-Path $EvidenceDir "backend-live-err.log"

        $backendProcess = Start-Process -FilePath "java" -ArgumentList "-jar", "`"$($buildResult.EffectiveJarPath)`"", "--server.port=$BackendPort" -WindowStyle Hidden -PassThru -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr
        Write-RunLog "Backend JAR Process started: PID=$($backendProcess.Id)"

        # Chờ Backend ready
        $backendReady = $false
        for ($i = 1; $i -le 45; $i++) {
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/actuator/health" -UseBasicParsing -TimeoutSec 2
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

        # 6. KHỞI CHẠY VITE FRONTEND (B05)
        Write-RunLog "--- 6. Spawning Vite Frontend on port $VitePort ---"
        $env:VITE_PORT = "$VitePort"
        $env:BACKEND_PORT = "$BackendPort"
        $env:VITE_DATA_MODE = "api"
        $env:VITE_API_BASE_URL = "/api/v1"
        $viteBin = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
        $viteConfigPath = Join-Path $BaseDir "vite.config.mjs"
        $viteArgs = @(
            "`"$viteBin`"",
            "--config", "`"$viteConfigPath`""
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

        # 7. CHẠY BROWSER SMOKE TEST (B05)
        Write-RunLog "--- 7. Running Playwright Browser Smoke Test ---"
        $smokeScript = Join-Path $BaseDir "verify-c6-smoke.cjs"
        $env:RUN_DIR = $EvidenceDir
        $env:BASE_URL = "http://127.0.0.1:$VitePort"
        $env:API_BASE_URL = "http://127.0.0.1:$BackendPort/api/v1"

        $pSmoke = Start-Process -FilePath "node" -ArgumentList "`"$smokeScript`"" -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $EvidenceDir "smoke-node.log") -RedirectStandardError (Join-Path $EvidenceDir "smoke-node-err.log")
        if ($pSmoke.ExitCode -ne 0) {
            throw "Browser smoke test failed with exit code $($pSmoke.ExitCode)"
        }
        Write-RunLog "Browser smoke test: PASS"

        $overallSuccess = $true
    } finally {
        # =========================================================================
        # INNER FINALLY: DỌN TIẾN TRÌNH & DOCKER; NÉM NGOẠI LỆ NẾU CLEANUP LỖI (B02)
        # =========================================================================
        Write-RunLog "--- INNER FINALLY: Performing Process and Container Cleanup ---"

        if ($SimulateCleanupFailureEarly) {
            $cleanupFailureOccurred = $true
            $cleanupFailureMessage = "Simulated early cleanup failure"
            $overallSuccess = $false
        }

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

        # 3. Readback trạng thái owned processes (ownedProcessReadback AST check)
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

        # 4. Dừng container MySQL với native docker check (B02)
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

        # 5. Kiểm tra ports giải phóng
        $portsFree = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $anyBound = $false
            foreach ($p in @($MysqlPort, $BackendPort, $VitePort)) {
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

        if ($SimulateCleanupFailure) {
            $cleanupFailureOccurred = $true
            $cleanupFailureMessage += " Simulated general cleanup failure;"
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
    # OUTER FINALLY: KHÔI PHỤC CALLER ENVIRONMENT VÔ ĐIỀU KIỆN (B02)
    # Bất kể logging, readback, hay exception ném ra ở inner finally, outer finally vẫn chạy
    # =============================================================================
    Restore-ProcessEnvironment $initialEnvBackup
}

if (-not $overallSuccess) {
    exit 1
}

exit 0
