"""Owned local provider proof. Reuses guarded MySQL/browser harness; never main DB."""
import argparse, hashlib, json, os, socket, subprocess, time, urllib.request, uuid
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]
FLAGS=subprocess.CREATE_NO_WINDOW

def listening(port):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1',port))==0

def main():
    p=argparse.ArgumentParser();p.add_argument('--backend-root',required=True);p.add_argument('--native',required=True);p.add_argument('--evidence',required=True);p.add_argument('--reuse-osrm')
    a=p.parse_args();out=Path(a.evidence).resolve();assert out.is_relative_to(REPO/'.runtime') and not out.exists()
    graph=REPO/'.runtime/coordination-ai3-20261019/osrm-central'
    manifest=json.loads((graph.parent/'graph-manifest.json').read_text(encoding='utf-8-sig'))
    assert not listening(5000),'OSRM occupied; never stop another provider'
    for name,meta in manifest['files'].items():
        file=(graph/name).resolve();assert file.is_relative_to(graph) and hashlib.sha256(file.read_bytes()).hexdigest().lower()==meta['sha256'].lower(),name
    out.mkdir();env=os.environ.copy();env.update(QWEN_PARSER_ENABLED='true',AI_ROUTING_ENABLED='true',QWEN_MODEL='qwen3:8b')
    sources=[p for folder in ['backend/src','frontend/src','scripts/ai','scripts/coordination/ai4','scripts/coordination/c14-core'] for p in (REPO/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    sources += [REPO/'frontend'/n for n in ['package.json','package-lock.json','vite.config.js']]
    before={p.relative_to(REPO).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    (out/'inputs-before.json').write_text(json.dumps(before,indent=2))
    name='kltn-ai4-proof-'+uuid.uuid4().hex[:12];owned=None;ollama=None;log=None
    def run(cmd,**kw):
        r=subprocess.run(cmd,cwd=REPO,env=env,capture_output=True,creationflags=FLAGS,timeout=900,**kw)
        if r.returncode:
            (out/'command-failure.private.log').write_bytes(r.stdout+r.stderr)
            raise RuntimeError('Command failed (private arguments omitted): '+str(cmd[0]))
        return r.stdout
    try:
        if a.reuse_osrm:
            name=a.reuse_osrm;assert name.startswith('kltn-ai4-proof-')
            info=json.loads(run(['docker','inspect',name]))[0]
            assert not info['State']['Running'] and info['Config']['Image']==manifest['image']
            assert any(Path(m['Source']).resolve()==graph.resolve() and m['Destination']=='/data' and not m['RW'] for m in info['Mounts'])
            owned=info['Id'];run(['docker','start',name])
        else:
            owned=run(['docker','run','-d','--name',name,'--memory','2g','--cpus','2','-p','127.0.0.1:5000:5000','--mount','type=bind,source='+str(graph)+',target=/data,readonly',manifest['image'],'osrm-routed','--algorithm','mld','/data/central.osrm']).decode().strip()
        (out/'osrm-identity.json').write_text(json.dumps({'name':name,'id':owned,'graphImage':manifest['image']}))
        if not listening(11434):
            env.update(OLLAMA_HOST='127.0.0.1:11434',OLLAMA_MODELS='E:/AI_Cache/ollama',OLLAMA_NO_CLOUD='true',OLLAMA_NOPRUNE='true')
            log=(out/'ollama.log').open('wb');ollama=subprocess.Popen(['C:/Users/LENOVO/AppData/Local/Programs/Ollama/ollama.exe','serve'],env=env,stdout=log,stderr=log,creationflags=FLAGS)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            try:
                if listening(5000):
                    tags=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=3));break
            except OSError:pass
            time.sleep(1)
        else:raise RuntimeError('Provider startup deadline')
        assert any(m['name']=='qwen3:8b' for m in tags['models']),'No model pull allowed'
        (out/'ollama-ownership.json').write_text(json.dumps({'pid':ollama.pid if ollama else None,'owned':ollama is not None}))
        (out/'providers.json').write_text(json.dumps({'osrmContainer':name,'id':owned,'graphImage':manifest['image'],'models':tags,'ollamaOwned':ollama is not None},indent=2))
        # Proof may stop only these owned providers for negative cases, with exact identity checks.
        env['AI4_OWNED_OSRM_NAME']=name;env['AI4_OWNED_OSRM_ID']=owned
        env['AI4_OWNED_OLLAMA_PID']=str(ollama.pid) if ollama else ''
        result=run([os.sys.executable,str(REPO/'scripts/coordination/c14-core/run-browser.py'),'--backend-root',a.backend_root,'--backend-evidence',a.native,'--evidence',str(out/'browser'),'--browser-script','scripts/coordination/ai4/verify-live.cjs'])
        (out/'driver.log').write_bytes(result)
        assert before=={p.relative_to(REPO).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},'Source drift'
        (out/'source-match.json').write_text(json.dumps({'matched':True,'files':len(before)}))
    finally:
        if ollama:
            if ollama.poll() is None:
                subprocess.run(['taskkill','/PID',str(ollama.pid),'/T','/F'],capture_output=True,creationflags=FLAGS,timeout=20,check=True)
                ollama.wait(timeout=20)
        if log:log.close()
        if owned:
            assert run(['docker','inspect','--format','{{.Id}}',name]).decode().strip()==owned
            run(['docker','stop',name])
        (out/'cleanup.json').write_text(json.dumps({'ollamaOwned':ollama is not None,'ollamaStopped':ollama.poll() is not None if ollama else None,'osrmStopped':not listening(5000),'containers':'KEEP','graph':'KEEP'}))

if __name__=='__main__':main()
