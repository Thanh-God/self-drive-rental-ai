"""Start the explicitly approved AI3 local preview; never reset or seed the database.

Use --apply only after approving backup/migration of the existing local database.
Artifacts and the private SQL backup remain under the new --evidence directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.request
import uuid

REPO = Path(__file__).resolve().parents[2]
RUN = REPO / '.runtime/coordination-ai3-final-20261019'
IMAGE = 'ghcr.io/project-osrm/osrm-backend@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f'
MYSQL = 'ab0698eba8cf545bd23ab40451bfbae01a51a9666bfb66b166a44f81ea418007'
HISTORY = [('1', '190705803'), ('2', '-1792922806'), ('3', '1994983605')]


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def free_ports(ports=(8080, 5173, 5000, 11434)):
    for port in ports:
        with socket.socket() as sock:
            sock.settimeout(.3)
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Port {port} occupied; no existing service was stopped')


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
                            timeout=300, **kwargs)
    if result.returncode:
        raise RuntimeError('Command failed: ' + str(args[0]) + ' (private output withheld)')
    return result.stdout


def sql(query):
    return run(['docker', 'exec', MYSQL, 'sh', '-c',
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --batch --skip-column-names kdrive -e "$1"',
                'sh', query]).decode().strip()


def wait_json(url, predicate, timeout=180):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                value = json.load(response)
            if predicate(value):
                return value
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Readiness timeout: ' + url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    out = Path(args.evidence).resolve()
    if not out.is_relative_to(REPO / '.runtime') or out.exists():
        raise RuntimeError('A new evidence directory under .runtime is required')
    free_ports()
    for item in json.loads((RUN / 'source-hashes.json').read_text()):
        assert digest(REPO / item['file']) == item['afterDiskBytes'], 'Source drift: ' + item['file']
    jar = RUN / 'backend-copy/target/kdrive-0.1.0-SNAPSHOT.jar'
    provenance = json.loads((RUN / 'native-rerun/native/jar-provenance.json').read_text())
    assert digest(jar) == provenance['jarSHA256'], 'JAR drift'
    graph = REPO / '.runtime/coordination-ai3-20261019/osrm-central'
    manifest = json.loads((graph.parent / 'graph-manifest.json').read_text(encoding='utf-8-sig'))
    assert manifest['image'] == IMAGE
    for filename, expected in manifest['files'].items():
        path = (graph / filename).resolve()
        assert path.is_relative_to(graph) and digest(path).lower() == expected['sha256'].lower()
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(('SPRING_', 'KDRIVE_TEST_', 'KDRIVE_MIGRATION_', 'VITE_'))}
    allowed = set(re.findall(r'\$\{([A-Z_]+)', (REPO / 'backend/src/main/resources/application.yml').read_text()))
    for line in (REPO / 'backend/.env.local').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip().removeprefix('export ')
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            if key.strip() in allowed:
                env[key.strip()] = value.strip().strip('\"\'')
    assert env['DB_URL'].startswith('jdbc:mysql://127.0.0.1:33385/kdrive?'), 'Wrong database'
    assert len(env['JWT_SECRET']) >= 32
    identity = json.loads(run(['docker', 'inspect', MYSQL]))[0]
    assert identity['Id'] == MYSQL and identity['State']['Running']
    assert any(p['HostPort'] == '33385' for p in identity['NetworkSettings']['Ports']['3306/tcp'])
    history = sql('SELECT version,checksum FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank')
    assert [tuple(row.split('\t')) for row in history.splitlines()] == HISTORY, 'Expected V3 database'
    assert sql('SELECT COUNT(*) FROM flyway_schema_history WHERE success=0') == '0'
    model_root = Path('E:/AI_Cache/ollama')
    model = json.loads((model_root / 'manifests/registry.ollama.ai/library/qwen3/8b').read_text())
    for layer in model['layers']:
        blob = model_root / 'blobs' / layer['digest'].replace(':', '-')
        assert blob.is_file() and blob.stat().st_size == layer['size'], 'Missing model blob'
    if not args.apply:
        print('PREFLIGHT PASS; no files, services or database changes')
        return
    out.mkdir(parents=True)
    processes, owned, logs = [], None, []
    def start(command, name, child_env, cwd):
        log = (out / (name + '.log')).open('wb')
        logs.append(log)
        process = subprocess.Popen(command, cwd=cwd, env=child_env, stdout=log, stderr=log,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        processes.append((name, process))
    try:
        backup = out / 'database.private.sql'
        with backup.open('xb') as destination:
            result = subprocess.run(['docker', 'exec', MYSQL, 'sh', '-c',
                'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF kdrive'],
                stdout=destination, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW, timeout=300)
        assert result.returncode == 0 and backup.stat().st_size > 1000, 'Backup failed'
        counts = sql("SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'vehicles',COUNT(*) FROM vehicles UNION ALL SELECT 'bookings',COUNT(*) FROM bookings UNION ALL SELECT 'locations',COUNT(*) FROM locations")
        name = 'kltn-ai3-local-' + uuid.uuid4().hex[:12]
        owned = run(['docker', 'run', '-d', '--name', name, '--memory', '2g', '--cpus', '2',
                     '-p', '127.0.0.1:5000:5000', '-v', str(graph) + ':/data:ro', IMAGE,
                     'osrm-routed', '--algorithm', 'mld', '/data/central.osrm']).decode().strip()
        wait_json('http://127.0.0.1:5000/route/v1/driving/108.2272,16.0611;108.338,15.877?overview=false', lambda x: x.get('code') == 'Ok')
        env.update(OLLAMA_HOST='127.0.0.1:11434', OLLAMA_MODELS=str(model_root), OLLAMA_NUM_PARALLEL='1',
                   OLLAMA_MAX_LOADED_MODELS='1', OLLAMA_KEEP_ALIVE='2m', OLLAMA_DEBUG='false')
        start(['C:/Users/LENOVO/AppData/Local/Programs/Ollama/ollama.exe', 'serve'], 'ollama', env, REPO)
        wait_json('http://127.0.0.1:11434/api/tags', lambda x: any(m['name'] == 'qwen3:8b' for m in x['models']))
        env.update(SEED_ENABLED='false', GEMINI_PARSER_ENABLED='false', AI_RECOMMENDATION_ENABLED='true',
                   QWEN_PARSER_ENABLED='true', QWEN_MODEL='qwen3:8b', AI_ROUTING_ENABLED='true',
                   PORT='8080', FRONTEND_ORIGIN='http://localhost:5173')
        start(['E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe', '-jar', str(jar),
               '--server.address=127.0.0.1', '--logging.level.root=INFO'], 'backend', env, REPO / 'backend')
        wait_json('http://127.0.0.1:8080/api/v1/health', lambda x: x.get('status') == 'UP')
        after = sql('SELECT version,checksum FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank')
        assert [tuple(row.split('\t')) for row in after.splitlines()] == HISTORY + [('4', '-1613438858')]
        assert counts == sql("SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'vehicles',COUNT(*) FROM vehicles UNION ALL SELECT 'bookings',COUNT(*) FROM bookings UNION ALL SELECT 'locations',COUNT(*) FROM locations"), 'Row count changed'
        env.update(VITE_DATA_MODE='api', VITE_API_BASE_URL='/api/v1', VITE_PROXY_TARGET='http://127.0.0.1:8080')
        build = run(['npm.cmd', 'run', 'build'], cwd=REPO / 'frontend', env=env)
        (out / 'frontend-build.log').write_bytes(build)
        start(['node.exe', 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
               '--port', '5173', '--strictPort'], 'frontend', env, REPO / 'frontend')
        end = time.monotonic() + 30
        while True:
            try:
                with urllib.request.urlopen('http://127.0.0.1:5173', timeout=3) as response:
                    assert response.status == 200
                break
            except OSError:
                if time.monotonic() >= end:
                    raise
                time.sleep(1)
        record = dict(status='LOCAL_PREVIEW_READY', releaseReview='PENDING', seed=False,
                      jarSHA256=digest(jar), backupSHA256=digest(backup), mysqlId=MYSQL,
                      osrmId=owned, history=after, rowCounts=counts,
                      processes=[dict(name=n, pid=p.pid, command=p.args) for n, p in processes])
        assert all(p.poll() is None for _, p in processes), 'A service exited'
        (out / 'services.json').write_text(json.dumps(record, indent=2))
        print('LOCAL_PREVIEW_READY http://localhost:5173; independent release review pending')
    except BaseException:
        for _, process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=30)
        if owned:
            run(['docker', 'stop', owned])
        raise
    finally:
        for log in logs:
            log.close()


if __name__ == '__main__':
    main()
