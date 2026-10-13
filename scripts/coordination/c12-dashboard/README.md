# C12 dashboard browser acceptance

Run from repository root after frontend final tests/lint/demo build; the runner buildsAPI and owns frontend5299/backend8299. Established Playwright fixture package/cache is reused, no addeddependency. This uses the existing project browser harness; no external canvas/auth plugin needed.

```
python scripts/coordination/c12-dashboard/run-browser.py --backend-root .runtime/coordination-c12-3-20261013/evidence/backend-copy --backend-evidence .runtime/coordination-c12-3-20261013/evidence/mysql-a --evidence .runtime/<new-turn>/evidence/browser --fresh-schema
```

Requires exact stopped C12fixture identity on33675, nativePASS8 and matching backend source/JAR. Newruntimeoutput required. Reuses container/volume with freshschema for browser representativequery rows; these rows aren'tproof of rentalworkflow (native C12-3 holds that proof). Does not access DB33385/3306. SQL readback/metadata snapshot must stayequalafterallbrowser reads. Source/frontend+harness bytes/keyset checkedafterrun. Services owned byrunner and exactfixture stop in finally; volumeKEEP.

Chromium desktop1440/1280 localevi-VN: Adminlogin/defaultmonth/API-vs-demo/date/UIvsHTTPvsSQL/zero/refresh/invalidrange/no-write; injectedHTTP500 hidesstaleKPI then realAPIretry; Guest/User/StaffUI/backendRBAC. Errorinjection is an explicit transporttest, not a claim backend naturally fails500. Newrootpassword staysprivateconfig; SQLerrors don't print sensitivearguments. On firstattempt CRLF password reading was fixed; redactedfailurelog retained. Screenshots/API JSON/SQL/hashes/assertions/log/cleanup innewout.

Restart your own devbackend/frontend to load source after deployment; runner doesn't replace orrestart user services/JAR. API and demo builds share dist, so finish them beforebrowserrun. No parallel build/test services.
