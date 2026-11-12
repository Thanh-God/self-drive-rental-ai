"""Sequential core suites, one owned MySQL fixture, one fresh marked schema per suite."""
import argparse, hashlib, json, os, shutil, socket, subprocess, sys, time, uuid
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

REPO = Path(__file__).resolve().parents[3]
FLAGS = subprocess.CREATE_NO_WINDOW
REGISTRY = REPO/'.runtime/docker-fixtures/mysql-core.json'

def fixture_source(reuse=None, new_reason=None, registry=REGISTRY):
    """Reuse is the default. Never silently fall back to docker run."""
    assert not (reuse and new_reason), 'Choose reuse or explicit new fixture, not both'
    if new_reason is not None:
        assert len(new_reason.strip()) >= 12, 'New fixture needs a specific approved reason (12+ characters)'
        return None, None
    if reuse:
        previous=Path(reuse).resolve();assert previous.is_relative_to(REPO/'.runtime'), 'Runtime fixture evidence required'
        return previous, None
    registry=Path(registry).resolve()
    assert registry.is_relative_to(REPO/'.runtime') and registry.is_file(), 'No registered fixture: register a verified pool or use --reuse-evidence; creation is not automatic'
    entry=json.loads(registry.read_text(encoding='utf-8-sig'))
    previous=(REPO/entry['evidence']).resolve()
    assert previous.is_relative_to(REPO/'.runtime'), 'Runtime fixture evidence required'
    fixture=json.loads((previous/'fixture.json').read_text())
    assert all(entry[k]==fixture[k] for k in ['id','name','volume','port']), 'Registry/evidence identity mismatch'
    assert entry.get('imageId','').startswith('sha256:'), 'Pinned registry image required'
    return previous, entry

def validate_reuse(fixture, inspection, pinned=None):
    assert fixture['name'].startswith('kltn-c14-core-') and fixture['port']==33676, 'Only isolated core fixture allowed'
    assert inspection['Id']==fixture['id'] and inspection['Name'].lstrip('/')==fixture['name'], 'Fixture identity drift'
    assert inspection['State']['Status']=='exited', 'Reusable fixture must be stopped, not paused/running'
    assert inspection['Config']['Image']=='mysql:8.4', 'MySQL fixture image drift'
    assert inspection['HostConfig']['PortBindings']=={'3306/tcp':[{'HostIp':'127.0.0.1','HostPort':'33676'}]}, 'Fixture port drift'
    mounts=inspection['Mounts']
    assert len(mounts)==1 and mounts[0]['Type']=='volume' and mounts[0]['Name']==fixture['volume'] and mounts[0]['Destination']=='/var/lib/mysql', 'Fixture mount drift'
    if pinned:assert inspection['Image']==pinned['imageId'], 'Pinned fixture image drift'
SUITES = ['ScheduleProtectionHttpTest','ScheduleWarningHttpTest','VehicleSearchTest','ConcurrencyAndRaceTest','BranchClosureBookingTest','BranchStatusHttpServerTest',
          'OperationalReportIntegrationTest','OperationalReportMySqlTest','RentalIntegrationTest',
          'CancelBoundaryTest','MySqlMigrationTest','LocationCategoryIntegrationTest','LocationIntegrationTest',
          'VehicleCatalogHttpServerTest','VehicleAmenityHttpServerTest','VehicleImageHttpServerTest',
          'AccountAssignmentHttpServerTest','IncidentReportIntegrationTest','IncidentReportHttpServerTest',
          'ReviewIntegrationTest','ReviewHttpIntegrationTest','BackendRegressionTest','VehicleAdminHttpServerTest',
          'LicensePhotoHttpTest','ReturnPolicyHttpTest','ReturnReceiptHttpTest','ReturnSettlementHttpTest','DepositHttpTest','QrDemoHttpTest','RecommendationHttpTest','LocationRouteHttpServerTest','ItineraryStorageIntegrationTest','LocationPilotImporterMySqlTest',
          'AssistantReviewQuoteFlowHttpTest','AssistantReviewQuoteLiveIT','ItineraryLivePreviewIT',
          'AiChatHttpTest','AiChatSearchHttpTest','AiChatMinimalSearchHttpTest','AiChatLiveIT',
          'NoShowWithoutDepositHttpTest','RentalBalanceHttpTest','RentalBalanceDepositHttpTest','HandoverReadingsHttpTest','BusinessCancellationHttpTest','ContractContentHttpTest','ContractAcceptanceHttpTest','ContractAcceptanceRaceTest','ContractRentalBalanceFlowHttpTest','RentalBalanceRefundHttpTest']

