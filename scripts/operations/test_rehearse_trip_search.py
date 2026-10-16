"""Refusal tests execute the runner entrypoint and forbid Docker/SQL/process calls."""
import json
from pathlib import Path
import sys
import tempfile
import io
from contextlib import redirect_stderr
import unittest
from unittest.mock import patch
import rehearse_trip_search as runner

class TripRunnerGuardTest(unittest.TestCase):
    def test_unknown_browser_script_refused_before_any_process(self):
        argv=['runner','--native-evidence','missing','--backend-root','missing','--evidence','missing','--browser-script','arbitrary.cjs']
        with patch.object(sys,'argv',argv),patch.object(runner.subprocess,'run') as process,redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:runner.main()
            self.assertEqual(error.exception.code,2)
            process.assert_not_called()
    def test_unsupported_booking_count_refused_before_any_process(self):
        argv=['runner','--native-evidence','missing','--backend-root','missing','--evidence','missing','--expected-bookings','2']
        with patch.object(sys,'argv',argv),patch.object(runner.subprocess,'run') as process,redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:runner.main()
            self.assertEqual(error.exception.code,2)
            process.assert_not_called()
    def invoke(self, root, fixture, out=None, backend=None):
        native=root/'native';native.mkdir()
        (native/'fixture.json').write_text(json.dumps(fixture))
        output=out or root/'output'
        before={p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()}
        argv=['runner','--native-evidence',str(native),'--backend-root',str(backend or root/'backend'),'--evidence',str(output)]
        with patch.object(sys,'argv',argv),patch.object(runner.subprocess,'run',side_effect=AssertionError('Must refuse before process/SQL')) as process:
            with self.assertRaises(ValueError):runner.main()
            process.assert_not_called()
        self.assertEqual(before,{p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()})
        self.assertFalse(output.exists())
    def test_original_database_identity_is_refused_before_any_process(self):
        with tempfile.TemporaryDirectory(dir=runner.REPO/'.runtime') as value:
            self.invoke(Path(value),{'name':'kltn-phase5-rerun','port':33385,'volume':'kltn_phase5_rerun_20261004_1823'})
    def test_unexpected_port_or_volume_is_refused(self):
        for fixture in [{'name':'kltn-c14-core-test','port':3306,'volume':'vol-kltn-c14-core-test'}, {'name':'kltn-c14-core-test','port':33676,'volume':'original-data'}]:
            with tempfile.TemporaryDirectory(dir=runner.REPO/'.runtime') as value:self.invoke(Path(value),fixture)
    def test_backend_outside_runtime_is_refused(self):
        with tempfile.TemporaryDirectory(dir=runner.REPO/'.runtime') as value:
            self.invoke(Path(value),{},backend=runner.REPO/'backend')

if __name__=='__main__':unittest.main()
