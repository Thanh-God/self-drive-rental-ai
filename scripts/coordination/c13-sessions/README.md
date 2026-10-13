# Session integration regression

Use `scripts/coordination/c12-dashboard/run-browser.py` with `--browser-script scripts/coordination/c13-sessions/verify-browser.cjs`, matching runtime backend/native evidence and a new `--evidence` output plus `--fresh-schema`.

Reuses an isolated test fixture. Tests browser logout, multi-session revocation, account lock/unlock, expired signed fixture JWT and Guest/User/Staff/Admin restrictions. All fixture credentials stay local; no user database or user service is changed. Includes profile regression. Assertions and screenshots are private runtime output, not tracked documentation.

Write regressions also check concurrent profile updates (one success/one version conflict), stale license updates with readback, same-tick form submission and an explicitly injected unstructured server error. Rejected-write checks prove preservation of the relevant profile/license fields; they do not establish rollback of every rental workflow.
