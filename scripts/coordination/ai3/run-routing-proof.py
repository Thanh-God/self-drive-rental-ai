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

def osrm_fixture(registry, new_reason=None):
    if new_reason is not None:
        assert len(new_reason.strip()) >= 12, 'New OSRM fixture requires a specific approved reason'
        return None
    registry = Path(registry).resolve()
    assert registry.is_relative_to(REPO / '.runtime') and registry.is_file(), 'No registered OSRM fixture; creation is not automatic'
    entry = json.loads(registry.read_text(encoding='utf-8-sig'))
    evidence = (REPO / entry['evidence']).resolve()
    assert evidence.is_relative_to(REPO / '.runtime'), 'Runtime OSRM evidence required'
    original = json.loads((evidence / 'osrm-identity.json').read_text())
    assert all(entry[k] == original[k] for k in ['id', 'name']), 'OSRM registry/evidence identity mismatch'
    assert entry['name'].startswith('kltn-ai3-proof-') and original['image'] == IMAGE, 'Only registered test OSRM allowed'
    return entry

def validate_osrm_reuse(entry, data, graph):
    assert data['Id'] == entry['id'] and data['Name'].lstrip('/') == entry['name'], 'OSRM identity drift'
    assert data['State']['Status'] == 'exited', 'OSRM test fixture must be stopped'
    assert data['Config']['Image'] == IMAGE and data['Image'] == entry['imageId'], 'OSRM image drift'
    assert data['Config']['Cmd'] == ['osrm-routed', '--algorithm', 'mld', '/data/central.osrm'], 'OSRM command drift'
    assert data['HostConfig']['PortBindings'] == {'5000/tcp': [{'HostIp':'127.0.0.1','HostPort':'5000'}]}, 'OSRM port drift'
    mounts = data['Mounts']
    assert len(mounts) == 1 and mounts[0]['Type'] == 'bind' and mounts[0]['Destination'] == '/data' and not mounts[0]['RW'] and Path(mounts[0]['Source']).resolve() == graph.resolve(), 'OSRM graph mount drift'


def listening():
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', 5000)) == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend-root', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--reuse-evidence', required=True)
    parser.add_argument('--osrm-registry', default=str(REPO / '.runtime/docker-fixtures/osrm.json'))
    parser.add_argument('--new-fixture-reason', help='Exceptional new OSRM container only, with approved reason')
    parser.add_argument('--graph-dir', required=True)
    parser.add_argument('--graph-manifest', required=True)
    parser.add_argument('--browser-script', help='Optional repository proof run against the live regional graph')
    parser.add_argument('--itinerary-live', action='store_true',
                        help='Also run ItineraryLivePreviewIT online (live Qwen, KDRIVE_AI_LIVE_ITINERARY=true) and offline')
    parser.add_argument('--itinerary-scope', choices=['all', 'no-qwen', 'qwen'], default='all',
                        help='no-qwen: provider cases only; qwen: only the live Qwen case (online)')
    args = parser.parse_args()
    itinerary_counts = {'online': 0, 'offline': 0}
    if args.itinerary_live:
        if args.itinerary_scope != 'no-qwen':
            assert os.environ.get('KDRIVE_AI_LIVE_ITINERARY') == 'true', 'Itinerary live proof requires explicit KDRIVE_AI_LIVE_ITINERARY=true'
        itinerary_counts = {'all': {'online': 2, 'offline': 1}, 'no-qwen': {'online': 1, 'offline': 1},
                            'qwen': {'online': 1, 'offline': 0}}[args.itinerary_scope]
    else:
        assert args.itinerary_scope == 'all', '--itinerary-scope needs --itinerary-live'
    out, build = Path(args.evidence).resolve(), Path(args.backend_root).resolve()
    graph, manifest_path = Path(args.graph_dir).resolve(), Path(args.graph_manifest).resolve()
    assert out.is_relative_to(REPO / '.runtime') and not out.exists(), 'New runtime evidence required'
    reusable = osrm_fixture(args.osrm_registry, args.new_fixture_reason)
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
    if reusable:
        name = reusable['name']

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

    def native(mode, previous, suite='LocationRouteHttpServerTest', expected=3, extra=()):
        evidence = out / (mode if suite == 'LocationRouteHttpServerTest' else 'itinerary-' + mode)
        historical = evidence.parent / 'historical-migration'
        if not historical.exists():
            historical.mkdir()
            for filename in ['V1__rental_schema.sql', 'V2__incident_audit_and_review_vehicle.sql']:
                shutil.copy2(REPO / 'backend/src/main/resources/db/migration' / filename, historical / filename)
        run([os.sys.executable, str(REPO / 'scripts/coordination/c14-core/run-mysql.py'),
             '--backend-root', str(build), '--evidence', str(evidence),
             '--reuse-evidence', str(previous), '--suites', suite,
             '--routing-mode', mode, *extra], log='native-' + evidence.name + '.log')
        result = json.loads((evidence / 'result.json').read_text())
        assert result['tests'] == expected and result['skips'] == 0
        assert result['suites'][0]['routingMode'] == mode
        return evidence

    def stop_owned():
        if inspect()['State']['Running']:
            run(['docker', 'stop', name])
        assert not inspect()['State']['Running']
        assert not listening(), 'Owned OSRM port must close'

    try:
        if reusable:
            data = json.loads(run(['docker', 'inspect', name]).stdout)[0]
            validate_osrm_reuse(reusable, data, graph)
            owned = reusable['id']
            run(['docker', 'start', name])
        else:
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
        if itinerary_counts['online']:
            previous = native('online', previous, 'ItineraryLivePreviewIT', itinerary_counts['online'],
                              ('--itinerary-scope', args.itinerary_scope))
        if args.browser_script:
            browser_env = env.copy()
            browser_env['AI_ROUTING_ENABLED'] = 'true'
            run([os.sys.executable, str(REPO / 'scripts/coordination/c14-core/run-browser.py'),
                 '--backend-root', str(build), '--backend-evidence', str(previous),
                 '--evidence', str(out / 'browser'), '--browser-script', args.browser_script],
                log='browser-run.log', extra_env=browser_env)
        stop_owned()
        adverse('online')
        previous = native('offline', previous)
        if itinerary_counts['offline']:
            native('offline', previous, 'ItineraryLivePreviewIT', itinerary_counts['offline'],
                   ('--itinerary-scope', args.itinerary_scope))
        (out / 'result.json').write_text(json.dumps({'status': 'PASS scoped',
            'nativeTests': 6 + itinerary_counts['online'] + itinerary_counts['offline'], 'nativeSkips': 0,
            'expectedAdverseFailures': 2, 'itineraryLive': args.itinerary_live,
            'itineraryScope': args.itinerary_scope if args.itinerary_live else None, 'scope': manifest['scope']}, indent=2))
    finally:
        if owned:
            stop_owned()
            (out / 'osrm.log').write_bytes(run(['docker', 'logs', name]).stdout)
            (out / 'cleanup.json').write_text(json.dumps({'osrmStopped': True, 'container': name,
                'id': owned, 'graph': 'KEEP', 'containerPolicy': 'KEEP stopped'}))


if __name__ == '__main__':
    main()
