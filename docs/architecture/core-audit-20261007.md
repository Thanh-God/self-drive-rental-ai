# Full audit và kế hoạch core — 07/10/2026

## A. Project status và giới hạn audit

Baseline HEAD `51 d12313679 b212 f92 c87 eb92 a42594 ee8 a5 c34 b`; workspace có thay đổi chưa commit được giữ nguyên. Artifact `.runtime/full-audit-20261007/`: status-before, source-doc-manifest.csv, endpoints.txt, entity-query-index.txt, use-cases-at-head.md, backend-verify.log/backend-results.json, mysql-read.txt, jar-after-build.json. Đã quét 176 file text source/test/docs/scripts bằng đọc nội dung, hash, số dòng/file rỗng; rà sâu route/API/service/security/DDL và dependency nghiệp vụ. Build/dependency/binary không tính là source. Artifact runtime lịch sử đọc có chọn lọc qua biên bản chính thức, không coi mọi prompt cũ là yêu cầu mới. Không tuyên bố đã đọc bằng tay từng dòng toàn project hoặc tái chạy mọi E2 E.

React19/Vite6 SPA, Spring Boot3.5.16/Java21 modular monolith, Maven Wrapper, Security/JWT. Modules đang có implementation: auth,user,vehicle,branch,booking,operation,contract,invoice,review. location/ai là mục tiêu, chưa có endpoint nghiệp vụ. Không tạo staff/admin module riêng. AuthContext/hook quản lý phiên và race; demo tách API nhưng default VITE_DATA_MODE là demo. Scripts Git Bash đặt API mode và nạp env; backend không tự đọc .env.local.

Nguồn ưu tiên: chỉ đạo mới của người dùng (core trước AI) > quyết định đã duyệt > requirements hiện hành và crosswalk > source/tests > báo cáo agent. Tên 29 UC không là29 màn hình hay chứng nhận DONE. Audit này không sửa source/test/migration/config. Backend verify tạo lại JAR trong target, nên hash JAR mới có trong artifact, không dùng hash JAR cũ để tuyên bố build mới đã startup MySQL. Không reset/commit/push hoặc xóa placeholder.

Kiểm chứng: backend verify exit0,31 tests tổng,28 executed PASS,3 skip,0 fail/error; concurrency suite lần này dùng H2, không MySQL. MySQLMigration Test2 skip và RouteVersionGuardTest1 skip không làPASS. Frontend29 tests/lint/APIbuild PASS gần nhất trên source cuối tại `.runtime/ua02-acceptance-20261007` (hash ApiScreens0 ED4 C48 D...), không chạy lặp khi không đổi. Browser MySQL đã có home/auth, checkoutpositive, APInegative, race và1 POST; toàn Staff/Admin/U04/U05/U06/U09 chưa được nghiệm thu đầy đủ trong audit này. Không cóP0 runtime mới đã tái hiện. Không đo tải/tối ưu/security toàn diện hay đọc dữ liệu cá nhân của DB người dùng.

## B. Progress — phương pháp, không phải tỷ lệ PASS

Bốn checkpoint bằng trọng số: UI luồng thật có triển khai; API/backend cho thao tác chính có triển khai; Table/Column/Read/Write support; full-UC E2 E đã được nghiệm thu. Mỗi checkpoint0/1, không tự cho PARTIAL50%. Checkpoint3 không chứng minh toàn bộ rule đã đúng. DONE chỉ khi đủ4 và toàn tiêu chí UC, không vì điểm triển khai cao. Dấu? nghĩa chưa đủ bằng chứng E2 E, tính0 chocheckpoint4.

Theo29 UC hiện hành:74/116=63.8% checkpoint coverage toàn kế hoạch kể cả2 AI. Core không AI:74/108=68.5%. A05 vốn “Nên có”; nếu loại riêng optional A05 thì74/104=71.2%, không tự bỏ chức năng này. Core full-UC accepted hiện1/27=3.7% theo tiêu chuẩn đầy đủ của ma trận; không nhầm tỷ lệaccepted với lượngsource đã có.

Đối chiếu22 UC tại HEAD: gộp lại để không tăng tiến độ do tách tên.20 UCnon AI, mỗi UCmax4; các UCgộp dùng trung bình checkpoint của phần con. Chuỗi điểm theo thứ tự bảng HEAD (bỏG04/U06 AI): G01=3,G02=3,G03=3 (register+login gộp, expiry chưa đủ),U01=3,U02=3,U03=3,U04=3,U05=3,S01=3,S02=3,S03=3,S04=3,A01=3,A02=2 (vehicle3/catalog1),A03=1,A04=3,A05=0,U07=3,S05=3,A06=2.75 (branch2/route3/assignment3/claim3). Tổng53.75/80=67.2% core; toàn22 UC53.75/88=61.1%. Không cộng từng phần con nhưUC độc lập vào kế hoạch cũ. Bằng chứng kế hoạch HEAD là baseline truy xuất được, không khẳng định là đề cương đầu tiên chưa lưu.

