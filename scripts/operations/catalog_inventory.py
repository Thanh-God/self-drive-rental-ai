"""Read-only catalog inventory, including protected-table counts; never prints credentials."""
import argparse
import json
from pathlib import Path
import subprocess

ORIGINAL_ID = "ab0698eba8cf545bd23ab40451bfbae01a51a9666bfb66b166a44f81ea418007"


def inventory(container="kltn-phase5-rerun"):
    if container != "kltn-phase5-rerun":
        raise ValueError("Inventory entrypoint only supports the known original container")
    identity = subprocess.run(["docker", "inspect", "--format", "{{.Id}}|{{.State.Running}}", container], capture_output=True, check=True).stdout.decode().strip()
    if identity != ORIGINAL_ID + "|true":
        raise ValueError("Original container identity/running state differs")
    # Explicit fields: no user credentials, contact fields, or document snapshots leave MySQL.
    queries = {
        "vehicles": "SELECT id,name,plate,brand_id,category_id,home_branch_id,current_branch_id,seats,transmission,daily_price,status,description,version FROM vehicles ORDER BY id",
        "brands": "SELECT id,name FROM vehicle_brands ORDER BY id",
        "categories": "SELECT id,name FROM vehicle_categories ORDER BY id",
        "branches": "SELECT id,name,address,status,version FROM branches ORDER BY id",
        "routes": "SELECT id,pickup_branch_id,return_branch_id,fee,enabled,version FROM branch_routes ORDER BY id",
        "staffAssignments": "SELECT user_id,branch_id FROM staff_branches ORDER BY user_id,branch_id",
        "staff": "SELECT id,full_name,status FROM users WHERE role='STAFF' ORDER BY id",
        "images": "SELECT id,vehicle_id,url,sort_order,attribution FROM vehicle_images ORDER BY vehicle_id,sort_order",
        "history": "SELECT installed_rank,version,description,type,script,checksum,success FROM flyway_schema_history ORDER BY installed_rank",
    }
    protected = ["bookings", "booking_status_history", "contracts", "invoices", "invoice_items", "vehicle_handover_records", "reviews", "incident_cases", "incident_events", "users", "driver_licenses"]
    statements = ["SET TRANSACTION READ ONLY", "START TRANSACTION WITH CONSISTENT SNAPSHOT"]
    for query in queries.values():
        statements.append(query)
    for table in protected:
        statements.append("SELECT '" + table + "' AS protected_table,COUNT(*) AS row_count FROM " + table)
    statements.append("COMMIT")
    command = ["docker", "exec", "-i", container, "sh", "-c",
               'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --database=kdrive --default-character-set=utf8mb4 --xml']
    result = subprocess.run(command, input=(";\n".join(statements) + ";\n").encode(), capture_output=True)
    if result.returncode:
        raise RuntimeError("Read-only inventory failed; no credentials or raw errors emitted")
    # mysql XML emits independent resultset documents; wrap after removing repeated declarations.
    from xml.etree import ElementTree as ET
    xml = result.stdout.decode("utf-8").replace('<?xml version="1.0"?>', '')
    sets = list(ET.fromstring("<inventory>" + xml + "</inventory>"))
    names = list(queries) + protected
    if len(sets) != len(names):
        raise ValueError("Inventory resultset count differs")
    parsed = {name: [{field.attrib["name"]: field.text for field in row} for row in resultset] for name, resultset in zip(names, sets)}
    return {"containerId": ORIGINAL_ID, "schema": "kdrive", "mode": "READ ONLY", "data": parsed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or not args.output.parent.is_dir():
        raise ValueError("New output file in existing directory required")
    data = inventory()
    with args.output.open("x", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    print("Read-only inventory saved; " + str(len(data["data"]["vehicles"])) + " vehicles")


if __name__ == "__main__":
    main()
