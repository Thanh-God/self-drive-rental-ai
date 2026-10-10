# run-f04-tests.ps1
# Runner F04 assertions HTTP/MySQL - chạy tests lên MySQL fixture riêng
# - Guards: Shell guard, Refusal dir guard, Port guards, Container & Volume guards
# - Fixture MySQL riêng (port dynamic), schema riêng, marker table riêng
# - Chạy ReviewHttpIntegrationTest (5 tests) và ReviewIntegrationTest (6 tests) trên MySQL mới
# - Thu thập Surefire XML reports, đọc lại readback
# - Finally dọn dẹp: container stop, ports verify free, caller env restore, keep volume

[CmdletBinding()]
param(
    [string]$RunStamp = $null,
    [string]$EvidenceDir = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BaseDir = $PSScriptRoot
$RepoRoot = (Get-Item $BaseDir).Parent.Parent.FullName
$BackendDir = Join-Path $RepoRoot "backend"

function Get-GitHead {
    try { return (git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim() } catch { return "" }
}

function Get-GitStatus {
    try { $status = git -C $RepoRoot status --porcelain 2>$null } catch { $status = "" }
    return ($status.Trim() -split "`n") | Where-Object { $_ -ne "" }
}

# =============================================================================
# 1. UNSUPPORTED SHELL GUARD TRƯỚC MỌI MUTATION
# =============================================================================
if ($PSVersionTable.PSEdition -ne "Desktop" -or $PSVersionTable.PSVersion.Major -ne 5) {
    throw "[UNSUPPORTED_SHELL] Only Windows PowerShell 5.1 (Desktop edition) is supported. Detected: $($PSVersionTable.PSEdition) v$($PSVersionTable.PSVersion). Refusing execution before mutation."
}

# =============================================================================
# 2. EVIDENCE REFUSAL GUARD TRƯỚC MỌI MUTATION
# =============================================================================
if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    if ([string]::IsNullOrWhiteSpace($RunStamp)) {
        $RunStamp = (Get-Date -Format 'yyyyMMdd-HHmmss')
    }
    $EvidenceDir = Join-Path $BaseDir "evidence\run-$RunStamp"
} else {
    if ([string]::IsNullOrWhiteSpace($RunStamp)) {
        $RunStamp = [System.IO.Path]::GetFileName($EvidenceDir)
    }
}

if (Test-Path -LiteralPath $EvidenceDir) {
    throw "[PREFLIGHT_REFUSAL] Refusing to execute: Evidence directory already exists: $EvidenceDir"
}

New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null

$runLogPath = Join-Path $EvidenceDir "runner.log"
function Write-RunLog {
    param([string]$Message)
    $ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')
    $line = "[$ts] $Message"
    Write-Output $line
    Add-Content -LiteralPath $runLogPath -Value $line -Encoding utf8
}

Write-RunLog "=== STARTING C6 F04 TESTS RUNNER ($RunStamp) ==="
Write-RunLog "Evidence directory: $EvidenceDir"

# =============================================================================
# 3. CONTAINER, VOLUME VÀ PORT GUARDS TRƯỚC MUTATION
# =============================================================================
$MysqlPort = 33611  # Port khác với checkpoint B (33610)
$safeStamp = ($RunStamp -replace '[^a-zA-Z0-9_]', '_').ToLower()
$ContainerName = "kltn-c6-f04-opencode-$safeStamp"
$VolumeName = "kltn_c6_f04_opencode_${safeStamp}_data"
$BusinessSchema = "kdrive_c6_f04"
$MarkerSchema = "kdrive_c6_f04_meta"
$DbUser = "kdrive"

# Port check
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $MysqlPort)
try {
    $listener.Start()
} catch {
    throw "[PREFLIGHT_GUARD] Port $MysqlPort is already in use; refusing to execute."
} finally {
    $listener.Stop()
}
Write-RunLog "Port verified available: $MysqlPort (MySQL)"

# Container & volume check
$existingContainers = @(docker ps -a --filter "name=^/${ContainerName}$" --format "{{.Names}}")
if ($existingContainers -contains $ContainerName) {
    throw "[PREFLIGHT_GUARD] Container '$ContainerName' already exists; refusing to reuse."
}
$existingVolumes = @(docker volume ls --filter "name=^${VolumeName}$" --format "{{.Name}}")
if ($existingVolumes -contains $VolumeName) {
    throw "[PREFLIGHT_GUARD] Volume '$VolumeName' already exists; refusing to reuse."
}
Write-RunLog "Container and volume names verified clean."

