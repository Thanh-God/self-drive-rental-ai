"""Unsafe target must fail at the actual test entrypoint, before any JDBC startup."""
import argparse,json,os,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]

def main():
 p=argparse.ArgumentParser();p.add_argument('--backend-root',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
 build=Path(a.backend_root).resolve();out=Path(a.evidence).resolve()
 assert build.is_relative_to(REPO/'.runtime') and out.is_relative_to(REPO/'.runtime') and not out.exists()
 for source in (REPO/'backend/src').rglob('*'):
  if source.is_file():assert source.read_bytes()==(build/source.relative_to(REPO/'backend')).read_bytes(),source
 out.mkdir();env=os.environ.copy()
 for key in list(env):
  if key.startswith(('KDRIVE_TEST_','KDRIVE_MIGRATION_','SPRING_')):env.pop(key)
 # Invalid credentials provide an additional safeguard if an entrypoint regresses.
 env.update(JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1',KDRIVE_TEST_DB_URL='jdbc:mysql://127.0.0.1:33385/kdrive_c14_never_connect?useSSL=false',
            KDRIVE_TEST_DB_USER='never_valid_c14_guard',KDRIVE_TEST_DB_PASSWORD='never_valid_c14_guard',
            KDRIVE_TEST_EXPECTED_HOST='127.0.0.1',KDRIVE_TEST_EXPECTED_PORT='33385',KDRIVE_TEST_EXPECTED_SCHEMA='kdrive_c14_never_connect',
            KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX='kdrive_c14_',KDRIVE_TEST_FIXTURE_MARKER_TOKEN='never-valid-marker',
            KDRIVE_MIGRATION_MYSQL_URL='jdbc:mysql://127.0.0.1:33385/mysql?useSSL=false',KDRIVE_MIGRATION_MYSQL_USER='never_valid_c14_guard',KDRIVE_MIGRATION_MYSQL_PASSWORD='never_valid_c14_guard')
 probes=[('ConcurrencyAndRaceTest','concurrentBookingAttemptsOnlyOneSucceeds','[C5-F04 GUARD] Refusing database connection: Port 33385'),
         ('MySqlMigrationTest','freshAndV1UpgradePreserveDataAndMatchSchema','[MIGRATION GUARD] Admin connection must match isolated fixture endpoint')]
 results=[]
 for suite,method,cause in probes:
  r=subprocess.run([str(build/'mvnw.cmd'),'-o','-B','-ntp',f'-Dmaven.repo.local={REPO/".runtime/m2"}',f'-Dtest={suite}#{method}','test'],cwd=build,env=env,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=180)
  (out/(suite+'.log')).write_bytes(r.stdout+r.stderr)
  xml=build/f'target/surefire-reports/TEST-com.carrental.{suite}.xml';report=ET.parse(xml).getroot()
  assert r.returncode!=0 and report.get('tests')=='1' and report.get('errors')=='1' and report.get('skipped')=='0'
  error=report.find('testcase/error');assert error is not None and cause in (error.text or ''),'Unrelated failure is not guard proof'
  (out/xml.name).write_bytes(xml.read_bytes());results.append({'entrypoint':suite,'method':method,'nativeExit':r.returncode,'expectedGuardRefusal':True,'cause':cause})
 (out/'result.json').write_text(json.dumps({'status':'PASS entrypoint refusal scoped','probes':results},indent=2));print('PASS actual entrypoint refusals 2')
if __name__=='__main__':main()
