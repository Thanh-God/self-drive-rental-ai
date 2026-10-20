#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kiem thu tu dong cho script import_locations_pilot.py (F06):
- Kiem thu pre-validation toan bo dataset truoc mutation.
- Kiem thu so sanh metadata & phat hien conflict (conflict-safe).
- Kiem thu dry-run, idempotence va auth failure qua mock HTTP server.
"""

import http.server
import json
import threading
import unittest
from pathlib import Path

from import_locations_pilot import (
    validate_dataset,
    metadata_matches,
    import_pilot_locations,
)


class MockBackendHandler(http.server.BaseHTTPRequestHandler):
    categories = [{"id": "cat-1", "name": "Bảo tàng & Văn hóa"}]
    locations = []
    auth_token = "valid-admin-token"

    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {self.auth_token}":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error": "Unauthorized"}')
            return

        if self.path == "/api/v1/admin/location-categories":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(self.categories).encode("utf-8"))
        elif self.path == "/api/v1/admin/locations":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(self.locations).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {self.auth_token}":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error": "Unauthorized"}')
            return

        content_len = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_len).decode("utf-8"))

        if self.path == "/api/v1/admin/location-categories":
            new_cat = {"id": f"cat-{len(self.categories)+1}", "name": body["name"]}
            self.categories.append(new_cat)
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(new_cat).encode("utf-8"))
        elif self.path == "/api/v1/admin/locations":
            new_loc = dict(body)
            new_loc["id"] = f"loc-{len(self.locations)+1}"
            self.locations.append(new_loc)
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(new_loc).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Tat log server khi chay test


class ImportLocationsPilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        MockBackendHandler.categories = [{"id": "cat-1", "name": "Bảo tàng & Văn hóa"}]
        MockBackendHandler.locations = []
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), MockBackendHandler)
        cls.port = cls.server.server_port
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_01_pilot_json_pre_validation(self):
        json_path = Path(__file__).parent / "locations-pilot.json"
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        errors = validate_dataset(data)
        self.assertEqual(errors, [], f"Dataset pilot hop le phai co 0 loi validation: {errors}")

    def test_02_validation_catches_invalid_coords_and_duplicates(self):
        bad_data = {
            "schemaVersion": "kdrive-locations-pilot-v1",
            "locations": [
                {"name": "Điểm 1", "categoryName": "Cat", "latitude": 21.0, "longitude": 105.8},  # Ha Noi (ngoai Da Nang)
                {"name": "Điểm 1", "categoryName": "Cat", "latitude": 16.0, "longitude": 108.2},  # Duplicate name
                {"name": "Điểm 3", "categoryName": "Cat", "latitude": 16.0, "longitude": 108.2, "metadata": {"timezone": "UTC"}},  # Bad tz
                {"name": "Điểm 4", "categoryName": "Cat", "latitude": 16.0, "longitude": 108.2, "metadata": {"timezone": "Asia/Ho_Chi_Minh", "durationMinutes": 60}} # Missing evidence
            ]
        }
        errors = validate_dataset(bad_data)
        self.assertTrue(len(errors) >= 4)
        self.assertTrue(any("ngoai vung" in e for e in errors))
        self.assertTrue(any("trung lap" in e for e in errors))
        self.assertTrue(any("Asia/Ho_Chi_Minh" in e for e in errors))
        self.assertTrue(any("durationEvidence" in e for e in errors))

    def test_03_metadata_matching(self):
        m1 = {"timezone": "Asia/Ho_Chi_Minh", "durationMinutes": 60, "hoursEvidence": {"url": "https://a.test"}}
        m2 = {"timezone": "Asia/Ho_Chi_Minh", "durationMinutes": 60, "hoursEvidence": {"url": "https://a.test"}}
        m_diff = {"timezone": "Asia/Ho_Chi_Minh", "durationMinutes": 90, "hoursEvidence": {"url": "https://a.test"}}
        self.assertTrue(metadata_matches(m1, m2))
        self.assertFalse(metadata_matches(m1, m_diff))
        self.assertFalse(metadata_matches(m1, None))

    def test_04_auth_failure_reported(self):
        json_path = Path(__file__).parent / "locations-pilot.json"
        res = import_pilot_locations(json_path, self.base_url, token="invalid-token", dry_run=False)
        self.assertTrue(len(res["errors"]) > 0)
        self.assertTrue("401" in res["errors"][0])

    def test_05_dry_run_creates_nothing(self):
        json_path = Path(__file__).parent / "locations-pilot.json"
        res = import_pilot_locations(json_path, self.base_url, token="valid-admin-token", dry_run=True)
        self.assertTrue(res["dryRun"])
        self.assertTrue(res["validationSuccess"])
        self.assertEqual(len(MockBackendHandler.locations), 0, "Dry-run tuyet doi khong ghi locations vao server.")
        self.assertEqual(len(res["locationsCreated"]), 8)

    def test_06_apply_first_run_then_second_run_idempotent(self):
        json_path = Path(__file__).parent / "locations-pilot.json"
        # Run 1: Apply thuc te
        res1 = import_pilot_locations(json_path, self.base_url, token="valid-admin-token", dry_run=False)
        self.assertEqual(len(res1["errors"]), 0)
        self.assertEqual(len(res1["locationsCreated"]), 8)
        self.assertEqual(len(MockBackendHandler.locations), 8)

        # Run 2: Idempotent apply lan 2 -> Tat ca phai duoc bo qua (skipped)
        res2 = import_pilot_locations(json_path, self.base_url, token="valid-admin-token", dry_run=False)
        self.assertEqual(len(res2["errors"]), 0)
        self.assertEqual(len(res2["locationsCreated"]), 0, "Lan 2 khong duoc tao them bat ky ban ghi nao.")
        self.assertEqual(len(res2["locationsSkipped"]), 8, "Toan bo 8 ban ghi phai duoc skipped vi da ton tai trung khop.")
        self.assertEqual(len(MockBackendHandler.locations), 8)

    def test_07_conflict_detection_when_server_facts_drift(self):
        json_path = Path(__file__).parent / "locations-pilot.json"
        # Thay doi toa do cua 1 dia diem tren mock server de gia lap facts bi drift
        orig_lat = MockBackendHandler.locations[0]["latitude"]
        MockBackendHandler.locations[0]["latitude"] = 16.5555555  # Toa do khac

        res = import_pilot_locations(json_path, self.base_url, token="valid-admin-token", dry_run=False)
        self.assertEqual(len(res["locationsConflict"]), 1, "Phai phat hien conflict do toa do bi drift.")
        self.assertEqual(len(res["locationsSkipped"]), 7)

        # Restore
        MockBackendHandler.locations[0]["latitude"] = orig_lat


if __name__ == "__main__":
    unittest.main()
