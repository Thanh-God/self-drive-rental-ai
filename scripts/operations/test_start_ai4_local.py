"""Read-only refusal checks for the AI4 local entrypoint before any backup/start/import."""
import importlib.util, socket, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('ai4_start',Path(__file__).with_name('start-ai4-local.py'))
startup=importlib.util.module_from_spec(spec);spec.loader.exec_module(startup)

class StartupGuards(unittest.TestCase):
    def test_existing_evidence_preserves_sentinel(self):
        with tempfile.TemporaryDirectory(dir=startup.REPO/'.runtime') as folder:
            sentinel=Path(folder)/'sentinel';sentinel.write_text('KEEP')
            with self.assertRaisesRegex(RuntimeError,'New evidence'):
                startup.preflight_path(folder)
            self.assertEqual(sentinel.read_text(),'KEEP');self.assertEqual(len(list(Path(folder).iterdir())),1)
    def test_outside_runtime_refused(self):
        with self.assertRaisesRegex(RuntimeError,'New evidence'):
            startup.preflight_path(startup.REPO/'outside-ai4-runtime')
        self.assertFalse((startup.REPO/'outside-ai4-runtime').exists())
    def test_occupied_port_does_not_stop_owner(self):
        with socket.socket() as owner:
            owner.bind(('127.0.0.1',0));owner.listen();port=owner.getsockname()[1]
            original=startup.h.free_ports
            with patch.object(startup.h,'free_ports',lambda:original((port,))):
                with self.assertRaisesRegex(RuntimeError,'occupied'):
                    startup.preflight_path(startup.REPO/'.runtime/new-ai4-port-probe')
            with socket.create_connection(('127.0.0.1',port),timeout=1):pass
        self.assertFalse((startup.REPO/'.runtime/new-ai4-port-probe').exists())

if __name__=='__main__':unittest.main()
