"""C11-A1 HTTP/MySQL proof, owning one isolated fixture and keeping its volume."""
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
    args = parser.parse_args()
    out = Path(args.evidence).resolve()
    if not out.is_relative_to(REPO / ".runtime") or out.exists():
        raise RuntimeError("[PREFLIGHT_REFUSAL] New repository runtime output required")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 33672))
    jar = REPO / "backend/target/kdrive-0.1.0-SNAPSHOT.jar"
    if not jar.is_file():
        raise RuntimeError("Run backend verify on final source first")
    name = "kltn-c11-a1-" + uuid.uuid4().hex[:12]
    volume = "vol-" + name
    schema = "kdrive_c11_a1"
    marker = schema + "_meta"
    password, token = uuid.uuid4().hex, uuid.uuid4().hex
    env = os.environ.copy()
    env.pop("SPRING_PROFILES_ACTIVE", None)
    env.update(JAVA_HOME="E:/Tools/Java/jdk-21.0.12.1+1",
               KDRIVE_TEST_DB_URL=f"jdbc:mysql://127.0.0.1:33672/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
               KDRIVE_TEST_DB_USER="root", KDRIVE_TEST_DB_PASSWORD=password,
               KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX=schema,
               KDRIVE_TEST_FIXTURE_MARKER_TOKEN=token,
               KDRIVE_TEST_EXPECTED_HOST="127.0.0.1", KDRIVE_TEST_EXPECTED_PORT="33672",
               KDRIVE_TEST_EXPECTED_SCHEMA=schema, KDRIVE_TEST_MARKER_SCHEMA=marker)
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

    if name in run(["docker", "ps", "-a", "--format", "{{.Names}}" ]).stdout.decode().splitlines():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Container identity exists")
    if volume in run(["docker", "volume", "ls", "--format", "{{.Name}}"] ).stdout.decode().splitlines():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Volume identity exists")
    before = inputs()
    out.mkdir(parents=True)
    (out / "inputs-before.json").write_text(json.dumps(before, indent=2))
    private = out / "mysql.private.env"
    private.write_text(f"MYSQL_ROOT_PASSWORD={password}\nMYSQL_DATABASE={schema}\n")
    owned = False
    identity = None
    try:
        identity = run(["docker", "run", "-d", "--name", name, "-p", "127.0.0.1:33672:3306",
                        "--env-file", str(private), "-v", volume + ":/var/lib/mysql", "mysql:8.4"]).stdout.decode().strip()
        owned = True
        (out / "fixture.json").write_text(json.dumps({"id": identity, "name": name, "volume": volume,
                                                     "schema": schema, "port": 33672, "policy": "KEEP stopped"}, indent=2))
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
        sql(f"CREATE DATABASE {marker}; CREATE TABLE {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO {marker}.__kdrive_test_fixture_marker VALUES(1,'{schema}','{token}');")
        assert sql(f"SELECT COUNT(*) FROM {marker}.__kdrive_test_fixture_marker WHERE target_schema='{schema}' AND marker_token='{token}'").stdout.strip() == b"1"
        run([str(REPO / "backend/mvnw.cmd"), "-o", "-B", "-ntp", f"-Dmaven.repo.local={REPO / '.runtime/m2'}",
             "-Dtest=BranchStatusHttpServerTest", "test"], cwd=REPO / "backend", log="mysql-http-tests.log")
        xml = REPO / "backend/target/surefire-reports/TEST-com.carrental.BranchStatusHttpServerTest.xml"
        report = ET.parse(xml).getroot()
        assert [int(report.get(k, "0")) for k in ("tests", "failures", "errors", "skipped")] == [4, 0, 0, 0]
        required = {"closeRenameReopenAndNoOpUseCurrentVersion", "validationNotFoundPermissionsAndStaleRequestsDoNotWrite",
                    "closeAllBranchesWithoutMinimumAndRecover", "closeAndReopenPreserveExistingBusinessRowsAndSnapshots"}
        assert {c.get("name") for c in report.findall("testcase")} == required
        shutil.copy2(xml, out / xml.name)
        # Match actual packaged class/resource bytes to the compiled tree used by HTTP tests.
        matched = []
        with zipfile.ZipFile(jar) as packaged:
            for entry in packaged.namelist():
                if entry.startswith("BOOT-INF/classes/") and not entry.endswith("/"):
                    rel = entry.removeprefix("BOOT-INF/classes/")
                    assert packaged.read(entry) == (REPO / "backend/target/classes" / rel).read_bytes(), rel
                    matched.append(rel)
        assert any("BranchController" in p for p in matched) and any("BranchService" in p for p in matched)
        assert before == inputs(), "[SOURCE_DRIFT] Execution inputs changed"
        (out / "jar-provenance.json").write_text(json.dumps({"jarSHA256": hashlib.sha256(jar.read_bytes()).hexdigest(),
                                                           "matchedEntries": matched, "sourceInputsMatch": True}, indent=2))
        readback = sql(f"SELECT id,status,version FROM {schema}.branches ORDER BY id; SELECT version,checksum,success FROM {schema}.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{schema}'; SELECT COUNT(*) FROM {schema}.vehicles; SELECT COUNT(*) FROM {schema}.branch_routes; SELECT COUNT(*) FROM {schema}.staff_branches;")
        (out / "sql-readback.txt").write_bytes(readback.stdout)
        (out / "result.json").write_text(json.dumps({"status": "PASS C11-A1 scoped", "tests": 4, "skips": 0,
                                                    "realHTTP": True, "database": "MySQL", "jarEntries": len(matched)}, indent=2))
    finally:
        if owned:
            assert run(["docker", "inspect", "--format", "{{.Id}}", name]).stdout.decode().strip() == identity
            run(["docker", "stop", name], log="cleanup.log")
            assert run(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.strip() == b"false"
            (out / "cleanup.json").write_text(json.dumps({"id": identity, "fixtureStopped": True, "volume": "KEEP"}))


if __name__ == "__main__":
    main()