# Live local-Qwen suites never run by default and need an explicit caller opt-in.
LIVE_QWEN_SUITES = ['AssistantReviewQuoteLiveIT','AiChatLiveIT']

# Live itinerary preview on the registered OSRM graph: never default, explicit routing mode, Qwen opt-in online.
ITINERARY_LIVE_SUITE = 'ItineraryLivePreviewIT'
ITINERARY_LIVE_METHODS = {
    'online': ['onlineRealQwenAndOsrm_PreviewMatchesDirectOsrmLegs', 'onlineForcedSearch_MatchesOracleOnRealGraphWithinBudget'],
    'offline': ['offlineOsrmStopped_PreviewIsUnavailableNotInfeasible'],
}
ROUTING_SUITES = ('LocationRouteHttpServerTest', ITINERARY_LIVE_SUITE)
ITINERARY_QWEN_METHOD = 'onlineRealQwenAndOsrm_PreviewMatchesDirectOsrmLegs'
ITINERARY_SCOPES = ('all', 'no-qwen', 'qwen')

def itinerary_methods(routing_mode, scope='all'):
    """Methods for one run. 'no-qwen' leaves out the live Qwen case; 'qwen' runs only that case."""
    assert scope in ITINERARY_SCOPES, 'Unknown itinerary scope'
    methods = ITINERARY_LIVE_METHODS[routing_mode]
    if scope == 'no-qwen':
        return [m for m in methods if m != ITINERARY_QWEN_METHOD]
    if scope == 'qwen':
        return [m for m in methods if m == ITINERARY_QWEN_METHOD]
    return list(methods)

def require_itinerary_live(selected, routing_mode, environ, scope='all'):
    if ITINERARY_LIVE_SUITE not in selected:
        return
    assert routing_mode in ITINERARY_LIVE_METHODS, 'Itinerary live suite requires explicit --routing-mode'
    methods = itinerary_methods(routing_mode, scope)
    assert methods, 'Itinerary scope selects no method for this routing mode'
    if ITINERARY_QWEN_METHOD in methods:
        assert environ.get('KDRIVE_AI_LIVE_ITINERARY')=='true', 'Online itinerary live suite requires explicit KDRIVE_AI_LIVE_ITINERARY=true'

def select_suites(requested, environ):
    selected=list(requested) if requested else [s for s in SUITES if s not in LIVE_QWEN_SUITES and s != ITINERARY_LIVE_SUITE]
    if any(s in LIVE_QWEN_SUITES for s in selected):
        assert environ.get('KDRIVE_AI_LIVE_FLOW')=='true', 'Live Qwen suite requires explicit KDRIVE_AI_LIVE_FLOW=true'
    return selected

PILOT_IMPORTER_SUITE = 'LocationPilotImporterMySqlTest'
PILOT_INPUT_NAMES = ['import_locations_pilot.py', 'locations-pilot.json']

def validate_pilot_inputs(backend_root, suites):
    if PILOT_IMPORTER_SUITE not in suites:
        return {}
    # The Java test resolves these files from user.dir/../scripts/ai.
    copied_dir=Path(backend_root).resolve().parent/'scripts'/'ai'
    pinned={}
    for name in PILOT_INPUT_NAMES:
        source=REPO/'scripts/ai'/name
        copied=copied_dir/name
        assert copied.is_file(), f'Missing staged pilot input: {copied}'
        source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
        copied_hash=hashlib.sha256(copied.read_bytes()).hexdigest()
        assert copied_hash==source_hash, f'Pilot input hash mismatch at execution path: {copied}'
        pinned[source.relative_to(REPO).as_posix()]=source_hash
        pinned[copied.relative_to(REPO).as_posix()]=copied_hash
    return pinned

DEFAULT_SOURCE = REPO/'backend'

MIGRATION_SUITE_MIN = 10

def declared_tests(build, suite):
    """Number of @Test methods declared in the copied backend's suite source (the XML must run all of them)."""
    source=build/f'src/test/java/com/carrental/{suite}.java'
    assert source.is_file(), f'Suite source missing in backend copy: {suite}'
    return sum(1 for line in source.read_text(encoding='utf-8').splitlines() if line.lstrip().startswith('@Test'))

def assert_migration_suite_complete(build, counts):
    """Every declared migration test ran (no partial selection), and never fewer than the historical baseline."""
    expected=declared_tests(build,'MySqlMigrationTest')
    assert expected>=MIGRATION_SUITE_MIN, f'MySqlMigrationTest declares only {expected} tests'
    assert counts[0]==expected, f'MySqlMigrationTest ran {counts[0]} of {expected} declared tests'

