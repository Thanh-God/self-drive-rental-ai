$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_MIGRATION_MYSQL_URL', 'Process')) { throw 'Configure KDRIVE_MIGRATION_MYSQL_URL for an isolated MySQL test instance.' }
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_MIGRATION_MYSQL_USER', 'Process')) { throw 'Configure KDRIVE_MIGRATION_MYSQL_USER for an isolated MySQL test instance.' }
if ($null -eq [Environment]::GetEnvironmentVariable('KDRIVE_MIGRATION_MYSQL_PASSWORD', 'Process')) { throw 'Configure KDRIVE_MIGRATION_MYSQL_PASSWORD for an isolated MySQL test instance.' }
& ./mvnw.cmd test '-Dtest=MySqlMigrationTest'
exit $LASTEXITCODE
