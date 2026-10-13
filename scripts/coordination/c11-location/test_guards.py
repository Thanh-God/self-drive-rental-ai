"""Exercise real entrypoints before any Docker/process mutation."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


def load(filename):
    spec = importlib.util.spec_from_file_location(filename, Path(__file__).with_name(filename + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Guards(unittest.TestCase):
    def exercise(self, filename, output):
        module = load(filename)
        args = [filename, "--evidence", str(output)]
        if filename == "run-browser":
            args += ["--backend-evidence", str(module.REPO / ".runtime")]
        before = sorted(p.name for p in output.iterdir()) if output.exists() and output.is_dir() else None
        with patch.object(sys, "argv", args), patch("subprocess.run") as native, patch("subprocess.Popen") as spawn:
            with self.assertRaisesRegex(RuntimeError, r"\[PREFLIGHT_REFUSAL\]"):
                module.main()
            native.assert_not_called()
            spawn.assert_not_called()
        after = sorted(p.name for p in output.iterdir()) if output.exists() and output.is_dir() else None
        self.assertEqual(before, after)

    def test_backend_refuses_existing_runtime(self):
        self.exercise("run-location", Path(__file__).resolve().parents[3] / ".runtime")

    def test_browser_refuses_existing_runtime(self):
        self.exercise("run-browser", Path(__file__).resolve().parents[3] / ".runtime")

    def test_backend_refuses_outside(self):
        self.exercise("run-location", Path(tempfile.gettempdir()))

    def test_browser_refuses_outside(self):
        self.exercise("run-browser", Path(tempfile.gettempdir()))


if __name__ == "__main__":
    unittest.main()
