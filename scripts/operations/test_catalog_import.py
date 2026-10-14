import copy
import contextlib
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("catalog_import", Path(__file__).with_name("catalog_import.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def manifest():
    return {"approved": True, "branches": [{"name": "Branch A", "address": "Address A"}],
            "vehicles": [{"name": "Car A", "plate": "43A-12345", "brand": "Brand A", "category": "Sedan",
                          "branch": "Branch A", "seats": 5, "transmission": "AUTO", "dailyPrice": 650000}]}


class FakeAPI:
    def __init__(self):
        self.calls = []
        self.role = "ADMIN"
        self.branches = []
        self.vehicles = []
        self.catalog = {"brands": [], "categories": []}
        self.fail = None

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == self.fail:
            raise ValueError("HTTP 409 conflict")
        if method == "GET":
            return {"/auth/me": {"role": self.role}, "/branches": self.branches,
                    "/vehicles": self.vehicles, "/vehicles/catalog": self.catalog}[path]
        return {"id": "new-" + str(len(self.calls)), **body}


class ImportTests(unittest.TestCase):
    def test_create_order_and_typed_payload(self):
        api, journal = FakeAPI(), []
        module.apply(manifest(), api, journal.append)
        posts = [(path, body) for method, path, body in api.calls if method == "POST"]
        self.assertEqual([p for p, _ in posts], ["/admin/branches", "/admin/vehicle-brands", "/admin/vehicle-categories", "/admin/vehicles"])
        self.assertEqual(posts[-1][1]["homeBranchId"], journal[0]["id"])
        self.assertEqual(posts[-1][1]["brandId"], journal[1]["id"])
        self.assertEqual(posts[-1][1]["dailyPrice"], 650000)
        self.assertEqual(posts[-1][1]["status"], "ACTIVE")

    def test_refuse_unapproved_or_incomplete_before_network(self):
        changes = [{"approved": False}, {"branches": [{"name": "Branch A", "address": None}]}]
        for change in changes:
            api = FakeAPI()
            data = manifest() | change
            with self.assertRaises(ValueError):
                module.apply(data, api, lambda _: None)
            self.assertEqual(api.calls, [])

    def test_invalid_vehicle_references_and_duplicate_plates(self):
        for patch in [{"branch": "missing"}, {"dailyPrice": 0}, {"dailyPrice": True}, {"seats": 1}, {"transmission": "SCOOTER"}]:
            data = manifest()
            data["vehicles"][0].update(patch)
            with self.assertRaises(ValueError):
                module.validate(data)
        data = manifest()
        data["vehicles"].append(copy.deepcopy(data["vehicles"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate plates"):
            module.validate(data)

    def test_nonadmin_and_conflicting_branch_do_not_write(self):
        for role, branches in [("STAFF", []), ("ADMIN", [{"id": "b", "name": "Branch A", "address": "Different", "status": "ACTIVE"}])]:
            api = FakeAPI()
            api.role, api.branches = role, branches
            with self.assertRaises(ValueError):
                module.apply(manifest(), api, lambda _: None)
            self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_existing_plate_conflict_prevents_all_writes(self):
        api = FakeAPI()
        api.vehicles = [{"plate": "43A-12345", "name": "Other car"}]
        with self.assertRaisesRegex(ValueError, "Existing plate differs"):
            module.apply(manifest(), api, lambda _: None)
        self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_exact_existing_vehicle_is_not_recreated_or_relocated(self):
        api = FakeAPI()
        api.branches = [{"id": "b", **manifest()["branches"][0], "status": "ACTIVE"}]
        api.catalog = {"brands": [{"id": "brand", "name": "Brand A"}], "categories": [{"id": "cat", "name": "Sedan"}]}
        api.vehicles = [{"id": "v", "plate": "43A-12345", "name": "Car A", "seats": 5, "transmission": "AUTO",
                         "dailyPrice": 650000, "brandId": "brand", "categoryId": "cat", "homeBranchId": "b",
                         "currentBranchId": "another", "status": "MAINTENANCE"}]
        module.apply(manifest(), api, lambda _: None)
        self.assertTrue(all(method == "GET" for method, _, _ in api.calls))

    def test_partial_failure_stops_and_keeps_created_ids(self):
        api, journal = FakeAPI(), []
        api.fail = "/admin/vehicle-brands"
        with self.assertRaises(ValueError):
            module.apply(manifest(), api, journal.append)
        self.assertEqual(len(journal), 1)
        self.assertEqual(journal[0]["path"], "/admin/branches")
        self.assertFalse(any(path == "/admin/vehicles" for _, path, _ in api.calls))

    def test_reject_remote_or_ambiguous_target_without_network(self):
        for url in ["https://example.com/api/v1", "http://localhost/api/v1", "http://localhost:8080/api/v1?x=y", "http://user@localhost:8080/api/v1"]:
            with self.assertRaises(ValueError):
                module.client(url, "test-token")

    def test_cli_preview_is_offline_and_shows_exact_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "draft.json"
            file.write_text(json.dumps(manifest() | {"approved": False}), encoding="utf-8")
            output = io.StringIO()
            with patch.object(sys, "argv", ["catalog_import.py", str(file)]), patch.object(module, "client") as client, contextlib.redirect_stdout(output):
                module.main()
            client.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())

    def test_cli_wrong_hash_refuses_before_client_or_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            file, journal = Path(directory) / "approved.json", Path(directory) / "journal.jsonl"
            file.write_text(json.dumps(manifest()), encoding="utf-8")
            with patch.object(sys, "argv", ["catalog_import.py", str(file), "--apply", "--approved-sha256", "wrong",
                                           "--base-url", "http://localhost:8080/api/v1", "--journal", str(journal)]), patch.object(module, "client") as client:
                with self.assertRaisesRegex(ValueError, "Exact approved SHA256"):
                    module.main()
            client.assert_not_called()
            self.assertFalse(journal.exists())

    def test_cli_never_overwrites_existing_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            file, journal = Path(directory) / "approved.json", Path(directory) / "journal.jsonl"
            file.write_text(json.dumps(manifest()), encoding="utf-8")
            journal.write_text("retain", encoding="utf-8")
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            api = FakeAPI()
            with patch.object(sys, "argv", ["catalog_import.py", str(file), "--apply", "--approved-sha256", digest,
                                           "--base-url", "http://localhost:8080/api/v1", "--journal", str(journal)]), patch.object(module, "client", return_value=api):
                with self.assertRaises(FileExistsError):
                    module.main()
            self.assertEqual(journal.read_text(encoding="utf-8"), "retain")
            self.assertEqual(api.calls, [])


if __name__ == "__main__":
    unittest.main()
