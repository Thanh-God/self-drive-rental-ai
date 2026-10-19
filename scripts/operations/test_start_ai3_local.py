"""Exercise refusal guards with real sockets/direct entrypoint and no database access."""
import contextlib
import importlib.util
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('startup', Path(__file__).with_name('start-ai3-local.py'))
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class StartupGuards(unittest.TestCase):
    def test_existing_evidence_refused_without_touching_sentinel(self):
        with tempfile.TemporaryDirectory(dir=startup.REPO / '.runtime') as folder:
            sentinel = Path(folder) / 'sentinel'
            sentinel.write_text('keep')
            with patch.object(sys, 'argv', ['startup', '--evidence', folder, '--apply']):
                with self.assertRaisesRegex(RuntimeError, 'new evidence directory'):
                    startup.main()
            self.assertEqual(sentinel.read_text(), 'keep')
            self.assertEqual(len(list(Path(folder).iterdir())), 1)

    def test_outside_runtime_refused(self):
        with patch.object(sys, 'argv', ['startup', '--evidence', str(startup.REPO / 'forbidden-preview')]):
            with self.assertRaisesRegex(RuntimeError, 'under .runtime'):
                startup.main()
        self.assertFalse((startup.REPO / 'forbidden-preview').exists())

    def test_occupied_port_refused_and_owner_remains_listening(self):
        with contextlib.closing(socket.socket()) as owner:
            owner.bind(('127.0.0.1', 0))
            owner.listen()
            port = owner.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, f'Port {port} occupied'):
                startup.free_ports((port,))
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass


if __name__ == '__main__':
    unittest.main()