**Con số tổng thể dùng điều phối: khoảng67% độ phủ triển khai core so baseline22 UC; không phải67% chức năng đã nghiệm thu.** Không có dữ liệu để ước lượng thời gian còn lại theo tỷ lệ này. Percent thay đổi nếu người dùng chốt scope/optional khác; phải lưu mẫu số.

## C–G. Features, actor và Use Case coverage

Mỗi hàng sau vừa là feature audit vừa là coverage: Original Plan=IDbaseline HEAD; Layers=UI/API-backend/Data/E2 E,1 cócheckpoint,0 thiếu; E2 E?chưafullacceptance. Code là entry point, bao gồm dependency trong endpoints/entity index. “NOT DONE” có thể đã cóTable nhưng actor chưa dùng được. Không dùng BROKEN khi chưa tái hiện. AI “NOT DONE/deferred”, không NOT REQUIRED vĩnh viễn.

| # / Feature | Actor | Original Plan | Current status | Completion | Code | Missing | Priority | UI/API-backend/Data/E2 E |
|---|---|---|---|---|---|---|---|---|
| G01 Search vehicles | Guest/User | G01 | PARTIAL | 3/4 | ApiVehicleListPage;VehicleController | Full filters/error E2 E,media data | P2 | 1/1/1/? |
| G02 Vehicle details | Guest/User | G02 | PARTIAL | 3/4 | ApiVehicleDetailPage;VehicleService | Images/amenities integration and fullpublicreview E2 E | P1 | 1/1/1/? |
| G03 Register | Guest | G03 | DONE scoped register | 4/4 | RegisterPage;AuthController | Keep tests;sharedlogin expiry trackedseparately | P3 | 1/1/1/1 |
| G04 Recommend | Guest/User | G04 | NOT DONE/deferred | 0/4 | AiScreens;DataGate | No real AIAPI;policyopen | P5 | 0/0/0/0 |
| U01 Profile/password | User | U01 | PARTIAL | 3/4 | ApiProfilePage;AccountService | UA-03 expiry/updateisolation | P3 | 1/1/1/? |
| U02 Availability/quote | User | U02 | PARTIAL | 3/4 | ApiNewBookingPage;BookingService | UA-01 negative form/serverchanges | P1 | 1/1/1/? |
| U03 Create booking | User | U02 | PARTIAL | 3/4 | ApiNewBookingPage;BookingService | UA-01 quote→price/schedulechange UI;UA-02 scoped PASSkeep | P1 | 1/1/1/? |
| U04 Rental history/documents | User | U03 | PARTIAL | 3/4 | Api Booking List/Detail/Document;RentalWorkflow | Ownership/timing/snapshot full E2 E | P1 | 1/1/1/? |
| U05 Cancel | User | U04 | PARTIAL | 3/4 | bookingActions;BookingService.change | 24 hboundary/reason/state/crossuser E2 E | P1 | 1/1/1/? |
| U06 Review | User | U05 | PARTIAL | 3/4 | ApiBookingDetailPage;ReviewService | COMPLETED/duplicate/crossuser/publichide E2 E | P1 | 1/1/1/? |
| U07 Itinerary | User | U06 | NOT DONE/deferred | 0/4 | AiScreens;DataGate | Real API/provider/routecheck | P5 | 0/0/0/0 |
| U08 License | User | U07 | PARTIAL | 3/4 | ApiProfilePage;LicenseService | Compatibility-to-end UInegative,updateisolation | P1 | 1/1/1/? |
| U09 Incident/claimreply | User | U07 | PARTIAL | 3/4 | Incident Panel;IncidentService | Fullreport→assess→claim→reply UI | P1 | 1/1/1/? |
| S01 Handle booking | Staff | S01 | PARTIAL | 3/4 | Api Booking List/Detail;RentalWorkflow | Assignedbranch/confirm/reject/invalid E2 E | P1 | 1/1/1/? |
| S02 Handover | Staff | S02 | PARTIAL | 3/4 | ApiOperationPage;RentalWorkflow | Real-time/startwindow/record/GPLXE2 E | P1 | 1/1/1/? |
| S03 Return/complete | Staff | S03 | PARTIAL | 3/4 | ApiOperationPage;RentalWorkflow | Actualbranch/status/invoice E2 E | P1 | 1/1/1/? |
| S04 Vehicle status | Staff | S04 | PARTIAL | 3/4 | ApiVehiclesAdminPage fleet;VehicleService | Currentbranchpermission/recovery E2 E | P2 | 1/1/1/? |
| S05 Assess incident | Staff | S05 | PARTIAL | 3/4 | Incident Panel;IncidentService | Assessment/coverage/claimrules E2 E | P1 | 1/1/1/? |
| S06 Verify license | Staff | S02/U07 | PARTIAL | 3/4 | ApiBookingDetailPage;LicenseService.verify | Verify duringhandover,notindependent endpoint;full E2 E | P1 | 1/1/1/? |
| A01 Accounts | Admin | A01 | PARTIAL | 3/4 | ApiAccountsPage;AccountService | Lock→tokenreject/unlock/create Staff E2 E | P1 | 1/1/1/? |
| A02 Vehicles | Admin | A02 | PARTIAL | 3/4 | ApiVehiclesAdminPage;VehicleService | Media/amenities,invalid/version E2 E | P1 | 1/1/1/? |
| A03 Locations | Admin | A03 | NOT DONE | 1/4 | LocationsPage;DataGate | Real UI/API/service;Tableexists | P1 | 0/0/1/0 |
| A04 Moderate reviews | Admin | A04 | PARTIAL | 3/4 | ApiReviewsAdminPage;ReviewService | Hidden/public/version E2 E | P2 | 1/1/1/? |
| A05 Report | Admin | A05 optional | NOT DONE | 0/4 | DashboardPage;DataGate | Approve metrics;real API/UI | P1 optional | 0/0/0/0 |
| A06 Branches | Admin | A06 | PARTIAL | 2/4 | ApiBranchesPage;BranchService | API/UIDisable missing,saveforces ACTIVE | P1 | 1/0/1/? |
| A07 Assign Staff | Admin | A06 | PARTIAL | 3/4 | ApiAccountsPage;BranchService.assign | Assignedlistvisibility/E2 E;revokeunapproved | P2 | 1/1/1/? |
| A08 Vehicle catalog | Admin | A02 | NOT DONE writes | 1/4 | catalogroute→ApiBranchesPage | Brand/category/amenity CRUDUI/API | P1 | 0/0/1/0 |
| A09 Approve claim | Admin | A06 | PARTIAL | 3/4 | Incident Panel;IncidentService | Full Actorchain/amount/audit E2 E | P1 | 1/1/1/? |
| A10 Branch routes | Admin | A06 | PARTIAL | 3/4 | ApiBranchesPage;BranchService.route | Version/close/inputrules E2 E | P2 | 1/1/1/? |

