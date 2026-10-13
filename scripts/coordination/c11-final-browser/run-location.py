"""Recheck location persistence after shared auth changes, on the exact A4 fixture."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import uuid
import xml.etree.ElementTree as ET

REPO=Path(__file__).resolve().parents[3]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--backend-root',required=True)
    parser.add_argument('--backend-evidence',required=True)
    parser.add_argument('--evidence',required=True)
    args=parser.parse_args()
    out=Path(args.evidence).resolve()
    if not out.is_relative_to(REPO/'.runtime') or out.exists():
        raise RuntimeError('[PREFLIGHT_REFUSAL] Runtime new output required')
    build=Path(args.backend_root).resolve();backend=Path(args.backend_evidence).resolve()
    if not all(p.is_relative_to(REPO/'.runtime') for p in [build,backend]):
        raise RuntimeError('[PREFLIGHT_REFUSAL] Runtime inputs required')
    fixture=json.loads((backend/'fixture.json').read_text())
    assert fixture['name'].startswith('kltn-c11-a4-') and fixture['port']==33675
    for rel,sha in json.loads((backend/'inputs-before.json').read_text()).items():
        assert hashlib.sha256((REPO/rel).read_bytes()).hexdigest()==sha,rel
    jar=build/'target/kdrive-0.1.0-SNAPSHOT.jar'
    assert hashlib.sha256(jar.read_bytes()).hexdigest()==json.loads((backend/'jar-provenance.json').read_text())['jarSHA256']
    password=next(line.split('=',1)[1] for line in (backend/'mysql.private.env').read_text().splitlines() if line.startswith('MYSQL_ROOT_PASSWORD='))
    env=os.environ.copy();flags=subprocess.CREATE_NO_WINDOW
    def run(command,cwd=REPO):
        result=subprocess.run(command,cwd=cwd,env=env,capture_output=True,creationflags=flags,timeout=300)
        if result.returncode:raise RuntimeError('Native failed; private execution')
        return result.stdout
    assert run(['docker','inspect','--format','{{.Id}}|{{.State.Running}}',fixture['name']]).decode().strip()==fixture['id']+'|false'
    out.mkdir(parents=True);started=False
    schema='kdrive_c11_location_a4_'+uuid.uuid4().hex[:8];marker=schema+'_meta';token=uuid.uuid4().hex
    def sql(query):return run(['docker','exec','-e','MYSQL_PWD='+password,fixture['name'],'mysql','-uroot','--default-character-set=utf8mb4','-N','-e',query])
    try:
        run(['docker','start',fixture['name']]);started=True
        import time
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            try:
                if sql('SELECT 1').strip()==b'1':break
            except RuntimeError:pass
            time.sleep(1)
        else:raise RuntimeError('SQL readiness deadline')
        sql(f"CREATE DATABASE {schema}; CREATE DATABASE {marker}; CREATE TABLE {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO {marker}.__kdrive_test_fixture_marker VALUES(1,'{schema}','{token}');")
        env.update(JAVA_HOME='E:/Tools/Java/jdk-21.0.12.1+1',KDRIVE_TEST_DB_URL=f'jdbc:mysql://127.0.0.1:33675/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC',KDRIVE_TEST_DB_USER='root',KDRIVE_TEST_DB_PASSWORD=password,KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX=schema,KDRIVE_TEST_FIXTURE_MARKER_TOKEN=token,KDRIVE_TEST_EXPECTED_HOST='127.0.0.1',KDRIVE_TEST_EXPECTED_PORT='33675',KDRIVE_TEST_EXPECTED_SCHEMA=schema,KDRIVE_TEST_MARKER_SCHEMA=marker)
        result=subprocess.run([str(build/'mvnw.cmd'),'-o','-B','-ntp',f'-Dmaven.repo.local={REPO/".runtime/m2"}','-Dtest=LocationIntegrationTest,LocationCategoryIntegrationTest','test'],cwd=build,env=env,capture_output=True,creationflags=flags,timeout=300)
        (out/'maven.log').write_bytes(result.stdout+result.stderr);(out/'maven-exit.txt').write_text(str(result.returncode));assert result.returncode==0
        for suite in ['LocationIntegrationTest','LocationCategoryIntegrationTest']:
            xml=build/f'target/surefire-reports/TEST-com.carrental.{suite}.xml';report=ET.parse(xml).getroot()
            assert [int(report.get(k,'0')) for k in ['tests','failures','errors','skipped']]==[3,0,0,0]
            shutil.copy2(xml,out/xml.name)
        for rel,sha in json.loads((backend/'inputs-before.json').read_text()).items():assert hashlib.sha256((REPO/rel).read_bytes()).hexdigest()==sha,rel
        assert hashlib.sha256(jar.read_bytes()).hexdigest()==json.loads((backend/'jar-provenance.json').read_text())['jarSHA256']
        (out/'sql-readback.txt').write_bytes(sql(f'SELECT version,checksum,success FROM {schema}.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM {schema}.locations; SELECT COUNT(*) FROM {schema}.location_categories;'))
        (out/'result.json').write_text(json.dumps({'status':'PASS location MySQL scoped','tests':6,'skips':0,'transport':'Spring MockMvc','database':'MySQL','schema':schema}))
    finally:
        if started:
            assert run(['docker','inspect','--format','{{.Id}}',fixture['name']]).decode().strip()==fixture['id']
            run(['docker','stop',fixture['name']]);assert run(['docker','inspect','--format','{{.State.Running}}',fixture['name']]).strip()==b'false'
            (out/'cleanup.json').write_text(json.dumps({'fixtureStopped':True,'volume':'KEEP','id':fixture['id']}))

if __name__=='__main__':main()
