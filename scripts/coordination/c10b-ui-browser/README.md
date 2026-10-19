# C10B UI proof

Run from repository root in Windows PowerShell5.1 with fresh evidence paths:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/coordination/c10b-ui-browser/test-c10b-browser-guards.ps1 -EvidenceDir .runtime/<new-guards>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/coordination/c10b-ui-browser/run-c10b-browser.ps1 -EvidenceDir .runtime/<new-browser>
```

Build frontend API mode with `VITE_DATA_MODE=api`, `VITE_API_BASE_URL=/api/v1` before browser proof. The runner uses ports8293/5293 and isolated MySQL33663+, accepted C10B JAR/provenance, input manifest and C7 cleanup helpers. It preserves caller env including `VITE_PROXY_TARGET`, stops only owned processes/container and retains test volume. Refuses occupied ports, existing evidence, missing dependencies and source drift before spawn.

After intentional source/build changes, regenerate the manifest from the actual inputs; do not rewrite a manifest to hide unexplained drift:

```powershell
. scripts/coordination/c10b-ui-browser/c10b-inputs.ps1
$proofRoot=(Get-Location).Path
$backendEvidence=Read-Host "Path to verified backend evidence (mysql-url-final)"
Get-C10BInputs $proofRoot $backendEvidence | ConvertTo-Json | Set-Content scripts/coordination/c10b-ui-browser/c10b-browser-reference-manifest.json
```

Actual browser imports licensed assets into isolated fixture via Admin API, uses mounted form400/409/POST/reorder and held real PUT, compares SQL UTF8 bytes, tests broken-file HTTP404/recovery, validates RBAC and4pages at3desktop sizes. It records assertions/screenshots; JSON/exit alone does not replace source/readback. Browser checks use the existing local Playwright installation. Original MySQL is read for identity protection only.
