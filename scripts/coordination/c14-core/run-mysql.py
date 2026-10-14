"""Sequential core suites, one owned MySQL fixture, one fresh marked schema per suite."""
import argparse, hashlib, json, os, shutil, socket, subprocess, time, uuid
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

REPO = Path(__file__).resolve().parents[3]
FLAGS = subprocess.CREATE_NO_WINDOW
SUITES = ['VehicleSearchTest','ConcurrencyAndRaceTest','BranchClosureBookingTest','BranchStatusHttpServerTest',
          'OperationalReportIntegrationTest','OperationalReportMySqlTest','RentalIntegrationTest',
          'CancelBoundaryTest','MySqlMigrationTest','LocationCategoryIntegrationTest','LocationIntegrationTest',
          'VehicleCatalogHttpServerTest','VehicleAmenityHttpServerTest','VehicleImageHttpServerTest',
          'AccountAssignmentHttpServerTest','IncidentReportIntegrationTest','IncidentReportHttpServerTest',
          'ReviewIntegrationTest','ReviewHttpIntegrationTest','BackendRegressionTest']

def inputs():
    files = list((REPO/'backend/src').rglob('*')) + list((REPO/'backend/.mvn').rglob('*'))
    files += [REPO/'backend'/n for n in ['pom.xml','mvnw','mvnw.cmd']]
    files.append(Path(__file__))
    return {p.relative_to(REPO).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--backend-root',required=True)
    parser.add_argument('--evidence',required=True);parser.add_argument('--reuse-evidence')
    parser.add_argument('--suites',nargs='+',choices=SUITES)
    args=parser.parse_args();build=Path(args.backend_root).resolve();out=Path(args.evidence).resolve()
    assert out.is_relative_to(REPO/'.runtime') and not out.exists(),'New runtime evidence required'
    assert build.is_relative_to(REPO/'.runtime'),'Isolated source copy required'
    for p in (REPO/'backend/src').rglob('*'):
        if p.is_file():assert p.read_bytes()==(build/p.relative_to(REPO/'backend')).read_bytes(),p
    jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar';assert jar.is_file(),'Verify before native proof'
    historical=out.parent/'historical-migration';assert len(list(historical.glob('V*.sql')))==2
    with socket.socket() as sock:sock.bind(('127.0.0.1',33676))
    env=os.environ.copy()
    for key in list(env):
        if key.startswith(('KDRIVE_TEST_','KDRIVE_MIGRATION_','SPRING_')):env.pop(key)
    env['JAVA_HOME']='E:/Tools/Java/jdk-21.0.12.1+1'
    def run(command,cwd=REPO,log=None,check=True):
        result=subprocess.run(command,cwd=cwd,env=env,capture_output=True,creationflags=FLAGS,timeout=600)
        if log:
            (out/log).write_bytes(result.stdout+result.stderr);(out/(log+'.exit')).write_text(str(result.returncode))
        if check and result.returncode:raise RuntimeError('Native failure; see '+str(log or 'private execution'))
        return result
    name='kltn-c14-core-'+uuid.uuid4().hex[:12];volume='vol-'+name
    password,token=uuid.uuid4().hex,uuid.uuid4().hex;identity=None;owned=False;final=None
    if args.reuse_evidence:
        previous=Path(args.reuse_evidence).resolve();assert previous.is_relative_to(REPO/'.runtime')
        f=json.loads((previous/'fixture.json').read_text())
        assert f['name'].startswith('kltn-c14-core-') and f['port']==33676
        name,volume,identity=f['name'],f['volume'],f['id']
        password=next(l.split('=',1)[1] for l in (previous/'mysql.private.env').read_text().splitlines() if l.startswith('MYSQL_ROOT_PASSWORD='))
        token=(previous/'marker.private.token').read_text().strip()
        inspection=json.loads(run(['docker','inspect',name]).stdout)[0]
        assert inspection['Id']==identity and not inspection['State']['Running']
        assert [m['Name'] for m in inspection['Mounts'] if m['Destination']=='/var/lib/mysql']==[volume]
    else:
        assert name not in run(['docker','ps','-a','--format','{{.Names}}']).stdout.decode().splitlines()
        assert volume not in run(['docker','volume','ls','--format','{{.Name}}']).stdout.decode().splitlines()
    before=inputs();out.mkdir(parents=True)
    (out/'inputs-before.json').write_text(json.dumps(before,indent=2))
    private=out/'mysql.private.env';private.write_text('MYSQL_ROOT_PASSWORD='+password+'\nMYSQL_DATABASE=kdrive_c14_core\n')
    (out/'marker.private.token').write_text(token)
    marker='kdrive_c14_meta'
    def sql(query,check=True):
        return run(['docker','exec','-e','MYSQL_PWD='+password,name,'mysql','-uroot','--batch','--raw','-N','-e',query],check=check)
    try:
        if args.reuse_evidence:run(['docker','start',name])
        else:identity=run(['docker','run','-d','--name',name,'-p','127.0.0.1:33676:3306','--env-file',str(private),'-v',volume+':/var/lib/mysql','mysql:8.4']).stdout.decode().strip()
        owned=True
        fixture={'name':name,'id':identity,'volume':volume,'port':33676,'schema':'kdrive_c14_core','policy':'KEEP stopped'}
        (out/'fixture.json').write_text(json.dumps(fixture,indent=2))
        deadline=time.monotonic()+90;ready=0
        while time.monotonic()<deadline:
            p=sql('SELECT 1',False);ready=ready+1 if p.returncode==0 and p.stdout.strip()==b'1' else 0
            if ready>=2:break
            time.sleep(1)
        else:raise RuntimeError('MySQL readiness deadline')
        sql(f'CREATE DATABASE IF NOT EXISTS {marker}; CREATE TABLE IF NOT EXISTS {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255));')
        reports=[]
        for suite in args.suites or SUITES:
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
            run([str(build/'mvnw.cmd'),'-o','-B','-ntp',f'-Dmaven.repo.local={REPO/".runtime/m2"}','-Dtest='+suite,'test'],build,suite+'.log')
            xml=build/f'target/surefire-reports/TEST-com.carrental.{suite}.xml';report=ET.parse(xml).getroot()
            counts=[int(report.get(k,'0')) for k in ['tests','failures','errors','skipped']]
            assert counts[0]>0 and counts[1:]==[0,0,0],(suite,counts)
            if suite=='ConcurrencyAndRaceTest':assert counts[0]==8
            if suite=='MySqlMigrationTest':assert counts[0]==2
            shutil.copy2(xml,out/xml.name)
            reports.append({'suite':suite,'counts':counts,'schema':schema,'methods':[c.get('name') for c in report.findall('testcase')]})
            (out/'progress.json').write_text(json.dumps(reports,indent=2));print(suite+': PASS '+str(counts[0]),flush=True)
        matched=[]
        with zipfile.ZipFile(jar) as z:
            for entry in z.namelist():
                if entry.startswith('BOOT-INF/classes/') and not entry.endswith('/'):
                    rel=entry.removeprefix('BOOT-INF/classes/');assert z.read(entry)==(build/'target/classes'/rel).read_bytes(),rel;matched.append(rel)
        assert before==inputs(),'Source drift'
        (out/'jar-provenance.json').write_text(json.dumps({'jarSHA256':hashlib.sha256(jar.read_bytes()).hexdigest(),'matchedEntries':matched},indent=2))
        final={'status':'PASS C14 native scoped','tests':sum(r['counts'][0] for r in reports),'skips':0,'suites':reports}
    finally:
        if owned:
            assert run(['docker','inspect','--format','{{.Id}}',name]).stdout.decode().strip()==identity
            run(['docker','stop',name]);assert run(['docker','inspect','--format','{{.State.Running}}',name]).stdout.decode().strip()=='false'
            (out/'cleanup.json').write_text(json.dumps({'fixtureStopped':True,'volume':'KEEP','id':identity}))
    if final is not None:(out/'result.json').write_text(json.dumps(final,indent=2))

if __name__=='__main__':main()
