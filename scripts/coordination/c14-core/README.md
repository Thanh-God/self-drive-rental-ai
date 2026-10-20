# Isolated core regression runners

These runners exercise real MySQL, application services and desktop UI. They
never target the application's local database at port 33385 or another database
at port 3306. Tests use one dedicated MySQL 8.4 container at port 33676 and fresh
schemas for individual suites. The browser uses backend 8300 and frontend 5300.
All three ports must be free. Containers are stopped afterwards and their volumes
are retained for inspection; there is no automatic deletion.

For vehicle administration, select `--suites VehicleAdminHttpServerTest MySqlMigrationTest`
in `run-mysql.py`. The migration suite covers fresh, V1 upgrade, V2 upgrade and
the historical partial-migration refusal (three test methods). With that native
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
