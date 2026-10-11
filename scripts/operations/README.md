# Docker storage verification

Run from KLTN root using PowerShell. This operation is separate from C6 browser acceptance.

`verify-docker-storage.ps1 -OutputDirectory <NEW_DIRECTORY>` checks the current Docker engine, records sorted container/image/volume inventory, starts **kltn-phase5-rerun** only if needed, waits for MySQL, captures a read-only ordered mysqldump of **kdrive**, captures Flyway history/table count, and verifies localhost:33385. It does not start the application backend or mutate schema/business data. Output includes **private database contents**: use ignored/private evidence directories; never commit/share raw SQL. Container secrets are used inside the container without printing them.

`verify-docker-storage.ps1 -Mode Compare -BeforeDirectory <BEFORE> -AfterDirectory <AFTER>` requires every evidence file, equal inventory/SQL/Flyway hashes and engine version, and successful endpoint checks on both snapshots. Failure throws; investigate rather than rewriting expected values. Starting MySQL changes service state; the caller is responsible for restoring its pre-operation state. Never stop unrelated services.

`test-docker-storage-comparison.ps1 -EvidenceDirectory <NEW_DIRECTORY>` tests the actual comparator: identical snapshots accepted; container/volume/image/SQL/Flyway drift, missing evidence, engine change and unverified endpoint rejected. These unit fixtures verify comparator behavior; they do not prove a real disk migration.

For migration, first follow Docker's supported Settings -> Resources -> Advanced -> Disk image location flow. Back up the fully stopped VM disk and verify SHA256 before moving/reinstalling. Record the source/destination VHDX and actual startup after migration; file hashes alone do not establish recoverability. Preserve the backup until the moved engine and data are independently verified. Do not manually change undocumented settings, prune data, uninstall before backup, or restore over a mounted disk.

References: https://docs.docker.com/desktop/features/wsl/ ; https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/
