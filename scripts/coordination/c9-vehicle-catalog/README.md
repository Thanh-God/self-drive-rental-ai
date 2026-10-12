# C9 catalog verification

Run sequentially from the repository root with Windows PowerShell 5.1. Use a new evidence directory for each attempt; existing directories are refused. Backend fixtures are isolated from user MySQL (33385/3306). Containers are stopped, volumes and evidence retained.

1. Run frontend tests/lint; build both demo and API modes. For browser preview, **build** the API bundle with `VITE_DATA_MODE=api` and `VITE_API_BASE_URL=/api/v1`. Setting these variables only when starting preview cannot change an already compiled bundle.
2. Refresh the backend reference manifest only after reviewing source changes. Run `run-c9-backend.ps1 -EvidenceDir <new-runtime-dir>`: isolated build, provenance, JAR startup/auth and mandatory MySQL suites. Run `test-c9-backend-guards.ps1` separately.
3. Use that accepted backend directory with `Get-C9Inputs` from `c9-inputs.ps1` to freeze the browser manifest after the explicit API build. Run `test-c9-browser-guards.ps1`, then `run-c9-browser.ps1 -AcceptedBuildDir <accepted-backend-dir> -EvidenceDir <new-runtime-dir>`.
4. Compare final source hashes and inspect summaries, XML, SQL assertions, screenshots and cleanup readbacks. A control-only result is not business verification. Optional environment skips in general Maven verify do not replace zero-skip MySQL suites.

The container-failure guard injects native exit 23 into the actual stop helper and verifies common-finally failure propagation. It is a controlled seam, not a claim that Docker physically failed. Live runs invoke Docker stop and inspect stopped state through the same helper.

Catalog supports read/create/update for brands, categories and amenities. Digest revision protects current state against stale writes; it is not a monotonic audit/version history and cannot detect an ABA change. DELETE and vehicle media/link management remain outside C9.