Sharedlogin/logout: implementedandscoped PASS,expiryandcrossprofile/gplx gapsremain; notaddone UCtomake30 denominator. Core27:1 DONE,23 PARTIAL,3 NOTDONE. Existing source supports many actorsteps, but no full Staff/Admin UC is marked DONE without completeevidence.

## F. Changes from plan

| Nội dung | Baseline | Hiện tại | Thay đổi/lý do | Xử lý |
|---|---|---|---|---|
| UC count | 22 UCHEAD |29 business+sharedlogin |Split booking/license/incident/admin;dateddocs05–06/10 |Keep IDs/crosswalk;not29 modules |
| User home | History/defaultworkspace |USERlogin/register→/ |Userapproved06/10;home APIPASS |Keep |
| Actor/module | Actor Staff/Admin |Roles,notdatamodules |AD-03/05 |Keep |
| Core priority | Original AI2 MVP |AIdeferredaftercoreallactors |Usernewinstruction07/10 |Keep AIcode;no AIworknow |
| Catalog screen | Adminvehiclecatalog |/admin/catalog→branch/routes |No clear reason found in the project. |Splitnavigation/minimal APIcatalog |
| Locations/dashboard | Planned Admin UC |APImode DataGate |No clear reason found in the project. |Addrealcoreflows/metricsdecision |
| Branchclose | Requirementadd/edit/close |savealways ACTIVE |No clear reason found in the project. |Definecloseeffectbeforedependent bookingschange |
| Licenseverification | Independentnamed UC |Partofhandover,checksandrecords |AD-11/sourceworkflow |Do not create standaloneendpointjustforname |
| Payment | Outsideonline scope |Noonlinepayment;invoice not paidproof |AD-10 |NOT REQUIRED onlinepayment |
| review vehicle link | Historicaldirectcolumnattempt |reviews→bookings→vehicles |Userdecision04/10 |Keep |
| Database history | Old V2 failed FKnote |Current V2 has6 eventcolumns |Approvedpre-release04/10;shared DBhistoryunknown |Keepoldaudit,addcurrentcrossreference |

## H. Technical debt / findings

