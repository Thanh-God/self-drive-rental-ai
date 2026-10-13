import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


class GuardTest(unittest.TestCase):
    def test_actual_entrypoint_refuses_existing_or_outside_without_native_calls(self):
        path = Path(__file__).with_name("run-mysql.py")
        spec = importlib.util.spec_from_file_location("branch_runner", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for target in (module.REPO / ".runtime", Path(tempfile.gettempdir())):
            with self.subTest(target=target):
                before = sorted(p.name for p in target.iterdir())
                with patch.object(sys, "argv", [str(path), "--backend-root", str(module.REPO / ".runtime" / "backend-copy"), "--evidence", str(target)]), patch("subprocess.run") as run, patch("subprocess.Popen") as spawn:
                    with self.assertRaisesRegex(RuntimeError, r"\[PREFLIGHT_REFUSAL\]"):
                        module.main()
                    run.assert_not_called()
                    spawn.assert_not_called()
                self.assertEqual(before, sorted(p.name for p in target.iterdir()))


if __name__ == "__main__":
    unittest.main()
