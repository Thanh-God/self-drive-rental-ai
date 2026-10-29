"""Restore a completed synthetic browser database into a NEW marked pool schema."""
import argparse, hashlib, importlib.util, json, os, re, shutil, socket, subprocess, time, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('run-mysql.py'))
native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)

def guard(source, target, out):
    assert re.fullmatch(r'kdrive_c14_browser_[0-9a-f]{12}', source), 'Synthetic browser schema required'
    assert re.fullmatch(r'kdrive_c14_restore_[0-9a-f]{12}', target) and source != target, 'Fresh restore schema required'
    assert out.resolve().is_relative_to(ROOT/'.runtime') and not out.exists(), 'New runtime output required'

def hashes(folder):
    return {p.relative_to(folder).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}

def main():
    p=argparse.ArgumentParser(); p.add_argument('--linked-evidence',required=True); p.add_argument('--backend-root',required=True); p.add_argument('--evidence',required=True); a=p.parse_args()
    linked,build,out=[Path(v).resolve() for v in (a.linked_evidence,a.backend_root,a.evidence)]
    assert all(v.is_relative_to(ROOT/'.runtime') for v in (linked,build,out))
    result=json.loads((linked/'result.json').read_text()); assert result['status']=='PASS browser scoped' and result['sourceMatch']
    source=(linked/'browser-schema.txt').read_text().strip(); target='kdrive_c14_restore_'+uuid.uuid4().hex[:12]; guard(source,target,out)
    for path in (ROOT/'backend/src').rglob('*'):
        if path.is_file(): assert path.read_bytes()==(build/path.relative_to(ROOT/'backend')).read_bytes(), 'Backend source drift'
    previous,pinned=native.fixture_source(); f=json.loads((previous/'fixture.json').read_text())
    password=next(l.split('=',1)[1] for l in (previous/'mysql.private.env').read_text().splitlines() if l.startswith('MYSQL_ROOT_PASSWORD='))
    token=(previous/'marker.private.token').read_text().strip(); assert re.fullmatch('[0-9a-f]{32}',token)
    env=os.environ.copy()
    for key in list(env):
        if key.startswith(('SPRING_','APP_','DEPOSIT_','RETURN_','SEED_')): env.pop(key)
    def run(cmd,data=None):
        r=subprocess.run(cmd,input=data,capture_output=True,env=env,creationflags=subprocess.CREATE_NO_WINDOW,timeout=60)
        assert r.returncode==0, 'Private command failed; no credentials/output exposed'
        return r.stdout
    def sql(q): return run(['docker','exec','-i','-e','MYSQL_PWD='+password,f['name'],'mysql','-uroot','--batch','--raw','-N','--default-character-set=utf8mb4'],q.encode()).decode('utf-8')
    native.validate_reuse(f,json.loads(run(['docker','inspect',f['name']]))[0],pinned)
    for port in (33676,8300):
        with socket.socket() as sock: sock.bind(('127.0.0.1',port))
    out.mkdir(parents=True); started=False; proc=None; log=None; final=None
    try:
        run(['docker','start',f['name']]); started=True
        for attempt in range(30):
            try:
                if sql('SELECT 1').strip()=='1': break
            except AssertionError:
                if attempt==29: raise
                time.sleep(1)
        assert sql(f"SELECT COUNT(*) FROM kdrive_c14_meta.__kdrive_test_fixture_marker WHERE target_schema='{source}' AND marker_token='{token}'").strip()=='1', 'Source marker mismatch'
        assert sql(f"SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='{target}'").strip()=='0', 'Restore target exists'
        tables=sql(f'SHOW TABLES FROM {source}').splitlines(); assert len(tables)==30
        assert all(re.fullmatch('[a-z_]+',t) for t in tables)
        def snapshot(schema):
            return {t:hashlib.sha256('\n'.join(sorted(sql(f'SELECT * FROM {schema}.{t}').splitlines())).encode()).hexdigest() for t in tables}
        before=snapshot(source)
        dump=run(['docker','exec','-e','MYSQL_PWD='+password,f['name'],'mysqldump','-uroot','--single-transaction','--skip-lock-tables','--no-tablespaces','--set-gtid-purged=OFF','--hex-blob',source])
        assert dump and b'CREATE DATABASE' not in dump and b'USE `' not in dump
        (out/'database.private.sql').write_bytes(dump)
        photos=linked/'private-license-photos'; originals=hashes(photos); assert len(originals)>0
        shutil.copytree(photos,out/'photos-backup'); shutil.copytree(out/'photos-backup',out/'photos-restored')
        assert originals==hashes(out/'photos-restored')
        sql(f"CREATE DATABASE {target}; INSERT INTO kdrive_c14_meta.__kdrive_test_fixture_marker VALUES((SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM kdrive_c14_meta.__kdrive_test_fixture_marker) t),'{target}','{token}');")
        run(['docker','exec','-i','-e','MYSQL_PWD='+password,f['name'],'mysql','-uroot',target],dump)
        assert snapshot(target)==before, 'Restored data differs'
        assert sql(f'SHOW TABLES FROM {target}').splitlines()==tables
        config=(linked/'application.private.properties').read_text().replace('/'+source+'?','/'+target+'?')
        replacements={'app.seed-enabled':'false','app.return-policy-enabled':'false','app.license-photo-directory':(out/'photos-restored').as_posix()}
        lines=[line for line in config.splitlines() if line.split('=',1)[0] not in replacements]
        lines += [k+'='+v for k,v in replacements.items()]
        conf=out/'application.private.properties'; conf.write_text('\n'.join(lines)+'\n')
        jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar'; log=(out/'backend.log').open('wb')
        proc=subprocess.Popen(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--spring.config.additional-location=file:'+conf.as_posix()],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            assert proc.poll() is None, 'Restored backend failed startup'
            try:
                with urllib.request.urlopen('http://127.0.0.1:8300/api/v1/health',timeout=2) as response:
                    assert response.status==200; break
            except OSError: time.sleep(1)
        else: raise AssertionError('Restored health timeout')
        assert before==snapshot(target)==snapshot(source), 'Startup or backup changed data'
        assert originals==hashes(photos)==hashes(out/'photos-restored')
        final={'status':'PASS fixture logical restore scoped','sourceSchema':source,'restoredSchema':target,'tables':30,'photoFiles':len(originals),'dumpSHA256':hashlib.sha256(dump).hexdigest(),'tableHashes':before,'photoHashes':originals,'startupHealth':200,'seedEnabled':False,'returnPolicyEnabled':False,'sourceUnchanged':True}
    finally:
        if proc and proc.poll() is None: proc.terminate(); proc.wait(timeout=30)
        if log: log.close()
        if started:
            assert run(['docker','inspect','--format','{{.Id}}',f['name']]).decode().strip()==f['id']
            run(['docker','stop',f['name']])
            assert run(['docker','inspect','--format','{{.State.Running}}',f['name']]).strip()==b'false'
        (out/'cleanup.json').write_text(json.dumps({'ownedBackendStopped':proc is None or proc.poll() is not None,'fixtureStopped':started,'schemasAndVolume':'KEEP'}))
    if final: (out/'result.json').write_text(json.dumps(final,indent=2)); print('PASS restore: 30 tables, photos and startup; source unchanged')

if __name__=='__main__': main()
