# C12 report MySQL proof

Run from repository root with Python3.12/JDK21/Docker mysql:8.4. Backend-root must be a source-identical newly verified runtime copy; never workspace target or production DB.

```
python scripts/coordination/c12-reports/run-mysql.py --backend-root .runtime/<turn>/evidence/backend-copy --evidence .runtime/<turn>/evidence/mysql-a
```

Runner refuses existing output, non-runtime build/output, port33675 in use, input drift or incorrect fixture marker. It owns one new kltn-c12-report fixture volume/schema kdrive_c12_report, binds127.0.0.1:33675, and stops exact identity in finally; KEEP volume. No original33385/3306 or prune.

Retry must use a NEW output directory with `--reuse-evidence .runtime/<turn>/evidence/mysql-a`. It checks old exact stopped ID and volume before restart, then validates marker; don't create another fixture for the same failure. Reused fixture is disposable query/workflow-test data only: test setup clears fixture rows and preserves earlier XML/logs in their output directory. No credentials/marker tokens in Git or public logs; private files runtime only.

Suites run sequentially: OperationalReportIntegrationTest4 then OperationalReportMySqlTest4, require exact names/counts withzero skip/fail. The first exercises aggregate query fixtures through Spring MockMvc on MySQL. The second exercises realHTTP quote/create/confirm/handover/return/complete, SQLreadback/no-write/RBAC/timebounds, a Mockito test-only latch between real booking aggregate and invoice aggregate for concurrent commit, and10000syntheticbooking rows latency. Spy never changes production source/assertions; writer completes via real workflow. TestClock is test-only.

Performance sample is10000bookings,0invoices/0completionhistory; five realHTTP calls. EXPLAIN logged is diagnostic COUNT on booking_created range using covering index scan, not EXPLAIN of all report expressions or production benchmark. Source review has3fixedaggregatequeries/no entity-tableloading; not a general-log statement-count measurement. Native mixed metric fixtures and real invoice workflow are checked in other cases. Larger invoice/history performance or an index migration needs a separate measured scope.

Full verify without external fixture intentionally skips4MySQL-onlytests, alongside14preexistingoptional cases. These skips aren'tPASS; runner later requires all8native tests executed. Source/JARresources compare and finalSQL/Flyway/readback/log/XML/result/cleanup are retained.