FA-01 P1 AppRoutes.jsx:289 catalogroutes ApiBranchesPage; VehicleController hasreadcatalogonly. Actualwrongbusinessscreen/missingwrite API; expected A08 realcatalogmanagement. Impact Admincannotcompletecatalog UC.
FA-02 P1 AppRoutes.jsx:locations andadminindex,PageKit.jsx:109: APImodeexplicitplaceholder; nolocation/reportcontroller. Expected A03 realflow,A05 approvedmetrics. Not runtimecrash;missingimplementation.
FA-03 P1 BranchService.java:save alwayssets ACTIVE;BranchInputhasnostatus. Expectedclosebranch per UC; missingendpoint/UI/definedexistingbookinghandling. Noautocancelormovevehiclewithoutdecision.
FA-04 P1 VehicleService.View/catalog,ApiVehicleDetailPage: schemaimages/amenitiesnotread/written bymainbackend. Expectedvehiclemedia/amenities. Publiciconfallbackishonest,notimageimplementation. Add URLmanagement/attributionwithinputvalidation,nofakeassetsorunapprovedupload.
FA-05 P2 UA-01/03 remain;U04–06 and fullactoroperation/incidentawait E2 E. Missingevidenceisnotdefect. UA-02 PASSkeep.
FA-06 P2 BookingService.list and IncidentService.list loadallthenfilter;ReviewService builds INlistforallvehiclebookings. Potentialscale/readcost,notmeasuredperformancefailure. Boundqueries/paginationonlyaftercoreorifobservedblocker.
FA-07 P2 21 empty Javafilesinclcontract/invoice/reviewtypes;functionscanworkusing JdbcTemplate. Do notmarknotdone/deletejustbecauseempty. Service SQL/writepersistenceplacementdebt;smallrefactoronlywhenfeaturedepends.
FA-08 P2 database-design.md openingcurrenthash/failed V2/22 emptyfilesclaimsarehistoricandsuperseded;decisions.md closing5 bydecisionsalonecontradictedbylateracceptancelimits. Noalteringoldentries;appendcurrentindex/scopeplanreference.
FA-09 P3 AuthlocalStoragetoken,no rate limit found;malformed NullPointerException globallymapped400 canhidecodingdefect. Currentriskreview,notconfirmedexploit. Do notreplaceauthframework/cookieswithoutdecision. Missingexpired JWTtest UA03.
FA-10 P3 frontenddefaultdemo anddefaultdirectlocalhost API requirelaunchscriptscorrectenv. Existing Unsupportedprotocol E/Network Errorhistoryresolvedscoped;notautomaticallycurrentbug.

## I. Database status — simple English

V1 has 25 business tables and 37 foreign keys. V2 adds 6 columns to incident_events. The QA database ua02_qa has 26 tables, with flyway_schema_history. It has 179 columns, including that table, and 37 foreign keys. Both V1 and V2 have success=1. Their checksums are 190705803 and -1792922806. See mysql-read.txt. The first read failed because MySQL was not ready. The second read passed after a short wait. No data was changed.

Exact COUNT queries found 5 users, 3 vehicles and 1 booking. This is test data, not data from every database. Other database history is NOT VERIFIED. No private user rows or passwords were shown. TABLE_ROWS may be an estimate.

| Tables | Main columns, keys and links | Current use / missing work |
|---|---|---|
| users | id, unique email, password_hash, role, status, token_version, version | Auth, profile and Admin read/write |
| branches, staff_branches, branch_routes | branch ID; user and branch keys; pickup and return keys; fee, enabled, version | Read/write; branch close is missing from API; Staff remove needs a decision |
| vehicles, vehicle_brands, vehicle_categories | id, unique plate, brand/category/branch keys, seats, transmission, daily_price, status | Vehicle read/write; brands and categories have read/seed only |
| amenities, vehicle_amenities, vehicle_images | amenity ID; vehicle and amenity keys; URL, order, attribution | Tables exist; no main API read/write found |
| driver_licenses | unique user_id, scheme, license_class, expires_on, status, checked_by, checked_at | Read/write and Staff checks at handover |
| bookings, booking_status_history | user/vehicle/branch keys; start/end/expiry time; status, price; history and actor keys | Read/write; indexes for vehicle/time, user/created time and status/expiry |
| vehicle_handover_records | booking and kind unique key; actor/branch keys; time, condition, license_snapshot | SQL read/write; an empty Java class does not mean missing data |
| contracts, invoices, invoice_items | unique booking_id, snapshot, issued_at; invoice item key, quantity, price, amount | SQL read/write; contract at confirmation, invoice at completion; invoice is not payment proof |
| reviews | unique booking_id, rating, content, hidden, moderated_by, moderated_at | Read/write; link to vehicle through booking; no direct vehicle_id |
| incident_cases, incident_events | booking/reporter keys; case/actor keys; time, status, money, basis; old/new event status | Read/write; keep old event values; old values may be NULL |
| location_categories, locations | category key, name, latitude, longitude, status | Tables only; no main controller/service found |
| itineraries, itinerary_days, itinerary_items | user key, criteria; unique date; day/location keys, order, snapshot | Tables only; AI is for a later phase |

