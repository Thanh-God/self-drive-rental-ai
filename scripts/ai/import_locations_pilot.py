#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Importer idempotent cho bo dia diem pilot KDrive.
- Mac dinh o che do --dry-run (khong ghi du lieu).
- Su dung API Admin hien hanh:
    + POST /api/v1/admin/location-categories (dam bao danh muc ton tai)
    + GET /api/v1/admin/locations (kiem tra dia diem da co)
    + POST /api/v1/admin/locations (tao moi neu chua co)
- Khong ghi de neu dia diem da ton tai (neu khac facts, bao CONFLICT va bo qua).
- Khong thuc hien xoa roi tao lai (tranh dangling foreign keys).
"""

import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Dam bao output UTF-8 tren Windows console
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def http_request(url, method="GET", token=None, payload=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            status = resp.status
            return status, json.loads(content) if content else None
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"error": err_body}
        return err.code, parsed


def import_pilot_locations(json_path, base_url, token, dry_run=True):
    with open(json_path, "r", encoding="utf-8") as f:
        pilot_data = json.load(f)

    report = {
        "dryRun": dry_run,
        "totalLocations": len(pilot_data.get("locations", [])),
        "categoriesCreated": [],
        "categoriesReused": [],
        "locationsCreated": [],
        "locationsSkipped": [],
        "locationsConflict": [],
        "errors": []
    }

    # 1. Lay danh muc hien tai
    cat_url = f"{base_url}/api/v1/admin/location-categories"
    status, categories = http_request(cat_url, method="GET", token=token)
    if status != 200:
        report["errors"].append(f"Khong the doc danh muc dia diem: HTTP {status}")
        return report

    category_map = {c["name"]: c["id"] for c in categories}

    # 2. Xu ly cac danh muc can thiet
    required_categories = sorted({loc["categoryName"] for loc in pilot_data["locations"]})
    for cat_name in required_categories:
        if cat_name in category_map:
            report["categoriesReused"].append(cat_name)
        else:
            if dry_run:
                report["categoriesCreated"].append(f"[DRY-RUN] {cat_name}")
                category_map[cat_name] = f"dry-run-cat-{cat_name}"
            else:
                c_status, c_res = http_request(cat_url, method="POST", token=token, payload={"name": cat_name})
                if c_status in (200, 201) and "id" in c_res:
                    category_map[cat_name] = c_res["id"]
                    report["categoriesCreated"].append(cat_name)
                else:
                    report["errors"].append(f"Loi tao danh muc '{cat_name}': {c_res}")

    # 3. Lay danh sach dia diem hien co
    loc_url = f"{base_url}/api/v1/admin/locations"
    status, existing_locations = http_request(loc_url, method="GET", token=token)
    if status != 200:
        report["errors"].append(f"Khong the doc danh sach dia diem: HTTP {status}")
        return report

    existing_by_name = {loc["name"]: loc for loc in existing_locations}

    # 4. Xu ly tung dia diem
    for loc in pilot_data["locations"]:
        name = loc["name"]
        cat_id = category_map.get(loc["categoryName"])
        lat = round(float(loc["latitude"]), 7)
        lng = round(float(loc["longitude"]), 7)
        status_val = loc.get("status", "ACTIVE")
        meta = loc.get("metadata")

        payload = {
            "categoryId": cat_id,
            "name": name,
            "latitude": lat,
            "longitude": lng,
            "status": status_val,
            "metadata": meta
        }

        if name in existing_by_name:
            existing = existing_by_name[name]
            ex_lat = round(float(existing["latitude"]), 7)
            ex_lng = round(float(existing["longitude"]), 7)
            if abs(ex_lat - lat) < 1e-5 and abs(ex_lng - lng) < 1e-5:
                report["locationsSkipped"].append({"name": name, "reason": "Already exists with matching coordinates"})
            else:
                report["locationsConflict"].append({
                    "name": name,
                    "reason": f"Coordinate mismatch. Existing: ({ex_lat}, {ex_lng}), Pilot: ({lat}, {lng})"
                })
        else:
            if dry_run:
                report["locationsCreated"].append({"name": name, "status": "[DRY-RUN] Plan to create"})
            else:
                l_status, l_res = http_request(loc_url, method="POST", token=token, payload=payload)
                if l_status in (200, 201) and "id" in l_res:
                    report["locationsCreated"].append({"name": name, "id": l_res["id"]})
                else:
                    report["errors"].append(f"Loi tao dia diem '{name}': HTTP {l_status} - {l_res}")

    return report


def main():
    parser = argparse.ArgumentParser(description="Importer bo dia diem pilot KDrive")
    parser.add_argument("--json", default=str(Path(__file__).parent / "locations-pilot.json"), help="Duong dan file locations-pilot.json")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080", help="Root URL backend")
    parser.add_argument("--token", default=os.getenv("KDRIVE_ADMIN_TOKEN"), help="Admin JWT token (hoac dat qua env KDRIVE_ADMIN_TOKEN)")
    parser.add_argument("--apply", action="store_true", help="Thuc hien ghi thay vi dry-run")
    args = parser.parse_args()

    if not args.token:
        print("Luu y: Khong co admin token. Dry-run chi mo phong kiem tra schema cuc bo.")

    dry_run = not args.apply
    result = import_pilot_locations(args.json, args.base_url, args.token, dry_run=dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
