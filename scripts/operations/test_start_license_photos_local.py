"""Read-only local activation guard checks; never connects to the shared DB."""
import importlib.util, socket, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('license_start',Path(__file__).with_name('start-license-photos-local.py'))
startup=importlib.util.module_from_spec(spec);spec.loader.exec_module(startup)

class LicenseStartupGuards(unittest.TestCase):
    def test_mysql_reads_utf8_without_implicit_client_charset(self):
        with patch.object(startup.h,'run',return_value='Đà Nẵng\n'.encode('utf-8')) as run:
            self.assertEqual(startup.sql('SELECT name FROM branches'),'Đà Nẵng')
            self.assertIn('--default-character-set=utf8mb4',run.call_args.args[0][5])
    def test_snapshot_hashes_json_rows_without_logging_private_values(self):
        with patch.object(startup,'sql',side_effect=['1','["fixture","Đà Nẵng "]']) as sql:
            result=startup.snapshot({'branches':['id','name']})
            self.assertEqual(result['branches']['rows'],'1')
            self.assertEqual(len(result['branches']['sha256']),64)
            self.assertIn('SELECT JSON_ARRAY(`id`,`name`)',sql.call_args.args[0])
            self.assertNotIn('Đà Nẵng',str(result))
    def test_existing_and_outside_output_refuse_without_changes(self):
        with tempfile.TemporaryDirectory(dir=startup.REPO/'.runtime') as folder:
            sentinel=Path(folder)/'keep';sentinel.write_text('KEEP')
            with self.assertRaisesRegex(RuntimeError,'New evidence'):startup.preflight_path(folder)
            self.assertEqual(sentinel.read_text(),'KEEP')
        with self.assertRaisesRegex(RuntimeError,'New evidence'):startup.preflight_path(startup.REPO/'outside-license-artifact')
    def test_busy_port_owner_not_stopped(self):
        with socket.socket() as owner:
            owner.bind(('127.0.0.1',0));owner.listen();port=owner.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError,'occupied'):startup.h.free_ports((port,))
            with socket.create_connection(('127.0.0.1',port),timeout=1):pass
    def test_flyway_line_checksums_preserve_v1_to_v4_and_add_v5(self):
        rows=startup.checksums()
        self.assertEqual(rows[:4],[('1','190705803'),('2','-1792922806'),('3','1994983605'),('4','-1613438858')])
        self.assertEqual([r[0] for r in rows],['1','2','3','4','5'])

if __name__=='__main__':unittest.main()
