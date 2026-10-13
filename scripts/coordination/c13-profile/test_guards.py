"""Browser selection refuses invalid paths before fixture/output mutation."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("browser_runner", ROOT / "scripts/coordination/c12-dashboard/run-browser.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class BrowserScriptGuard(unittest.TestCase):
    def test_invalid_selection_refuses_before_fixture_or_output_access(self):
        for script in (ROOT / "README.md", ROOT / "scripts/coordination/missing.cjs", ROOT / "frontend/src/api/client.js"):
            with self.subTest(script=script):
                args = ["runner", "--backend-root", str(ROOT / ".runtime/missing"), "--backend-evidence", str(ROOT / ".runtime/missing-proof"), "--evidence", str(ROOT / ".runtime/c13-guard-never-created"), "--browser-script", str(script)]
                with patch.object(sys, "argv", args), patch.object(runner.subprocess, "run") as native:
                    with self.assertRaisesRegex(RuntimeError, "Repository browser script required"):
                        runner.main()
                    native.assert_not_called()
                self.assertFalse((ROOT / ".runtime/c13-guard-never-created").exists())

if __name__ == "__main__":
    unittest.main()