# Import modules đã PASS từ checkpoint A/B
$checkpointAHelpersModule = Join-Path $RepoRoot ".runtime\coordination-c6-checkpoint-a-20261010-122848\c6-checkpoint-a-helpers.psm1"
if (Test-Path $checkpointAHelpersModule) {
    Import-Module $checkpointAHelpersModule -Force
    Write-RunLog "Imported checkpoint A helpers module"
}

# =============================================================================
# 4. BASELINE STATE
# =============================================================================
$baselineHead = Get-GitHead
$baselineStatus = Get-GitStatus

Write-RunLog "Baseline Git HEAD: $baselineHead"
Write-RunLog "Baseline Status Lines Count: $($baselineStatus.Count)"

# Caller environment snapshot (Outer snapshot)
$callerTrackedVars = @(
    "MYSQL_PWD", "JAVA_HOME", "KDRIVE_TEST_DB_URL", "SPRING_DATASOURCE_URL",
    "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD",
    "KDRIVE_TEST_DB_USER", "KDRIVE_TEST_DB_PASSWORD",
    "KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX", "KDRIVE_TEST_FIXTURE_MARKER_TOKEN",
    "KDRIVE_TEST_EXPECTED_HOST", "KDRIVE_TEST_EXPECTED_PORT", "KDRIVE_TEST_EXPECTED_SCHEMA",
    "KDRIVE_TEST_MARKER_SCHEMA"
)
$originalCallerEnv = @{}
foreach ($v in $callerTrackedVars) {
    if ([Environment]::GetEnvironmentVariable($v, "Process")) {
        $originalCallerEnv[$v] = [Environment]::GetEnvironmentVariable($v, "Process")
    }
}

$containerCreated = $false
$overallSuccess = $false
$testSummaries = [ordered]@{}

