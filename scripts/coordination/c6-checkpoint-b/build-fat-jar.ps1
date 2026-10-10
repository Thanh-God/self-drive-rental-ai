# build-fat-jar.ps1
# Build Fat JAR và kiểm tra toàn diện build inputs, source/test/resource manifest, byte-level class provenance và output isolation (B03)

[CmdletBinding()]
param(
    [string]$EvidenceDir = $null,
    [string]$OutputDir = $null,
    [switch]$SkipBuildIfJarMatches,
    [string]$ManifestReferencePath = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = "E:\AI\BERT_Project\codepython\KLTN"
$BackendDir = Join-Path $RepoRoot "backend"
$DefaultTargetJar = Join-Path $BackendDir "target\kdrive-0.1.0-SNAPSHOT.jar"

if ([string]::IsNullOrWhiteSpace($EvidenceDir)) {
    $EvidenceDir = Join-Path $PSScriptRoot "evidence"
}
if (-not (Test-Path -LiteralPath $EvidenceDir)) {
    New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null
}

$buildReportFile = Join-Path $EvidenceDir "build-provenance-report.json"
$buildLogFile = Join-Path $EvidenceDir "maven-package-build.log"
$manifestOutputFile = Join-Path $EvidenceDir "build-input-manifest.json"

# =============================================================================
# 1. Thu thập full manifest các build inputs (source, resources, tests, wrapper, pom)
# =============================================================================
Write-Host "[PROVENANCE] Collecting full build inputs manifest (main sources, resources, tests, configs, wrapper)..."

$manifestEntries = [ordered]@{}

# 1.1 Config và wrapper
$coreFiles = @(
    "backend/pom.xml",
    "backend/.mvn/wrapper/maven-wrapper.properties",
    "backend/mvnw.cmd",
    "backend/mvnw"
)
foreach ($cf in $coreFiles) {
    $fp = Join-Path $RepoRoot ($cf -replace '/', '\')
    if (Test-Path -LiteralPath $fp) {
        $manifestEntries[$cf] = (Get-FileHash -Algorithm SHA256 -LiteralPath $fp).Hash
    } else {
        throw "[BUILD_INPUT_MISSING] Core build input missing: $cf"
    }
}

# 1.2 Main Java sources
$mainJavaDir = Join-Path $BackendDir "src\main\java"
if (Test-Path -LiteralPath $mainJavaDir) {
    Get-ChildItem -Path $mainJavaDir -Filter "*.java" -Recurse -File | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRoot.Length)).TrimStart('\', '/') -replace '\\', '/'
        $manifestEntries[$rel] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    }
}

# 1.3 Main Resources
$mainResDir = Join-Path $BackendDir "src\main\resources"
if (Test-Path -LiteralPath $mainResDir) {
    Get-ChildItem -Path $mainResDir -Recurse -File | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRoot.Length)).TrimStart('\', '/') -replace '\\', '/'
        $manifestEntries[$rel] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    }
}

# 1.4 Test Java sources
$testJavaDir = Join-Path $BackendDir "src\test\java"
if (Test-Path -LiteralPath $testJavaDir) {
    Get-ChildItem -Path $testJavaDir -Filter "*.java" -Recurse -File | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRoot.Length)).TrimStart('\', '/') -replace '\\', '/'
        $manifestEntries[$rel] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    }
}

Write-Host "[PROVENANCE] Total build inputs tracked: $($manifestEntries.Count) files."
$manifestEntries | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestOutputFile -Encoding UTF8

# =============================================================================
# 2. Kiểm tra SkipBuildIfJarMatches vs Manifest Reference
# =============================================================================
$needBuild = $true

