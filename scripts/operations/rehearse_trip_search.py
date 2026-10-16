"""Real browser proof on a stopped, owned native-test fixture; never the original DB."""
import argparse, hashlib, json, os, socket, subprocess, time, uuid, zipfile
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

REPO = Path(__file__).resolve().parents[2]
FLAGS = subprocess.CREATE_NO_WINDOW

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-evidence',required=True,type=Path)
    parser.add_argument('--backend-root',required=True,type=Path)
    parser.add_argument('--evidence',required=True,type=Path)
    parser.add_argument('--browser-script',choices=['verify-oto2-browser.cjs','verify-vehicle-search-form.cjs','verify-vehicle-compare.cjs','verify-vehicle-favorites.cjs','verify-rental-guide.cjs','verify-ui-readability.cjs'],default='verify-vehicle-search-form.cjs')
    parser.add_argument('--expected-bookings',type=int,choices=[0,1],default=0)
    args=parser.parse_args()
    native,backend,out=[p.resolve() for p in (args.native_evidence,args.backend_root,args.evidence)]
    if not all(p.is_relative_to(REPO/'.runtime') for p in (native,backend,out)) or out.exists(): raise ValueError('New runtime output required')
    fixture=json.loads((native/'fixture.json').read_text())
    if not fixture['name'].startswith('kltn-c14-core-') or fixture['port']!=33676 or fixture['volume']!='vol-'+fixture['name']: raise ValueError('Not an owned isolated fixture')
    password=next(line.split('=',1)[1] for line in (native/'mysql.private.env').read_text().splitlines() if line.startswith('MYSQL_ROOT_PASSWORD='))
    env=os.environ.copy()
    for key in list(env):
        if key.startswith(('DB_','SPRING_','SEED_','KDRIVE_TEST_')):env.pop(key)
    env.update(VITE_DATA_MODE='api',VITE_API_BASE_URL='/api/v1',VITE_PROXY_TARGET='http://127.0.0.1:8382')
    def run(command,**kwargs):return subprocess.run(command,cwd=REPO,env=env,capture_output=True,creationflags=FLAGS,timeout=180,check=True,**kwargs)
    inspection=json.loads(run(['docker','inspect',fixture['name']]).stdout)[0]
    if inspection['Id']!=fixture['id'] or inspection['State']['Running'] or [m['Name'] for m in inspection['Mounts'] if m['Destination']=='/var/lib/mysql']!=[fixture['volume']]:raise ValueError('Fixture identity/state drift')
    for port in [33676,8382,5382]:
        with socket.socket() as sock:sock.bind(('127.0.0.1',port))
    def hashes():
        files=[p for root in ['backend/src','frontend/src'] for p in (REPO/root).rglob('*') if p.is_file()]
        files.extend([Path(__file__),REPO/'scripts/operations'/args.browser_script,REPO/'frontend/vite.config.js'])
        return {p.relative_to(REPO).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    before=hashes()
    for p in (REPO/'backend/src').rglob('*'):
        if p.is_file() and p.read_bytes()!=(backend/p.relative_to(REPO/'backend')).read_bytes():raise ValueError('Backend source copy drift')
    jar=backend/'target/kdrive-0.1.0-SNAPSHOT.jar'
    with zipfile.ZipFile(jar) as archive:
        for p in (backend/'target/classes').rglob('*'):
            if p.is_file() and archive.read('BOOT-INF/classes/'+p.relative_to(backend/'target/classes').as_posix())!=p.read_bytes():raise ValueError('JAR/classes drift')
    out.mkdir(parents=True)
    (out/'inputs-before.json').write_text(json.dumps(before,indent=2))
    seed=uuid.uuid4().hex+'A1!';schema='kdrive_c14_browser_'+uuid.uuid4().hex[:8]
    config=out/'backend.private.properties'
    config.write_text(f'server.port=8382\nspring.datasource.url=jdbc:mysql://127.0.0.1:33676/{schema}?useSSL=false&allowPublicKeyRetrieval=true&connectionTimeZone=UTC\nspring.datasource.username=root\nspring.datasource.password={password}\napp.jwt-secret={uuid.uuid4().hex}{uuid.uuid4().hex}\napp.seed-enabled=true\napp.seed-password={seed}\napp.cors-origin=http://127.0.0.1:5382\n')
    processes=[];handles=[];owned=False
    def sql(query):return run(['docker','exec','-i','-e','MYSQL_PWD='+password,fixture['name'],'mysql','-uroot','--batch','-N'],input=query.encode()).stdout
    def http(method,path,body=None,token=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        req=Request('http://127.0.0.1:8382/api/v1'+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode())
        with urlopen(req,timeout=10) as response:return json.loads(response.read())
    def spawn(command,label,cwd):
        handle=(out/(label+'.log')).open('wb');handles.append(handle)
        process=subprocess.Popen(command,cwd=cwd,env=env,stdout=handle,stderr=handle,creationflags=FLAGS);processes.append(process);return process
    try:
        run(['docker','start',fixture['name']]);owned=True
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            try:sql('SELECT 1');break
            except subprocess.CalledProcessError:time.sleep(1)
        else:raise RuntimeError('Fixture did not become ready')
        sql('CREATE DATABASE '+schema)
        backend_process=spawn(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--spring.config.additional-location=file:'+config.as_posix()],'backend',REPO)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            if backend_process.poll() is not None:raise RuntimeError('Backend exited; see private log')
            try:login=http('POST','/auth/login',{'email':'user@example.test','password':seed});break
            except (HTTPError,URLError,TimeoutError,ConnectionError):time.sleep(1)
        else:raise RuntimeError('Backend readiness timeout')
        http('PUT','/me/license',{'licenseNumber':'OTO2-FIXTURE','scheme':'VN_2025','licenseClass':'B','expiresOn':'2035-12-31','automaticOnly':False,'version':0},login['token'])
        (out/'fixture-readback.json').write_text(json.dumps({'fixture':fixture,'schema':schema,'vehicles':http('GET','/vehicles'),'jarSHA256':hashlib.sha256(jar.read_bytes()).hexdigest()},indent=2))
        spawn(['node','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5382','--strictPort'],'frontend',REPO/'frontend')
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            try:
                with urlopen('http://127.0.0.1:5382/vehicles',timeout=3):break
            except (URLError,TimeoutError,ConnectionError):time.sleep(1)
        else:raise RuntimeError('Frontend readiness timeout')
        env.update(OTO2_EVIDENCE=str(out),OTO2_SEED_PASSWORD=seed,KDRIVE_PLAYWRIGHT=str(REPO/'.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'))
        result=subprocess.run(['node',str(REPO/'scripts/operations'/args.browser_script)],cwd=REPO,env=env,capture_output=True,creationflags=FLAGS,timeout=180)
        (out/'browser.log').write_bytes(result.stdout+result.stderr);(out/'browser.exit').write_text(str(result.returncode))
        if result.returncode:raise RuntimeError('Browser proof failed; see browser.log')
        if sql(f'SELECT count(*) FROM {schema}.bookings').strip()!=str(args.expected_bookings).encode():raise AssertionError('Unexpected fixture booking count')
        if before!=hashes():raise AssertionError('Source drift')
        (out/'inputs-after.json').write_text(json.dumps(hashes(),indent=2))
        (out/'result.json').write_text(json.dumps({'status':'PASS scoped browser','originalDBWrites':False,'bookingCount':args.expected_bookings},indent=2))
        print('PASS native browser trip flow')
    finally:
        for process in reversed(processes):
            if process.poll() is None:process.terminate();process.wait(timeout=25)
        for handle in handles:handle.close()
        if owned:
            if run(['docker','inspect','--format','{{.Id}}',fixture['name']]).stdout.decode().strip()!=fixture['id']:raise RuntimeError('Cleanup identity drift')
            run(['docker','stop',fixture['name']])
        stopped=run(['docker','inspect','--format','{{.State.Running}}',fixture['name']]).stdout.strip()==b'false'
        (out/'cleanup.json').write_text(json.dumps({'processesStopped':all(p.poll() is not None for p in processes),'fixtureStopped':stopped,'volume':'KEEP'},indent=2))

if __name__=='__main__':main()
