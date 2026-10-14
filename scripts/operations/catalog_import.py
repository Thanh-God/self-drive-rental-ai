"""Create-only catalog importer. Default preview is offline and cannot write to DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the Admin bearer token to another endpoint.


def validate(data):
    if data.get("approved") is not True:
        raise ValueError("Manifest is a proposal; fill and approve it before import")
    for group in ("branches", "vehicles"):
        if not isinstance(data.get(group), list) or not data[group]:
            raise ValueError(f"Missing {group}")
    def text(value, limit):
        return isinstance(value, str) and 0 < len(value.strip()) <= limit and value == value.strip()
    branches = data["branches"]
    names = [b.get("name") for b in branches]
    if not all(text(n, 120) for n in names) or len({n.casefold() for n in names}) != len(names):
        raise ValueError("Invalid or duplicate branch names")
    if not all(text(b.get("address"), 300) for b in branches):
        raise ValueError("Branch addresses require approval")
    plates = []
    for v in data["vehicles"]:
        if not all(text(v.get(k), limit) for k, limit in [("name", 120), ("plate", 20), ("brand", 100), ("category", 100)]):
            raise ValueError("Vehicle name, plate, brand and category required")
        if v.get("branch") not in names or type(v.get("dailyPrice")) is not int or not 1 <= v["dailyPrice"] <= 100000000:
            raise ValueError("Invalid vehicle branch or price")
        if type(v.get("seats")) is not int or not 2 <= v["seats"] <= 9 or v.get("transmission") not in ("AUTO", "MANUAL"):
            raise ValueError("Only supported passenger cars may be imported")
        plates.append(v["plate"].upper())
    if len(set(plates)) != len(plates):
        raise ValueError("Duplicate plates")


def client(base, token):
    parsed = urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.path != "/api/v1" or parsed.query or parsed.fragment or parsed.username:
        raise ValueError("Target must be an explicit local http://host:port/api/v1 endpoint")
    if not parsed.port or not token:
        raise ValueError("Explicit API port and KDRIVE_ADMIN_TOKEN required")
    opener = build_opener(NoRedirect())
    def call(method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(base + path, data=body, method=method,
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with opener.open(request, timeout=20) as response:
                content = response.read()
                return json.loads(content) if content else None
        except HTTPError as error:
            raise ValueError(f"API {method} {path}: HTTP {error.code}; stop and inspect existing records") from None
    return call


def apply(data, call, record):
    """All existing-object conflicts are checked before the first POST. Never PUT/delete."""
    validate(data)
    if call("GET", "/auth/me").get("role") != "ADMIN":
        raise ValueError("Admin session required")
    branches = call("GET", "/branches")
    vehicles = call("GET", "/vehicles")
    catalog = call("GET", "/vehicles/catalog")
    def index(rows, key):
        result = {}
        for row in rows:
            value = row[key].casefold()
            if value in result:
                raise ValueError(f"Ambiguous existing {key}; reconcile manually")
            result[value] = row
        return result
    branch_map = index(branches, "name")
    brand_map = index(catalog["brands"], "name")
    category_map = index(catalog["categories"], "name")
    vehicle_map = index(vehicles, "plate")
    for branch in data["branches"]:
        old = branch_map.get(branch["name"].casefold())
        if old and (old["address"] != branch["address"] or old["status"] != "ACTIVE"):
            raise ValueError("Existing branch differs; reconcile manually")
    for v in data["vehicles"]:
        old = vehicle_map.get(v["plate"].casefold())
        if old:
            expected = {k: v[k] for k in ("name", "seats", "transmission", "dailyPrice")}
            expected.update(brandId=brand_map.get(v["brand"].casefold(), {}).get("id"),
                            categoryId=category_map.get(v["category"].casefold(), {}).get("id"),
                            homeBranchId=branch_map.get(v["branch"].casefold(), {}).get("id"))
            if any(old.get(k) != value for k, value in expected.items()):
                raise ValueError("Existing plate differs; reconcile manually")
    def create(path, payload):
        created = call("POST", path, payload)
        if not isinstance(created, dict) or not created.get("id"):
            raise ValueError("Missing created ID; stop and inspect server")
        record({"path": path, "id": created["id"]})
        return created
    for b in data["branches"]:
        key = b["name"].casefold()
        if key not in branch_map:
            branch_map[key] = create("/admin/branches", b)
    for field, mapping, path in [("brand", brand_map, "/admin/vehicle-brands"), ("category", category_map, "/admin/vehicle-categories")]:
        for v in data["vehicles"]:
            key = v[field].casefold()
            if key not in mapping:
                mapping[key] = create(path, {"name": v[field]})
    for v in data["vehicles"]:
        if v["plate"].casefold() in vehicle_map:
            continue
        payload = {k: v[k] for k in ("name", "seats", "transmission", "dailyPrice")}
        payload.update(plate=v["plate"].upper(), brandId=brand_map[v["brand"].casefold()]["id"],
                       categoryId=category_map[v["category"].casefold()]["id"],
                       homeBranchId=branch_map[v["branch"].casefold()]["id"], status="ACTIVE", version=0)
        create("/admin/vehicles", payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approved-sha256")
    parser.add_argument("--base-url")
    parser.add_argument("--journal", type=Path)
    args = parser.parse_args()
    raw = args.manifest.read_bytes()
    data = json.loads(raw)
    digest = hashlib.sha256(raw).hexdigest()
    if not args.apply:
        print(json.dumps({"mode": "OFFLINE PREVIEW — no API/DB writes", "sha256": digest,
                          "approved": data.get("approved", False), "proposal": data}, ensure_ascii=False, indent=2))
        return
    validate(data)
    if args.approved_sha256 != digest or not args.journal or not args.base_url:
        raise ValueError("Exact approved SHA256, explicit target and new journal required")
    call = client(args.base_url, os.environ.get("KDRIVE_ADMIN_TOKEN"))
    with args.journal.open("x", encoding="utf-8") as journal:
        def record(row):
            journal.write(json.dumps(row) + "\n")
            journal.flush()
        record({"manifestSHA256": digest, "target": args.base_url})
        apply(data, call, record)
    print("Requests completed. Verify readback, routes, staff assignments and images separately.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
