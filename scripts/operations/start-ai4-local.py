"""Start approved AI4 locally on the existing V4 DB; explicit catalog hash required to import."""
import argparse, importlib.util, json, os, re, socket, subprocess, time, urllib.request
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local_helpers',Path(__file__).with_name('start-ai3-local.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
HISTORY=[('1','190705803'),('2','-1792922806'),('3','1994983605'),('4','-1613438858')]

def preflight_path(value):
    out=Path(value).resolve()
    if not out.is_relative_to(REPO/'.runtime') or out.exists():raise RuntimeError('New evidence under .runtime required')
    h.free_ports();return out

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--evidence',required=True);p.add_argument('--backend-root',required=True);p.add_argument('--native',required=True);p.add_argument('--approved-catalog-sha',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    out=preflight_path(a.evidence);build=Path(a.backend_root).resolve();native=Path(a.native).resolve()
    assert build.is_relative_to(REPO/'.runtime') and native.is_relative_to(REPO/'.runtime')
    jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar';assert h.digest(jar)==json.loads((native/'jar-provenance.json').read_text())['jarSHA256']
    for rel,sha in json.loads((native/'inputs-before.json').read_text()).items():assert h.digest(REPO/rel)==sha,'Source drift: '+rel
    catalog=REPO/'scripts/ai/locations-pilot.json';assert h.digest(catalog).lower()==a.approved_catalog_sha.lower(),'Catalog approval hash mismatch'
    assert [tuple(row.split('\t')) for row in h.sql('SELECT version,checksum FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank').splitlines()]==HISTORY,'Expected V4; no migration authorized'
    assert h.sql('SELECT COUNT(*) FROM flyway_schema_history WHERE success=0')=='0'
    env={k:v for k,v in os.environ.items() if not k.startswith(('SPRING_','KDRIVE_TEST_','KDRIVE_MIGRATION_','VITE_'))}
    allowed=set(re.findall(r'\$\{([A-Z_]+)',(REPO/'backend/src/main/resources/application.yml').read_text()))
    for line in (REPO/'backend/.env.local').read_text(encoding='utf-8-sig').splitlines():
        line=line.strip().removeprefix('export ')
        if line and not line.startswith('#') and '=' in line:
            key,value=line.split('=',1)
            if key.strip() in allowed:env[key.strip()]=value.strip().strip('\"\'')
    assert env['DB_URL'].startswith('jdbc:mysql://127.0.0.1:33385/kdrive?') and len(env['JWT_SECRET'])>=32
    password=os.environ.get('KDRIVE_ADMIN_PASSWORD') or env.get('SEED_PASSWORD')
    assert password,'Admin credential missing; use ignored local environment, never chat'
    graph=REPO/'.runtime/coordination-ai3-20261019/osrm-central';manifest=json.loads((graph.parent/'graph-manifest.json').read_text(encoding='utf-8-sig'))
    for name,meta in manifest['files'].items():assert h.digest(graph/name).lower()==meta['sha256'].lower(),name
    mysql=json.loads(h.run(['docker','inspect',h.MYSQL]))[0];assert mysql['Id']==h.MYSQL and mysql['State']['Running']
    if not a.apply:print('PREFLIGHT PASS; no writes/start/import');return
    out.mkdir();handles=[];processes=[];osrm=None
    def start(cmd,label,cwd=REPO):
        log=(out/(label+'.log')).open('wb');handles.append(log)
        process=subprocess.Popen(cmd,cwd=cwd,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW);processes.append((label,process));return process
    try:
        backup=out/'database.private.sql'
        with backup.open('xb') as dest:
            r=subprocess.run(['docker','exec',h.MYSQL,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF kdrive'],stdout=dest,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW,timeout=180)
        assert r.returncode==0 and backup.stat().st_size>1000,'Backup failed'
        counts=h.sql("SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'vehicles',COUNT(*) FROM vehicles UNION ALL SELECT 'bookings',COUNT(*) FROM bookings")
        osrm_name='kltn-ai3-local-88172262b0b9';info=json.loads(h.run(['docker','inspect',osrm_name]))[0]
        assert not info['State']['Running'] and info['Config']['Image']==manifest['image']
        assert any(Path(m['Source']).resolve()==graph.resolve() and m['Destination']=='/data' and not m['RW'] for m in info['Mounts'])
        osrm=info['Id'];h.run(['docker','start',osrm_name])
        env.update(SEED_ENABLED='false',GEMINI_PARSER_ENABLED='false',AI_RECOMMENDATION_ENABLED='true',QWEN_PARSER_ENABLED='true',QWEN_MODEL='qwen3:8b',AI_ROUTING_ENABLED='true',PORT='8080',FRONTEND_ORIGIN='http://localhost:5173',OLLAMA_HOST='127.0.0.1:11434',OLLAMA_MODELS='E:/AI_Cache/ollama',OLLAMA_NO_CLOUD='true',OLLAMA_NOPRUNE='true',OLLAMA_MAX_LOADED_MODELS='1')
        start(['C:/Users/LENOVO/AppData/Local/Programs/Ollama/ollama.exe','serve'],'ollama')
        start(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--server.address=127.0.0.1'],'backend',REPO/'backend')
        h.wait_json('http://127.0.0.1:8080/api/v1/health',lambda x:x.get('status')=='UP')
        request=urllib.request.Request('http://127.0.0.1:8080/api/v1/auth/login',data=json.dumps({'email':'admin@example.test','password':password}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:token=json.load(response)['token']
        spec=importlib.util.spec_from_file_location('pilot_importer',REPO/'scripts/ai/import_locations_pilot.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
        dry=imp.import_pilot_locations(catalog,'http://127.0.0.1:8080',token,dry_run=True)
        assert not dry['errors'] and not dry['locationsConflict'],'Dry run conflict; no catalog writes performed'
        result=imp.import_pilot_locations(catalog,'http://127.0.0.1:8080',token,dry_run=False)
        assert not result['errors'] and not result['locationsConflict'],'Partial import; inspect report before safe retry'
        (out/'catalog-import.json').write_text(json.dumps({'dryRun':dry,'apply':result},ensure_ascii=False,indent=2),encoding='utf-8')
        assert counts==h.sql("SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'vehicles',COUNT(*) FROM vehicles UNION ALL SELECT 'bookings',COUNT(*) FROM bookings")
        env.update(VITE_DATA_MODE='api',VITE_API_BASE_URL='/api/v1',VITE_PROXY_TARGET='http://127.0.0.1:8080')
        (out/'frontend-build.log').write_bytes(h.run(['node.exe','node_modules/vite/bin/vite.js','build'],cwd=REPO/'frontend',env=env))
        start(['node.exe','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'],'frontend',REPO/'frontend')
        h.wait_json('http://127.0.0.1:11434/api/tags',lambda x:any(m['name']=='qwen3:8b' for m in x['models']))
        warm_request=urllib.request.Request('http://127.0.0.1:11434/api/generate',data=json.dumps({'model':'qwen3:8b','prompt':'','stream':False,'keep_alive':'2m'}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(warm_request,timeout=120) as response:assert json.load(response).get('done') is True
        h.wait_json('http://127.0.0.1:5000/route/v1/driving/108.22317,16.0602;108.21768,16.07137?overview=false',lambda x:x.get('code')=='Ok')
        assert all(proc.poll() is None for _,proc in processes)
        record={'status':'LOCAL_AI4_READY','seed':False,'jarSHA256':h.digest(jar),'backupSHA256':h.digest(backup),'catalogSHA256':h.digest(catalog),'mysqlId':h.MYSQL,'osrmId':osrm,'protectedCounts':counts,'processes':[{'name':n,'pid':p.pid,'command':p.args} for n,p in processes]}
        (out/'services.json').write_text(json.dumps(record,indent=2));print('LOCAL_AI4_READY http://localhost:5173; approved catalog imported, core counts preserved')
    except BaseException:
        for _,process in reversed(processes):
            if process.poll() is None:
                subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=20)
                process.wait(timeout=20)
        if osrm:h.run(['docker','stop',osrm])
        raise
    finally:
        for log in handles:log.close()

if __name__=='__main__':main()
