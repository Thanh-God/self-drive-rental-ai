# Isolated core regression runners

These runners exercise real MySQL, application services and desktop UI. They
never target the application's local database at port 33385 or another database
at port 3306. Tests use one dedicated MySQL 8.4 container at port 33676 and fresh
schemas for individual suites. The browser uses backend 8300 and frontend 5300.
All three ports must be free. The verified fixture registered in
`.runtime/docker-fixtures/mysql-core.json` is reused by default, across days and
agents working sequentially. Missing registry or identity/image/mount/marker
drift is a refusal, never an implicit new container. Containers are stopped
afterwards and their volumes are retained; there is no automatic deletion.

For sandbox deposit logic, select `--suites DepositHttpTest MySqlMigrationTest`.
The migration suite covers fresh V12, preserved upgrades through V11→V12 and
the historical partial-migration refusal (ten test methods). With matching
native evidence, the desktop proof uses `--synthetic-deposit --browser-script
scripts/operations/verify-booking-deposit.cjs` on `run-browser.py`. This explicit
mode configures synthetic merchant values, delays scheduled provider calls, and
the browser intercepts checkout navigation. Its signed local IPN proves internal
protocol handling only; it is never evidence of a real VNPAY payment/refund.
Real merchant, HTTPS callback, QueryDR and Refund must be accepted separately.

For vehicle administration, select `--suites VehicleAdminHttpServerTest MySqlMigrationTest`
in `run-mysql.py`. The same migration suite checks fresh and upgrade schemas,
preserved data and the historical partial-migration refusal. With that native
evidence and the matching JAR, run `run-browser.py` with
`--browser-script scripts/operations/verify-vehicle-admin.cjs`. This proof uses
native desktop controls for create/edit/delete/cancel/history conflict and action
placement at 1280/1440 pixels. Alternative browser scripts must exist under the
repository's `scripts/` directory; their hashes join the provenance manifest.

Prerequisites: Docker, JDK 21, Maven Wrapper cache, Node/npm dependencies,
Python 3.12 and Playwright Chromium. Configure runtime executable paths in the
runner for the machine being used. Run from the repository root.

Create a new directory under `.runtime/`, with an exact copy of `backend/src`,
`backend/.mvn`, `backend/pom.xml` and both Maven wrappers in `evidence/backend-copy`.
Also copy `scripts/ai/locations-pilot.json` to `scripts/ai/locations-pilot.json`
beside the backend-copy directory (for example `evidence/scripts/ai/locations-pilot.json`),
preserving its hash: the dataset regression suite resolves it relative to the backend.
Run `verify` on that copy before running native suites. Put the genuine historical
V1/V2 migration snapshot in `evidence/historical-migration` for the failed partial
migration probe. Retrieve it from the appropriate repository revision; do not
modify current migrations or repair failed fixture histories.

```powershell
python scripts/coordination/c14-core/test_guards.py
python scripts/coordination/c14-core/run-mysql.py --backend-root .runtime/<run>/evidence/backend-copy --evidence .runtime/<run>/evidence/native-a
python scripts/coordination/c14-core/verify-refusals.py --backend-root .runtime/<run>/evidence/backend-copy --evidence .runtime/<run>/evidence/refusals
python scripts/coordination/c14-core/run-browser.py --backend-root .runtime/<run>/evidence/backend-copy --backend-evidence .runtime/<run>/evidence/native-a --evidence .runtime/<run>/evidence/browser-a
```

Each output directory must be new. Native assertions require nonempty suites
with zero failures, errors and skips. The native runner verifies an exact fixture
identity and marker before database writes. A retry can use `--reuse-evidence`
with an existing stopped fixture and `--suites` to select affected suites; it does
not erase earlier outputs. Keep the original successful suite outputs as well.

`--new-fixture-reason "<specific approved isolation reason>"` is reserved for a
genuine exception requiring a fresh server. It cannot be combined with
`--reuse-evidence`, and the flag does not itself authorize creation. Registering
an existing fixture requires matching its full ID/name/volume/port with its
original evidence and pinning its Docker image ID. Registry files contain no
credentials and stay ignored/local. The runner reads the existing marker before
creating a new suite schema; it never repairs a missing marker on a reused pool.

The browser creates same-branch and cross-branch rentals through the UI, including
quote acceptance, Staff transitions and customer reviews. It independently reads
SQL snapshots, invoice values, locations, history and incident audit. Report
values come from these actual rentals. To avoid artificial production clocks,
handover waits until the real pickup time; returns are early and retain the
quoted price. Timestamps and report range use the current Vietnam date.

Evidence/configuration stays local and ignored. Private fixture environment files
contain credentials: never commit or publish them. Passing a scoped runner is
not a claim that unrelated providers or optional functionality were tested.

The refusal probe supplies deliberately invalid credentials and expects a specific
guard exception before JDBC startup. Maven exits nonzero for these deliberate
negative cases; the probe verifies the exact exception and does not count an
unrelated connection failure as success. Run Maven-based probes sequentially.

For read-only document permissions and catalog navigation, reuse the completed
browser dataset with a new output directory:

```powershell
python scripts/coordination/c14-core/verify-documents.py --backend-root .runtime/<run>/evidence/backend-copy --backend-evidence .runtime/<run>/evidence/native-a --linked-evidence .runtime/<run>/evidence/browser-a --evidence .runtime/<run>/evidence/documents --browser-script scripts/coordination/c14-core/verify-catalog.cjs
```

