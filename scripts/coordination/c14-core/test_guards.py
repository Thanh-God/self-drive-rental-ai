"""Call actual runner entrypoints; refusals must precede native commands or writes."""
import copy, importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]

def load(name):
    spec=importlib.util.spec_from_file_location('c14_'+name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class RunnerGuards(unittest.TestCase):
    def test_migration_suite_count_follows_the_copied_source_and_keeps_the_minimum(self):
        runner=load('run-mysql')
        with tempfile.TemporaryDirectory() as tmp:
            build=Path(tmp);suite=build/'src/test/java/com/carrental/MySqlMigrationTest.java';suite.parent.mkdir(parents=True)
            def declare(n):suite.write_text('class MySqlMigrationTest{\n'+''.join(f' @Test void t{i}(){{}}\n' for i in range(n))+' // @Test in a comment is not a test\n}\n',encoding='utf-8')
            declare(11);self.assertEqual(11,runner.declared_tests(build,'MySqlMigrationTest'))
            runner.assert_migration_suite_complete(build,[11,0,0,0])
            with self.assertRaisesRegex(AssertionError,'ran 10 of 11'):runner.assert_migration_suite_complete(build,[10,0,0,0])
            declare(10);runner.assert_migration_suite_complete(build,[10,0,0,0])
            declare(9)
            with self.assertRaisesRegex(AssertionError,'declares only 9'):runner.assert_migration_suite_complete(build,[9,0,0,0])
            suite.unlink()
            with self.assertRaisesRegex(AssertionError,'Suite source missing'):runner.declared_tests(build,'MySqlMigrationTest')

    def test_ai_chat_proof_is_explicit_and_exclusive(self):
        module=load('run-browser')
        chat=Path('verify-ai-chat.cjs')
        settings=module.proof_settings(chat,ai_chat=True)
        for line in ('app.qwen-parser-enabled=true','app.ai-recommendation-enabled=true','app.qwen-model=qwen3:8b'):self.assertIn(line,settings)
        self.assertNotIn('ai-daily-limit',settings,'the default allowance is what the proof exercises')
        with self.assertRaises(AssertionError):module.proof_settings(chat)
        with self.assertRaises(AssertionError):module.proof_settings(Path('verify-browser.cjs'),ai_chat=True)
        for kwargs in ({'qr':True},{'synthetic':True},{'return_policy':True}):
            with self.assertRaises(AssertionError):module.proof_settings(chat,ai_chat=True,**kwargs)
        self.assertNotIn('qwen',module.proof_settings(Path('verify-browser.cjs')))

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

    def test_source_root_must_be_backend_checkout_outside_runtime_before_native_or_output(self):
        module=load('run-mysql')
        self.assertEqual(module.resolve_source_root(None),(ROOT/'backend').resolve())
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);output=folder/'output'
            (folder/'src/main').mkdir(parents=True);(folder/'pom.xml').write_text('<project/>')
            with self.assertRaisesRegex(AssertionError,'not a runtime copy'):
                self.invoke(module,['--backend-root',str(folder),'--evidence',str(output),'--source-root',str(folder)])
            self.assertFalse(output.exists())
        with tempfile.TemporaryDirectory() as outside, tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            output=Path(directory)/'output'
            with self.assertRaisesRegex(AssertionError,'Backend source root required'):
                self.invoke(module,['--backend-root',directory,'--evidence',str(output),'--source-root',outside])
            self.assertFalse(output.exists())

    def test_source_copy_must_match_source_root_in_both_directions(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory() as outside, tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            source=Path(outside);build=Path(directory)
            for root in (source,build):
                (root/'src/main/java').mkdir(parents=True);(root/'src/main/java/A.java').write_text('class A {}')
            (source/'pom.xml').write_text('<project/>')
            module.verify_source_copy(module.resolve_source_root(str(source)),build)
            (build/'src/main/java/A.java').write_text('class A { int drift; }')
            with self.assertRaises(AssertionError):module.verify_source_copy(source,build)
            (build/'src/main/java/A.java').write_text('class A {}');(build/'src/main/java/Extra.java').write_text('class Extra {}')
            with self.assertRaisesRegex(AssertionError,'absent from the source root'):module.verify_source_copy(source,build)
            (build/'src/main/java/Extra.java').unlink();(source/'src/main/java/B.java').write_text('class B {}')
            with self.assertRaises(FileNotFoundError):module.verify_source_copy(source,build)

    def test_external_source_inputs_are_keyed_and_detect_drift(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory() as outside:
            source=Path(outside);(source/'src/main').mkdir(parents=True);(source/'src/main/A.java').write_text('class A {}')
            (source/'pom.xml').write_text('<project/>')
            before=module.inputs(None,(),source)
            self.assertIn('source-root:src/main/A.java',before);self.assertIn('source-root:pom.xml',before)
            self.assertFalse(any(k.startswith('backend/') for k in before))
            module.assert_inputs_unchanged(before,None,(),source)
            (source/'src/main/A.java').write_text('class A { int drift; }')
            with self.assertRaisesRegex(AssertionError,'drift'):module.assert_inputs_unchanged(before,None,(),source)
        self.assertIn('backend/pom.xml',module.inputs())

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

    def test_live_qwen_suite_is_opt_in_and_excluded_by_default(self):
        module=load('run-mysql')
        self.assertIn('AssistantReviewQuoteFlowHttpTest',module.SUITES)
        self.assertIn('AssistantReviewQuoteLiveIT',module.SUITES)
        default=module.select_suites(None,{})
        self.assertIn('AssistantReviewQuoteFlowHttpTest',default)
        self.assertNotIn('AssistantReviewQuoteLiveIT',default)
        for environ in ({},{'KDRIVE_AI_LIVE_FLOW':'1'},{'KDRIVE_AI_LIVE_FLOW':'TRUE'}):
            with self.assertRaises(AssertionError):module.select_suites(['AssistantReviewQuoteLiveIT'],environ)
        self.assertEqual(['AssistantReviewQuoteLiveIT'],module.select_suites(['AssistantReviewQuoteLiveIT'],{'KDRIVE_AI_LIVE_FLOW':'true'}))

    def test_chat_suites_stub_by_default_and_live_chat_opt_in(self):
        module=load('run-mysql')
        default=module.select_suites(None,{})
        for suite in ('AiChatHttpTest','AiChatSearchHttpTest','AiChatMinimalSearchHttpTest'):
            self.assertIn(suite,module.SUITES)
            self.assertIn(suite,default)
        self.assertIn('AiChatLiveIT',module.SUITES)
        self.assertIn('AiChatLiveIT',module.LIVE_QWEN_SUITES)
        self.assertNotIn('AiChatLiveIT',default)
        for environ in ({},{'KDRIVE_AI_LIVE_FLOW':'yes'}):
            with self.assertRaises(AssertionError):module.select_suites(['AiChatLiveIT'],environ)
        self.assertEqual(['AiChatLiveIT'],module.select_suites(['AiChatLiveIT'],{'KDRIVE_AI_LIVE_FLOW':'true'}))

    def test_no_show_and_rental_balance_suites_run_by_default(self):
        # L2/L4: booking-flow suites without live providers are part of the default native set.
        module=load('run-mysql')
        default=module.select_suites(None,{})
        for suite in ('NoShowWithoutDepositHttpTest','RentalBalanceHttpTest','RentalBalanceDepositHttpTest'):
            self.assertIn(suite,module.SUITES)
            self.assertIn(suite,default)
            self.assertNotIn(suite,module.LIVE_QWEN_SUITES)
        self.assertEqual(['RentalBalanceHttpTest'],module.select_suites(['RentalBalanceHttpTest'],{}))

    def test_itinerary_live_suite_needs_mode_and_online_opt_in(self):
        module=load('run-mysql')
        self.assertIn('ItineraryLivePreviewIT',module.SUITES)
        self.assertNotIn('ItineraryLivePreviewIT',module.select_suites(None,{}))
        module.require_itinerary_live(['RecommendationHttpTest'],None,{})
        for mode,environ in ((None,{}),('online',{}),('online',{'KDRIVE_AI_LIVE_ITINERARY':'1'}),('sideways',{})):
            with self.assertRaises(AssertionError):module.require_itinerary_live(['ItineraryLivePreviewIT'],mode,environ)
        module.require_itinerary_live(['ItineraryLivePreviewIT'],'offline',{})
        module.require_itinerary_live(['ItineraryLivePreviewIT'],'online',{'KDRIVE_AI_LIVE_ITINERARY':'true'})
        self.assertEqual(2,len(module.ITINERARY_LIVE_METHODS['online']));self.assertEqual(1,len(module.ITINERARY_LIVE_METHODS['offline']))

    def test_itinerary_scope_splits_qwen_from_provider_cases(self):
        module=load('run-mysql')
        self.assertEqual(['onlineForcedSearch_MatchesOracleOnRealGraphWithinBudget'],module.itinerary_methods('online','no-qwen'))
        self.assertEqual([module.ITINERARY_QWEN_METHOD],module.itinerary_methods('online','qwen'))
        self.assertEqual(module.ITINERARY_LIVE_METHODS['offline'],module.itinerary_methods('offline','no-qwen'))
        self.assertEqual([],module.itinerary_methods('offline','qwen'))
        module.require_itinerary_live(['ItineraryLivePreviewIT'],'online',{},'no-qwen')
        with self.assertRaisesRegex(AssertionError,'KDRIVE_AI_LIVE_ITINERARY'):module.require_itinerary_live(['ItineraryLivePreviewIT'],'online',{},'qwen')
        with self.assertRaisesRegex(AssertionError,'selects no method'):module.require_itinerary_live(['ItineraryLivePreviewIT'],'offline',{'KDRIVE_AI_LIVE_ITINERARY':'true'},'qwen')
        with self.assertRaises(AssertionError):module.itinerary_methods('online','some')

    def test_itinerary_live_refusal_precedes_evidence_and_fixture(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);out=folder/'evidence'
            argv=['run-mysql.py','--backend-root',str(folder/'backend-copy'),'--evidence',str(out),'--suites','ItineraryLivePreviewIT','--routing-mode','online']
            with patch.object(sys,'argv',argv),patch.dict(os.environ,{},clear=False),\
                 patch.object(module,'fixture_source',side_effect=AssertionError('fixture must not be reached')) as source:
                os.environ.pop('KDRIVE_AI_LIVE_ITINERARY',None)
                with self.assertRaisesRegex(AssertionError,'KDRIVE_AI_LIVE_ITINERARY'):module.main()
                source.assert_not_called()
            self.assertFalse(out.exists())

    def test_live_qwen_refusal_precedes_evidence_and_fixture(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);out=folder/'evidence'
            argv=['run-mysql.py','--backend-root',str(folder/'backend-copy'),'--evidence',str(out),'--suites','AssistantReviewQuoteLiveIT']
            with patch.object(sys,'argv',argv),patch.dict(os.environ,{},clear=False),                 patch.object(module,'fixture_source',side_effect=AssertionError('fixture must not be reached')) as source:
                os.environ.pop('KDRIVE_AI_LIVE_FLOW',None)
                with self.assertRaisesRegex(AssertionError,'KDRIVE_AI_LIVE_FLOW'):module.main()
                source.assert_not_called()
            self.assertFalse(out.exists())

    def test_pilot_importer_suite_pins_files_at_java_execution_path(self):
        module=load('run-mysql')
        self.assertIn(module.PILOT_IMPORTER_SUITE,module.SUITES)
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);backend=folder/'build-parent'/'backend-copy';backend.mkdir(parents=True)
            copied=backend.parent/'scripts'/'ai'
            copied.mkdir(parents=True)
            output_copies=folder/'different-evidence-parent'/'scripts'/'ai'
            output_copies.mkdir(parents=True)
            for name in module.PILOT_INPUT_NAMES:
                content=(ROOT/'scripts'/'ai'/name).read_bytes()
                (copied/name).write_bytes(content)
                (output_copies/name).write_bytes(content+b' decoy')
            pinned=module.validate_pilot_inputs(backend,[module.PILOT_IMPORTER_SUITE])
            expected_paths={
                path.relative_to(ROOT).as_posix()
                for name in module.PILOT_INPUT_NAMES
                for path in (ROOT/'scripts'/'ai'/name,copied/name)
            }
            self.assertEqual(set(pinned),expected_paths)
            (copied/'locations-pilot.json').write_bytes((copied/'locations-pilot.json').read_bytes()+b' ')
            with self.assertRaisesRegex(AssertionError,'hash mismatch at execution path'):
                module.validate_pilot_inputs(backend,[module.PILOT_IMPORTER_SUITE])
            self.assertEqual(module.validate_pilot_inputs(backend,['VehicleSearchTest']),{})

    def test_native_entrypoint_uses_build_parent_and_refuses_missing_or_drifted_inputs(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            root=Path(directory)

            def snapshot():
                return {
                    path.relative_to(root).as_posix():path.read_bytes()
                    for path in root.rglob('*') if path.is_file()
                }

            for state in ('valid','missing','drifted'):
                with self.subTest(state=state):
                    case=root/state;case.mkdir()
                    backend=case/'build-parent'/'backend-copy';backend.mkdir(parents=True)
                    output_parent=case/'different-evidence-parent'
                    output=output_parent/'native'
                    decoy=output_parent/'scripts'/'ai';decoy.mkdir(parents=True)
                    for name in module.PILOT_INPUT_NAMES:
                        (decoy/name).write_bytes((ROOT/'scripts'/'ai'/name).read_bytes())

                    actual=backend.parent/'scripts'/'ai'
                    if state != 'missing':
                        actual.mkdir(parents=True)
                        for name in module.PILOT_INPUT_NAMES:
                            content=(ROOT/'scripts'/'ai'/name).read_bytes()
                            if state == 'drifted' and name == 'import_locations_pilot.py':
                                content += b'\n# build-side drift\n'
                            (actual/name).write_bytes(content)

                    before=snapshot()
                    arguments=[
                        '--backend-root',str(backend),
                        '--evidence',str(output),
                        '--suites',module.PILOT_IMPORTER_SUITE,
                    ]
                    with patch.object(sys,'argv',['runner']+arguments), \
                            patch.object(module.subprocess,'run') as native, \
                            patch.object(module,'fixture_source',side_effect=RuntimeError('fixture boundary reached')) as fixture:
                        if state == 'valid':
                            with self.assertRaisesRegex(RuntimeError,'fixture boundary reached'):
                                module.main()
                            fixture.assert_called_once()
                        else:
                            expected='Missing staged pilot input' if state == 'missing' else 'hash mismatch at execution path'
                            with self.assertRaisesRegex(AssertionError,expected):
                                module.main()
                            fixture.assert_not_called()
                        native.assert_not_called()

                    self.assertFalse(output.exists())
                    self.assertEqual(snapshot(),before)

    def test_native_input_manifest_detects_staged_file_drift_after_run(self):
        module=load('run-mysql')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            folder=Path(directory);backend=folder/'backend-copy';backend.mkdir()
            copied=backend.parent/'scripts'/'ai';copied.mkdir(parents=True)
            for name in module.PILOT_INPUT_NAMES:
                (copied/name).write_bytes((ROOT/'scripts'/'ai'/name).read_bytes())
            module.validate_pilot_inputs(backend,[module.PILOT_IMPORTER_SUITE])
            before=module.inputs(backend,[module.PILOT_IMPORTER_SUITE])
            (copied/'import_locations_pilot.py').write_bytes(
                (copied/'import_locations_pilot.py').read_bytes()+b'\n# post-run drift\n'
            )
            with self.assertRaisesRegex(AssertionError,'Source or staged pilot input drift'):
                module.assert_inputs_unchanged(before,backend,[module.PILOT_IMPORTER_SUITE])

    def test_browser_refuses_existing_output_without_native_commands(self):
        module=load('run-browser')
        with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
            with self.assertRaises(AssertionError):
                self.invoke(module,['--backend-evidence',directory,'--backend-root',directory,'--evidence',directory])

if __name__=='__main__':unittest.main()
