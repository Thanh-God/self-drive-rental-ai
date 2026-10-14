"""Native rehearsal on ONE owned MySQL fixture. Never targets original database."""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[2]
FLAGS = subprocess.CREATE_NO_WINDOW
DB_PORT, API_PORT, FRONT_PORT = 33681, 8381, 5381


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--backend-root", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    batch, backend, out = args.batch.resolve(), args.backend_root.resolve(), args.evidence.resolve()
    if not out.is_relative_to(REPO / '.runtime') or out.exists() or not backend.is_relative_to(REPO / '.runtime'):
        raise ValueError("New runtime evidence and verified backend copy required")
    source_hashes = {}
    for p in (REPO / 'backend/src/main').rglob('*'):
        if p.is_file():
            if p.read_bytes() != (backend / p.relative_to(REPO / 'backend')).read_bytes():
                raise ValueError("Backend copy drift")
            source_hashes[p.relative_to(REPO).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    jar = backend / 'target/kdrive-0.1.0-SNAPSHOT.jar'
    with zipfile.ZipFile(jar) as archive:
        for p in (backend / 'target/classes').rglob('*'):
            if p.is_file() and archive.read('BOOT-INF/classes/' + p.relative_to(backend / 'target/classes').as_posix()) != p.read_bytes():
                raise ValueError("JAR/classes drift")
    for port in [DB_PORT, API_PORT, FRONT_PORT]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    out.mkdir(parents=True)
    (out / 'source-provenance.json').write_text(json.dumps({'sourceHashes': source_hashes, 'jarSHA256': hashlib.sha256(jar.read_bytes()).hexdigest()}, indent=2))
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('DB_', 'SPRING_', 'SEED_', 'KDRIVE_TEST_')):
            env.pop(key)
    env['VITE_DATA_MODE'], env['VITE_API_BASE_URL'], env['VITE_PROXY_TARGET'] = 'api', '/api/v1', 'http://127.0.0.1:8381'
    password, seed_password = uuid.uuid4().hex, uuid.uuid4().hex + 'A1!'
    name = 'kltn-oto1-' + uuid.uuid4().hex[:12]
    volume = 'vol-' + name
    identity, backend_process, frontend_process = None, None, None
    handles, checks = [], []
    def check(name, actual, expected):
        if actual != expected:
            raise AssertionError(name + ': expected/actual differ; inspect private evidence')
        checks.append({'name': name, 'actual': actual, 'expected': expected})
        (out / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    def run(command, log=None, command_env=None, input=None):
        result = subprocess.run(command, cwd=REPO, env=command_env or env, input=input, capture_output=True, creationflags=FLAGS, timeout=240)
        if log:
            (out / log).write_bytes(result.stdout + result.stderr)
            (out / (log + '.exit')).write_text(str(result.returncode))
        return result
    def sql(query):
        result = run(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + password, name, 'mysql', '-uroot', '--default-character-set=utf8mb4', '--batch', '--raw', '-N'], input=query.encode())
        if result.returncode:
            raise RuntimeError('Fixture SQL failed (details suppressed)')
        return result.stdout.decode().strip()
    def snapshot(schema):
        tables = ['users', 'driver_licenses', 'bookings', 'booking_status_history', 'contracts', 'invoices', 'invoice_items', 'vehicle_handover_records', 'reviews', 'incident_cases', 'incident_events']
        result = run(['docker', 'exec', '-e', 'MYSQL_PWD=' + password, name, 'mysqldump', '-uroot', '--no-create-info', '--skip-comments', '--skip-add-locks', '--skip-lock-tables', '--compact', '--order-by-primary', schema, *tables])
        if result.returncode:
            raise RuntimeError('Protected snapshot failed')
        return hashlib.sha256(result.stdout).hexdigest()
    def http(method, path, payload=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = Request('http://127.0.0.1:8381/api/v1' + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers, method=method)
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    def spawn(command, label, cwd=REPO):
        handle = (out / (label + '.log')).open('wb')
        handles.append(handle)
        return subprocess.Popen(command, cwd=cwd, env=env, stdout=handle, stderr=handle, creationflags=FLAGS)
    def start_backend(schema, label):
        config = out / (label + '.private.properties')
        config.write_text(f'server.port=8381\nspring.datasource.url=jdbc:mysql://127.0.0.1:33681/{schema}?useSSL=false&allowPublicKeyRetrieval=true&connectionTimeZone=UTC\nspring.datasource.username=root\nspring.datasource.password={password}\napp.jwt-secret={uuid.uuid4().hex}{uuid.uuid4().hex}\napp.seed-enabled=true\napp.seed-password={seed_password}\napp.cors-origin=http://127.0.0.1:5381\n')
        process = spawn(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe', '-jar', str(jar), '--spring.config.additional-location=file:' + config.as_posix()], label)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Owned backend exited; inspect log')
                try:
                    login = http('POST', '/auth/login', {'email': 'admin@example.test', 'password': seed_password})
                    return process, login['token']
                except (HTTPError, URLError, TimeoutError, ConnectionError):
                    time.sleep(1)
            raise RuntimeError('Backend readiness timeout')
        except BaseException:
            stop(process)
            raise
    def stop(process):
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=25)
    def cli(script, file, token, journal, expected=0):
        child_env = env | {'KDRIVE_ADMIN_TOKEN': token}
        result = run([os.sys.executable, '-X', 'utf8', str(REPO / 'scripts/operations' / script), str(file), '--apply', '--base-url', 'http://127.0.0.1:8381/api/v1', '--approved-sha256', hashlib.sha256(file.read_bytes()).hexdigest(), '--journal', str(out / (journal + '.jsonl'))], log=journal + '.log', command_env=child_env)
        check(journal + ' exit', result.returncode, expected)
        return (result.stdout + result.stderr).decode('utf-8', errors='replace')
    try:
        private = out / 'mysql.private.env'
        private.write_text('MYSQL_ROOT_PASSWORD=' + password + '\nMYSQL_DATABASE=oto1_catalog\n')
        result = run(['docker', 'run', '-d', '--name', name, '-p', '127.0.0.1:33681:3306', '--env-file', str(private), '-v', volume + ':/var/lib/mysql', 'mysql:8.4'])
        if result.returncode:
            raise RuntimeError('Could not create owned fixture')
        identity = result.stdout.decode().strip()
        (out / 'fixture.json').write_text(json.dumps({'id': identity, 'name': name, 'volume': volume, 'port': DB_PORT, 'schemas': ['oto1_catalog', 'oto1_partial'], 'policy': 'KEEP stopped'}, indent=2))
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                if sql('SELECT 1') == '1':
                    break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('MySQL readiness timeout')
        check('Exact fixture identity', run(['docker', 'inspect', '--format', '{{.Id}}', name]).stdout.decode().strip(), identity)
        check('Exclusive fixture volume', run(['docker', 'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}', name]).stdout.decode().strip(), volume)
        backend_process, token = start_backend('oto1_catalog', 'backend-main')
        create = json.loads((batch / 'catalog-create-proposal.json').read_text(encoding='utf-8')) | {'approved': True}
        config = json.loads((batch / 'catalog-configure-proposal.json').read_text(encoding='utf-8')) | {'approved': True}
        # Reproduce observed original vehicle revisions using actual catalog API, never SQL edits.
        for edit in config['vehicles']:
            expected = edit['expected']
            row = next(v for v in http('GET', '/vehicles') if v['id'] == expected['id'])
            remaining = expected['version'] - row['version']
            if remaining < 0 or remaining % 2:
                raise ValueError('Cannot reproduce revision without altering plan')
            for step in range(remaining):
                desired = row | {'description': expected['description'] if step % 2 else expected['description'] + ' revision probe'}
                row = http('PUT', '/admin/vehicles/' + row['id'], desired, token)
            check('Observed revision ' + row['id'], row['version'], expected['version'])
        user_token = http('POST', '/auth/login', {'email': 'user@example.test', 'password': seed_password})['token']
        staff_token = http('POST', '/auth/login', {'email': 'staff.dn@example.test', 'password': seed_password})['token']
        wrong_staff = http('POST', '/auth/login', {'email': 'staff.hn@example.test', 'password': seed_password})['token']
        http('PUT', '/me/license', {'licenseNumber': 'OTO1-FIXTURE', 'scheme': 'VN_2025', 'licenseClass': 'B', 'expiresOn': '2035-12-31', 'automaticOnly': False, 'version': 0}, user_token)
        start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
        request = {'vehicleId': 'v1', 'pickupBranchId': 'dn', 'returnBranchId': 'dn', 'startAt': start.isoformat(), 'endAt': (start + timedelta(hours=24)).isoformat()}
        quote = http('POST', '/bookings/quote', request, user_token)
        booking = http('POST', '/bookings', request | {'expectedTotal': quote['total']}, user_token)
        http('POST', '/bookings/' + booking['id'] + '/actions', {'next': 'CONFIRMED', 'version': booking['version'], 'reason': 'Fixture representative contract'}, staff_token)
        contract_before = http('GET', '/bookings/' + booking['id'] + '/contract', token=user_token)
        protected_before = snapshot('oto1_catalog')
        for filename, value in [('create.fixture.json', create), ('configure.fixture.json', config)]:
            (out / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        cli('catalog_import.py', out / 'create.fixture.json', token, 'create-first')
        cli('catalog_import.py', out / 'create.fixture.json', token, 'create-repeat')
        check('Create repeat no writes', len((out / 'create-repeat.jsonl').read_text().splitlines()), 1)
        conflict = copy.deepcopy(create)
        conflict['vehicles'][0]['dailyPrice'] += 1
        (out / 'conflict.fixture.json').write_text(json.dumps(conflict), encoding='utf-8')
        text = cli('catalog_import.py', out / 'conflict.fixture.json', token, 'create-conflict', 1)
        check('Conflict exact cause', 'Existing plate differs' in text, True)
        check('Conflict no writes', len((out / 'create-conflict.jsonl').read_text().splitlines()), 1)
        cli('configure_catalog.py', out / 'configure.fixture.json', token, 'configure-first')
        cli('configure_catalog.py', out / 'configure.fixture.json', token, 'configure-repeat')
        check('Configuration repeat no writes', len((out / 'configure-repeat.jsonl').read_text().splitlines()), 1)
        rows, branches = http('GET', '/vehicles'), http('GET', '/branches')
        catalog = http('GET', '/vehicles/catalog')
        check('Real vehicle count', len(rows), 20)
        check('Brand count', len(catalog['brands']), 10)
        check('Branch count', len(branches), 5)
        check('Four vehicles per branch', sorted(sum(v['currentBranchId'] == b['id'] for v in rows) for b in branches), [4]*5)
        check('Real API images', sum(len(v['images']) for v in rows), 34)
        check('All cars have images', all(v['images'] for v in rows), True)
        check('No test labels in catalog data', any('DEMO' in v['plate'] or 'mẫu' in (v.get('description') or '') for v in rows), False)
        check('Protected rows byte digest preserved', snapshot('oto1_catalog'), protected_before)
        check('Existing contract snapshot preserved', http('GET', '/bookings/' + booking['id'] + '/contract', token=user_token), contract_before)
        target = next(v for v in rows if v['name'] == 'Nissan Almera')
        hue = next(b for b in branches if b['name'] == 'KDrive Huế')
        payload = {'status': 'MAINTENANCE', 'version': target['version']}
        for actor_token, name_label in [(wrong_staff, 'Wrong branch Staff'), (token, 'Admin no Staff operation')]:
            try:
                http('PATCH', '/vehicles/' + target['id'] + '/operation', payload, actor_token)
                raise AssertionError('Expected forbidden operation')
            except HTTPError as error:
                check(name_label, error.code, 403)
        maintained = http('PATCH', '/vehicles/' + target['id'] + '/operation', payload, staff_token)
        check('Assigned Staff can operate new branch', maintained['status'], 'MAINTENANCE')
        http('PATCH', '/vehicles/' + target['id'] + '/operation', {'status': 'ACTIVE', 'version': maintained['version']}, staff_token)
        fresh_quote = http('POST', '/bookings/quote', request | {'vehicleId': target['id'], 'pickupBranchId': hue['id'], 'returnBranchId': hue['id']}, user_token)
        check('New car same-branch quote', fresh_quote['total'], 600000)
        dn = next(b for b in branches if b['name'] == 'KDrive Đà Nẵng')
        cross_quote = http('POST', '/bookings/quote', request | {'vehicleId': target['id'], 'pickupBranchId': hue['id'], 'returnBranchId': dn['id']}, user_token)
        check('New car cross-branch quote', cross_quote['total'], 1400000)
        (out / 'readback.json').write_text(json.dumps({'vehicles': rows, 'catalog': catalog, 'branches': branches, 'routes': http('GET', '/branch-routes')}, ensure_ascii=False, indent=2), encoding='utf-8')
        frontend_process = spawn(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5381', '--strictPort'], 'frontend', REPO / 'frontend')
        time.sleep(3)
        browser_env = env | {'OTO1_EVIDENCE': str(out), 'KDRIVE_PLAYWRIGHT': str(REPO / '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright')}
        browser_result = run(['node', str(REPO / 'scripts/operations/verify-oto1-browser.cjs')], log='browser.log', command_env=browser_env)
        check('Real browser exit', browser_result.returncode, 0)
        stop(frontend_process)
        stop(backend_process)
        sql('CREATE DATABASE oto1_partial')
        backend_process, probe_token = start_backend('oto1_partial', 'backend-partial')
        partial = {'approved': True, 'branches': [{'name': 'Partial probe', 'address': 'Isolated fixture only'}], 'vehicles': [
            {'name': 'Probe car A', 'plate': 'PROBE-A', 'brand': 'ProbeBrand', 'category': 'Sedan', 'branch': 'Partial probe', 'seats': 5, 'transmission': 'AUTO', 'dailyPrice': 100000},
            {'name': 'Probe car B', 'plate': 'PROBE-B', 'brand': 'PróbeBrand', 'category': 'Sedan', 'branch': 'Partial probe', 'seats': 5, 'transmission': 'AUTO', 'dailyPrice': 100000}]}
        (out / 'partial.fixture.json').write_text(json.dumps(partial), encoding='utf-8')
        probe_before = snapshot('oto1_partial')
        text = cli('catalog_import.py', out / 'partial.fixture.json', probe_token, 'partial-failure', 1)
        check('Partial failure exact HTTP cause', 'HTTP 409' in text, True)
        check('Partial journal retains branch and brand', len((out / 'partial-failure.jsonl').read_text().splitlines()), 3)
        check('Partial stops before vehicle creation', len(http('GET', '/vehicles')), 3)
        check('Partial branch retained', len(http('GET', '/branches')), 3)
        check('Partial protected data unchanged', snapshot('oto1_partial'), probe_before)
        (out / 'result.json').write_text(json.dumps({'status': 'PASS native rehearsal scoped', 'assertions': len(checks), 'originalDBWrites': False, 'approval': 'original batch still unapproved'}, indent=2))
        print('PASS native catalog rehearsal: ' + str(len(checks)) + ' assertions')
    finally:
        stop(frontend_process)
        stop(backend_process)
        for handle in handles:
            handle.close()
        if identity:
            actual = run(['docker', 'inspect', '--format', '{{.Id}}', name]).stdout.decode().strip()
            if actual != identity:
                raise RuntimeError('Cleanup identity drift')
            if run(['docker', 'stop', name]).returncode:
                raise RuntimeError('Owned fixture failed to stop')
        cleanup = {'backendStopped': backend_process is None or backend_process.poll() is not None, 'frontendStopped': frontend_process is None or frontend_process.poll() is not None, 'fixtureStopped': identity is not None and run(['docker', 'inspect', '--format', '{{.State.Running}}', name]).stdout.decode().strip() == 'false', 'volume': 'KEEP'}
        (out / 'cleanup.json').write_text(json.dumps(cleanup, indent=2))


if __name__ == '__main__':
    main()
