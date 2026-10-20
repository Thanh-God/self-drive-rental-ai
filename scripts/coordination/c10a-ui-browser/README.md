# C10A UI browser proof

Windows PowerShell5.1; run sequentially from repo root with a new runtime EvidenceDir. `run-c10a-browser.ps1` uses the accepted C10A backend JAR via AcceptedBuildDir, hashes its source/provenance and starts only isolated MySQL/backend/frontend it owns. It refuses occupied8080/5173, never stops user services and never mounts original DB volume. Stop finally, exact process/container/environment readback; volume/evidence KEEP.

Build frontend with VITE_DATA_MODE=api,VITE_API_BASE_URL=/api/v1 before freezing `c10a-browser-reference-manifest.json` using Get-C10AInputs from c10a-inputs.ps1. Missing/reference drift must refuse before mutation. Run `test-c10a-browser-guards.ps1` separately, then `run-c10a-browser.ps1`; CONTROL_ONLY is not business proof. Wrapper/guards adapted from the verified C9 source, independently tested against current names/env/manifest.

Before/after visual proof requires `.runtime/c10a-ui-baseline-dist.txt` pointing to an isolated frontend/dist built from an archived Git HEAD (record source HEAD/build log). The browser routes that actual baseline HTML/assets in a separate context against the same fixture API; no synthetic DOM reconstruction or source checkout/reset. Baseline dist and pointer are hash-bound inputs. After screenshot uses the current source-bound API preview. Do not change pointer/bundle after freezing without reproof.

Browser creates its amenity fixtures through actual Admin API, assigns links to an independent second car, and checks SQL preservation, real held PUT1, controlled400, real409/freshPUTrecover, UIclear[], public card/detail labels, API/UI role denial, viewport overflow/focus/CTA/reduced-motion/HTTPconsole. Fixture data is not production data. Controlled400 is a UI error-path seam, not backend400 validation proof; accepted backend tests cover real validation. Container failure guard injects native exit23 into the actual stop helper, not a claim Docker physically failed.

Baseline/first-attempt/negative artifacts must be preserved. Final source/FEbuild/JAR/helper hashes before/after/final and actual screenshots are required. UI proof closes C10A only; vehicle images C10B remain pending.