Primary key — a field that gives each row its ID. Foreign key — a field that links one table to another table. V1 checks price, time, seats and status. Queries use parameters. Version fields reject old updates. The vehicle lock checks competing bookings.

JPA maps some tables. Other tables use SQL. Hibernate validate checks mapped entities, not every SQL-only table. No new missing table or column was proved necessary for core work. The branch status column already exists, but the current API does not change it. No new wrong link was proved. Eight tables have no main use yet: amenities, vehicle_amenities, vehicle_images, location_categories, locations and the three itinerary tables. Do not delete them. Brands/categories are used for read and seed. Empty Java files are listed in the manifest.

Core data needed: users, Staff branch links, active branches, open routes and fees, vehicles, real image URLs, amenities, licenses, bookings for each state, handover records, documents, reviews and incidents. Seed gives three cars; it is test data, not a business price rule. No query plan or load test was done. We cannot prove an index is unused from source alone.

Keep one Flyway source. Do not clean, repair or run manual DDL on a user database. Check history, checksums, structure and data before an update to a shared database. Live user database data and other shared databases were not checked in this audit.
## J–L. Remaining work, assignment, dependencies

P0: no newconfirmedstartupblocker. C0 belowchecksstartup/configfirst;escalateonlyifreproduced. P1 core,P2 integration,P3 validation/security,P4 polish,P5 AInowdeferred. Codex Acoordinatesandaccepts;Antigravitylargedependencies;Codex Bshorttasks. Userpastes prompts,notautomaticagentlaunch. Worksequentially,never2 agentsediting ApiScreens/ApiManagementScreensatthe sametime.

| Task ID | Task / Agent | Files/module | Dependency / input | Expected output / acceptance | Priority |
|---|---|---|---|---|---|
| C0 | Auditbaseline/runcontract;Codex B | scripts,README,env/config | Thisreport;no sourcechange unlessbug | JARcurrentbuildstartup/Hibernate/health/APIproxy;register/login;separate H2/MySQLresults;no user DBwrite | P0 check |
| C1 | UA03 expiry/isolation;Codex B | AuthContext,Api Profile,user/securitytests | C0;latestscoped QA | Validexpired JWT401,UIclearsoldsession;Bprofile/GPLXupdateleaves Aunchanged;no401 oldresponseclearsnewsession | P3 |
| C2 | UA01 negativecheckout/serverchanges;Antigravity | Api New Booking,booking/license/branch/vehicle | C1;rulesdecisions | Formmissing/wrong/expiry/time/routeerror;real Adminpricechangeorother Userbookingafterquote→createfails;noextrabooking/history;freshquoteallowsvalidcase | P1 |
| C3 | Full Staffoperation+documents;Antigravity | operation,booking,contract,invoice,Api Booking/Document | C2;assigned Staffandtestclock | UIconfirm/reject/reason;handover GPLX/currentbranch/time;return/complete;docissuancecorrect;wrongbranch/Adminhandover403;MySQLrecords+rollback | P1 |
| C4 | Userhistory/docownership;Codex B | Api Booking List/Detail/Document | C3 | Pending/confirmed/completedlistdetail;contract/invoicewhenissued;crossuser404/noleak;snapshotaftercatalogchange | P1 |
| C5 | Cancel;Codex B | bookingActions,BookingService | C4 |24 hboundary/reason/state/ownership;Staffnearstartcorrect;oldversion409;noillegaltransition | P1 |
| C6 | Review+moderation;Codex B | review,Api Booking Detail,Api Reviews Admin | C3,C4 |Completedownbookingonce;duplicate/foreign/uncompletedreject;Adminhide/showpublic;oldversion409 | P1/P2 |
| C7 | Incidentchain;Antigravity | operation/Incident Panel,user/staff/admin | C3 |Custodytimebounds/latevalidreport;assessment/coverage/claim/dispute/close;currentbranchblock;historicaleventsunchanged;noautodeduct | P1 |
| C8 | Accounts/assignment UX;Codex B | user/branch,Api Accounts | C0;A07 addonlyapproved |Create Staff/duplicate/lock→token401/unlock;showassignedbranches;non Staffassignmentreject;do notrevokeuntilapproved | P1/P2 |
| C9 | Vehiclecatalog API/UI;Antigravity | vehicle controller/service/adapter,Api Management | C8;catalogscopefrom A08 |Create/read/updatebrand/category/amenity,unique/invalid/role/versionchecks;useditemdeleteblockedunlesspolicyapproved;correctcatalogroute | P1 |
| C10 | Vehiclemedia/amenities;Codex B | vehicle DTO/API,detail/manage | C9 |Real URL/attribution/order/amenitylinkswriteandread;fallbackonlywhenmissing;no externaluploadsecret/newprovider | P1/P2 |
| C11 | Branchclose/tourlocations;Antigravity,two tasks | branch thenlocation;Api Management/Locations | C3,C9;branchcloseeffectdecision |Closeblocknewquote/twoactivebranchesrules perdecision;do notcancelexistingrental;location CRUDcoords/category/statusvalid/role;no Map API | P1 |
| C12 | Reportmetrics;Codex B | report API/Admin Dashboard | C3,C7;A05 metricapprovaloptional |Define countsbytime/status,earnednotpaymentlabel;data/UI match;deniedfornon Admin;nofake KPI | P1 optional |
| C13 | Validation/integrationhardening;Antigravity | onlyfindingdependencies | C1–12 |No500 forbadinput;unique/race/permissionchecks;boundaries/no PII;fixonlyreproducedbugs | P3 |
| C14 | Allactor E2 E/finalacceptance;Codex A | tests/artifacts/docs | Allmandatorycoretasks |Eachcore UCfullpositive+criticalnegative+DBread/write;no skipped PASS;sourcehash/JARmanifest andindependentfinalrerun;no outstanding P0/P1 | P2 |
| C15 | UXpolish;Codex B | scopedcomponents/pages | C14 |Mobile/error/loading/empty/accessibility;no businessscopechange | P4 |
| AI | Separatephase;noagentnow | Existing AIpages preserved | Corefinalacceptance+providerdecisions | Futuretaskonly;no AIcalls/training/prompts now | P5 deferred |

