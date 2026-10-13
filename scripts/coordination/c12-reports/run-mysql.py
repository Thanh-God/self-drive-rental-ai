"""C11-A2 HTTP/MySQL proof, owning one isolated fixture and keeping its volume."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile

REPO = Path(__file__).resolve().parents[3]


def inputs():
    paths = [p for p in (REPO / "backend/src").rglob("*") if p.is_file()]
    paths += [p for p in (REPO / "backend/.mvn").rglob("*") if p.is_file()]
    paths += [REPO / "backend" / n for n in ("pom.xml", "mvnw", "mvnw.cmd")]
    paths += [Path(__file__)]
    return {p.relative_to(REPO).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--backend-root", required=True)
    parser.add_argument("--reuse-evidence")
    args = parser.parse_args()
    out = Path(args.evidence).resolve()
    if not out.is_relative_to(REPO / ".runtime") or out.exists():
        raise RuntimeError("[PREFLIGHT_REFUSAL] New repository runtime output required")
    build=Path(args.backend_root).resolve()
    if not build.is_relative_to(REPO / ".runtime"):
        raise RuntimeError("[PREFLIGHT_REFUSAL] Isolated backend copy required")
    for source in (REPO / "backend/src").rglob("*"):
        if source.is_file():
            assert source.read_bytes()==(build / source.relative_to(REPO / "backend")).read_bytes(), source
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 33675))
    jar = build / "target/kdrive-0.1.0-SNAPSHOT.jar"
    if not jar.is_file():
        raise RuntimeError("Run backend verify on final source first")
    name = "kltn-c12-report-" + uuid.uuid4().hex[:12]
    volume = "vol-" + name
    schema = "kdrive_c12_report"
    marker = schema + "_meta"
    password, token = uuid.uuid4().hex, uuid.uuid4().hex
    env = os.environ.copy()
    env.pop("SPRING_PROFILES_ACTIVE", None)
    env.update(JAVA_HOME="E:/Tools/Java/jdk-21.0.12.1+1",
               KDRIVE_TEST_DB_URL=f"jdbc:mysql://127.0.0.1:33675/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
               KDRIVE_TEST_DB_USER="root", KDRIVE_TEST_DB_PASSWORD=password,
               KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX=schema,
               KDRIVE_TEST_FIXTURE_MARKER_TOKEN=token,
               KDRIVE_TEST_EXPECTED_HOST="127.0.0.1", KDRIVE_TEST_EXPECTED_PORT="33675",
               KDRIVE_TEST_EXPECTED_SCHEMA=schema, KDRIVE_TEST_MARKER_SCHEMA=marker)
    if args.reuse_evidence:
        previous=Path(args.reuse_evidence).resolve()
        assert previous.is_relative_to(REPO / ".runtime")
        f=json.loads((previous / "fixture.json").read_text())
        assert f["name"].startswith("kltn-c12-report-") and f["schema"]==schema and f["port"]==33675
        name,volume=f["name"],f["volume"]
        password=next(line.split("=",1)[1] for line in (previous / "mysql.private.env").read_text().splitlines() if line.startswith("MYSQL_ROOT_PASSWORD="))
        token=(previous / "marker.private.token").read_text().strip()
        env.update(KDRIVE_TEST_DB_PASSWORD=password,KDRIVE_TEST_FIXTURE_MARKER_TOKEN=token)
    flags = subprocess.CREATE_NO_WINDOW

    def run(command, cwd=REPO, check=True, log=None):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                                creationflags=flags, timeout=600)
        if log:
            (out / log).write_bytes(result.stdout + result.stderr)
            (out / (log + ".exit")).write_text(str(result.returncode))
        if check and result.returncode:
            raise RuntimeError(f"Native exit {result.returncode}; see {log or 'private execution'}")
        return result

    if not args.reuse_evidence and name in run(["docker", "ps", "-a", "--format", "{{.Names}}" ]).stdout.decode().splitlines():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Container identity exists")
    if not args.reuse_evidence and volume in run(["docker", "volume", "ls", "--format", "{{.Name}}"] ).stdout.decode().splitlines():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Volume identity exists")
    before = inputs()
    out.mkdir(parents=True)
    (out / "inputs-before.json").write_text(json.dumps(before, indent=2))
    private = out / "mysql.private.env"
    private.write_text(f"MYSQL_ROOT_PASSWORD={password}\nMYSQL_DATABASE={schema}\n")
    (out / "marker.private.token").write_text(token)
    owned = False
    identity = None
    try:
        if args.reuse_evidence:
            identity=f["id"]
            assert run(["docker","inspect","--format","{{.Id}}|{{.State.Running}}",name]).stdout.decode().strip()==identity+"|false"
            mounts=json.loads(run(["docker","inspect",name]).stdout)[0]["Mounts"]
            assert [m["Name"] for m in mounts if m.get("Destination")=="/var/lib/mysql"]==[volume]
            run(["docker","start",name])
        else:
            identity = run(["docker", "run", "-d", "--name", name, "-p", "127.0.0.1:33675:3306",
                            "--env-file", str(private), "-v", volume + ":/var/lib/mysql", "mysql:8.4"]).stdout.decode().strip()
        owned = True
        (out / "fixture.json").write_text(json.dumps({"id": identity, "name": name, "volume": volume,
                                                     "schema": schema, "port": 33675, "policy": "KEEP stopped"}, indent=2))
        def sql(query, check=True):
            return run(["docker", "exec", "-e", "MYSQL_PWD=" + password, name, "mysql", "-uroot",
                        "--batch", "--skip-column-names", "-e", query], check=check)
        deadline = time.monotonic() + 90
        consecutive = 0
        while time.monotonic() < deadline:
            probe = sql("SELECT 1", check=False)
            consecutive = consecutive + 1 if probe.returncode == 0 and probe.stdout.strip() == b"1" else 0
            if consecutive >= 2:
                break
            time.sleep(1)
        else:
            raise RuntimeError("SQL readiness deadline")
        if not args.reuse_evidence:
            sql(f"CREATE DATABASE {marker}; CREATE TABLE {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO {marker}.__kdrive_test_fixture_marker VALUES(1,'{schema}','{token}');")
        assert sql(f"SELECT COUNT(*) FROM {marker}.__kdrive_test_fixture_marker WHERE target_schema='{schema}' AND marker_token='{token}'").stdout.strip() == b"1"
        suites={
            "OperationalReportIntegrationTest":{"dateValidationAndReadPermissions","emptyIsHonestZeroWithCompleteStatusSet","aggregatesUseOwnTimestampsEffectiveExpiryAndFirstCompletionWithoutWrites","invoiceMoneyStaysExactBeyondLongSumAndJavascriptPrecision"},
            "OperationalReportMySqlTest":{"workflowReadbackAndSnapshotPrices","concurrentCompletionKeepsOneReadSnapshot","httpBoundariesPermissionsAndEmpty","representativeVolumePlansAndLatency"}}
        for suite,required in suites.items():
            logname=suite+".log"
            run([str(build / "mvnw.cmd"),"-o","-B","-ntp",f"-Dmaven.repo.local={REPO / '.runtime/m2'}","-Dtest="+suite,"test"],cwd=build,log=logname)
            xml=build/f"target/surefire-reports/TEST-com.carrental.{suite}.xml"
            report=ET.parse(xml).getroot()
            assert [int(report.get(k,"0")) for k in ("tests","failures","errors","skipped")]==[len(required),0,0,0]
            assert {c.get("name") for c in report.findall("testcase")}==required
            shutil.copy2(xml,out/xml.name)
        log=(out / "OperationalReportMySqlTest.log").read_text(errors="replace")
        assert "C12 MYSQL SNAPSHOT OLD THEN NEW VERIFIED" in log
        assert "C12 MYSQL 10000 BOOKINGS HTTP LATENCY MS" in log and "C12 MYSQL PLAN" in log
        # Match actual packaged class/resource bytes to the compiled tree used by HTTP tests.
        matched = []
        with zipfile.ZipFile(jar) as packaged:
            for entry in packaged.namelist():
                if entry.startswith("BOOT-INF/classes/") and not entry.endswith("/"):
                    rel = entry.removeprefix("BOOT-INF/classes/")
                    assert packaged.read(entry) == (build / "target/classes" / rel).read_bytes(), rel
                    matched.append(rel)
        assert any("OperationalReportController" in p for p in matched) and any("OperationalReportService" in p for p in matched)
        assert before == inputs(), "[SOURCE_DRIFT] Execution inputs changed"
        (out / "jar-provenance.json").write_text(json.dumps({"jarSHA256": hashlib.sha256(jar.read_bytes()).hexdigest(),
                                                           "matchedEntries": matched, "sourceInputsMatch": True}, indent=2))
        readback = sql(f"SELECT id,status,version FROM {schema}.branches ORDER BY id; SELECT version,checksum,success FROM {schema}.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{schema}'; SELECT COUNT(*) FROM {schema}.vehicles; SELECT COUNT(*) FROM {schema}.branch_routes; SELECT COUNT(*) FROM {schema}.staff_branches; SELECT id,status,pickup_branch_id,return_branch_id,actual_return_branch_id,version FROM {schema}.bookings ORDER BY id; SELECT next_status FROM {schema}.booking_status_history ORDER BY occurred_at,id;")
        (out / "sql-readback.txt").write_bytes(readback.stdout)
        (out / "result.json").write_text(json.dumps({"status": "PASS C12-3 MySQL scoped", "tests": 8, "skips": 0,
                                                    "realHTTP": True, "database": "MySQL", "jarEntries": len(matched)}, indent=2))
    finally:
        if owned:
            assert run(["docker", "inspect", "--format", "{{.Id}}", name]).stdout.decode().strip() == identity
            run(["docker", "stop", name], log="cleanup.log")
            assert run(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.strip() == b"false"
            (out / "cleanup.json").write_text(json.dumps({"id": identity, "fixtureStopped": True, "volume": "KEEP"}))


if __name__ == "__main__":
    main()
