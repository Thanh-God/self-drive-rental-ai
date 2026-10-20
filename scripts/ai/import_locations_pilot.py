#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Importer idempotent cho bo dia diem pilot KDrive.
- Mac dinh o che do --dry-run (khong ghi du lieu).
- Validate toan bo dataset JSON truoc khi thuc hien bat ky mutation nao.
- So sanh toan dien cac facts (toa do, category, status, metadata) de phat hien conflict.
- Khong ghi de neu co xung dot du lieu (Conflict-safe).
- Khong xoa roi tao lai (tranh dangling foreign keys).
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


def validate_dataset(data):
    """Kiem tra tinh hop le toan bo dataset JSON truoc khi goi bat ky API nao."""
    errors = []
    if not isinstance(data, dict):
        return ["Dataset phai la JSON object."]

    if data.get("schemaVersion") != "kdrive-locations-pilot-v1":
        errors.append(f"schemaVersion khong hop le: {data.get('schemaVersion')}")

    locations = data.get("locations")
    if not isinstance(locations, list) or len(locations) < 4:
        errors.append("Danh sach locations phai chua it nhat 4 dia diem.")
        return errors

    seen_names = set()
    # Bounding box Da Nang - Hoi An: [107.4, 15.4, 108.8, 16.7]
    min_lat, max_lat = 15.4, 16.7
    min_lng, max_lng = 107.4, 108.8

    for i, loc in enumerate(locations):
        prefix = f"locations[{i}]"
        name = loc.get("name")
        if not name or not isinstance(name, str):
            errors.append(f"{prefix}: thieu truong name hop le.")
        elif name in seen_names:
            errors.append(f"{prefix}: trung lap ten dia diem '{name}'.")
        else:
            seen_names.add(name)

        if not loc.get("categoryName"):
            errors.append(f"{prefix}: thieu categoryName.")

        lat = loc.get("latitude")
        lng = loc.get("longitude")
        if lat is None or not (min_lat <= lat <= max_lat):
            errors.append(f"{prefix}: vi do {lat} nam ngoai vung Da Nang - Hoi An ({min_lat}-{max_lat}).")
        if lng is None or not (min_lng <= lng <= max_lng):
            errors.append(f"{prefix}: kinh do {lng} nam ngoai vung Da Nang - Hoi An ({min_lng}-{max_lng}).")

        meta = loc.get("metadata")
        if meta is not None:
            if not isinstance(meta, dict):
                errors.append(f"{prefix}: metadata phai la object.")
            else:
                if meta.get("timezone") != "Asia/Ho_Chi_Minh":
                    errors.append(f"{prefix}: timezone phai la Asia/Ho_Chi_Minh.")
                dur = meta.get("durationMinutes")
                if dur is not None and (not isinstance(dur, int) or dur <= 0 or dur > 1440):
                    errors.append(f"{prefix}: durationMinutes phai tu 1 den 1440.")
                if dur is not None and not meta.get("durationEvidence"):
                    errors.append(f"{prefix}: co durationMinutes nhung thieu durationEvidence.")

    return errors


def metadata_matches(ex_meta, pilot_meta):
    """So sanh metadata giua existing tren server va pilot dataset."""
    if ex_meta is None and pilot_meta is None:
        return True
    if ex_meta is None or pilot_meta is None:
        return False
    # So sanh timezone va durationMinutes
    if ex_meta.get("timezone") != pilot_meta.get("timezone"):
        return False
    if ex_meta.get("durationMinutes") != pilot_meta.get("durationMinutes"):
        return False
    # So sanh hoursEvidence url
    ex_h_ev = (ex_meta.get("hoursEvidence") or {}).get("url")
    pi_h_ev = (pilot_meta.get("hoursEvidence") or {}).get("url")
    if ex_h_ev != pi_h_ev:
        return False
    return True


def import_pilot_locations(json_path, base_url, token, dry_run=True):
    with open(json_path, "r", encoding="utf-8") as f:
        pilot_data = json.load(f)

    # 1. Pre-validation toan bo dataset (F06)
    val_errors = validate_dataset(pilot_data)
    if val_errors:
        return {
            "dryRun": dry_run,
            "validationSuccess": False,
            "errors": val_errors,
            "locationsCreated": [],
            "locationsSkipped": [],
            "locationsConflict": []
        }

    report = {
        "dryRun": dry_run,
        "validationSuccess": True,
        "totalLocations": len(pilot_data.get("locations", [])),
        "categoriesCreated": [],
        "categoriesReused": [],
        "locationsCreated": [],
        "locationsSkipped": [],
        "locationsConflict": [],
        "errors": []
    }

    if not token and not dry_run:
        report["errors"].append("Khong co token Admin de thuc hien --apply.")
        return report

    # 2. Lay danh muc hien tai
    cat_url = f"{base_url}/api/v1/admin/location-categories"
    status, categories = http_request(cat_url, method="GET", token=token)
    if status != 200:
        report["errors"].append(f"Khong the doc danh muc dia diem: HTTP {status} ({categories})")
        return report

    category_map = {c["name"]: c["id"] for c in categories}

    # 3. Xu ly cac danh muc can thiet
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

    # 4. Lay danh sach dia diem hien co
    loc_url = f"{base_url}/api/v1/admin/locations"
    status, existing_locations = http_request(loc_url, method="GET", token=token)
    if status != 200:
        report["errors"].append(f"Khong the doc danh sach dia diem: HTTP {status} ({existing_locations})")
        return report

    existing_by_name = {loc["name"]: loc for loc in existing_locations}

    # 5. Xu ly tung dia diem
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
            coords_match = abs(ex_lat - lat) < 1e-5 and abs(ex_lng - lng) < 1e-5
            category_match = existing.get("categoryId") == cat_id
            status_match = existing.get("status") == status_val
            meta_match = metadata_matches(existing.get("metadata"), meta)

            if coords_match and category_match and status_match and meta_match:
                report["locationsSkipped"].append({
                    "name": name,
                    "reason": "Exact match (coordinates, category, status, metadata) - idempotent skip"
                })
            else:
                conflict_reasons = []
                if not coords_match:
                    conflict_reasons.append(f"coordinates diff (server: {ex_lat},{ex_lng} vs pilot: {lat},{lng})")
                if not category_match:
                    conflict_reasons.append(f"category diff (server: {existing.get('categoryId')} vs pilot: {cat_id})")
                if not status_match:
                    conflict_reasons.append(f"status diff (server: {existing.get('status')} vs pilot: {status_val})")
                if not meta_match:
                    conflict_reasons.append("metadata/hours facts diff")

                report["locationsConflict"].append({
                    "name": name,
                    "reason": "; ".join(conflict_reasons)
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

    dry_run = not args.apply
    result = import_pilot_locations(args.json, args.base_url, args.token, dry_run=dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["errors"] or not result.get("validationSuccess", True):
        sys.exit(1)


if __name__ == "__main__":
    main()
