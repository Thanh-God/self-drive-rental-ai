"""Read-only document permissions on the same completed browser workflow IDs."""
import argparse,hashlib,json,os,socket,subprocess,time,urllib.request,urllib.error
from pathlib import Path
REPO=Path(__file__).resolve().parents[3];FLAGS=subprocess.CREATE_NO_WINDOW

def main():
 p=argparse.ArgumentParser();p.add_argument('--linked-evidence',required=True);p.add_argument('--backend-evidence',required=True);p.add_argument('--backend-root',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
 linked,native,build,out=[Path(x).resolve() for x in [a.linked_evidence,a.backend_evidence,a.backend_root,a.evidence]]
 assert all(x.is_relative_to(REPO/'.runtime') for x in [linked,native,build,out]) and not out.exists()
 assert json.loads((linked/'result.json').read_text())['status']=='PASS C14 linked browser scoped'
 f=json.loads((native/'fixture.json').read_text());assert f['name'].startswith('kltn-c14-core-') and f['port']==33676
 jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar';assert hashlib.sha256(jar.read_bytes()).hexdigest()==json.loads((native/'jar-provenance.json').read_text())['jarSHA256']
 ids=json.loads((linked/'workflow-ids.json').read_text());assert len(ids)==2
 config=(linked/'application.private.properties').read_text();schema=(linked/'browser-schema.txt').read_text().strip();assert schema.startswith('kdrive_c14_browser_')
 password=next(l.split('=',1)[1] for l in config.splitlines() if l.startswith('spring.datasource.password='))
 env=os.environ.copy()
 for key in list(env):
  if key.startswith('SPRING_'):env.pop(key)
 def run(c):
  r=subprocess.run(c,env=env,capture_output=True,creationflags=FLAGS,timeout=30);assert r.returncode==0,'Private execution failed';return r.stdout
 inspection=json.loads(run(['docker','inspect',f['name']]))[0];assert inspection['Id']==f['id'] and not inspection['State']['Running']
 assert [m['Name'] for m in inspection['Mounts'] if m['Destination']=='/var/lib/mysql']==[f['volume']]
 for port in [33676,8300]:
  with socket.socket() as sock:sock.bind(('127.0.0.1',port))
 def sql(q):return run(['docker','exec','-e','MYSQL_PWD='+password,f['name'],'mysql','-uroot','--default-character-set=utf8mb4','--batch','--raw','-N',schema,'-e',q]).decode('utf-8')
 def request(path,token=None,body=None):
  headers={'Content-Type':'application/json'}
  if token:headers['Authorization']='Bearer '+token
  req=urllib.request.Request('http://127.0.0.1:8300/api/v1'+path,headers=headers,data=None if body is None else json.dumps(body).encode())
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.loads(r.read())
  except urllib.error.HTTPError as e:return e.code,None
 out.mkdir();copied=out/'application.private.properties';copied.write_text(config)
 before=hashlib.sha256(jar.read_bytes()).hexdigest();checks=[];started=False;process=None;handle=None;final=None
 try:
  run(['docker','start',f['name']]);started=True;time.sleep(3)
  handle=(out/'backend.log').open('wb');process=subprocess.Popen(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe','-jar',str(jar),'--spring.config.additional-location=file:'+copied.as_posix()],env=env,stdout=handle,stderr=handle,creationflags=FLAGS)
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   assert process.poll() is None
   try:
    if request('/health')[0]==200:break
   except OSError:pass
   time.sleep(1)
  else:raise RuntimeError('Backend readiness deadline')
  tokens={}
  for name,email in [('owner','user@example.test'),('admin','admin@example.test'),('dn','staff.dn@example.test'),('hn','staff.hn@example.test'),('other','c14-other@example.test')]:
   status,data=request('/auth/login',body={'email':email,'password':'C14FixtureOnly!' if name=='other' else 'BranchBookingTestOnly123!'});assert status==200;tokens[name]=data['token']
  snapshot=lambda:sql('SELECT * FROM contracts ORDER BY id;SELECT * FROM invoices ORDER BY id;SELECT * FROM invoice_items ORDER BY id;SELECT id,status,version,total FROM bookings ORDER BY id;')
  saved=snapshot()
  for index,booking in enumerate(ids):
   for kind in ['contract','invoice']:
    for name in ['guest','other','owner','admin','dn','hn']:
     expected=401 if name=='guest' else 404 if name=='other' or (name=='hn' and index==0) else 200
     status,data=request('/bookings/'+booking+'/'+kind,tokens.get(name));assert status==expected,(kind,name,status,expected)
     if expected==200:assert len(data)==1
     checks.append({'workflow':booking,'document':kind,'actor':name,'actual':status,'expected':expected})
  assert saved==snapshot(),'Document reads changed business data';assert before==hashlib.sha256(jar.read_bytes()).hexdigest()
  (out/'checks.json').write_text(json.dumps(checks,indent=2));(out/'sql-readback.txt').write_text(saved)
  final={'status':'PASS linked document reads scoped','assertions':len(checks)+2,'sameWorkflowIds':ids,'jarSHA256':before}
 finally:
  if process is not None and process.poll() is None:process.terminate();process.wait(timeout=20)
  if handle:handle.close()
  if started:
   assert run(['docker','inspect','--format','{{.Id}}',f['name']]).decode().strip()==f['id'];run(['docker','stop',f['name']]);assert run(['docker','inspect','--format','{{.State.Running}}',f['name']]).decode().strip()=='false'
  (out/'cleanup.json').write_text(json.dumps({'ownedBackendStopped':process is None or process.poll() is not None,'fixtureStopped':True,'volume':'KEEP'}))
 if final:(out/'result.json').write_text(json.dumps(final,indent=2));print('PASS linked document read permissions '+str(final['assertions']))
if __name__=='__main__':main()
