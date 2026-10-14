"""Call actual runner entrypoints; refusals must precede native commands or writes."""
import importlib.util, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]

def load(name):
    spec=importlib.util.spec_from_file_location('c14_'+name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class RunnerGuards(unittest.TestCase):
    def invoke(self,module,arguments):
        with patch.object(sys,'argv',['runner']+arguments),patch.object(module.subprocess,'run',side_effect=AssertionError('Native command reached')):
            module.main()

    def test_native_refuses_existing_evidence_without_changes(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);sentinel=folder/'keep.txt';sentinel.write_text('caller sentinel')
            with self.assertRaisesRegex(AssertionError,'New runtime evidence'):
                self.invoke(module,['--backend-root',str(folder),'--evidence',str(folder)])
            self.assertEqual(sentinel.read_text(),'caller sentinel');self.assertEqual(list(folder.iterdir()),[sentinel])

    def test_native_refuses_different_backend_before_native_or_output(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);output=folder/'output'
            with self.assertRaises(FileNotFoundError):
                self.invoke(module,['--backend-root',str(folder),'--evidence',str(output)])
            self.assertFalse(output.exists())

    def test_browser_refuses_protected_port_before_native_or_output(self):
        module=load('run-browser')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);native=folder/'native';native.mkdir();output=folder/'output'
            fixture=native/'fixture.json';fixture.write_text(json.dumps({'name':'kltn-c14-core-guard','port':33385}))
            original=fixture.read_bytes()
            with self.assertRaises(AssertionError):
                self.invoke(module,['--backend-evidence',str(native),'--backend-root',str(folder),'--evidence',str(output)])
            self.assertEqual(fixture.read_bytes(),original);self.assertFalse(output.exists())

    def test_browser_refuses_existing_output_without_native_commands(self):
        module=load('run-browser')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            with self.assertRaises(AssertionError):
                self.invoke(module,['--backend-evidence',directory,'--backend-root',directory,'--evidence',directory])

if __name__=='__main__':unittest.main()
