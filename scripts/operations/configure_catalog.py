"""Reviewable catalog amendments/media/routes/assignments; no SQL, delete or automatic retry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
from catalog_import import client


def configure(plan, call, record, asset_root=None):
    if plan.get("approved") is not True:
        raise ValueError("Approved configuration required")
    if call("GET", "/auth/me").get("role") != "ADMIN":
        raise ValueError("Admin required")
    vehicles = call("GET", "/vehicles")
    branches = call("GET", "/branches")
    routes = call("GET", "/branch-routes")
    assignments = call("GET", "/admin/staff-branches")
    edits = []
    # Preflight every amendment before mutation; do not move vehicles or touch price/status.
    for kind, rows, allowed in [("vehicles", vehicles, {"name", "plate", "description"}), ("branches", branches, {"name", "address"})]:
        for edit in plan.get(kind, []):
            expected, changes = edit["expected"], edit["changes"]
            if not changes or not set(changes) <= allowed or "version" not in expected or "id" not in expected:
                raise ValueError("Unsupported edit")
            matches = [row for row in rows if row["id"] == expected["id"]]
            if len(matches) != 1:
                raise ValueError("Missing/ambiguous edit target")
            current = matches[0]
            desired = expected | changes
            if all(current.get(k) == value for k, value in desired.items() if k != "version"):
                continue
            if any(current.get(k) != value for k, value in expected.items()):
                raise ValueError("Stale configuration target; reconcile before write")
            edits.append((kind, current, changes))
    predicted_vehicles = [dict(row) for row in vehicles]
    predicted_branches = [dict(row) for row in branches]
    for kind, current, changes in edits:
        for row in predicted_vehicles if kind == "vehicles" else predicted_branches:
            if row["id"] == current["id"]:
                row.update(changes)
    def unique(rows, field):
        mapping = {row[field]: row for row in rows}
        if len(mapping) != len(rows):
            raise ValueError("Ambiguous target names/plates")
        return mapping
    by_plate = unique(predicted_vehicles, "plate")
    by_branch = unique(predicted_branches, "name")
    image_work = []
    image_keys, route_keys, assignment_keys = set(), set(), set()
    asset_root = (asset_root or Path(__file__).resolve().parents[2] / "frontend/public").resolve()
    for image in plan.get("images", []):
        vehicle = by_plate.get(image["plate"])
        if not vehicle or vehicle["name"] != image["model"] or not image["url"].startswith("/media/vehicles/") or not 1 <= len(image["attribution"]) <= 1000:
            raise ValueError("Invalid image mapping")
        key = (image["plate"], image["url"])
        if key in image_keys:
            raise ValueError("Duplicate image mapping")
        image_keys.add(key)
        asset = (asset_root / image["url"].lstrip("/")).resolve()
        if not asset.is_relative_to(asset_root) or not asset.is_file() or hashlib.sha256(asset.read_bytes()).hexdigest() != image.get("sha256"):
            raise ValueError("Image asset missing or hash differs")
        existing = [row for row in vehicle.get("images", []) if row["url"] == image["url"]]
        if existing and (len(existing) != 1 or existing[0]["attribution"] != image["attribution"]):
            raise ValueError("Existing image credit differs; no overwrite")
        if not existing:
            image_work.append((vehicle["id"], image))
    route_work = []
    for route in plan.get("routes", []):
        key = (route["pickup"], route["return"])
        if key in route_keys:
            raise ValueError("Duplicate route")
        route_keys.add(key)
        pickup, destination = by_branch[route["pickup"]], by_branch[route["return"]]
        if pickup["status"] != "ACTIVE" or destination["status"] != "ACTIVE" or type(route["fee"]) is not int or not 0 <= route["fee"] <= 100000000:
            raise ValueError("Invalid route configuration")
        existing = [r for r in routes if r["pickupBranchId"] == pickup["id"] and r["returnBranchId"] == destination["id"]]
        if existing and (len(existing) != 1 or existing[0]["fee"] != route["fee"] or existing[0]["enabled"] is not True):
            raise ValueError("Route already differs; no overwrite")
        if not existing:
            route_work.append({"pickupBranchId": pickup["id"], "returnBranchId": destination["id"], "fee": route["fee"], "enabled": True, "expectedVersion": 0})
    assignment_work = []
    for assignment in plan.get("assignments", []):
        key = (assignment["userId"], assignment["branch"])
        if key in assignment_keys:
            raise ValueError("Duplicate assignment")
        assignment_keys.add(key)
        branch = by_branch[assignment["branch"]]
        if not any(row["userId"] == assignment["userId"] for row in assignments):
            raise ValueError("New assignment requires an already assigned Staff identity")
        if not any(row["userId"] == assignment["userId"] and row["branchId"] == branch["id"] for row in assignments):
            assignment_work.append({"userId": assignment["userId"], "branchId": branch["id"]})
    def write(method, path, payload):
        result = call(method, path, payload)
        record({"method": method, "path": path})
        return result
    for kind, current, changes in edits:
        payload = current | changes
        write("PUT", "/admin/" + kind + "/" + quote(current["id"], safe=""), payload)
    for vehicle_id, image in image_work:
        path = "/admin/vehicles/" + quote(vehicle_id, safe="") + "/images"
        current = call("GET", path)
        write("POST", path, {"url": image["url"], "attribution": image["attribution"], "expectedRevision": current["revision"]})
    for payload in route_work:
        write("PUT", "/admin/branch-routes", payload)
    for payload in assignment_work:
        write("POST", "/admin/staff-branches", payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approved-sha256")
    parser.add_argument("--base-url")
    parser.add_argument("--journal", type=Path)
    args = parser.parse_args()
    raw = args.plan.read_bytes()
    digest, plan = hashlib.sha256(raw).hexdigest(), json.loads(raw)
    if not args.apply:
        print(json.dumps({"mode": "OFFLINE PREVIEW", "sha256": digest, "proposal": plan}, ensure_ascii=False, indent=2))
        return
    if digest != args.approved_sha256 or not args.journal or not args.base_url or plan.get("approved") is not True:
        raise ValueError("Exact approved plan/hash/target and new journal required")
    call = client(args.base_url, os.environ.get("KDRIVE_ADMIN_TOKEN"))
    with args.journal.open("x", encoding="utf-8") as journal:
        def record(row):
            journal.write(json.dumps(row) + "\n")
            journal.flush()
        record({"planSHA256": digest, "target": args.base_url})
        configure(plan, call, record)
    print("Configuration requests completed; independent readback required")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(str(error)) from None
