# Docker storage verification

Run from KLTN root using PowerShell. This operation is separate from C6 browser acceptance.

`verify-docker-storage.ps1 -OutputDirectory <NEW_DIRECTORY>` checks the current Docker engine, records sorted container/image/volume inventory, starts **kltn-phase5-rerun** only if needed, waits for MySQL, captures a read-only ordered mysqldump of **kdrive**, captures Flyway history/table count, and verifies localhost:33385. It does not start the application backend or mutate schema/business data. Output includes **private database contents**: use ignored/private evidence directories; never commit/share raw SQL. Container secrets are used inside the container without printing them.

`verify-docker-storage.ps1 -Mode Compare -BeforeDirectory <BEFORE> -AfterDirectory <AFTER>` requires every evidence file, equal inventory/SQL/Flyway hashes and engine version, and successful endpoint checks on both snapshots. Failure throws; investigate rather than rewriting expected values. Starting MySQL changes service state; the caller is responsible for restoring its pre-operation state. Never stop unrelated services.

`test-docker-storage-comparison.ps1 -EvidenceDirectory <NEW_DIRECTORY>` tests the actual comparator: identical snapshots accepted; container/volume/image/SQL/Flyway drift, missing evidence, engine change and unverified endpoint rejected. These unit fixtures verify comparator behavior; they do not prove a real disk migration.

For migration, first follow Docker's supported Settings -> Resources -> Advanced -> Disk image location flow. Back up the fully stopped VM disk and verify SHA256 before moving/reinstalling. Record the source/destination VHDX and actual startup after migration; file hashes alone do not establish recoverability. Preserve the backup until the moved engine and data are independently verified. Do not manually change undocumented settings, prune data, uninstall before backup, or restore over a mounted disk.

References: https://docs.docker.com/desktop/features/wsl/ ; https://docs.docker.com/desktop/settings-and-maintenance/backup-and-restore/

## Historical fixture retention and cleanup

`archive-redundant-fixtures.ps1 -PlanPath <reviewed-plan.json> -ArchiveRoot E:\Tools\Docker\Archives\<new-round> -Phase Archive` accepts only explicit ARCHIVE_THEN_REMOVE entries. The plan contains all KEEP entries as protected names and records exact container ID/image/volume/evidence/reason. The actual guard checks stopped state and sole volume reference before every operation; original MySQL and unsupported names fail closed. Private container configurations remain inside an ACL-restricted archive root. Archive tar files and SHA256 are validated; source volumes are mounted read-only.

`restore-fixture-archive-probe.ps1 -ArchiveRoot <root>` restores one archived fixture with business tables into newly owned random resources, with no host port/network. It checks MySQL query readiness, copied server UUID, catalog and business/Flyway query readbacks, then removes only the probe resources. This demonstrates one representative physical archive recovery; it does not run old application suites or prove every archived fixture individually. The original stopped volume remains untouched.

`archive-redundant-fixtures.ps1 ... -Phase Remove` requires matching plan hash/count, checked archive hashes and representative restore proof; revalidates live identity/mount/ownership before removing only planned containers and volumes. It never prunes, deletes evidence, or removes unrelated/orphan volumes. Do not edit a plan after archive or restore over a live/original volume. Interrupted removal must be inspected from manifest/removal log; do not blindly rerun a completed phase.

`test-fixture-cleanup-guard.ps1 -EvidenceDirectory <new-directory>` exercises the real guard: valid legacy families and negative cases for original/protected targets, identity/image drift, running state, changed mounts, shared volume and absent archive verification.

Keep raw TASK/HANDOFF/ACCEPTANCE and test assertions/readbacks in their original rounds. Use archive manifests to locate historical data after deleting Docker copies. Old superseded retries are not necessarily byte-identical; archive preserves their differences. Unique migration/adverse checkpoints, active findings and unknown ownership stay retained until reviewed. Removing Docker volumes reduces logical data; Windows VHDX file size may require a separate supported reclamation operation. Do not silently compact or delete the full migration backup.

## C10B catalog photos — approved local target only

`node scripts/operations/import-c10b-catalog-media.mjs --evidence .runtime/<fresh-path>` is a read-only dry-run. `--apply` is a bounded transaction for the user-approved exact container ID, sole named volume and v1/v2/v3 model mapping. It verifies17–30unique asset hashes/rights metadata, refuses changed targets or differing existing media, records before/plan/after and non-media checksums, locks vehicle rows and inserts only on an empty media table. Exact existing mapping is NOOP; no overwrite/delete/reseed/reset. Evidence stays private/ignored. A new machine cannot silently reuse this machine-specific identity; use the Admin editor or a separately reviewed target plan.

Tests: `node --test scripts/operations/import-c10b-catalog-media.test.mjs`. Registry: frontend/public/media/vehicles/licenses.json; attribution page /media/vehicles/licenses.html. These are model/market-variant illustrations, not photographs of the rental unit. Each photo retains its own license; licenses do not apply to the application source as a whole.
