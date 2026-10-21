import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('inventory-docker-fixtures.py'))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class ClassificationTest(unittest.TestCase):
    def classify(self, **fields):
        item = {'name': 'kltn-c14-core-example', 'state': 'exited', 'mounts': [], 'evidence': ['fixture.json']}
        item.update(fields)
        return inventory.classify(item, {'shared': ['a', 'b']})[0]

    def test_protected_original_even_stopped(self):
        for name in inventory.PROTECTED:
            self.assertEqual(self.classify(name=name), 'KEEP_PROTECTED')

    def test_running_is_not_cleanup(self):
        for state in ['running', 'paused', 'restarting']:
            self.assertEqual(self.classify(state=state), 'KEEP_RUNNING')

    def test_external_unknown_is_kept(self):
        self.assertEqual(self.classify(name='other_mysql'), 'KEEP_UNKNOWN')

    def test_missing_evidence_is_not_permission(self):
        self.assertEqual(self.classify(evidence=[]), 'KEEP_NEEDS_EVIDENCE')

    def test_stopped_matching_id_is_only_candidate_not_approval(self):
        self.assertEqual(self.classify(), 'REVIEW_CLEANUP')

    def test_shared_volume_is_kept(self):
        self.assertEqual(self.classify(mounts=[{'type': 'volume', 'name': 'shared'}]), 'KEEP_SHARED_VOLUME')

    def test_registered_pool_and_local_service_are_protected(self):
        self.assertEqual(self.classify(registeredRole='mysql-core'), 'KEEP_REGISTERED')


if __name__ == '__main__':
    unittest.main()