C11 is2 sequentialtasks,notonebroadprompt;C9 dividebrand/categorythenamenityiftoolloops. Short Codex Bpromptonetaskonly;Antigravitymaxoneapprovedmodulegroup. C2/C3 mayneedfixture Clocktestconfiguration;do notchangeproductionclock/bypassstate tofakehandover. Ifwaitforrentalstartisnecessary,createfuture-nearfixtureaftercorrectquote;nohand-edits user DB. Scopeopenpolicyrequiresuserdecisionbeforedependentimplementation,notpausethewholeindependentbacklog.

Table Read/Write acceptanceforeachtask: query exact User/ID/state/time beforeafter;assertsave/readandnoextra Rows;keep Foreignkey/history;no User DBreset. Basicfrontendexistingmodulechangesdo notrequireframeworkmigration. Codevolumecannotbeestimatedhonestlyfrom UCcount. Clearnewwork:location API/UI,catalogwrite API/UI,vehiclemedia,branchclosestatus/report(optional). Existingrental/user/staffworkmayneed0 applicationcodeif E2 Epasses. Giveactualfiles/LOCin handoffafterreproduction,notmade-up LOCbudget.

## M. Acceptance plan và thứ tự phase

Phase0=report này, implementation chưa bắt đầu. Phase1=C0/P0 reproducedonly. Phase2=backendcoregaps C9/C11 andneededfindingfixes. Phase3=matching UI;Phase4=APIintegration C1–12;Phase5=validation C13;Phase6=full UCTest C14;Phase7=final Codex Aacceptance;Phase8=AIonlyafter0–7 accepted. Trongmỗitask vẫnbackend→UI→integration→test,khôngcấmlàmlátcắtendtoend đểtránhgiao APIchưa UI.

Inspect→Understand→minimal Implement→target Tests→Regression→Review→Report. Handoff AG_HANDOFF/OC_HANDOFF chỉkhi cókếtquả,hashbeforeafter/kểcảuntracked/contract/command-exit/pass-fail-skip/assertion/artifact/services. Codex Achecksourcefinalandrerunkeychecks,backup/hash/officialfindingsrồidọnđúnghandoffsroot. Max2 sameerrorattemptswithnewevidence;10 minnoprogresscheckpoint;testprogressisnotloop. ACCEPTED scoped/NEED FIX/REJECTED;noagentselfreported DONEalone.

Đểchuyển AI:27 UCnon AIcandidate(26 nếu A05đượcduyệthoãn)phảiquyếtđịnhscope rõ;allmandatorycorefullaccepted;no P0/P1;remaining P2/P3 tácđộngcoređóng;policydeferredexplicit,nopretendimplemented;unknownshared DBhistoryisdeployblockerforthattarget,notreasonforlocalmock PASS. Khôngđóng Giaiđoạn5 cũchỉbằngduyệtdecision;phase0–8ởđâylàexecutionplanmới,khôngxóahayđổisốauditgiaiđoạncũ.




