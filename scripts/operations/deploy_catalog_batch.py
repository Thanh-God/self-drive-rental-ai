"""Deploy the explicitly approved OTO1 batch after exact target/backup/restore checks."""
import argparse
import gzip
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

from catalog_inventory import ORIGINAL_ID, inventory
from catalog_import import client

REPO = Path(__file__).resolve().parents[2]
ORIGINAL = 'kltn-phase5-rerun'
ORIGINAL_VOLUME = 'kltn_phase5_rerun_20261004_1823'
APPROVED_HASHES = {'catalog-create-proposal.json': 'be50ed1cc5596c924c30d836d6ea0cc467154749e012b39d1bc0dddd7a46d8dd',
                   'catalog-configure-proposal.json': '3b265497c69e3210764a67bde7d7b034a1d84720d00447836a097572cc57d38a'}
CATALOG_KEYS = ['vehicles', 'brands', 'categories', 'branches', 'routes', 'staffAssignments', 'images', 'history', 'staff']
PROTECTED = ['users', 'driver_licenses', 'bookings', 'booking_status_history', 'contracts', 'invoices', 'invoice_items', 'vehicle_handover_records', 'reviews', 'incident_cases', 'incident_events']


def validate_batch(batch, current):
    result = {}
    for name, expected_hash in APPROVED_HASHES.items():
        raw = (batch / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected_hash:
            raise ValueError('Approved proposal content drift: ' + name)
        proposal = json.loads(raw)
        if proposal.get('approved') is not False:
            raise ValueError('Proposal approval flag unexpectedly changed')
        result[name] = proposal | {'approved': True}
    reference = json.loads((batch / 'inventory-before.json').read_text(encoding='utf-8'))
    if current['containerId'] != ORIGINAL_ID or current['schema'] != 'kdrive':
        raise ValueError('Original target drift')
    for key in CATALOG_KEYS:
        if current['data'][key] != reference['data'][key]:
            raise ValueError('Current catalog drift before any write: ' + key)
    for image in result['catalog-configure-proposal.json']['images']:
        path = (REPO / 'frontend/public' / image['url'].lstrip('/')).resolve()
        if not path.is_relative_to(REPO / 'frontend/public') or hashlib.sha256(path.read_bytes()).hexdigest() != image['sha256']:
            raise ValueError('Image content drift')
    return result


def local_env(path):
    allowed = {'DB_URL', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET', 'SEED_PASSWORD'}
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            if key.strip() in allowed:
                values[key.strip()] = value.strip().strip('"').strip("'")
    if values.get('DB_URL') != 'jdbc:mysql://127.0.0.1:33385/kdrive?connectionTimeZone=UTC':
        raise ValueError('Expected explicit original DB_URL, no fallback allowed')
    if not all(values.get(key) for key in allowed):
        raise ValueError('Required local settings unavailable; no credential reset allowed')
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', type=Path, required=True)
    parser.add_argument('--backend-root', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--apply-approved-oto1', action='store_true')
    args = parser.parse_args()
    out, batch, backend = args.evidence.resolve(), args.batch.resolve(), args.backend_root.resolve()
    if out.exists() or not out.is_relative_to(REPO / '.runtime') or not batch.is_relative_to(REPO / '.runtime') or not backend.is_relative_to(REPO / '.runtime'):
        raise ValueError('New runtime evidence and local source/batch paths required')
    current = inventory()
    approved = validate_batch(batch, current)
    settings = local_env(REPO / 'backend/.env.local')
    if not args.apply_approved_oto1:
        print('Preflight passed. No writes; explicit --apply-approved-oto1 required.')
        return
    jar = backend / 'target/kdrive-0.1.0-SNAPSHOT.jar'
    for file in (REPO / 'backend/src/main').rglob('*'):
        if file.is_file() and file.read_bytes() != (backend / file.relative_to(REPO / 'backend')).read_bytes():
            raise ValueError('Backend source copy drift')
    with zipfile.ZipFile(jar) as archive:
        for file in (backend / 'target/classes').rglob('*'):
            if file.is_file() and archive.read('BOOT-INF/classes/' + file.relative_to(backend / 'target/classes').as_posix()) != file.read_bytes():
                raise ValueError('JAR class drift')
    for port in [8381, 5381, 33681]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    out.mkdir(parents=True)
    (out / 'inventory-before.json').write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding='utf-8')
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('SPRING_', 'DB_', 'SEED_', 'KDRIVE_TEST_')):
            env.pop(key)
    env.update(settings, SEED_ENABLED='false', PORT='8381', FRONTEND_ORIGIN='http://127.0.0.1:5381', VITE_DATA_MODE='api', VITE_API_BASE_URL='/api/v1', VITE_PROXY_TARGET='http://127.0.0.1:8381')
    checks, handles = [], []
    backend_process = frontend_process = None
    probe_started = False
    fixture = json.loads((batch / 'native-a/fixture.json').read_text())
    fixture_password = next(line.split('=', 1)[1] for line in (batch / 'native-a/mysql.private.env').read_text().splitlines() if line.startswith('MYSQL_ROOT_PASSWORD='))
    def run(command, input=None):
        return subprocess.run(command, cwd=REPO, env=env, input=input, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=180)
    def must(command, input=None):
        result = run(command, input)
        if result.returncode:
            raise RuntimeError('Private native operation failed; stopped without exposing credentials/data')
        return result.stdout
    def check(name, actual, expected):
        if actual != expected:
            raise AssertionError(name + ' differs; inspect local evidence')
        checks.append({'name': name, 'actual': actual, 'expected': expected})
        (out / 'checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
    def sql(container, query):
        if container == ORIGINAL:
            command = ['docker', 'exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 --batch --raw -N']
        else:
            command = ['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + fixture_password, container, 'mysql', '-uroot', '--default-character-set=utf8mb4', '--batch', '--raw', '-N']
        return must(command, query.encode()).decode().strip()
    def dump(tables=None):
        command = ['docker', 'exec', ORIGINAL, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --skip-comments --skip-add-locks --skip-lock-tables --compact --order-by-primary --hex-blob --set-gtid-purged=OFF --column-statistics=0 kdrive' + ('' if tables is None else ' ' + ' '.join(tables))]
        return must(command)
    def table_checksums(container, schema, tables):
        rows = sql(container, 'CHECKSUM TABLE ' + ','.join('`' + schema + '`.`' + table + '`' for table in tables) + ';').splitlines()
        values = {line.split('\t')[0].split('.')[-1]: line.split('\t')[1] for line in rows}
        if len(values) != len(tables) or any(not v.isdecimal() for v in values.values()):
            raise ValueError('Missing or unsupported table checksum')
        return values
    def spawn(command, label, cwd=REPO):
        handle = (out / (label + '.log')).open('wb')
        handles.append(handle)
        return subprocess.Popen(command, cwd=cwd, env=env, stdout=handle, stderr=handle, creationflags=subprocess.CREATE_NO_WINDOW)
    def stop(process):
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=25)
    try:
        check('Original identity and volume', must(['docker', 'inspect', '--format', '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}', ORIGINAL]).decode().strip(), ORIGINAL_ID + '|true|' + ORIGINAL_VOLUME)
        check('Probe identity stopped', must(['docker', 'inspect', '--format', '{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{if eq .Destination "/var/lib/mysql"}}{{.Name}}{{end}}{{end}}', fixture['name']]).decode().strip(), fixture['id'] + '|false|' + fixture['volume'])
        tables = sql(ORIGINAL, "SELECT table_name FROM information_schema.tables WHERE table_schema='kdrive' AND table_type='BASE TABLE' ORDER BY table_name;").splitlines()
        check('Original schema table count', len(tables), 26)
        check('Original foreign key count', int(sql(ORIGINAL, "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='kdrive';")), 37)
        initial_checksums = table_checksums(ORIGINAL, 'kdrive', tables)
        protected_before = hashlib.sha256(dump(PROTECTED)).hexdigest()
        raw_backup = dump()
        backup = out / 'kdrive-before.private.sql.gz'
        backup.write_bytes(gzip.compress(raw_backup))
        check('Backup gzip roundtrip SHA', hashlib.sha256(gzip.decompress(backup.read_bytes())).hexdigest(), hashlib.sha256(raw_backup).hexdigest())
        must(['docker', 'start', fixture['name']])
        probe_started = True
        for attempt in range(60):
            try:
                if sql(fixture['name'], 'SELECT 1') == '1':
                    break
            except RuntimeError:
                time.sleep(1)
        else:
            raise RuntimeError('Probe readiness timeout')
        schema = 'oto1_backup_' + uuid.uuid4().hex[:12]
        sql(fixture['name'], 'CREATE DATABASE ' + schema)
        must(['docker', 'exec', '-i', '-e', 'MYSQL_PWD=' + fixture_password, fixture['name'], 'mysql', '-uroot', '--default-character-set=utf8mb4', schema], gzip.decompress(backup.read_bytes()))
        check('Restored backup all table checksums', table_checksums(fixture['name'], schema, tables), initial_checksums)
        (out / 'backup-verification.json').write_text(json.dumps({'gzipSHA256': hashlib.sha256(backup.read_bytes()).hexdigest(), 'sqlSHA256': hashlib.sha256(raw_backup).hexdigest(), 'restoredSchema': schema, 'restoredFixture': fixture['id'], 'tableChecksums': initial_checksums, 'protectedBeforeSHA256': protected_before}, indent=2))
        must(['docker', 'stop', fixture['name']])
        probe_started = False
        # Stop before ANY application write if drift occurred during backup/restore.
        check('Catalog unchanged during backup', inventory()['data'], current['data'])
        check('All tables unchanged during backup', table_checksums(ORIGINAL, 'kdrive', tables), initial_checksums)
        backend_process = spawn(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe', '-jar', str(jar)], 'backend')
        token = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if backend_process.poll() is not None:
                raise RuntimeError('Owned backend exited; check local log')
            request = Request('http://127.0.0.1:8381/api/v1/auth/login', data=json.dumps({'email': 'admin@example.test', 'password': settings['SEED_PASSWORD']}).encode(), headers={'Content-Type': 'application/json'})
            try:
                with urlopen(request, timeout=3) as response:
                    token = json.load(response)['token']
                    break
            except HTTPError as error:
                if error.code in [400, 401, 403]:
                    raise RuntimeError('Existing Admin login rejected; no reset performed') from None
                time.sleep(1)
            except (URLError, TimeoutError, ConnectionError):
                time.sleep(1)
        if not token:
            raise RuntimeError('Backend readiness timeout')
        call = client('http://127.0.0.1:8381/api/v1', token)
        check('Admin role', call('GET', '/auth/me')['role'], 'ADMIN')
        check('API bound to expected original vehicle IDs', sorted(v['id'] for v in call('GET', '/vehicles')), sorted(v['id'] for v in current['data']['vehicles']))
        check('Schema/history/catalog still unchanged before first POST', inventory()['data'], current['data'])
        check('Protected data still unchanged before first POST', hashlib.sha256(dump(PROTECTED)).hexdigest(), protected_before)
        # Human-approved contents remain frozen; approved copies differ only in the flag.
        for proposal_name, script in [('catalog-create-proposal.json', 'catalog_import.py'), ('catalog-configure-proposal.json', 'configure_catalog.py')]:
            value = approved[proposal_name]
            reference = json.loads((batch / proposal_name).read_text(encoding='utf-8'))
            check('Only approval flag changed ' + proposal_name, value | {'approved': False}, reference)
            file = out / proposal_name.replace('-proposal', '-approved')
            file.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
            result = subprocess.run([os.sys.executable, '-X', 'utf8', str(REPO / 'scripts/operations' / script), str(file), '--apply', '--base-url', 'http://127.0.0.1:8381/api/v1', '--approved-sha256', hashlib.sha256(file.read_bytes()).hexdigest(), '--journal', str(out / (script + '.journal.jsonl'))], cwd=REPO, env=env | {'KDRIVE_ADMIN_TOKEN': token}, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=180)
            (out / (script + '.log')).write_bytes(result.stdout + result.stderr)
            check(script + ' actual exit', result.returncode, 0)
        after = inventory()
        (out / 'inventory-after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding='utf-8')
        counts = {key: len(after['data'][key]) for key in ['vehicles', 'brands', 'categories', 'branches', 'images', 'routes', 'staffAssignments']}
        check('Final SQL counts', counts, {'vehicles': 20, 'brands': 10, 'categories': 4, 'branches': 5, 'images': 34, 'routes': 11, 'staffAssignments': 5})
        check('Protected content preserved', hashlib.sha256(dump(PROTECTED)).hexdigest(), protected_before)
        check('Migration history unchanged', after['data']['history'], current['data']['history'])
        readback = {'vehicles': call('GET', '/vehicles'), 'catalog': call('GET', '/vehicles/catalog'), 'branches': call('GET', '/branches'), 'routes': call('GET', '/branch-routes')}
        (out / 'readback.json').write_text(json.dumps(readback, ensure_ascii=False, indent=2), encoding='utf-8')
        check('API vehicle count', len(readback['vehicles']), 20)
        frontend_process = spawn(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5381', '--strictPort'], 'frontend', REPO / 'frontend')
        time.sleep(3)
        result = subprocess.run(['node', str(REPO / 'scripts/operations/verify-oto1-browser.cjs')], cwd=REPO, env=env | {'OTO1_EVIDENCE': str(out), 'KDRIVE_PLAYWRIGHT': str(REPO / '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright')}, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=150)
        (out / 'browser.log').write_bytes(result.stdout + result.stderr)
        check('Original catalog browser actual exit', result.returncode, 0)
        check('Protected content unchanged after GET-only browser', hashlib.sha256(dump(PROTECTED)).hexdigest(), protected_before)
        (out / 'result.json').write_text(json.dumps({'status': 'APPLIED verified scoped; independent review pending', 'checks': len(checks), 'counts': counts, 'backup': str(backup), 'originalContainerId': ORIGINAL_ID}, indent=2))
        print('Approved batch APPLIED: 20 vehicles / 10 brands / 5 branches. Protected data preserved.')
    finally:
        stop(frontend_process)
        stop(backend_process)
        for handle in handles:
            handle.close()
        if probe_started:
            check('Probe cleanup identity', must(['docker', 'inspect', '--format', '{{.Id}}', fixture['name']]).decode().strip(), fixture['id'])
            must(['docker', 'stop', fixture['name']])
        (out / 'cleanup.json').write_text(json.dumps({'backendStopped': backend_process is None or backend_process.poll() is not None, 'frontendStopped': frontend_process is None or frontend_process.poll() is not None, 'probeStopped': must(['docker', 'inspect', '--format', '{{.State.Running}}', fixture['name']]).decode().strip() == 'false', 'originalStillRunning': must(['docker', 'inspect', '--format', '{{.State.Running}}', ORIGINAL]).decode().strip() == 'true'}, indent=2))


if __name__ == '__main__':
    main()
