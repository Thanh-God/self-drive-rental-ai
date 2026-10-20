"""Exact stopped C14 fixture, real JAR/Vite, isolated linked-workflow schema."""
import argparse, hashlib, json, os, socket, subprocess, time, urllib.request, uuid
from pathlib import Path
REPO=Path(__file__).resolve().parents[3];FLAGS=subprocess.CREATE_NO_WINDOW

def resolve_proof(value):
 proof=Path(value).resolve() if value else Path(__file__).with_name('verify-browser.cjs').resolve()
 assert proof.is_relative_to(REPO/'scripts') and proof.is_file(),'Repository browser proof required'
 return proof

def main():
 p=argparse.ArgumentParser();p.add_argument('--backend-evidence',required=True);p.add_argument('--backend-root',required=True);p.add_argument('--evidence',required=True);p.add_argument('--browser-script');a=p.parse_args()
 native=Path(a.backend_evidence).resolve();build=Path(a.backend_root).resolve();out=Path(a.evidence).resolve()
 assert all(x.is_relative_to(REPO/'.runtime') for x in [native,build,out]) and not out.exists()
 f=json.loads((native/'fixture.json').read_text());assert f['name'].startswith('kltn-c14-core-') and f['port']==33676
 assert json.loads((native/'result.json').read_text())['status']=='PASS C14 native scoped'
 password=next(l.split('=',1)[1] for l in (native/'mysql.private.env').read_text().splitlines() if l.startswith('MYSQL_ROOT_PASSWORD='))
 jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar';assert hashlib.sha256(jar.read_bytes()).hexdigest()==json.loads((native/'jar-provenance.json').read_text())['jarSHA256']
 for rel,sha in json.loads((native/'inputs-before.json').read_text()).items():assert hashlib.sha256((REPO/rel).read_bytes()).hexdigest()==sha,rel
 files=[x for root in ['backend/src','frontend/src','scripts/coordination/c14-core'] for x in (REPO/root).rglob('*') if x.is_file() and '__pycache__' not in x.parts]
 files += [REPO/'frontend'/n for n in ['package.json','package-lock.json','vite.config.js']]
 proof=resolve_proof(a.browser_script)
 files.append(proof)
 before={x.relative_to(REPO).as_posix():hashlib.sha256(x.read_bytes()).hexdigest() for x in files}
 for port in [33676,8300,5300]:
  with socket.socket() as s:s.bind(('127.0.0.1',port))
 env=os.environ.copy()
 for key in list(env):
  if key.startswith(('SPRING_','VITE_','KDRIVE_TEST_','KDRIVE_MIGRATION_')):env.pop(key)
 env.update(VITE_DATA_MODE='api',VITE_API_BASE_URL='/api/v1',VITE_PROXY_TARGET='http://127.0.0.1:8300',C11_EVIDENCE=str(out),C11_BACKEND_EVIDENCE=str(native),C11_PLAYWRIGHT=str(REPO/'.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'))
 def run(c,cwd=REPO):
  try:r=subprocess.run(c,cwd=cwd,env=env,capture_output=True,creationflags=FLAGS,timeout=600)
  except subprocess.TimeoutExpired:raise RuntimeError('Native command timed out; private arguments omitted') from None
  if r.returncode:raise RuntimeError('Native failure; private output omitted')
  return r.stdout
 inspection=json.loads(run(['docker','inspect',f['name']]))[0]
 assert inspection['Id']==f['id'] and not inspection['State']['Running']
 assert [m['Name'] for m in inspection['Mounts'] if m['Destination']=='/var/lib/mysql']==[f['volume']]
 out.mkdir();(out/'inputs-before.json').write_text(json.dumps(before,indent=2));procs=[];handles=[];started=False;result=None
 def spawn(c,label,cwd=REPO):
  h=(out/(label+'.log')).open('wb');handles.append(h);process=subprocess.Popen(c,cwd=cwd,env=env,stdout=h,stderr=h,creationflags=FLAGS);procs.append(process);return process
 try:
  run(['docker','start',f['name']]);started=True;deadline=time.monotonic()+60
  while time.monotonic()<deadline:
   try:r=subprocess.run(['docker','exec','-e','MYSQL_PWD='+password,f['name'],'mysql','-uroot','-N','-e','SELECT 1'],capture_output=True,creationflags=FLAGS,timeout=10)
   except subprocess.TimeoutExpired:continue
   if r.returncode==0 and r.stdout.strip()==b'1':break
   time.sleep(1)
  else:raise RuntimeError('MySQL readiness deadline')
  schema='kdrive_c14_browser_'+uuid.uuid4().hex[:12];run(['docker','exec','-e','MYSQL_PWD='+password,f['name'],'mysql','-uroot','-e','CREATE DATABASE '+schema]);(out/'browser-schema.txt').write_text(schema)
  config=out/'application.private.properties';config.write_text(f'server.port=8300\nspring.datasource.url=jdbc:mysql://127.0.0.1:33676/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC\nspring.datasource.username=root\nspring.datasource.password={password}\napp.jwt-secret=c14-only-test-secret-at-least-32-bytes\napp.seed-enabled=true\napp.seed-password=BranchBookingTestOnly123!\napp.cors-origin=http://127.0.0.1:5300\n')
  spawn(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--spring.config.additional-location=file:'+config.as_posix()],'backend')
  (out/'api-build.log').write_bytes(run(['node','node_modules/vite/bin/vite.js','build'],REPO/'frontend'))
  spawn(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5300','--strictPort'],'frontend',REPO/'frontend')
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   assert all(x.poll() is None for x in procs),'Owned service exited'
   try:
    urllib.request.urlopen('http://127.0.0.1:5300',timeout=2).close()
    request=urllib.request.Request('http://127.0.0.1:8300/api/v1/auth/login',data=b'{"email":"admin@example.test","password":"BranchBookingTestOnly123!"}',headers={'Content-Type':'application/json'})
    urllib.request.urlopen(request,timeout=2).close();break
   except OSError:time.sleep(1)
  else:raise RuntimeError('Services readiness deadline')
  r=subprocess.run(['node',str(proof)],cwd=REPO,env=env,capture_output=True,creationflags=FLAGS,timeout=600)
  (out/'browser.log').write_bytes(r.stdout+r.stderr);(out/'browser-exit.txt').write_text(str(r.returncode));assert r.returncode==0,'Browser failure; see browser.log'
  for rel,sha in before.items():assert hashlib.sha256((REPO/rel).read_bytes()).hexdigest()==sha,rel
  result={'status':'PASS browser scoped' if a.browser_script else 'PASS C14 linked browser scoped','proofScript':str(proof.relative_to(REPO)),'assertions':len(json.loads((out/'browser-assertions.json').read_text(encoding='utf-8'))),'sourceMatch':True}
 finally:
  for process in reversed(procs):
   if process.poll() is None:process.terminate();process.wait(timeout=20)
  for h in handles:h.close()
  if started:
   assert run(['docker','inspect','--format','{{.Id}}',f['name']]).decode().strip()==f['id'];run(['docker','stop',f['name']]);assert run(['docker','inspect','--format','{{.State.Running}}',f['name']]).decode().strip()=='false'
  for port in [8300,5300]:
   with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Owned port remains listening'
  (out/'cleanup.json').write_text(json.dumps({'ownedProcessesStopped':all(x.poll() is not None for x in procs),'pids':[x.pid for x in procs],'fixtureStopped':True,'volume':'KEEP'},indent=2))
 if result:(out/'result.json').write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