## C8 scoped closure — 12/10/2026

C8 accounts/add-only Staff assignment scope is DONE: C8A acceptance retained with163unchangedinputs and C8B completed directly by Codex A at userrequest. Acceptance .runtime/coordination-c8-codexa-complete-20261012-140824/ACCEPTANCE.md;54/54frontendtests,lint/demoAPIbuild,37/37guards,59/59realbrowserHTTPMySQLchecks,147finalsource/buildhashesnodrift,ownedservicesstopped. Staff UI lock401 clearsession/loginredirect/unlockfreshlogin, invalid/RBAC/pending/stale/assignmentreadback proved. Add-onlycontractretained; revocationpolicy stillunapproved. Historical07/10snapshotrows/percentagesabove preserved, not retrospectivelyrecalculated. C8completiondoesnotcloseC9/location/AIMap/otherStage5work; no wholesystemPASS.


## C9 scoped closure — 12/10/2026

C9 A08 đọc/tạo/cập nhật hãng, loại xe, tiện nghi qua Admin API/UI/MySQL DONE scoped. Acceptance .runtime/coordination-c9-codexa-20261012-162636/ACCEPTANCE.md; frontend57/lint/demoAPI, verify110 (9optional skips tách riêng), MySQL11 zero skip, browser54/guards38, backendguards18 và source167/315 no drift. Public catalog additive amenities; rename giữ ID/FK/snapshot. Không triển khai DELETE chưa duyệt hoặc C10 media/amenity link, không nghiệm thu Location/AI/Map/toàn core. Lịch sử và phần trăm audit07/10 giữ nguyên. Codex A trực tiếp thực hiện/kiểm chứng theo người dùng, không tuyên bố review bởi agent độc lập.


## C10A backend checkpoint — 12/10/2026

Amenity links API/backend PASS scoped tại .runtime/coordination-c10a-codexa-complete-20261012-212639/ACCEPTANCE.md. MySQL9zero-skip,verify115/10optional skips,guards18,actual newJARHTTP/source173no-drift. UI C10A chờ Cursor; ảnh C10B chưa triển khai, nên C10 vẫn PARTIAL. Giữ lịch sử audit, không tự cập nhật phần trăm/wholecorePASS.


## C10A end-to-end scoped closure — 12/10/2026

C10A amenity links backend+UI DONE scoped: backend acceptance57be1ee retained173unchangedinputs and UI/homepage proof70tests/38guards/50realbrowserchecks at .runtime/coordination-c10a-ui-codexa-complete-20261012-230616/ACCEPTANCE.md. ActualAdminassign/clear/stale/recover→SQL/publichome/list/detail/RBAC/screenshots closed UI-R01..R03; latecallbackneweditorfalse-success regression fixed. C10B image URL/order/attribution/gallery remains pending, hence wholeC10 stillPARTIAL. Dashboard/C12/AIMap not implemented, historical percentages preserved.

### C10B planning — 13/10/2026 — PLANNED, chưa bàn giao
Kế hoạch docs/ui/c10b-plan.md: B1 API ảnh/order/attribution và MySQL; B2 gallery/card/Admin editor desktop; B3 mục tiêu24ảnh thật17–30 có nguồn/license/mapping/nhãnminhhọa. Giữ C10A PASS scoped, đối chiếu280backend/frontendsource0drift trong .runtime/coordination-c10b-plan-20261013/dependency-hashes.json. Urban nềnxámấm là mốcthịgiác, không tựtriểnkhai trọnredesign hoặcfont/provider. Mobile không làgatebắtbuộc theo user. Chưa tạo TASK/prompt/chạyagent/ghiDBgốc/downloadảnh; license và cáccontractđềxuất chốt trước triểnkhai. Không kếtluậnC10B/C10DONE.

### C10B-B1 backend handoff prepared — 13/10/2026
TASK .runtime/coordination-c10b-backend-opencode-20261013-082058/TASK.md sẵn sàng cho người dùng chuyển OpenCode. Scope backend media add/edit/reorder/public typedread, MySQL validation/RBAC/race/rollback/bulk/provenance và regression C10A/C9; khôngfrontend/browser/licenseảnh. Contract và gate cụthể trong TASK. Không tự gửi/chạyagent; chưaimplement/nghiệmthuC10B.

