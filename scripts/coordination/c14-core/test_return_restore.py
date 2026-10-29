import importlib.util, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('restore',Path(__file__).with_name('verify-return-restore.py'))
restore=importlib.util.module_from_spec(spec);spec.loader.exec_module(restore)

class RestoreGuards(unittest.TestCase):
    def test_only_new_synthetic_target(self):
        with tempfile.TemporaryDirectory(dir=restore.ROOT/'.runtime') as root:
            out=Path(root)/'new'
            restore.guard('kdrive_c14_browser_0123456789ab','kdrive_c14_restore_0123456789ab',out)
            for source,target in [('kdrive','kdrive_c14_restore_0123456789ab'),('kdrive_c14_browser_0123456789ab','kdrive'),('kdrive_c14_browser_0123456789ab','kdrive_c14_browser_0123456789ab')]:
                with self.assertRaises(AssertionError): restore.guard(source,target,out)
            out.mkdir(); sentinel=out/'keep'; sentinel.write_text('keep')
            with self.assertRaisesRegex(AssertionError,'New runtime'): restore.guard('kdrive_c14_browser_0123456789ab','kdrive_c14_restore_0123456789ab',out)
            self.assertEqual(sentinel.read_text(),'keep')
    def test_outside_runtime_refused(self):
        with self.assertRaisesRegex(AssertionError,'New runtime'): restore.guard('kdrive_c14_browser_0123456789ab','kdrive_c14_restore_0123456789ab',restore.ROOT/'outside-restore')

if __name__=='__main__': unittest.main()
