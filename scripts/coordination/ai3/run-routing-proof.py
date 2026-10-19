"""Sequential owned OSRM online/offline proof using the guarded native MySQL runner.

Requires an already verified isolated backend copy and a stopped reusable fixture.
Keeps all containers, volumes and evidence. Never targets the user's database.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import uuid
import urllib.request
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[3]
IMAGE = 'ghcr.io/project-osrm/osrm-backend@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f'
METHODS = {
    'online': 'onlineRoutePreview_RequiresLiveOsrm_MustBeVerified_BothDirectionsAndMultiPoint',
    'offline': 'offlineRoutePreview_WhenOsrmStopped_ReturnsUnavailableWithNoInventedEstimates',
}


def listening():
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', 5000)) == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-root', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--reuse-evidence', required=True)
    parser.add_argument('--graph-dir', required=True)
    parser.add_argument('--graph-manifest', required=True)
    args = parser.parse_args()
    out, build = Path(args.evidence).resolve(), Path(args.backend_root).resolve()
    graph, manifest_path = Path(args.graph_dir).resolve(), Path(args.graph_manifest).resolve()
    assert out.is_relative_to(REPO / '.runtime') and not out.exists(), 'New runtime evidence required'
    assert build.is_relative_to(REPO / '.runtime') and (build / 'target/kdrive-0.1.0-SNAPSHOT.jar').is_file()
    assert graph.is_relative_to(REPO / '.runtime') and manifest_path.is_relative_to(REPO / '.runtime')
    assert not listening(), 'Port5000 already occupied; do not stop someone else\'s provider'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    assert manifest['image'] == IMAGE
    for filename, expected in manifest['files'].items():
        source = (graph / filename).resolve()
        assert source.is_relative_to(graph) and source.is_file()
        assert hashlib.sha256(source.read_bytes()).hexdigest().lower() == expected['sha256'].lower(), filename
    out.mkdir(parents=True)
    shutil.copy2(manifest_path, out / 'graph-manifest.json')
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('KDRIVE_TEST_', 'KDRIVE_MIGRATION_', 'SPRING_')):
            env.pop(key)
    env['JAVA_HOME'] = 'E:/Tools/Java/jdk-21.0.12.1+1'
    owned = None
    name = 'kltn-ai3-proof-' + uuid.uuid4().hex[:12]

    def run(command, log=None, check=True, cwd=REPO, extra_env=None):
        result = subprocess.run(command, cwd=cwd, env=extra_env or env, capture_output=True,
                                creationflags=subprocess.CREATE_NO_WINDOW, timeout=900)
        if log:
            (out / log).write_bytes(result.stdout + result.stderr)
            (out / (log + '.exit')).write_text(str(result.returncode))
        if check and result.returncode:
            raise RuntimeError('Command failed; see ' + str(log or 'private command'))
        return result

    def inspect():
        data = json.loads(run(['docker', 'inspect', name]).stdout)[0]
        assert data['Id'] == owned, 'Owned container identity changed'
        return data

    def adverse(mode):
        # Direct real HTTP/H2 invocation deliberately requests the wrong provider state.
        wrong_env = env.copy()
        wrong_env['KDRIVE_ROUTING_MODE'] = mode
        result = run([str(build / 'mvnw.cmd'), '-o', '-B', '-ntp',
                      '-Dmaven.repo.local=' + str(REPO / '.runtime/m2'),
                      '-Dtest=LocationRouteHttpServerTest#' + METHODS[mode], 'test'],
                     log='adverse-' + mode + '.log', check=False, cwd=build, extra_env=wrong_env)
        xml = build / 'target/surefire-reports/TEST-com.carrental.LocationRouteHttpServerTest.xml'
        report = ET.parse(xml).getroot()
        assert result.returncode != 0
        assert [int(report.get(k, '0')) for k in ['tests', 'failures', 'errors', 'skipped']] == [1, 1, 0, 0]
        case = report.find('testcase')
        assert case.get('name') == METHODS[mode]
        failure = case.find('failure').get('message', '')
        expected = ('expected: <VERIFIED> but was: <UNAVAILABLE>' if mode == 'online'
                    else 'expected: <UNAVAILABLE> but was: <VERIFIED>')
        assert expected in failure, failure
        shutil.copy2(xml, out / ('adverse-' + mode + '.xml'))

    def native(mode, previous):
        evidence = out / mode
        historical = evidence.parent / 'historical-migration'
        if not historical.exists():
            historical.mkdir()
            for filename in ['V1__rental_schema.sql', 'V2__incident_audit_and_review_vehicle.sql']:
                shutil.copy2(REPO / 'backend/src/main/resources/db/migration' / filename, historical / filename)
        run([os.sys.executable, str(REPO / 'scripts/coordination/c14-core/run-mysql.py'),
             '--backend-root', str(build), '--evidence', str(evidence),
             '--reuse-evidence', str(previous), '--suites', 'LocationRouteHttpServerTest',
             '--routing-mode', mode], log='native-' + mode + '.log')
        result = json.loads((evidence / 'result.json').read_text())
        assert result['tests'] == 3 and result['skips'] == 0
        assert result['suites'][0]['routingMode'] == mode
        return evidence

    def stop_owned():
        if inspect()['State']['Running']:
            run(['docker', 'stop', name])
        assert not inspect()['State']['Running']
        assert not listening(), 'Owned OSRM port must close'

    try:
        owned = run(['docker', 'run', '-d', '--name', name, '--memory', '2g', '--cpus', '2',
                     '-p', '127.0.0.1:5000:5000', '--mount',
                     'type=bind,source=' + str(graph) + ',target=/data,readonly', IMAGE,
                     'osrm-routed', '--algorithm', 'mld', '/data/central.osrm']).stdout.decode().strip()
        (out / 'osrm-identity.json').write_text(json.dumps({'name': name, 'id': owned, 'image': IMAGE}, indent=2))
        deadline = time.monotonic() + 60
        while not listening():
            assert inspect()['State']['Running'], 'OSRM failed to start'
            if time.monotonic() > deadline:
                raise TimeoutError('OSRM readiness')
            time.sleep(1)
        readiness = []
        while True:
            assert inspect()['State']['Running'], 'OSRM exited before HTTP readiness'
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                    'http://127.0.0.1:5000/route/v1/driving/108.2022,16.0544;108.338,15.8801?overview=false',
                    timeout=2) as response:
                    assert response.status == 200
                    assert json.loads(response.read(32768)).get('code') == 'Ok', 'Expected graph route missing'
                readiness.append('HTTP route ready')
                break
            except (OSError, http.client.HTTPException) as error:
                readiness.append(type(error).__name__)
                if time.monotonic() > deadline:
                    raise TimeoutError('OSRM HTTP readiness') from error
                time.sleep(1)
        (out / 'readiness.json').write_text(json.dumps(readiness))
        # Raw probe proves this is the expected graph, not just any listening socket.
        run([os.sys.executable, str(REPO / 'scripts/coordination/ai3/probe-osrm.py'),
             '--evidence', str(out / 'raw-graph')], log='raw-graph.log')
        adverse('offline')
        previous = native('online', Path(args.reuse_evidence).resolve())
        stop_owned()
        adverse('online')
        native('offline', previous)
        (out / 'result.json').write_text(json.dumps({'status': 'PASS scoped', 'nativeTests': 6,
            'nativeSkips': 0, 'expectedAdverseFailures': 2, 'scope': manifest['scope']}, indent=2))
    finally:
        if owned:
            stop_owned()
            (out / 'osrm.log').write_bytes(run(['docker', 'logs', name]).stdout)
            (out / 'cleanup.json').write_text(json.dumps({'osrmStopped': True, 'container': name,
                'id': owned, 'graph': 'KEEP', 'containerPolicy': 'KEEP stopped'}))


if __name__ == '__main__':
    main()