try {
    # =============================================================================
    # 5. KHỞI CHẠY MYSQL 8.4 CONTAINER RIÊNG BIỆT
    # =============================================================================
    Write-RunLog "Configuring isolated MySQL credentials and private environment..."
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rootBytes = New-Object byte[] 32
    $userBytes = New-Object byte[] 32
    $markerBytes = New-Object byte[] 16
    $random.GetBytes($rootBytes)
    $random.GetBytes($userBytes)
    $random.GetBytes($markerBytes)
    $random.Dispose()

    $mysqlRootPassword = [Convert]::ToBase64String($rootBytes).TrimEnd("=").Replace("+", "A").Replace("/", "B")
    $dbPassword = [Convert]::ToBase64String($userBytes).TrimEnd("=").Replace("+", "C").Replace("/", "D")
    $markerToken = [Convert]::ToBase64String($markerBytes).TrimEnd("=").Replace("+", "X").Replace("/", "Y")

    $mysqlEnvFile = Join-Path $EvidenceDir "mysql.private.env"
    $envLines = @(
        "MYSQL_ROOT_PASSWORD=$mysqlRootPassword",
        "MYSQL_DATABASE=$BusinessSchema",
        "MYSQL_USER=$DbUser",
        "MYSQL_PASSWORD=$dbPassword"
    )
    [IO.File]::WriteAllLines($mysqlEnvFile, $envLines, [Text.UTF8Encoding]::new($false))
    Write-RunLog "Private env saved to $mysqlEnvFile"

    Write-RunLog "Starting isolated MySQL container '$ContainerName' on port $MysqlPort..."
    $dockerRunArgs = @(
        "run", "-d", "--name", $ContainerName,
        "--publish", "127.0.0.1:${MysqlPort}:3306",
        "--env-file", $mysqlEnvFile,
        "--volume", "${VolumeName}:/var/lib/mysql",
        "mysql:8.4"
    )
    $dockerRunProc = Start-Process -FilePath "docker" -ArgumentList $dockerRunArgs -NoNewWindow -Wait -PassThru
    if ($dockerRunProc.ExitCode -ne 0) {
        throw "Failed to start MySQL container '$ContainerName' (ExitCode: $($dockerRunProc.ExitCode))"
    }
    $containerCreated = $true

    # Chờ MySQL ready
    Write-RunLog "Waiting for MySQL query readiness on port $MysqlPort..."
    $mysqlReady = $false
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try {
            $probe = @(& docker exec -e "MYSQL_PWD=$mysqlRootPassword" $ContainerName mysql -uroot --batch --skip-column-names -e "SELECT 1;" 2>&1)
            if (($probe -join "").Trim() -eq "1") {
                $mysqlReady = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $mysqlReady) {
        throw "MySQL container did not become ready in time."
    }
    Write-RunLog "MySQL container is query-ready."

    # Thiết lập marker schema & token
    Write-RunLog "Setting up technical marker schema and table..."
    $setupSql = @"
CREATE DATABASE IF NOT EXISTS $MarkerSchema;
GRANT ALL PRIVILEGES ON $BusinessSchema.* TO '$DbUser'@'%';
GRANT SELECT ON $MarkerSchema.* TO '$DbUser'@'%';
FLUSH PRIVILEGES;
CREATE TABLE $MarkerSchema.__kdrive_test_fixture_marker (id INT PRIMARY KEY, target_schema VARCHAR(255), marker_token VARCHAR(255));
INSERT INTO $MarkerSchema.__kdrive_test_fixture_marker (id, target_schema, marker_token) VALUES (1, '$BusinessSchema', '$markerToken');
"@
    $sqlFile = Join-Path $EvidenceDir "setup-marker.sql"
    [IO.File]::WriteAllText($sqlFile, $setupSql, [Text.UTF8Encoding]::new($false))
    Write-RunLog "SQL written to $sqlFile"
    # Copy SQL file to container and execute via stdin
    $containerPath = "${ContainerName}:/tmp/setup-marker.sql"
    $copyProc = Start-Process -FilePath "docker" -ArgumentList "cp", $sqlFile, $containerPath -NoNewWindow -Wait -PassThru
    if ($copyProc.ExitCode -ne 0) {
        throw "Failed to copy SQL file to container"
    }
    $execProc = Start-Process -FilePath "docker" -ArgumentList "exec", "-i", "-e", "MYSQL_PWD=$mysqlRootPassword", $ContainerName, "mysql", "-uroot" -NoNewWindow -Wait -PassThru -RedirectStandardInput $sqlFile
    if ($execProc.ExitCode -ne 0) {
        throw "Failed to execute SQL in container (ExitCode: $($execProc.ExitCode))"
    }
    # Verify marker table exists and has correct data
    $verifySql = "SELECT count(*) as cnt FROM $MarkerSchema.__kdrive_test_fixture_marker WHERE target_schema = '$BusinessSchema';"
    $verifySqlFile = Join-Path $EvidenceDir "verify-marker.sql"
    [IO.File]::WriteAllText($verifySqlFile, $verifySql, [Text.UTF8Encoding]::new($false))
    $containerVerifyPath = "${ContainerName}:/tmp/verify-marker.sql"
    $copyVerifyProc = Start-Process -FilePath "docker" -ArgumentList "cp", $verifySqlFile, $containerVerifyPath -NoNewWindow -Wait -PassThru
    if ($copyVerifyProc.ExitCode -ne 0) {
        throw "Failed to copy verification SQL file to container"
    }
    $verifyProc = Start-Process -FilePath "docker" -ArgumentList "exec", "-i", "-e", "MYSQL_PWD=$mysqlRootPassword", $ContainerName, "mysql", "-uroot", "--batch", "--skip-column-names" -NoNewWindow -Wait -PassThru -RedirectStandardInput $verifySqlFile -RedirectStandardOutput (Join-Path $EvidenceDir "marker-verify.txt")
    if ($verifyProc.ExitCode -ne 0) {
        throw "Failed to verify marker table"
    }
    $verifyResult = Get-Content -LiteralPath (Join-Path $EvidenceDir "marker-verify.txt") -Raw
    Write-RunLog "Marker verification result: $verifyResult"
    if ($verifyResult.Trim() -ne "1") {
        throw "Marker table verification failed: expected 1 row, got '$verifyResult'"
    }
    Write-RunLog "Marker table initialized and verified: schema=$MarkerSchema, token=$markerToken"

    # Set process environment variables cho tests
    $dbUrl = "jdbc:mysql://127.0.0.1:${MysqlPort}/${BusinessSchema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
    $env:KDRIVE_TEST_DB_URL = $dbUrl
    $env:KDRIVE_TEST_DB_USER = $DbUser
    $env:KDRIVE_TEST_DB_PASSWORD = $dbPassword
    $env:KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX = $BusinessSchema
    $env:KDRIVE_TEST_FIXTURE_MARKER_TOKEN = $markerToken
    $env:KDRIVE_TEST_EXPECTED_HOST = "127.0.0.1"
    $env:KDRIVE_TEST_EXPECTED_PORT = "$MysqlPort"
    $env:KDRIVE_TEST_EXPECTED_SCHEMA = "$BusinessSchema"
    $env:KDRIVE_TEST_MARKER_SCHEMA = $MarkerSchema
    $env:SPRING_DATASOURCE_URL = $dbUrl
    $env:SPRING_DATASOURCE_USERNAME = $DbUser
    $env:SPRING_DATASOURCE_PASSWORD = $dbPassword

    # =============================================================================
    # 6. CHẠY 11 BACKEND TESTS (5 HTTP + 6 JPA INTEGRATION) TRÊN MYSQL MỚI
    # =============================================================================
    Write-RunLog "--- Running 11 Backend Tests on Isolated MySQL Fixture ---"
    $prevDir = Get-Location
    try {
        Set-Location -LiteralPath $BackendDir
        $mvnTestLog = Join-Path $EvidenceDir "mvn-f04-tests.log"
        $mvnErrLog = Join-Path $EvidenceDir "mvn-f04-tests-err.log"
        $mvnCmd = Join-Path $BackendDir "mvnw.cmd"
        $pTest = Start-Process -FilePath $mvnCmd -ArgumentList "-Dtest=ReviewHttpIntegrationTest,ReviewIntegrationTest", "test" -NoNewWindow -Wait -PassThru -RedirectStandardOutput $mvnTestLog -RedirectStandardError $mvnErrLog
        $mvnTestExit = $pTest.ExitCode
    } finally {
        Set-Location -LiteralPath $prevDir
    }
    Write-RunLog "Maven test run completed with ExitCode: $mvnTestExit"
    if ($mvnTestExit -ne 0) {
        throw "Backend tests failed with ExitCode $mvnTestExit"
    }

    # Kiểm tra Surefire reports
    $httpXml = Join-Path $BackendDir "target\surefire-reports\TEST-com.carrental.ReviewHttpIntegrationTest.xml"
    $serviceXml = Join-Path $BackendDir "target\surefire-reports\TEST-com.carrental.ReviewIntegrationTest.xml"
    if (-not (Test-Path $httpXml) -or -not (Test-Path $serviceXml)) {
        throw "Surefire reports missing in target directory."
    }
    Copy-Item -LiteralPath $httpXml -Destination (Join-Path $EvidenceDir "TEST-com.carrental.ReviewHttpIntegrationTest.xml") -Force
    Copy-Item -LiteralPath $serviceXml -Destination (Join-Path $EvidenceDir "TEST-com.carrental.ReviewIntegrationTest.xml") -Force

    # Parse Surefire XML để verify - read from target dir directly to avoid copy timing issues
    $httpXmlContent = [xml](Get-Content -LiteralPath $httpXml -Raw)
    $serviceXmlContent = [xml](Get-Content -LiteralPath $serviceXml -Raw)

    Write-RunLog "HTTP XML testsuite attributes: $($httpXmlContent.testsuite.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" })"
    Write-RunLog "Service XML testsuite attributes: $($serviceXmlContent.testsuite.Attributes | ForEach-Object { "$($_.Name)=$($_.Value)" })"

    $httpTests = [int]$httpXmlContent.testsuite.GetAttribute("tests")
    $httpFailures = [int]$httpXmlContent.testsuite.GetAttribute("failures")
    $httpErrors = [int]$httpXmlContent.testsuite.GetAttribute("errors")
    $httpSkipped = [int]$httpXmlContent.testsuite.GetAttribute("skipped")

    $serviceTests = [int]$serviceXmlContent.testsuite.GetAttribute("tests")
    $serviceFailures = [int]$serviceXmlContent.testsuite.GetAttribute("failures")
    $serviceErrors = [int]$serviceXmlContent.testsuite.GetAttribute("errors")
    $serviceSkipped = [int]$serviceXmlContent.testsuite.GetAttribute("skipped")

    Write-RunLog "HTTP Test Suite: tests=$httpTests, failures=$httpFailures, errors=$httpErrors, skipped=$httpSkipped"
    Write-RunLog "Service Test Suite: tests=$serviceTests, failures=$serviceFailures, errors=$serviceErrors, skipped=$serviceSkipped"

    if ($httpTests -ne 5 -or $httpFailures -ne 0 -or $httpErrors -ne 0 -or $httpSkipped -ne 0) {
        throw "ReviewHttpIntegrationTest did not meet expectations: 5 tests, 0 failures, 0 errors, 0 skipped"
    }
    if ($serviceTests -ne 6 -or $serviceFailures -ne 0 -or $serviceErrors -ne 0 -or $serviceSkipped -ne 0) {
        throw "ReviewIntegrationTest did not meet expectations: 6 tests, 0 failures, 0 errors, 0 skipped"
    }

    $testSummaries["ReviewHttpIntegrationTest"] = [pscustomobject]@{ Status = "PASS"; Tests = $httpTests; Failures = $httpFailures; Errors = $httpErrors; Skipped = $httpSkipped }
    $testSummaries["ReviewIntegrationTest"] = [pscustomobject]@{ Status = "PASS"; Tests = $serviceTests; Failures = $serviceFailures; Errors = $serviceErrors; Skipped = $serviceSkipped }
    Write-RunLog "Backend 11 tests validated: HTTP=5 PASS, Service=6 PASS, 0 skip."

    $overallSuccess = $true

} finally {
    # =============================================================================
    # 7. CLEANUP TRONG FINALLY
    # =============================================================================
    Write-RunLog "--- Cleanup ---"

    # Restore caller environment
    foreach ($v in $callerTrackedVars) {
        if ($originalCallerEnv.ContainsKey($v)) {
            [Environment]::SetEnvironmentVariable($v, $originalCallerEnv[$v], "Process")
        } else {
            [Environment]::SetEnvironmentVariable($v, $null, "Process")
        }
    }
    Write-RunLog "Caller environment restored."

    # Stop container
    if ($containerCreated) {
        Write-RunLog "Stopping MySQL container '$ContainerName'..."
        $stopProc = Start-Process -FilePath "docker" -ArgumentList "stop", $ContainerName -NoNewWindow -Wait -PassThru
        Write-RunLog "Container stop ExitCode: $($stopProc.ExitCode)"
    }

    # Verify port released
    $portReleased = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $MysqlPort)
        try {
            $listener.Start()
            $listener.Stop()
            $portReleased = $true
            break
        } catch {}
        Start-Sleep -Seconds 1
    }
    if ($portReleased) {
        Write-RunLog "Port $MysqlPort verified released."
    } else {
        Write-RunLog "WARNING: Port $MysqlPort may still be occupied after cleanup."
    }

    # Volume kept for audit
    Write-RunLog "Volume '$VolumeName' retained for audit."

    # Final Git state
    $finalHead = Get-GitHead
    $finalStatus = Get-GitStatus
    Write-RunLog "Final Git HEAD: $finalHead"
    Write-RunLog "Final Status Lines Count: $($finalStatus.Count)"

    # Write test summary
    $summary = [pscustomobject]@{
        RunStamp = $RunStamp
        EvidenceDir = $EvidenceDir
        BaselineHead = $baselineHead
        FinalHead = $finalHead
        OverallSuccess = $overallSuccess
        TestSummaries = $testSummaries
        ContainerName = $ContainerName
        VolumeName = $VolumeName
        MySQLPort = $MysqlPort
        BusinessSchema = $BusinessSchema
        MarkerSchema = $MarkerSchema
        Timestamp = (Get-Date -Format 'o')
    }
    $summaryPath = Join-Path $EvidenceDir "f04-test-summary.json"
    $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding utf8
    Write-RunLog "Summary written to $summaryPath"

    if ($overallSuccess) {
        Write-RunLog "=== F04 TESTS RUNNER COMPLETED SUCCESSFULLY ==="
    } else {
        Write-RunLog "=== F04 TESTS RUNNER FAILED ==="
    }
}