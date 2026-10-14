import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
from configure_catalog import configure


class API:
    def __init__(self):
        self.calls = []
        self.branches = [{"id": "b", "name": "Old", "address": "Address", "status": "ACTIVE", "version": 0}]
        self.vehicles = [{"id": "v", "name": "Car", "plate": "OLD", "description": "Old", "version": 2, "status": "ACTIVE", "currentBranchId": "b", "images": []}]
        self.routes = []
        self.assignments = [{"userId": "staff", "branchId": "b"}]
        self.role = "ADMIN"

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET":
            return {"/auth/me": {"role": self.role}, "/branches": self.branches, "/vehicles": self.vehicles,
                    "/branch-routes": self.routes, "/admin/staff-branches": self.assignments}[path]
        if method == "PUT" and path == "/admin/vehicles/v":
            self.vehicles[0].update(body | {"version": self.vehicles[0]["version"] + 1})
        if method == "PUT" and path == "/admin/branches/b":
            self.branches[0].update(body | {"version": self.branches[0]["version"] + 1})
        return body


def plan(api):
    return {"approved": True, "vehicles": [{"expected": {k:v for k,v in api.vehicles[0].items() if k != "images"}, "changes": {"plate": "NEW", "description": "New"}}],
            "branches": [{"expected": copy.deepcopy(api.branches[0]), "changes": {"name": "New"}}]}


class ConfigurationTests(unittest.TestCase):
    def test_guarded_update_and_noop_replay(self):
        api = API()
        data = plan(api)
        configure(data, api, lambda _: None)
        self.assertEqual(api.vehicles[0]["plate"], "NEW")
        self.assertEqual(api.vehicles[0]["currentBranchId"], "b")
        self.assertEqual(api.branches[0]["name"], "New")
        api.calls.clear()
        configure(data, api, lambda _: None)
        self.assertTrue(all(method == "GET" for method,_,_ in api.calls))

    def test_all_edits_preflight_before_any_write(self):
        api = API()
        data = plan(api)
        api.branches[0]["version"] = 1
        with self.assertRaisesRegex(ValueError, "Stale"):
            configure(data, api, lambda _: None)
        self.assertTrue(all(method == "GET" for method,_,_ in api.calls))

    def test_no_authority_for_price_status_or_location_changes(self):
        for field in ["dailyPrice", "status", "currentBranchId", "homeBranchId"]:
            api = API()
            data = plan(api)
            data["vehicles"][0]["changes"][field] = "changed"
            with self.assertRaisesRegex(ValueError, "Unsupported edit"):
                configure(data, api, lambda _: None)
            self.assertTrue(all(method == "GET" for method,_,_ in api.calls))

    def test_missing_or_changed_asset_refuses_before_edits(self):
        api = API()
        data = plan(api)
        data["images"] = [{"plate": "NEW", "model": "Car", "url": "/media/vehicles/nonexistent.jpg", "attribution": "Author", "sha256": "wrong"}]
        with self.assertRaisesRegex(ValueError, "asset missing or hash"):
            configure(data, api, lambda _: None)
        self.assertTrue(all(method == "GET" for method,_,_ in api.calls))

    def test_route_conflict_refuses_before_edits(self):
        api = API()
        data = plan(api)
        data["routes"] = [{"pickup": "New", "return": "New", "fee": 0}]
        api.routes = [{"pickupBranchId": "b", "returnBranchId": "b", "fee": 10, "enabled": True}]
        with self.assertRaisesRegex(ValueError, "Route already differs"):
            configure(data, api, lambda _: None)
        self.assertTrue(all(method == "GET" for method,_,_ in api.calls))

    def test_unapproved_or_wrong_role_refuses(self):
        for approved, role in [(False, "ADMIN"), (True, "USER")]:
            api = API()
            api.role = role
            with self.assertRaises(ValueError):
                configure({"approved": approved}, api, lambda _: None)
            self.assertTrue(all(method == "GET" for method,_,_ in api.calls))


if __name__ == "__main__":
    unittest.main()
