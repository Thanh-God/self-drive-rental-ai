$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$envFile = Join-Path $PSScriptRoot 'backend/.env.local'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}
foreach ($name in @('DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        throw "Missing $name. Configure backend/.env.local or process environment."
    }
}
$javaCommand = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { 'java' }
& $javaCommand -jar 'backend/target/kdrive-0.1.0-SNAPSHOT.jar'
exit $LASTEXITCODE