This checks the same contract/invoice IDs for Guest, owner, another User, Admin
and Staff at each branch, then verifies brand/search filtering, vehicle details
and the correct booking-form target. It creates no additional bookings and
compares business records before and after the reads. Omit `--browser-script`
to check document permissions without starting Vite.

QR DEMO proof: select `--suites QrDemoHttpTest DepositHttpTest MySqlMigrationTest` for native tests. With matching evidence/JAR, use `--qr-manual --browser-script scripts/operations/verify-qr-deposit.cjs` for desktop. QR mode never configures a merchant or contacts a bank. MySqlMigrationTest has seven methods, including V6 ledger preservation and multiple partial refunds. QR schema versions end at V9; SQL and the metadata-only Java Flyway migration share the same history.

Return settlement: select `ReturnSettlementHttpTest ReturnReceiptHttpTest ReturnPolicyHttpTest QrDemoHttpTest MySqlMigrationTest VehicleAdminHttpServerTest`. Settlement uses a separate ledger; tests must prove duplicate/race/rollback and preserve deposit data.

Schedule protection/warnings: select `ScheduleProtectionHttpTest ScheduleWarningHttpTest ReturnReceiptHttpTest QrDemoHttpTest ConcurrencyAndRaceTest`. The two schedule suites use guarded native schemas when `KDRIVE_TEST_DB_URL` is supplied, otherwise isolated H2. Protection asserts native database identity and exercises return/create and return/handover races with database readback; warnings check role visibility and read-only behavior. Keep UI/browser acceptance separate from this native proof.

For desktop schedule warnings, use `run-browser.py` with the matching native evidence/JAR
and `--browser-script scripts/operations/verify-schedule-warnings.cjs` (no payment flags).
The proof creates four synthetic same-branch calendar bookings in the runner's fresh
marked schema, logs in through the UI at 1440×900, checks Staff/Admin filters and
related links, USER isolation, wrong-branch denial, actual UI return/readback and a
deliberate failed API request. Screenshots and console evidence stay in the new
output directory. This does not enable return policy on the website DB or exercise
the full settlement workflow; native and settlement proofs remain separate.

For same-branch early/on-time return acceptance, use the verified backend copy and
native evidence with `run-browser.py --qr-manual --return-policy --browser-script
scripts/operations/verify-return-policy.cjs` and a new runtime evidence directory.
This explicit mode is restricted to that proof and forces return policy on and
settlement DEMO on in the isolated schema; other proofs keep return policy off.
The early case creates the booking, QR DEMO receipt and handover through UI.
The on-time case uses a labelled past-dated SQL fixture (policy, contract and
handover), then real UI receipt/completion. It does not claim a past UI booking,
change the production clock, enable the website DB, or transfer real money.

Late-return desktop acceptance uses the same explicit `--qr-manual --return-policy`
mode with `--browser-script scripts/operations/verify-return-late.cjs`. It prepares
labelled past-dated same-branch A/B pairs using policy terms from a real quote,
then exercises UI return, partial DEMO receipt, Admin waiver, completion/invoice,
and B handover before/after return; a separate pair proves maintenance still
blocks handover. These dated fixtures have no deposit requirement; no deposit
receipt or bank transfer is claimed. Native settlement tests cover server-side
negative inputs, idempotency, rollback and races separately.

For a logical recovery rehearsal of a completed synthetic late-return dataset:

```powershell
python scripts/coordination/c14-core/test_return_restore.py
python scripts/coordination/c14-core/verify-return-restore.py --linked-evidence .runtime/<run>/browser-a --backend-root .runtime/<verified>/backend-copy --evidence .runtime/<new>/restore-a
```

The restore runner requires the registered stopped pool, exact image/mount/port
and source marker. It dumps only the marked browser schema, copies its synthetic
license photos, restores into a new marked schema, compares every table and photo,
and starts the matching backend with seed and new return-policy creation disabled.
It checks health and unchanged data after startup, then stops its own backend/pool.
Dump, private configuration and photos remain ignored runtime artifacts; never
publish them. All schemas and volumes are retained. This is a fixture recovery
proof, not permission to replace the website database, downgrade migrations or
turn off settlement handling for existing policy snapshots.

QR reconciliation read regression: after building an isolated backend copy with
`mvnw verify`, run the registered MySQL pool with a fresh evidence directory:

```powershell
E:/MT_Python/python312/python.exe -X utf8 scripts/coordination/c14-core/run-mysql.py --backend-root .runtime/<run>/build/backend-copy --evidence .runtime/<run>/native --suites QrDemoHttpTest DepositHttpTest CancelBoundaryTest ConcurrencyAndRaceTest MySqlMigrationTest
```

Prepare the verified historical V1/V2 resources in `<run>/historical-migration`
as required by the runner; do not substitute current migrations for historical
ones. The QR suite checks all three reconciliation GETs, ownership/branch
permissions, unchanged ledger/history/contracts after reads, non-QR omission,
refund and retry classification, failed-contract recovery, and existing QR
processing after the new-deposit flag is disabled. The flag-off test temporarily
changes the test context's configuration fields and restores them in `finally`;
it does not claim to test a process restart or production deployment.
Batch-query limits are covered separately by `QrReconciliationReadServiceTest`.
Native MockMvc/SQL evidence does not constitute browser UI acceptance. Preserve
frontend test/lint/API-demo build evidence only while its inputs are unchanged.