def resolve_source_root(source_root=None):
    """Backend checkout whose src the isolated copy must match; default is this repository's backend."""
    source=Path(source_root).resolve() if source_root else DEFAULT_SOURCE
    assert not source.is_relative_to(REPO/'.runtime'), 'Source root must be a checkout, not a runtime copy'
    assert (source/'src/main').is_dir() and (source/'pom.xml').is_file(), 'Backend source root required'
    return source

def verify_source_copy(source, build):
    """Byte-equal copy in both directions: every source file present and identical, no extra copied file."""
    files=[p for p in (source/'src').rglob('*') if p.is_file()]
    for p in files:assert p.read_bytes()==(build/p.relative_to(source)).read_bytes(),p
    copied=[p for p in (build/'src').rglob('*') if p.is_file()]
    assert len(copied)==len(files),'Backend copy has source files absent from the source root'

def source_key(p, source):
    if p.is_relative_to(REPO):return p.relative_to(REPO).as_posix()
    return 'source-root:'+p.relative_to(source).as_posix()

def inputs(backend_root=None, suites=(), source=None):
    source=source or DEFAULT_SOURCE
    files = list((source/'src').rglob('*')) + list((source/'.mvn').rglob('*'))
    files += [source/n for n in ['pom.xml','mvnw','mvnw.cmd']]
    files += [REPO/'scripts/ai'/n for n in ['import_locations_pilot.py','locations-pilot.json']]
    files.append(Path(__file__))
    if backend_root is not None and PILOT_IMPORTER_SUITE in suites:
        staged_dir=Path(backend_root).resolve().parent/'scripts'/'ai'
        files += [staged_dir/name for name in PILOT_INPUT_NAMES]
    return {source_key(p,source):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}

