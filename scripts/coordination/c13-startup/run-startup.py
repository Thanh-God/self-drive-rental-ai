"""Real startup from a source-only snapshot and an exact isolated MySQL fixture."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request
import uuid
import zipfile

REPO=Path(__file__).resolve().parents[3]
FLAGS=subprocess.CREATE_NO_WINDOW

def main():
 parser=argparse.ArgumentParser();parser.add_argument("--evidence",required=True);parser.add_argument("--backend-evidence",required=True);args=parser.parse_args()
 out=Path(args.evidence).resolve();proof=Path(args.backend_evidence).resolve()
 if not out.is_relative_to(REPO/".runtime") or out.exists() or not proof.is_relative_to(REPO/".runtime"):raise RuntimeError("New runtime output and isolated backend evidence required")
 fixture=json.loads((proof/"fixture.json").read_text());assert fixture["name"].startswith("kltn-c12-report-") and fixture["port"]==33675
 def native(command,cwd=REPO,env=None,timeout=180):
  r=subprocess.run(command,cwd=cwd,env=env,capture_output=True,creationflags=FLAGS,timeout=timeout)
  if r.returncode:raise RuntimeError("Native command failed (arguments/output suppressed)")
  return r.stdout
 assert native(["docker","inspect","--format","{{.Id}}|{{.State.Running}}",fixture["name"]]).decode().strip()==fixture["id"]+"|false"
 for port in [33675,8299,5299]:
  with socket.socket() as sock:sock.bind(("127.0.0.1",port))
 tracked=native(["git","ls-files","-z"]).decode().split("\0");tracked=[p for p in tracked if p]
 tracked+=['scripts/coordination/c13-startup/'+n for n in ['test_startup.py','run-startup.py','README.md'] if 'scripts/coordination/c13-startup/'+n not in tracked]
 assert not any(p.startswith((".runtime/",".local/internal-docs/")) or p.endswith(".env.local") for p in tracked)
 before={p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in tracked}
 out.mkdir(parents=True);source=out/"source";source.mkdir()
 for rel in tracked:
  target=source/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REPO/rel,target)
 for rel in tracked:assert hashlib.sha256((source/rel).read_bytes()).hexdigest()==before[rel]
 assert not any((source/p).exists() for p in ['.git','backend/target','frontend/node_modules','backend/.env.local'])
 (out/"inputs-before.json").write_text(json.dumps(before,indent=2))
 password=next(l.split('=',1)[1] for l in (proof/'mysql.private.env').read_text().splitlines() if l.startswith('MYSQL_ROOT_PASSWORD='))
 env=os.environ.copy()
 for key in ['DB_URL','DB_USER','DB_PASSWORD','JWT_SECRET','PORT','FRONTEND_ORIGIN','SEED_ENABLED','SEED_PASSWORD','BACKEND_ENV_FILE','SPRING_PROFILES_ACTIVE']:env.pop(key,None)
 secret=uuid.uuid4().hex+uuid.uuid4().hex
 env.update(JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1',FRONTEND_PORT='5299',VITE_PROXY_TARGET='http://127.0.0.1:8299',MAVEN_OPTS='-Dmaven.repo.local='+REPO.joinpath('.runtime/m2').as_posix(),MAVEN_ARGS='-o',C11_PLAYWRIGHT=str(REPO/'.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'),C11_EVIDENCE=str(out))
 handles=[];processes=[];started=False;checks=[];final_result=None
 def check(name,actual,expected):
  assert actual==expected,name;checks.append({'name':name,'actual':actual,'expected':expected});(out/'startup-assertions.json').write_text(json.dumps(checks,indent=2))
 def spawn(command,label,cwd=source):
  stdout=(out/(label+'.log')).open('wb');stderr=(out/(label+'-error.log')).open('wb');handles.extend([stdout,stderr]);p=subprocess.Popen(command,cwd=cwd,env=env,stdout=stdout,stderr=stderr,creationflags=FLAGS);processes.append(p);return p
 def get(url):
  with urllib.request.urlopen(url,timeout=3) as r:return r.read()
 try:
  native(['docker','start',fixture['name']]);started=True
  deadline=time.monotonic()+60
  while time.monotonic()<deadline:
   r=subprocess.run(['docker','exec','-e','MYSQL_PWD='+password,fixture['name'],'mysql','-uroot','-N','-e','SELECT 1'],capture_output=True,creationflags=FLAGS,timeout=10)
   if r.returncode==0 and r.stdout.strip()==b'1':break
   time.sleep(1)
  else:raise RuntimeError('MySQL readiness deadline')
  schema='kdrive_c13_startup_'+uuid.uuid4().hex[:12]
  native(['docker','exec','-e','MYSQL_PWD='+password,fixture['name'],'mysql','-uroot','-e','CREATE DATABASE '+schema])
  (out/'schema.txt').write_text(schema)
  envfile=out/'backend.private.env'
  envfile.write_text(f'DB_URL=jdbc:mysql://127.0.0.1:33675/{schema}?useSSL=false&allowPublicKeyRetrieval=true&connectionTimeZone=UTC\nDB_USER=root\nDB_PASSWORD={password}\nJWT_SECRET={secret}\nPORT=8299\nFRONTEND_ORIGIN=http://127.0.0.1:5299\nSEED_ENABLED=true\nSEED_PASSWORD=BranchBookingTestOnly123!\n',encoding='utf-8')
  (out/'application.private.properties').write_text('app.jwt-secret='+secret+'\n')
  node=shutil.which('node');npm=Path(shutil.which('npm.cmd')).parent/'node_modules/npm/bin/npm-cli.js'
  install=subprocess.run([node,str(npm),'ci','--offline'],cwd=source/'frontend',env=env,capture_output=True,creationflags=FLAGS,timeout=240)
  (out/'npm-ci.log').write_bytes(install.stdout+install.stderr);check('Fresh npm ci lockfile',install.returncode,0)
  bash=os.environ.get('KDRIVE_GIT_BASH','E:/data github/Git/bin/bash.exe')
  backend=spawn([bash,'--noprofile','--norc',str(source/'scripts/run-backend-gitbash.sh'),'--env-file',envfile.as_posix()],'backend')
  deadline=time.monotonic()+300
  while time.monotonic()<deadline:
   assert backend.poll() is None,'Backend script exited; inspect private backend logs'
   try:
    if json.loads(get('http://127.0.0.1:8299/api/v1/health'))['status']=='UP':break
   except (OSError,ValueError):pass
   time.sleep(1)
  else:raise RuntimeError('Backend startup deadline')
  jar=source/'backend/target/kdrive-0.1.0-SNAPSHOT.jar'
  with zipfile.ZipFile(jar) as archive:check('Fresh JAR has application class', 'BOOT-INF/classes/com/carrental/KDriveApplication.class' in archive.namelist(),True)
  check('Actual backend ready',json.loads(get('http://127.0.0.1:8299/api/v1/health'))['status'],'UP')
  frontend=spawn([bash,'--noprofile','--norc',str(source/'scripts/run-frontend-gitbash.sh')],'frontend')
  deadline=time.monotonic()+90
  while time.monotonic()<deadline:
   assert frontend.poll() is None,'Frontend script exited; inspect private frontend logs'
   try:
    if json.loads(get('http://127.0.0.1:5299/api/v1/health'))['status']=='UP':break
   except (OSError,ValueError):pass
   time.sleep(1)
  else:raise RuntimeError('Frontend startup deadline')
  check('Real Vite proxy reaches configured backend',json.loads(get('http://127.0.0.1:5299/api/v1/health'))['status'],'UP')
  config=get('http://127.0.0.1:5299/src/demo/config.js').decode()
  check('Actual Vite API mode', '\"VITE_DATA_MODE\": \"api\"' in config or '\"VITE_DATA_MODE\":\"api\"' in config,True)
  browser=subprocess.run([node,str(source/'scripts/coordination/c13-sessions/verify-browser.cjs')],cwd=source,env=env,capture_output=True,creationflags=FLAGS,timeout=300)
  (out/'browser.log').write_bytes(browser.stdout+browser.stderr);check('Clean-copy browser regression',browser.returncode,0)
  for rel,sha in before.items():assert hashlib.sha256((REPO/rel).read_bytes()).hexdigest()==sha and hashlib.sha256((source/rel).read_bytes()).hexdigest()==sha,rel
  final_result={'status':'PASS source-only startup scoped','startupAssertions':len(checks),'browserAssertions':len(json.loads((out/'browser-assertions.json').read_text())),'sourceHashesMatch':True,'jarSHA256':hashlib.sha256(jar.read_bytes()).hexdigest()}
 finally:
  for p in reversed(processes):
   if p.poll() is None:
    subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True,creationflags=FLAGS,timeout=20);p.wait(timeout=20)
  # npm can detach a Node child from the Bash process tree on Windows.
  # Identify leftovers by the unique source-only snapshot path and creation identity.
  source_key=source.as_posix().lower().replace("'","''")+'/'
  cleanup_script="""$root='SOURCE_KEY'; $owned=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -in @('node.exe','java.exe','bash.exe','cmd.exe','esbuild.exe') -and $_.CommandLine -and $_.CommandLine.Replace('\\','/').ToLowerInvariant().Contains($root) }); foreach($item in $owned){$current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$item.ProcessId); if($current -and $current.CreationDate -eq $item.CreationDate){Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop}}; $owned | Select-Object ProcessId,Name,CreationDate | ConvertTo-Json -Compress""".replace('SOURCE_KEY',source_key)
  leftover_cleanup=native(['powershell.exe','-NoProfile','-Command',cleanup_script])
  (out/'leftover-cleanup.json').write_bytes(leftover_cleanup)
  for h in handles:h.close()
  if started:
   assert native(['docker','inspect','--format','{{.Id}}',fixture['name']]).decode().strip()==fixture['id'];native(['docker','stop',fixture['name']])
  deadline=time.monotonic()+10
  while True:
   alive=[]
   for port in [8299,5299]:
    with socket.socket() as sock:
     if sock.connect_ex(('127.0.0.1',port))==0:alive.append(port)
   if not alive:break
   if time.monotonic()>deadline:raise RuntimeError('Owned service port still listening')
   time.sleep(0.2)
  (out/'cleanup.json').write_text(json.dumps({'ownedProcessesStopped':all(p.poll() is not None for p in processes),'portsStopped':[8299,5299],'fixtureStopped':native(['docker','inspect','--format','{{.State.Running}}',fixture['name']]).decode().strip()=='false','volume':'KEEP','pids':[p.pid for p in processes]},indent=2))

 if final_result is not None:(out/'result.json').write_text(json.dumps(final_result,indent=2))

if __name__=='__main__':main()