### C10B-B1 OpenCode review — 13/10/2026 — PARTIAL / FAIL
ACCEPTANCE .runtime/coordination-c10b-backend-review-20261013-093030/ACCEPTANCE.md: noHANDOFF/evidence/implementationcommit; productioncompilepass, testCompile4errors exit1; guardparse4diagnostics, actualrunner exit1 missingmanifest beforemutation. Findings B1-R01–R10: immutablebulkcast, nullURLreorder/uniqueoverflow,POST201,canonicalJSON,rollbackwrongspy,allowedURLwrongassertion,guardunsafe/causeproof,manifestmissing,URLtrailingfilename. MySQL/JAR/cleanup/relevantregressionsNOTVERIFIED onchangedsource. Reviewer didnotedit/commitagentfiles orstartDockerfixture; C10B remainspending.

### C10B-B1 OpenCode follow-up prepared — 13/10/2026
TASK .runtime/coordination-c10b-backend-opencode-followup-20261013-093435/TASK.md: backend-only sửa B1-R01–R10 theo ACCEPTANCE review093030, smallcompile/business/guardfix trướcMySQL/JARheavyproof; contractgốc giữ, HANDOFF/evidencefoldermới. Chưaagentexecution hoặcPASS. Preexistingworkflow/source giữ nguyên.

### C10B-B1 follow-up review and Antigravity remaining handoff — 13/10/2026 — PARTIAL
Review .runtime/coordination-c10b-backend-review2-20261013-095741/ACCEPTANCE.md: compile/PSparsepass, observed sourcefixes retained; noHANDOFF/manifest/commit/proof. SmallHTTPtest runtime stalledMockito, cancelledexecs, ownedPIDgone; no businessPASS/MySQL/JAR. R2-01–R2-06 remain, usertransferred backend-onlyremaining to .runtime/coordination-c10b-backend-antigravity-20261013-095859/TASK.md. Noagentautolaunch/frontend/DBgốcchanges.

### C10B backend Codex A takeover preparation — 13/10/2026 — PARTIAL/FAIL
UserreportsAntigravitystoppedtoken;8C10Bfilehashunchangedreview2,noHANDOFF/checkpoint/evidence. Plan/review .runtime/coordination-c10b-codexa-takeover-20261013-101157/. Surefiredumpactualerror5JavaAttachpipe; rerunoutside sandbox completes42.644s with11tests2PASS5FAIL2ERROR2SKIP,exit1/XMLpreserved. Remainingactualissues nullableMap.of, per-methodfixture/columnreadback, URLtrailingfilename, exactrollbackafterrealmutation andmanifest/guards/MySQL/JAR. Prep only,no sourcefix/DBgócwrite/agentdelegation; relevantoldPASSretained, noC10BDONE.


### C10B backend direct completion — 13/10/2026 — PASS scoped, Codex A

Antigravity stopped; Codex A adopted unchanged partial OpenCode source, fixed fixture/null payload/URL escaped traversal and trailing filename, real insert/order rollback, canonical typed JSON revision, order-range collision/overflow and public bulk/old PUT/snapshot proof. Backend source final verify127total115executed12optionalSKIP0failure/error; actualMySQL images12+amenities5+catalog4=21executed0SKIP; guard18/18, actualsource-boundJAR create201/edit/reorder/publiclist/detail/SQLcredit,171buildinputs102class/resourcesmatch and executionfreeze0drift. Schema26tables37FK,V1/V2checksumsretained, caller/ownedcleanupPASS, originalMySQLidentityunchanged. Reports/evidence .runtime/coordination-c10b-backend-codexa-complete-20261013-101802/. BackendDONEonly; frontend/gallery/17–30licensedphotos remainC10Bpending. No migration/frontend/provider/userDBwrite/push/prune; oldreports/evidence retained and preexistingworkflowchangeexcluded.

### C10B UI và ảnh trực tiếp hoàn tất — 13/10/2026 — DONE scoped, Codex A

Urban xám ấm cho homepage/list/detail/my-bookings; API card/gallery và Admin image add/edit/reorder, pending/400/409/reload/late-response. Frontend77/77 zero skip, lint/demo/API build, importer3/3, guards38/38 và55browser assertions trên backend/MySQL thật, desktop1280/1440/1920. Backend C10B source/JAR unchanged retained21actualMySQL; không triển khai lại.17ảnhCC có hồ sơ trang nguồn/tác giả/license/uniquehash, total4,311,268bytes; publiccredits. Người dùng duyệt đúngv1/v2/v3; import transaction rồi SQL exactreadback,25non-media tablechecksumsunchanged vàrerunNOOP. Cácfixture/nghiệp vụ test cô lập; ownedbackend/frontend/fixturestopped; originalMySQLkept. Reports .runtime/coordination-c10b-ui-codexa-20261013/, canonical docs/ui/c10b-ui-acceptance.md. Codex A tự triển khai và kiểm chứng bằng readback/assertions độc lập, không claim reviewer agentkhác. C10 image/amenity scopeDONE; AI/Map/dashboard/otherauditremain, khôngwhole-systemPASS hoặcpush.
