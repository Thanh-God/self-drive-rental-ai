"""Explicit local V4 -> V5 activation: backup, preserve old columns, no seed or test writes."""
import argparse, hashlib, importlib.util, json, os, re, subprocess, zlib
from pathlib import Path

REPO=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local_helpers',Path(__file__).with_name('start-ai3-local.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

def sql(query):
    return h.run(['docker','exec',h.MYSQL,'sh','-c',
                  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names kdrive -e "$1"',
                  'sh',query]).decode('utf-8').strip()

def checksums():
    rows=[]
    for file in sorted((REPO/'backend/src/main/resources/db/migration').glob('V*.sql')):
        value=zlib.crc32(''.join(file.read_text(encoding='utf-8-sig').splitlines()).encode('utf-8'))
        rows.append((file.name.split('__')[0][1:],str(value if value<2**31 else value-2**32)))
    return rows

def preflight_path(value):
    out=Path(value).resolve()
    if not out.is_relative_to(REPO/'.runtime') or out.exists():raise RuntimeError('New evidence under .runtime required')
    h.free_ports((8080,5173));return out

def snapshot(columns):
    result={}
    for table,names in columns.items():
        assert re.fullmatch(r'[a-z_]+',table) and all(re.fullmatch(r'[a-z_]+',x) for x in names)
        fields=','.join('`'+x+'`' for x in names)
        result[table]={'rows':sql(f'SELECT COUNT(*) FROM `{table}`'),
                       'sha256':hashlib.sha256(sql(f'SELECT JSON_ARRAY({fields}) FROM `{table}` ORDER BY {fields}').encode()).hexdigest()}
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--evidence',required=True);p.add_argument('--backend-root',required=True);p.add_argument('--native',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    out=preflight_path(a.evidence);build=Path(a.backend_root).resolve();native=Path(a.native).resolve()
    assert build.is_relative_to(REPO/'.runtime') and native.is_relative_to(REPO/'.runtime')
    assert json.loads((native/'result.json').read_text())['status']=='PASS C14 native scoped'
    jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar'
    assert h.digest(jar)==json.loads((native/'jar-provenance.json').read_text())['jarSHA256']
    for rel,sha in json.loads((native/'inputs-before.json').read_text()).items():assert h.digest(REPO/rel)==sha,'Source drift'
    info=json.loads(h.run(['docker','inspect',h.MYSQL]))[0]
    assert info['Id']==h.MYSQL and info['State']['Running']
    assert info['HostConfig']['PortBindings']=={'3306/tcp':[{'HostIp':'127.0.0.1','HostPort':'33385'}]}
    assert len(info['Mounts'])==1 and info['Mounts'][0]['Name']=='kltn_phase5_rerun_20261004_1823' and info['Mounts'][0]['Destination']=='/var/lib/mysql'
    expected=checksums();assert [r[0] for r in expected]==['1','2','3','4','5']
    history=[tuple(row.split('\t')) for row in sql('SELECT version,checksum FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank').splitlines()]
    assert history==expected[:4] and sql('SELECT COUNT(*) FROM flyway_schema_history WHERE success=0')=='0','Expected intact V4 history; no repair/retry authorized'
    env={k:v for k,v in os.environ.items() if not k.startswith(('SPRING_','KDRIVE_TEST_','KDRIVE_MIGRATION_','VITE_'))}
    allowed=set(re.findall(r'\$\{([A-Z_]+)',(REPO/'backend/src/main/resources/application.yml').read_text()))
    for line in (REPO/'backend/.env.local').read_text(encoding='utf-8-sig').splitlines():
        line=line.strip().removeprefix('export ')
        if line and not line.startswith('#') and '=' in line:
            key,value=line.split('=',1)
            if key.strip() in allowed:env[key.strip()]=value.strip().strip('\"\'')
    assert env['DB_URL'].startswith('jdbc:mysql://127.0.0.1:33385/kdrive?') and len(env['JWT_SECRET'])>=32
    columns={}
    for row in sql("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='kdrive' AND table_name<>'flyway_schema_history' ORDER BY table_name,ordinal_position").splitlines():
        table,column=row.split('\t');columns.setdefault(table,[]).append(column)
    before=snapshot(columns)
    if not a.apply:print('PREFLIGHT PASS; no writes or startup');return
    out.mkdir();processes=[];handles=[]
    (out/'before.json').write_text(json.dumps({'history':history,'columns':columns,'dataHashes':before},indent=2))
    backup=out/'database.private.sql'
    with backup.open('xb') as target:
        r=subprocess.run(['docker','exec',h.MYSQL,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF kdrive'],stdout=target,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW,timeout=180)
    assert r.returncode==0 and backup.stat().st_size>1000,'Backup failed; migration not started'
    def start(command,label,cwd):
        log=(out/(label+'.log')).open('wb');handles.append(log)
        proc=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW);processes.append((label,proc));return proc
    try:
        env.update(SEED_ENABLED='false',PORT='8080',FRONTEND_ORIGIN='http://localhost:5173',LICENSE_PHOTO_DIRECTORY=str(REPO/'.runtime/private-license-photos'))
        start(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--server.address=127.0.0.1'],'backend',REPO/'backend')
        h.wait_json('http://127.0.0.1:8080/api/v1/health',lambda x:x.get('status')=='UP')
        assert expected==[tuple(row.split('\t')) for row in sql('SELECT version,checksum FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank').splitlines()]
        after=snapshot(columns);assert before==after,'Existing business data changed; inspect before retry'
        assert sql("SELECT COUNT(*) FROM driver_licenses WHERE front_photo IS NOT NULL OR back_photo IS NOT NULL OR photo_review_status<>'MISSING'")=='0'
        (out/'after.json').write_text(json.dumps({'history':expected,'dataHashes':after,'oldColumnsPreserved':True,'backupSHA256':h.digest(backup)},indent=2))
        env.update(VITE_DATA_MODE='api',VITE_API_BASE_URL='/api/v1',VITE_PROXY_TARGET='http://127.0.0.1:8080')
        start(['node.exe','node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],'frontend',REPO/'frontend')
        import urllib.request
        import time
        for _ in range(30):
            try:urllib.request.urlopen('http://127.0.0.1:5173',timeout=2).close();break
            except OSError:time.sleep(1)
        else:raise RuntimeError('Frontend startup failed')
        assert all(proc.poll() is None for _,proc in processes)
        (out/'services.json').write_text(json.dumps({'status':'LOCAL_LICENSE_PHOTOS_READY','seed':False,'jarSHA256':h.digest(jar),'mysqlId':h.MYSQL,'processes':[{'name':name,'pid':proc.pid} for name,proc in processes]},indent=2))
        print('LOCAL_LICENSE_PHOTOS_READY; V5 applied, old data preserved, seed disabled')
    except BaseException:
        for _,proc in reversed(processes):
            if proc.poll() is None:
                subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=20)
        raise
    finally:
        for log in handles:log.close()

if __name__=='__main__':main()