def assert_inputs_unchanged(expected, backend_root, suites, source=None):
    assert expected==inputs(backend_root,suites,source), 'Source or staged pilot input drift'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--backend-root',required=True)
    parser.add_argument('--evidence',required=True);parser.add_argument('--reuse-evidence')
    parser.add_argument('--fixture-registry',default=str(REGISTRY))
    parser.add_argument('--new-fixture-reason',help='Exceptional new container only; requires a specific approved reason')
    parser.add_argument('--suites',nargs='+',choices=SUITES)
    parser.add_argument('--routing-mode',choices=['online','offline'])
    parser.add_argument('--itinerary-scope',choices=list(ITINERARY_SCOPES),default='all')
    parser.add_argument('--source-root',help='Backend checkout the isolated copy must match (default: this repository backend)')
    args=parser.parse_args();build=Path(args.backend_root).resolve();out=Path(args.evidence).resolve()
    assert out.is_relative_to(REPO/'.runtime') and not out.exists(),'New runtime evidence required'
    assert build.is_relative_to(REPO/'.runtime'),'Isolated source copy required'
    source=resolve_source_root(args.source_root)
    selected_suites=select_suites(args.suites,os.environ)
    require_itinerary_live(selected_suites,args.routing_mode,os.environ,args.itinerary_scope)
    pilot_inputs=validate_pilot_inputs(build,selected_suites)
    previous,pinned=fixture_source(args.reuse_evidence,args.new_fixture_reason,args.fixture_registry)
    if any(s in ROUTING_SUITES for s in selected_suites):
        assert args.routing_mode, 'Routing suite requires explicit --routing-mode'
        with socket.socket() as probe:
            online = probe.connect_ex(('127.0.0.1',5000)) == 0
        assert online == (args.routing_mode == 'online'), 'Routing provider state does not match requested mode'
    assert out.is_relative_to(REPO/'.runtime') and not out.exists(),'New runtime evidence required'
    assert build.is_relative_to(REPO/'.runtime'),'Isolated source copy required'
    verify_source_copy(source,build)
    jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar';assert jar.is_file(),'Verify before native proof'
    historical=out.parent/'historical-migration';assert len(list(historical.glob('V*.sql')))==2
    if 'MySqlMigrationTest' in (args.suites or SUITES):
        assert hashlib.sha256((historical/'V2__incident_audit_and_review_vehicle.sql').read_bytes()).hexdigest() == '7444cb4dadb9499d1ef9c8433e3f7e969f48d00e785578021201816553fa66ce', 'Historical V2 snapshot mismatch; do not substitute current migration'
    with socket.socket() as sock:sock.bind(('127.0.0.1',33676))
    env=os.environ.copy()
    for key in list(env):
        if key.startswith(('KDRIVE_TEST_','KDRIVE_MIGRATION_','SPRING_')):env.pop(key)
    env['JAVA_HOME']='E:/Tools/Java/jdk-21.0.12.1+1'
    if 'LocationPilotImporterMySqlTest' in selected_suites:env['KDRIVE_PILOT_PYTHON']=sys.executable
    env.pop('KDRIVE_ROUTING_MODE',None)
    if args.routing_mode:env['KDRIVE_ROUTING_MODE']=args.routing_mode
    def run(command,cwd=REPO,log=None,check=True):
        result=subprocess.run(command,cwd=cwd,env=env,capture_output=True,creationflags=FLAGS,timeout=600)
        if log:
            (out/log).write_bytes(result.stdout+result.stderr);(out/(log+'.exit')).write_text(str(result.returncode))
        if check and result.returncode:raise RuntimeError('Native failure; see '+str(log or 'private execution'))
        return result
    name='kltn-c14-core-'+uuid.uuid4().hex[:12];volume='vol-'+name
    password,token=uuid.uuid4().hex,uuid.uuid4().hex;identity=None;owned=False;final=None
    if previous:
        f=json.loads((previous/'fixture.json').read_text())
        assert f['name'].startswith('kltn-c14-core-') and f['port']==33676
        name,volume,identity=f['name'],f['volume'],f['id']
        password=next(l.split('=',1)[1] for l in (previous/'mysql.private.env').read_text().splitlines() if l.startswith('MYSQL_ROOT_PASSWORD='))
        token=(previous/'marker.private.token').read_text().strip()
        inspection=json.loads(run(['docker','inspect',name]).stdout)[0]
        validate_reuse(f,inspection,pinned)
    else:
        assert name not in run(['docker','ps','-a','--format','{{.Names}}']).stdout.decode().splitlines()
        assert volume not in run(['docker','volume','ls','--format','{{.Name}}']).stdout.decode().splitlines()
    before=inputs(build,selected_suites,source)
    assert all(before.get(path)==value for path,value in pilot_inputs.items()), 'Pilot inputs drifted before native execution'
    out.mkdir(parents=True)
    (out/'inputs-before.json').write_text(json.dumps(before,indent=2))
    head=run(['git','-C',str(source),'rev-parse','HEAD'],check=False)
    status=run(['git','-C',str(source),'status','--porcelain','--','.'],check=False)
    provenance={'sourceRoot':str(source),'default':source==DEFAULT_SOURCE,
                'gitHead':head.stdout.decode().strip() if head.returncode==0 else None,
                'gitClean':status.returncode==0 and not status.stdout.strip()}
    (out/'source.json').write_text(json.dumps(provenance,indent=2))
    private=out/'mysql.private.env';private.write_text('MYSQL_ROOT_PASSWORD='+password+'\nMYSQL_DATABASE=kdrive_c14_core\n')
    (out/'marker.private.token').write_text(token)
    marker='kdrive_c14_meta'
    def sql(query,check=True):
        return run(['docker','exec','-e','MYSQL_PWD='+password,name,'mysql','-uroot','--batch','--raw','-N','-e',query],check=check)
    try:
        if previous:run(['docker','start',name])
        else:identity=run(['docker','run','-d','--name',name,'-p','127.0.0.1:33676:3306','--env-file',str(private),'-v',volume+':/var/lib/mysql','mysql:8.4']).stdout.decode().strip()
        owned=True
        fixture={'name':name,'id':identity,'volume':volume,'port':33676,'schema':'kdrive_c14_core','policy':'KEEP reusable stopped','reuseEvidence':str(previous) if previous else None,'newFixtureReason':args.new_fixture_reason}
        (out/'fixture.json').write_text(json.dumps(fixture,indent=2))
        deadline=time.monotonic()+90;ready=0
        while time.monotonic()<deadline:
            p=sql('SELECT 1',False);ready=ready+1 if p.returncode==0 and p.stdout.strip()==b'1' else 0
            if ready>=2:break
            time.sleep(1)
        else:raise RuntimeError('MySQL readiness deadline')
        assert len(token)==32 and all(c in '0123456789abcdef' for c in token), 'Invalid private marker token'
        if previous:
            count=sql(f"SELECT COUNT(*) FROM {marker}.__kdrive_test_fixture_marker WHERE marker_token='{token}'").stdout.decode().strip()
            assert count.isdecimal() and int(count)>0, 'Existing fixture marker mismatch; do not create or repair markers'
        else:sql(f'CREATE DATABASE IF NOT EXISTS {marker}; CREATE TABLE IF NOT EXISTS {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255));')
        reports=[]
        for suite in selected_suites:
            schema='kdrive_c14_'+uuid.uuid4().hex[:12]
            sql(f"CREATE DATABASE {schema}; INSERT INTO {marker}.__kdrive_test_fixture_marker VALUES((SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM {marker}.__kdrive_test_fixture_marker) t),'{schema}','{token}');")
            env.update(KDRIVE_TEST_DB_URL=f'jdbc:mysql://127.0.0.1:33676/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC',
                       KDRIVE_TEST_DB_USER='root',KDRIVE_TEST_DB_PASSWORD=password,KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX='kdrive_c14_',
                       KDRIVE_TEST_FIXTURE_MARKER_TOKEN=token,KDRIVE_TEST_EXPECTED_HOST='127.0.0.1',KDRIVE_TEST_EXPECTED_PORT='33676',
                       KDRIVE_TEST_EXPECTED_SCHEMA=schema,KDRIVE_TEST_MARKER_SCHEMA=marker)
            for key in list(env):
                if key.startswith('KDRIVE_MIGRATION_'):env.pop(key)
            if suite=='MySqlMigrationTest':
                env.update(KDRIVE_MIGRATION_MYSQL_URL='jdbc:mysql://127.0.0.1:33676/mysql?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC',
                           KDRIVE_MIGRATION_MYSQL_USER='root',KDRIVE_MIGRATION_MYSQL_PASSWORD=password,
                           KDRIVE_HISTORICAL_MIGRATION_DIR=str(historical),KDRIVE_MIGRATION_ARTIFACT_DIR=str(out))
            selector=suite
            if suite=='LocationRouteHttpServerTest':
                method=('onlineRoutePreview_RequiresLiveOsrm_MustBeVerified_BothDirectionsAndMultiPoint'
                        if args.routing_mode=='online' else 'offlineRoutePreview_WhenOsrmStopped_ReturnsUnavailableWithNoInventedEstimates')
                selector+='#httpPermissionsAndInputNegativesWithPerRequestDatabaseInvariance+snapshotDetectsUpdatesWithoutRowCountChanges+'+method
            if suite==ITINERARY_LIVE_SUITE:
                selector+='#'+'+'.join(itinerary_methods(args.routing_mode,args.itinerary_scope))
            run([str(build/'mvnw.cmd'),'-o','-B','-ntp',f'-Dmaven.repo.local={REPO/".runtime/m2"}','-Dtest='+selector,'test'],build,suite+'.log')
            xml=build/f'target/surefire-reports/TEST-com.carrental.{suite}.xml';report=ET.parse(xml).getroot()
            counts=[int(report.get(k,'0')) for k in ['tests','failures','errors','skipped']]
            assert counts[0]>0 and counts[1:]==[0,0,0],(suite,counts)
            if suite=='ConcurrencyAndRaceTest':assert counts[0]==8
            if suite==ITINERARY_LIVE_SUITE:assert counts[0]==len(itinerary_methods(args.routing_mode,args.itinerary_scope))
            if suite=='MySqlMigrationTest':assert_migration_suite_complete(build,counts)
            shutil.copy2(xml,out/xml.name)
            reports.append({'suite':suite,'counts':counts,'schema':schema,'routingMode':args.routing_mode if suite in ROUTING_SUITES else None,'methods':[c.get('name') for c in report.findall('testcase')]})
            (out/'progress.json').write_text(json.dumps(reports,indent=2));print(suite+': PASS '+str(counts[0]),flush=True)
        matched=[]
        with zipfile.ZipFile(jar) as z:
            for entry in z.namelist():
                if entry.startswith('BOOT-INF/classes/') and not entry.endswith('/'):
                    rel=entry.removeprefix('BOOT-INF/classes/');assert z.read(entry)==(build/'target/classes'/rel).read_bytes(),rel;matched.append(rel)
        assert_inputs_unchanged(before,build,selected_suites,source)
        (out/'jar-provenance.json').write_text(json.dumps({'jarSHA256':hashlib.sha256(jar.read_bytes()).hexdigest(),'matchedEntries':matched},indent=2))
        final={'status':'PASS C14 native scoped','tests':sum(r['counts'][0] for r in reports),'skips':0,'suites':reports,'source':provenance}
    finally:
        if owned:
            assert run(['docker','inspect','--format','{{.Id}}',name]).stdout.decode().strip()==identity
            run(['docker','stop',name]);assert run(['docker','inspect','--format','{{.State.Running}}',name]).stdout.decode().strip()=='false'
            (out/'cleanup.json').write_text(json.dumps({'fixtureStopped':True,'volume':'KEEP','id':identity}))
    if final is not None:(out/'result.json').write_text(json.dumps(final,indent=2))

if __name__=='__main__':main()
