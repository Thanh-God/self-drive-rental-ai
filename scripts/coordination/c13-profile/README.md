# Profile browser regression

Run at repository root with the shared isolated browser harness:

```text
python scripts/coordination/c12-dashboard/run-browser.py --backend-root <matching-runtime-backend-copy> --backend-evidence <native-MySQL-evidence> --evidence .runtime/<new-run>/evidence/browser --fresh-schema --browser-script scripts/coordination/c13-profile/verify-browser.cjs
```

Requires the exact stopped test fixture identity and matching backend source/JAR. Uses isolated ports 33675/8299/5299 and a new schema; never writes to the user database at 33385. The runner stops owned services/fixture and keeps its volume. Existing Playwright package is reused; no new dependency. Repository Playwright runs the integration assertions.

Tests actual UI phone/license/password saves, invalid input and rejected writes, readback, old-session revocation and success dialog. One transport scenario deliberately holds a real committed profile response past the client timeout: verify unknown-outcome feedback, no retry/false success, and reload readback. This injected delay does not diagnose a historical user timeout. Runtime logs/screenshots/config stay private and ignored.
