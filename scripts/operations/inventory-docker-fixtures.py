"""Read-only Docker metadata inventory. Never serializes Env, commands or credentials."""
import argparse
import csv
import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROTECTED = {'kltn-phase5-rerun', 'quiz_mysql'}


def docker(*args):
    result = subprocess.run(['docker', *args], capture_output=True, timeout=120,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(f'Docker metadata command failed ({args[0]}), exit={result.returncode}')
    return result.stdout.decode('utf-8-sig').strip()


def evidence_index(root):
    """Link exact IDs in fixture metadata, not PASS words, mtimes or similar names."""
    index = {}
    excluded = {'node_modules', 'm2', '.git', 'target', 'dist', 'chrome-profile',
                'backend-copy', 'backend-src', '__pycache__'}
    for folder, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in excluded]
        for filename in files:
            if filename not in {'fixture.json', 'osrm-identity.json'}:
                continue
            source = Path(folder) / filename
            try:
                item = json.loads(source.read_text(encoding='utf-8-sig'))
                identity = item.get('id', '')
                if re.fullmatch('[0-9a-f]{64}', identity):
                    index.setdefault(identity, []).append(str(source.relative_to(REPO)))
            except (OSError, ValueError, AttributeError):
                continue
    return index


def classify(item, refs):
    if item['name'] in PROTECTED:
        return 'KEEP_PROTECTED', 'DB ứng dụng/ngoài phạm vi, không dọn'
    if item.get('registeredRole'):
        return 'KEEP_REGISTERED', 'Tài nguyên local/pool đã đăng ký, không dọn'
    if item['state'] in {'running', 'paused', 'restarting'}:
        return 'KEEP_RUNNING', 'Dịch vụ đang hoạt động; không dừng trong lượt kiểm kê'
    if not item['name'].startswith('kltn-'):
        return 'KEEP_UNKNOWN', 'Không xác định thuộc KLTN, không dọn'
    if any(len(refs.get(m['name'], [])) > 1 for m in item['mounts'] if m['type'] == 'volume'):
        return 'KEEP_SHARED_VOLUME', 'Volume có nhiều container tham chiếu, cần điều tra'
    if item['evidence']:
        return 'REVIEW_CLEANUP', 'Ứng viên rà soát archive/dọn, chưa duyệt xóa; cần kiểm assertions, archive và exact identity'
    return 'KEEP_NEEDS_EVIDENCE', 'Chưa tìm thấy fixture evidence khớp full ID; tên/exit0 không chứng minh dư thừa'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    out = Path(args.evidence).resolve()
    if not out.is_relative_to(REPO / '.runtime') or out.exists():
        raise ValueError('New .runtime evidence directory required')
    # All Docker calls in this entrypoint are metadata reads.
    context = docker('context', 'show')
    ids = docker('ps', '-aq', '--no-trunc').splitlines()
    evidence = evidence_index(REPO / '.runtime')
    records = []
    for start in range(0, len(ids), 20):
        for data in json.loads(docker('inspect', *ids[start:start + 20])):
            records.append({
                'id': data['Id'], 'name': data['Name'].lstrip('/'),
                'state': data['State']['Status'], 'exitCode': data['State']['ExitCode'],
                'imageId': data['Image'], 'image': data['Config']['Image'],
                'created': data['Created'],
                'ports': data['HostConfig'].get('PortBindings') or {},
                'mounts': [{'type': m['Type'], 'name': m.get('Name'),
                            'source': m['Source'], 'destination': m['Destination'], 'rw': m['RW']}
                           for m in data['Mounts']],
                'evidence': evidence.get(data['Id'], []),
            })
    refs = {}
    for item in records:
        for mount in item['mounts']:
            if mount['type'] == 'volume':
                refs.setdefault(mount['name'], []).append(item['id'])
    registered = {}
    for source in (REPO / '.runtime/docker-fixtures').glob('*.json'):
        entry = json.loads(source.read_text(encoding='utf-8-sig'))
        if 'id' in entry:
            registered[entry['id']] = source.stem
    for item in records:
        item['registeredRole'] = registered.get(item['id'])
        item['classification'], item['reason'] = classify(item, refs)
        item['deletionApproved'] = False
    volume_names = docker('volume', 'ls', '--format', '{{.Name}}').splitlines()
    volumes = [{'name': name, 'containerIds': refs.get(name, []),
                'classification': 'REFERENCED' if refs.get(name) else 'UNREFERENCED_NOT_APPROVED'}
               for name in sorted(volume_names)]
    ids_after = docker('ps', '-aq', '--no-trunc').splitlines()
    if sorted(ids_after) != sorted(ids):
        raise RuntimeError('Container inventory changed during read; retry with new evidence')
    out.mkdir(parents=True)
    payload = {'timestampUtc': datetime.now(timezone.utc).isoformat(), 'context': context,
               'containers': records, 'volumes': volumes, 'mutations': [],
               'counts': dict(Counter(item['classification'] for item in records))}
    (out / 'inventory.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    with (out / 'containers.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['Name', 'ID', 'Image', 'State', 'Classification', 'Reason', 'Evidence'])
        for item in sorted(records, key=lambda r: (r['classification'], r['name'])):
            writer.writerow([item[k] for k in ['name', 'id', 'image', 'state', 'classification', 'reason']] + ['; '.join(item['evidence'])])
    digest = hashlib.sha256((out / 'inventory.json').read_bytes()).hexdigest()
    lines = ['# Kiểm kê Docker — chỉ đọc', '', f'Container: {len(records)}; volume: {len(volumes)}.',
             f'Context: {context}. Snapshot SHA256: {digest}.', '',
             'Không dừng/xóa/start container; không xóa volume. REVIEW_CLEANUP chỉ là ứng viên, không phải danh sách được phép xóa.', '',
             '| Phân loại | Số lượng |', '|---|---:|']
    lines += [f'| {key} | {value} |' for key, value in sorted(payload['counts'].items())]
    lines += ['', 'Chi tiết exact identity/mount/evidence: inventory.json và containers.csv.',
              'Volume không có container tham chiếu vẫn chưa được phép xóa; có thể là dữ liệu cần giữ.',
              'Trước dọn cần kiểm PASS/assertions theo source, phân loại cuối, archive/hash và restore proof theo AGENTS.']
    (out / 'INVENTORY.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'containers': len(records), 'volumes': len(volumes), 'counts': payload['counts'], 'mutations': []}))


if __name__ == '__main__':
    main()
