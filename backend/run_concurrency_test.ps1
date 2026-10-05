$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_URL', 'Process')) { throw 'Configure KDRIVE_TEST_DB_URL for an isolated MySQL test instance.' }
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_USER', 'Process')) { throw 'Configure KDRIVE_TEST_DB_USER for an isolated MySQL test instance.' }
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_TEST_DB_PASSWORD', 'Process')) { throw 'Configure KDRIVE_TEST_DB_PASSWORD for an isolated MySQL test instance.' }
& ./mvnw.cmd test '-Dtest=ConcurrencyAndRaceTest'
exit $LASTEXITCODE
