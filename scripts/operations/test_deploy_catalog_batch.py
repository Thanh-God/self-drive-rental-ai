import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import deploy_catalog_batch as deploy


class DeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.batch = self.root / 'batch'
        self.batch.mkdir()
        self.asset = self.root / 'frontend/public/media/vehicles/a.jpg'
        self.asset.parent.mkdir(parents=True)
        self.asset.write_bytes(b'controlled image bytes')
        self.current = {'containerId': deploy.ORIGINAL_ID, 'schema': 'kdrive', 'data': {key: [] for key in deploy.CATALOG_KEYS}}
        (self.batch / 'inventory-before.json').write_text(json.dumps(self.current), encoding='utf-8')
        proposals = {'catalog-create-proposal.json': {'approved': False, 'vehicles': []},
                     'catalog-configure-proposal.json': {'approved': False, 'images': [{'url': '/media/vehicles/a.jpg', 'sha256': hashlib.sha256(self.asset.read_bytes()).hexdigest()}]}}
        self.hashes = {}
        for name, value in proposals.items():
            raw = json.dumps(value).encode()
            (self.batch / name).write_bytes(raw)
            self.hashes[name] = hashlib.sha256(raw).hexdigest()
        self.patches = [patch.object(deploy, 'REPO', self.root), patch.object(deploy, 'APPROVED_HASHES', self.hashes)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_approved_copy_changes_only_flag(self):
        result = deploy.validate_batch(self.batch, self.current)
        for name, value in result.items():
            self.assertTrue(value['approved'])
            proposal = json.loads((self.batch / name).read_text())
            self.assertFalse(proposal['approved'])
            self.assertEqual(value | {'approved': False}, proposal)

    def test_modified_proposal_refused(self):
        with (self.batch / 'catalog-create-proposal.json').open('ab') as handle:
            handle.write(b' ')
        with self.assertRaisesRegex(ValueError, 'content drift'):
            deploy.validate_batch(self.batch, self.current)

    def test_vehicle_or_route_drift_refused_before_write(self):
        for key in ['vehicles', 'routes', 'images', 'history', 'staffAssignments']:
            changed = copy.deepcopy(self.current)
            changed['data'][key] = [{'unexpected': 1}]
            with self.assertRaisesRegex(ValueError, 'catalog drift'):
                deploy.validate_batch(self.batch, changed)

    def test_wrong_original_target_refused(self):
        for field, value in [('containerId', 'different'), ('schema', 'other')]:
            changed = self.current | {field: value}
            with self.assertRaisesRegex(ValueError, 'target drift'):
                deploy.validate_batch(self.batch, changed)

    def test_changed_asset_refused(self):
        self.asset.write_bytes(b'changed bytes')
        with self.assertRaisesRegex(ValueError, 'Image content drift'):
            deploy.validate_batch(self.batch, self.current)

    def test_env_target_and_required_credentials_guard(self):
        file = self.root / 'local.env'
        file.write_text('DB_URL=jdbc:mysql://127.0.0.1:33385/kdrive?connectionTimeZone=UTC\nDB_USER=user\nDB_PASSWORD=private-test-value\nJWT_SECRET=private-test-jwt\nSEED_PASSWORD=private-test-seed\n')
        before = file.read_bytes()
        self.assertEqual(deploy.local_env(file)['DB_USER'], 'user')
        self.assertEqual(file.read_bytes(), before)
        file.write_text(file.read_text().replace(':33385/', ':3306/'))
        with self.assertRaisesRegex(ValueError, 'DB_URL'):
            deploy.local_env(file)

    def test_existing_evidence_refused_before_docker(self):
        out = self.root / '.runtime/evidence'
        out.mkdir(parents=True)
        sentinel = out / 'keep.txt'
        sentinel.write_text('retain')
        with patch.object(sys, 'argv', ['deploy_catalog_batch.py', '--batch', str(self.root / '.runtime/batch'), '--backend-root', str(self.root / '.runtime/backend'), '--evidence', str(out), '--apply-approved-oto1']), patch.object(deploy, 'inventory') as inventory:
            with self.assertRaisesRegex(ValueError, 'New runtime evidence'):
                deploy.main()
            inventory.assert_not_called()
        self.assertEqual(sentinel.read_text(), 'retain')
        self.assertEqual(len(list(out.iterdir())), 1)

    def test_full_backup_retains_restore_metadata_while_content_digest_is_compact(self):
        full = deploy.dump_command()
        digest = deploy.dump_command(deploy.PROTECTED)
        self.assertNotIn('--compact', full)
        self.assertIn('--compact', digest)
        self.assertIn('--single-transaction', full)
        self.assertIn('--set-gtid-purged=OFF', full)
        self.assertTrue(full.endswith(' kdrive'))
        self.assertIn(' bookings ', digest)


if __name__ == '__main__':
    unittest.main()