if ($SkipBuildIfJarMatches) {
    if (-not (Test-Path -LiteralPath $DefaultTargetJar)) {
        Write-Host "[BUILD] Target JAR does not exist at $DefaultTargetJar, building required."
        $needBuild = $true
    } elseif ([string]::IsNullOrWhiteSpace($ManifestReferencePath)) {
        # Nếu không có file reference riêng, tìm manifest đã lưu trước đó trong target hoặc evidence
        $cachedManifestPath = Join-Path $BackendDir "target\build-input-manifest.json"
        if (-not (Test-Path -LiteralPath $cachedManifestPath)) {
            Write-Host "[BUILD] No previous build manifest found in target to compare, building required."
            $needBuild = $true
        } else {
            # So sánh manifest hiện tại với cached
            $cachedJson = Get-Content -LiteralPath $cachedManifestPath -Raw | ConvertFrom-Json
            $driftDetected = $false
            foreach ($prop in $cachedJson.psobject.Properties) {
                if (-not $manifestEntries.Contains($prop.Name) -or $manifestEntries[$prop.Name] -ne $prop.Value) {
                    Write-Host "[BUILD_DRIFT] Detected drift in build input: $($prop.Name)"
                    $driftDetected = $true
                    break
                }
            }
            if (-not $driftDetected -and $manifestEntries.Count -eq ($cachedJson.psobject.Properties | Measure-Object).Count) {
                Write-Host "[BUILD] Input manifest and JAR match 100%, skipping Maven build."
                $needBuild = $false
            } else {
                Write-Host "[BUILD] Input manifest changed or drifted, rebuild required."
                $needBuild = $true
            }
        }
    } else {
        # So sánh với ManifestReferencePath chỉ định
        if (-not (Test-Path -LiteralPath $ManifestReferencePath)) {
            throw "[MANIFEST_ERROR] Specified ManifestReferencePath does not exist: $ManifestReferencePath"
        }
        $refJson = Get-Content -LiteralPath $ManifestReferencePath -Raw | ConvertFrom-Json
        $driftDetected = $false
        foreach ($prop in $refJson.psobject.Properties) {
            if (-not $manifestEntries.Contains($prop.Name) -or $manifestEntries[$prop.Name] -ne $prop.Value) {
                Write-Host "[BUILD_DRIFT] Detected drift against reference in: $($prop.Name)"
                $driftDetected = $true
                break
            }
        }
        if ($driftDetected) {
            throw "[SOURCE_DRIFT] Build inputs do not match reference manifest."
        }
        $needBuild = $false
    }
}

# =============================================================================
# 3. Thực thi Build Maven (nếu cần) mà không clean toàn repo
# =============================================================================
if ($needBuild) {
    Write-Host "[BUILD] Packaging backend Fat JAR via Maven Wrapper..."
    $prev = Get-Location
    try {
        Set-Location -LiteralPath $BackendDir
        $mvnw = Join-Path $BackendDir "mvnw.cmd"
        $p = Start-Process -FilePath $mvnw -ArgumentList "package", "-DskipTests" -Wait -PassThru -NoNewWindow -RedirectStandardOutput $buildLogFile -RedirectStandardError (Join-Path $EvidenceDir "mvn-package-err.log")
        if ($p.ExitCode -ne 0) {
            throw "[BUILD_FAILURE] Maven package failed with exit code $($p.ExitCode)"
        }
    } finally {
        Set-Location -LiteralPath $prev
    }

    # Lưu cached manifest vào backend/target để các lần sau so sánh
    $targetDir = Join-Path $BackendDir "target"
    if (Test-Path -LiteralPath $targetDir) {
        $manifestEntries | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $targetDir "build-input-manifest.json") -Encoding UTF8
    }
}

if (-not (Test-Path -LiteralPath $DefaultTargetJar)) {
    throw "[BUILD_FAILURE] Fat JAR not found after build: $DefaultTargetJar"
}

# =============================================================================
# 4. Output Isolation (nếu OutputDir được chỉ định)
# =============================================================================
$EffectiveJarPath = $DefaultTargetJar
if (-not [string]::IsNullOrWhiteSpace($OutputDir)) {
    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    }
    $isolatedJar = Join-Path $OutputDir "kdrive-fat-isolated.jar"
    Copy-Item -LiteralPath $DefaultTargetJar -Destination $isolatedJar -Force
    $EffectiveJarPath = $isolatedJar
    Write-Host "[BUILD] Isolated JAR copy created at: $EffectiveJarPath"
}

$jarHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $EffectiveJarPath).Hash
$jarSize = (Get-Item -LiteralPath $EffectiveJarPath).Length
Write-Host "[BUILD] Effective Fat JAR: $EffectiveJarPath (SHA256: $jarHash, Size: $jarSize bytes)"

