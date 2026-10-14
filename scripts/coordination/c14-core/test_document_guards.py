import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from test_guards import ROOT,load

class DocumentGuards(unittest.TestCase):
 def invoke(self,module,args):
  with patch.object(sys,'argv',['runner']+args),patch.object(module.subprocess,'run',side_effect=AssertionError('Native command reached')):module.main()
 def test_existing_output_is_not_modified(self):
  module=load('verify-documents')
  with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
   root=Path(directory);sentinel=root/'keep.txt';sentinel.write_text('caller data')
   with self.assertRaises(AssertionError):self.invoke(module,['--backend-root',directory,'--backend-evidence',directory,'--linked-evidence',directory,'--evidence',directory])
   self.assertEqual(sentinel.read_text(),'caller data');self.assertEqual(list(root.iterdir()),[sentinel])
 def test_protected_fixture_port_refused_before_spawn(self):
  module=load('verify-documents')
  with tempfile.TemporaryDirectory(dir=ROOT/'.runtime') as directory:
   root=Path(directory);linked=root/'linked';native=root/'native';linked.mkdir();native.mkdir();output=root/'out'
   (linked/'result.json').write_text(json.dumps({'status':'PASS C14 linked browser scoped'}))
   fixture=native/'fixture.json';fixture.write_text(json.dumps({'name':'kltn-c14-core-guard','port':33385}));before=fixture.read_bytes()
   with self.assertRaises(AssertionError):self.invoke(module,['--backend-root',directory,'--backend-evidence',str(native),'--linked-evidence',str(linked),'--evidence',str(output)])
   self.assertFalse(output.exists());self.assertEqual(fixture.read_bytes(),before)
if __name__=='__main__':unittest.main()
