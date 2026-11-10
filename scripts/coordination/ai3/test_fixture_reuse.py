import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('routing_proof',Path(__file__).with_name('run-routing-proof.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


class OsrmReuseTest(unittest.TestCase):
    def test_registry_missing_never_falls_back_to_creation(self):
        with self.assertRaisesRegex(AssertionError,'creation is not automatic'):
            runner.osrm_fixture(runner.REPO/'.runtime/absent-osrm-registry-for-unit.json')

    def test_new_server_requires_specific_reason(self):
        self.assertIsNone(runner.osrm_fixture('unused',new_reason='approved incompatible graph test'))
        with self.assertRaises(AssertionError):runner.osrm_fixture('unused',new_reason='')

    def test_registry_pins_exact_evidence(self):
        with tempfile.TemporaryDirectory(dir=runner.REPO/'.runtime') as directory:
            folder=Path(directory);original={'id':'a'*64,'name':'kltn-ai3-proof-test','image':runner.IMAGE}
            (folder/'osrm-identity.json').write_text(json.dumps(original))
            entry={**original,'evidence':folder.relative_to(runner.REPO).as_posix(),'imageId':'sha256:fixed'}
            registry=folder/'registry.json';registry.write_text(json.dumps(entry))
            self.assertEqual(runner.osrm_fixture(registry),entry)
            entry['id']='b'*64;registry.write_text(json.dumps(entry))
            with self.assertRaisesRegex(AssertionError,'identity mismatch'):runner.osrm_fixture(registry)

    def test_validate_metadata_refuses_running_wrong_graph_image_port_and_identity(self):
        graph=runner.REPO/'.runtime/test-graph'
        entry={'id':'a'*64,'name':'kltn-ai3-proof-test','imageId':'sha256:fixed'}
        actual={'Id':'a'*64,'Name':'/kltn-ai3-proof-test','Image':'sha256:fixed','State':{'Status':'exited'},
                'Config':{'Image':runner.IMAGE,'Cmd':['osrm-routed','--algorithm','mld','/data/central.osrm']},
                'HostConfig':{'PortBindings':{'5000/tcp':[{'HostIp':'127.0.0.1','HostPort':'5000'}]}},
                'Mounts':[{'Type':'bind','Destination':'/data','Source':str(graph),'RW':False}]}
        runner.validate_osrm_reuse(entry,actual,graph)
        for key,value in [('Id','other'),('State',{'Status':'running'}),('Image','sha256:other'),('Mounts',[]),('HostConfig',{'PortBindings':{}}),('Config',{'Image':runner.IMAGE,'Cmd':['osrm-extract']})]:
            changed=copy.deepcopy(actual);changed[key]=value
            with self.assertRaises(AssertionError):runner.validate_osrm_reuse(entry,changed,graph)
        changed=copy.deepcopy(actual);changed['Mounts'][0]['RW']=True
        with self.assertRaisesRegex(AssertionError,'mount drift'):runner.validate_osrm_reuse(entry,changed,graph)


    def test_itinerary_live_requires_opt_in_before_any_evidence_or_fixture(self):
        import os, sys
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(dir=runner.REPO/'.runtime') as directory:
            out=Path(directory)/'proof'
            argv=['run-routing-proof.py','--backend-root',directory,'--evidence',str(out),'--reuse-evidence',directory,
                  '--graph-dir',directory,'--graph-manifest',directory,'--itinerary-live']
            with patch.object(sys,'argv',argv),patch.dict(os.environ,{},clear=False),\
                 patch.object(runner,'osrm_fixture',side_effect=AssertionError('fixture must not be reached')) as fixture:
                os.environ.pop('KDRIVE_AI_LIVE_ITINERARY',None)
                with self.assertRaisesRegex(AssertionError,'KDRIVE_AI_LIVE_ITINERARY'):runner.main()
                fixture.assert_not_called()
            self.assertFalse(out.exists())


if __name__=='__main__':unittest.main()