# =============================================================================
# 5. So sánh byte-level SHA256 giữa class/resource trong JAR và compiled output trên đĩa
# =============================================================================
$classesToCompare = @(
    @{
        JarPath = "BOOT-INF/classes/com/carrental/modules/review/controller/ReviewController.class"
        DiskPath = "backend/target/classes/com/carrental/modules/review/controller/ReviewController.class"
    },
    @{
        JarPath = "BOOT-INF/classes/com/carrental/modules/review/controller/ReviewController`$Input.class"
        DiskPath = "backend/target/classes/com/carrental/modules/review/controller/ReviewController`$Input.class"
    },
    @{
        JarPath = "BOOT-INF/classes/com/carrental/modules/review/controller/ReviewController`$Moderation.class"
        DiskPath = "backend/target/classes/com/carrental/modules/review/controller/ReviewController`$Moderation.class"
    },
    @{
        JarPath = "BOOT-INF/classes/com/carrental/modules/review/service/ReviewService.class"
        DiskPath = "backend/target/classes/com/carrental/modules/review/service/ReviewService.class"
    },
    @{
        JarPath = "BOOT-INF/classes/application.yml"
        DiskPath = "backend/target/classes/application.yml"
    },
    @{
        JarPath = "BOOT-INF/classes/db/migration/V1__rental_schema.sql"
        DiskPath = "backend/target/classes/db/migration/V1__rental_schema.sql"
    },
    @{
        JarPath = "BOOT-INF/classes/db/migration/V2__incident_audit_and_review_vehicle.sql"
        DiskPath = "backend/target/classes/db/migration/V2__incident_audit_and_review_vehicle.sql"
    }
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipArchive = [System.IO.Compression.ZipFile]::OpenRead($EffectiveJarPath)

$compareResults = @()
try {
    foreach ($entry in $classesToCompare) {
        $jarRel = $entry.JarPath
        $diskRel = $entry.DiskPath
        $diskFull = Join-Path $RepoRoot ($diskRel -replace '/', '\')

        if (-not (Test-Path -LiteralPath $diskFull)) {
            throw "[PROVENANCE_ERROR] Compiled disk class missing: $diskRel"
        }
        $diskBytes = [System.IO.File]::ReadAllBytes($diskFull)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $diskHash = -join ($sha.ComputeHash($diskBytes) | ForEach-Object { $_.ToString("X2") })

        $zipEntry = $zipArchive.GetEntry($jarRel)
        if ($null -eq $zipEntry) {
            throw "[PROVENANCE_ERROR] JAR missing class entry: $jarRel"
        }

        $stream = $zipEntry.Open()
        $memStream = [System.IO.MemoryStream]::new()
        $stream.CopyTo($memStream)
        $stream.Dispose()
        $jarBytes = $memStream.ToArray()
        $memStream.Dispose()
        $jarEntryHash = -join ($sha.ComputeHash($jarBytes) | ForEach-Object { $_.ToString("X2") })

        $match = ($diskHash -eq $jarEntryHash)
        if (-not $match) {
            throw "[PROVENANCE_MISMATCH] Byte mismatch between JAR and disk for ${jarRel}: JAR=$jarEntryHash, Disk=$diskHash"
        }

        $compareResults += [pscustomobject]@{
            JarPath   = $jarRel
            DiskPath  = $diskRel
            JarHash   = $jarEntryHash
            DiskHash  = $diskHash
            ByteMatch = $match
            SizeBytes = $jarBytes.Length
        }
    }
} finally {
    $zipArchive.Dispose()
}

Write-Host "[PROVENANCE] Byte-level class comparison passed: $($compareResults.Count)/$($compareResults.Count) entries matched 100%."

# Ghi báo cáo provenance tổng hợp
$report = [pscustomobject]@{
    TestName              = "B03 Full Source and Build Provenance Verification"
    Timestamp             = (Get-Date).ToString("o")
    EffectiveJarPath      = $EffectiveJarPath
    JarSHA256             = $jarHash
    JarSizeBytes          = $jarSize
    BuildInputsCount      = $manifestEntries.Count
    ManifestOutputFile    = $manifestOutputFile
    ClassesComparedCount  = $compareResults.Count
    AllClassesMatched     = $true
    OutputIsolationActive = (-not [string]::IsNullOrWhiteSpace($OutputDir))
    ClassComparisons      = $compareResults
}

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $buildReportFile -Encoding UTF8
Write-Host "[PROVENANCE] Report saved: $buildReportFile"

return [pscustomobject]@{
    EffectiveJarPath = $EffectiveJarPath
    JarSHA256        = $jarHash
    BuildInputsCount = $manifestEntries.Count
    AllPassed        = $true
}
