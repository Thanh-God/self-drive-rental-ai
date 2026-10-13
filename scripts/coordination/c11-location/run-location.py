"""C11 location proof on one owned MySQL fixture; never targets the user database."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[3]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True)
    args = parser.parse_args()
    out = Path(args.evidence).resolve()
    if not out.is_relative_to(REPO / ".runtime") or out.exists():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Require new repository runtime evidence")
    ports = (33671, 8297, 5297)
    for port in ports:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    name = "kltn-c11-location-" + uuid.uuid4().hex[:12]
    volume = "vol-" + name
    schema = "kdrive_c11_location"
    marker = schema + "_meta"
    password = uuid.uuid4().hex
    token = uuid.uuid4().hex
    env = os.environ.copy()
    env.pop("SPRING_PROFILES_ACTIVE", None)
    env.update({
        "JAVA_HOME": "E:/Tools/Java/jdk-21.0.12.1+1",
        "KDRIVE_TEST_DB_URL": f"jdbc:mysql://127.0.0.1:33671/{schema}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
        "KDRIVE_TEST_DB_USER": "root", "KDRIVE_TEST_DB_PASSWORD": password,
        "KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX": schema,
        "KDRIVE_TEST_FIXTURE_MARKER_TOKEN": token,
        "KDRIVE_TEST_EXPECTED_HOST": "127.0.0.1",
        "KDRIVE_TEST_EXPECTED_PORT": "33671", "KDRIVE_TEST_EXPECTED_SCHEMA": schema,
        "KDRIVE_TEST_MARKER_SCHEMA": marker,
    })
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def run(command, *, cwd=REPO, check=True, log=None):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                                creationflags=flags, timeout=600)
        if log:
            (out / log).write_bytes(result.stdout + result.stderr)
            (out / (log + ".exit")).write_text(str(result.returncode))
        if check and result.returncode:
            raise RuntimeError(f"Native command failed ({result.returncode}); see {log or 'private execution'}")
        return result

    names = run(["docker", "ps", "-a", "--format", "{{.Names}}"], check=True).stdout.decode().splitlines()
    volumes = run(["docker", "volume", "ls", "--format", "{{.Name}}"], check=True).stdout.decode().splitlines()
    if name in names or volume in volumes:
        raise RuntimeError("[PREFLIGHT_REFUSAL] Fixture identity exists")
    out.mkdir(parents=True)
    source = {str(p.relative_to(REPO)).replace("\\", "/"): digest(p)
              for p in (REPO / "backend/src").rglob("*") if p.is_file()}
    source["backend/pom.xml"] = digest(REPO / "backend/pom.xml")
    (out / "source-before.json").write_text(json.dumps(source, indent=2))
    private = out / "mysql.private.env"
    private.write_text(f"MYSQL_ROOT_PASSWORD={password}\nMYSQL_DATABASE={schema}\n")
    owned = False
    java = None
    handles = []
    assertions = []

    def sql(query):
        result = run(["docker", "exec", "-e", f"MYSQL_PWD={password}", name,
                      "mysql", "-uroot", "--batch", "--skip-column-names", "-e", query])
        return result.stdout.decode("utf-8").strip()

    def request(method, path, data=None, auth=None):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = "Bearer " + auth
        req = urllib.request.Request("http://127.0.0.1:8297/api/v1" + path,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            raw = error.read()
            return error.code, json.loads(raw or b"null")

    def expect(label, actual, expected):
        assert actual == expected, f"{label}: {actual!r} != {expected!r}"
        assertions.append({"label": label, "actual": actual, "expected": expected})

    try:
        identity = run(["docker", "run", "-d", "--name", name, "-p", "127.0.0.1:33671:3306",
                        "--env-file", str(private), "-v", volume + ":/var/lib/mysql", "mysql:8.4"]).stdout.decode().strip()
        owned = True
        (out / "fixture.json").write_text(json.dumps({"name": name, "id": identity, "volume": volume,
                                                     "schema": schema, "port": 33671, "policy": "KEEP stopped"}, indent=2))
        deadline = time.monotonic() + 90
        successes = 0
        while time.monotonic() < deadline:
            result = run(["docker", "exec", "-e", f"MYSQL_PWD={password}", name,
                          "mysql", "-uroot", "-N", "-e", "SELECT 1"], check=False)
            successes = successes + 1 if result.returncode == 0 and result.stdout.strip() == b"1" else 0
            if successes >= 2:
                break
            time.sleep(1)
        else:
            raise RuntimeError("MySQL readiness deadline")
        sql(f"CREATE DATABASE {marker}; CREATE TABLE {marker}.__kdrive_test_fixture_marker(id INT PRIMARY KEY,target_schema VARCHAR(255),marker_token VARCHAR(255)); INSERT INTO {marker}.__kdrive_test_fixture_marker VALUES(1,'{schema}','{token}');")
        run([str(REPO / "backend/mvnw.cmd"), "-o", "-B", "-ntp", f"-Dmaven.repo.local={REPO / '.runtime/m2'}",
             "-Dtest=LocationCategoryIntegrationTest,LocationIntegrationTest", "test"],
            cwd=REPO / "backend", log="mysql-tests.log")
        for suite in ("LocationCategoryIntegrationTest", "LocationIntegrationTest"):
            report = REPO / f"backend/target/surefire-reports/TEST-com.carrental.{suite}.xml"
            root = ET.parse(report).getroot()
            expect(suite + " failures/errors/skips", [int(root.get(k, "0")) for k in ("failures", "errors", "skipped")], [0, 0, 0])
            expect(suite + " tests", int(root.get("tests")), 3)
            shutil.copy2(report, out / report.name)
        jar = REPO / "backend/target/kdrive-0.1.0-SNAPSHOT.jar"
        (out / "jar-sha256.txt").write_text(digest(jar))
        config = out / "application.private.properties"
        config.write_text(f"server.port=8297\nspring.datasource.url={env['KDRIVE_TEST_DB_URL']}\nspring.datasource.username=root\nspring.datasource.password={password}\napp.jwt-secret=location-only-test-secret-at-least-32-bytes\napp.seed-enabled=true\napp.seed-password=LocationApiTestOnly123!\n")
        handles = [(out / "startup.log").open("wb"), (out / "startup-error.log").open("wb")]
        java = subprocess.Popen([env["JAVA_HOME"] + "/bin/java.exe", "-jar", str(jar),
                                 "--spring.config.additional-location=file:" + config.as_posix()],
                                cwd=REPO, env=env, stdout=handles[0], stderr=handles[1], creationflags=flags)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if java.poll() is not None:
                raise RuntimeError("Owned JAR exited during startup")
            try:
                status, result = request("POST", "/auth/login", {"email": "admin@example.test", "password": "LocationApiTestOnly123!"})
                if status == 200:
                    admin = result["token"]
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("JAR readiness deadline")
        cats = "/admin/location-categories"
        locs = "/admin/locations"
        for path in (cats, locs):
            expect("Guest denied " + path, request("GET", path)[0], 401)
            for email in ("user@example.test", "staff.hn@example.test"):
                status, login = request("POST", "/auth/login", {"email": email, "password": "LocationApiTestOnly123!"})
                expect("login " + email, status, 200)
                expect(email + " denied " + path, request("GET", path, auth=login["token"])[0], 403)
        status, category = request("POST", cats, {"name": " C11 HTTP Category "}, admin)
        expect("category created", status, 201)
        expect("trimmed", category["name"], "C11 HTTP Category")
        status, location = request("POST", locs, {"name": "C11 HTTP Location", "categoryId": category["id"],
                                   "latitude": 0, "longitude": 0, "status": "INACTIVE"}, admin)
        expect("location created", status, 201)
        expect("zero coordinates", [float(location["latitude"]), float(location["longitude"])], [0, 0])
        before = sql(f"SELECT name FROM {schema}.location_categories WHERE id='{category['id']}'")
        expect("missing revision 400", request("PUT", cats + "/" + category["id"], {"name": "Rejected"}, admin)[0], 400)
        expect("rejection no write", sql(f"SELECT name FROM {schema}.location_categories WHERE id='{category['id']}'"), before)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(request, "PUT", cats + "/" + category["id"],
                                   {"name": "Race " + str(i), "expectedRevision": category["revision"]}, admin) for i in range(2)]
            results = [f.result(timeout=30) for f in futures]
        expect("same revision concurrency", sorted(r[0] for r in results), [200, 409])
        winner = next(data for status, data in results if status == 200)
        expect("SQL winner", sql(f"SELECT name FROM {schema}.location_categories WHERE id='{category['id']}'"), winner["name"])
        expect("FK renamed category", request("GET", locs + "/" + location["id"], auth=admin)[1]["categoryName"], winner["name"])
        status, recovered = request("PUT", cats + "/" + category["id"], {"name": "Recovered", "expectedRevision": winner["revision"]}, admin)
        expect("fresh revision recovery", status, 200)
        (out / "http-assertions.json").write_text(json.dumps(assertions, indent=2, ensure_ascii=False), encoding="utf-8")
        (out / "readback.txt").write_text(sql(f"SELECT version,checksum,success FROM {schema}.flyway_schema_history ORDER BY installed_rank; SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{schema}'; SELECT name,status,latitude,longitude FROM {schema}.locations WHERE id='{location['id']}';"))
        for path, sha in source.items():
            expect("source unchanged " + path, digest(REPO / path), sha)
        (out / "result.json").write_text(json.dumps({"status": "PASS backend scoped", "assertions": len(assertions)}, indent=2))
    finally:
        if java is not None and java.poll() is None:
            java.terminate()
            java.wait(timeout=20)
        for handle in handles:
            handle.close()
        if owned:
            current = run(["docker", "inspect", "--format", "{{.Id}}", name]).stdout.decode().strip()
            if current != identity:
                raise RuntimeError("Fixture identity changed before cleanup")
            run(["docker", "stop", name], log="cleanup.log")
            state = run(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.decode().strip()
            if state != "false":
                raise RuntimeError("Owned fixture not stopped")
            (out / "cleanup-state.json").write_text(json.dumps({"fixtureStopped": True, "javaStopped": java is None or java.poll() is not None, "volume": "KEEP"}))


if __name__ == "__main__":
    main()
