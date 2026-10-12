# C10A backend proof

Run sequentially from repository root in Windows PowerShell 5.1 with Docker Linux engine and JDK21. Use a new ignored runtime EvidenceDir per attempt.

`run-c10a-backend.ps1 -EvidenceDir <new-runtime-dir>` defaults to isolated MySQL33651 and JAR8191. It refuses occupied ports/existing evidence, checks the required source reference manifest before mutation, builds an isolated backend copy and compares JAR classes/resources, exercises real JAR Admin amenity writes/public reads and runs VehicleAmenityHttpServerTest plus VehicleCatalogHttpServerTest on MySQL with strict zero-skip XML/method matching. It restores caller environment and stops owned processes/container; volume/evidence remain KEEP. Override ports only after checking they are available. Never mount user database volume or target33385/3306.

`test-c10a-backend-guards.ps1 -EvidenceDir <another-new-runtime-dir>` exercises entrypoint shell/root/existing evidence/missing/drift/occupied-port and caller/cleanup controls. CONTROL_ONLY is not business PASS. The runner is adapted from C9's verified wrapper and independently reverified; C7 helpers and C6 JAR builder are actual imports whose paths/hashes are in the manifest.

After reviewed source changes, refresh the reference manifest from its actual dependency paths, rerun affected proof, and compare source-before/source-after/final hashes. Do not overwrite artifacts or regenerate a manifest merely to conceal unexpected drift. General Maven verify optional skips do not replace mandatory MySQL tests. Tests inject a repository failure after actual DELETE/partial INSERT inside the real service transaction to prove rollback; the seam is not a physical Docker/DB outage. SQL instrumentation counts top-level JdbcTemplate query entrypoints, avoiding nested overload counts, and verifies actual no-op has no write calls.

No frontend/browser validation is included in this backend-only scope; Cursor's later task must prove UI/API integration against the accepted contract. Image management is C10B, not implemented here.
