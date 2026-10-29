"""Call actual runner entrypoints; refusals must precede native commands or writes."""
import copy, importlib.util, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]

def load(name):
    spec=importlib.util.spec_from_file_location('c14_'+name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class RunnerGuards(unittest.TestCase):
    def test_return_policy_mode_is_explicit_and_bounded(self):
        module=load('run-browser'); proof=ROOT/'scripts/operations/verify-return-policy.cjs'
        self.assertEqual(module.proof_settings(proof,qr=True,return_policy=True),'app.return-policy-enabled=true\napp.return-settlement-demo=true\n')
        self.assertEqual(module.proof_settings(Path('verify-browser.cjs')),'app.return-policy-enabled=false\napp.return-settlement-demo=true\n')
        self.assertIn('enabled=false',module.proof_settings(Path('verify-qr-deposit.cjs'),qr=True))
        self.assertIn('enabled=true',module.proof_settings(Path('verify-return-late.cjs'),qr=True,return_policy=True))
        for kwargs in [{},{'qr':True},{'return_policy':True}]:
            with self.assertRaises(AssertionError):module.proof_settings(Path('verify-return-late.cjs'),**kwargs)
        with self.assertRaises(AssertionError):module.proof_settings(Path('unbounded.cjs'),qr=True,return_policy=True)
        for kwargs in [{},{'return_policy':True},{'qr':True},{'qr':True,'synthetic':True,'return_policy':True}]:
            with self.assertRaises(AssertionError):module.proof_settings(proof,**kwargs)
        with self.assertRaisesRegex(AssertionError,'bounded QR DEMO'):
            module.proof_settings(Path('verify-qr-deposit.cjs'),qr=True,return_policy=True)

    def test_return_mode_refused_before_output_or_native(self):
        module=load('run-browser')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            out=Path(directory)/'new'
            with self.assertRaisesRegex(AssertionError,'bounded QR DEMO'):
                self.invoke(module,['--backend-evidence',directory,'--backend-root',directory,'--evidence',str(out),'--return-policy'])
            self.assertFalse(out.exists())

    def test_browser_proof_accepts_repository_script_and_refuses_external_or_missing(self):
        module=load('run-browser')
        proof=ROOT/'scripts/operations/verify-vehicle-admin.cjs'
        self.assertEqual(module.resolve_proof(str(proof)),proof.resolve())
        self.assertEqual(module.resolve_proof(None),Path(__file__).with_name('verify-browser.cjs').resolve())
        for path in [ROOT/'scripts/missing-proof.cjs',ROOT/'frontend/package.json']:
            with self.assertRaisesRegex(AssertionError,'Repository browser proof required'):
                module.resolve_proof(str(path))

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
                self.invoke(module,['--backend-root',str(folder),'--evidence',str(output),'--suites','VehicleSearchTest','--new-fixture-reason','guard source mismatch test'])
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

    def test_missing_registry_refuses_at_entrypoint_before_native_or_output(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);output=folder/'new'
            with self.assertRaisesRegex(AssertionError,'No registered fixture'):
                self.invoke(module,['--backend-root',str(folder),'--evidence',str(output),'--fixture-registry',str(folder/'absent.json'),'--suites','VehicleSearchTest'])
            self.assertFalse(output.exists())

    def test_new_fixture_requires_explicit_reason_and_cannot_mix_reuse(self):
        module=load('run-mysql')
        self.assertEqual(module.fixture_source(new_reason='approved server isolation test'),(None,None))
        with self.assertRaisesRegex(AssertionError,'specific approved reason'):
            module.fixture_source(new_reason='')
        with self.assertRaisesRegex(AssertionError,'not both'):
            module.fixture_source(reuse='anything',new_reason='approved server isolation test')

    def test_registry_selects_same_fixture_and_rejects_identity_or_path_drift(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);previous=folder/'previous';previous.mkdir()
            fixture={'id':'a'*64,'name':'kltn-c14-core-test','port':33676,'volume':'vol-test'}
            (previous/'fixture.json').write_text(json.dumps(fixture))
            entry={**fixture,'imageId':'sha256:'+'b'*64,'evidence':previous.relative_to(ROOT).as_posix()}
            registry=folder/'registry.json';registry.write_text(json.dumps(entry))
            self.assertEqual(module.fixture_source(registry=registry),(previous,entry))
            entry['id']='c'*64;registry.write_text(json.dumps(entry))
            with self.assertRaisesRegex(AssertionError,'identity mismatch'):
                module.fixture_source(registry=registry)
            entry['evidence']='../outside';registry.write_text(json.dumps(entry))
            with self.assertRaisesRegex(AssertionError,'Runtime fixture evidence'):
                module.fixture_source(registry=registry)

    def test_live_fixture_metadata_guard_refuses_wrong_target_image_mount_state_or_port(self):
        module=load('run-mysql')
        fixture={'id':'a'*64,'name':'kltn-c14-core-test','port':33676,'volume':'vol-test'}
        actual={'Id':'a'*64,'Name':'/kltn-c14-core-test','Image':'sha256:fixed',
                'State':{'Status':'exited'},'Config':{'Image':'mysql:8.4'},
                'HostConfig':{'PortBindings':{'3306/tcp':[{'HostIp':'127.0.0.1','HostPort':'33676'}]}},
                'Mounts':[{'Type':'volume','Name':'vol-test','Destination':'/var/lib/mysql'}]}
        module.validate_reuse(fixture,actual,{'imageId':'sha256:fixed'})
        for key,value in [('Id','other'),('Image','sha256:other'),('Name','/kltn-phase5-rerun'),('State',{'Status':'running'}),('Config',{'Image':'mysql:8.4.11'}),('Mounts',[]),('HostConfig',{'PortBindings':{}})]:
            changed=copy.deepcopy(actual);changed[key]=value
            with self.assertRaises(AssertionError):module.validate_reuse(fixture,changed,{'imageId':'sha256:fixed'})

    def test_browser_refuses_existing_output_without_native_commands(self):
        module=load('run-browser')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            with self.assertRaises(AssertionError):
                self.invoke(module,['--backend-evidence',directory,'--backend-root',directory,'--evidence',directory])

if __name__=='__main__':unittest.main()
