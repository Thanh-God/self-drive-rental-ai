"""Restart only the exact stopped fixture owned by the C11 backend proof."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request

REPO = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-evidence", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--fresh-schema", action="store_true")
    args = parser.parse_args()
    backend = Path(args.backend_evidence).resolve()
    out = Path(args.evidence).resolve()
    if not backend.is_relative_to(REPO / ".runtime") or not out.is_relative_to(REPO / ".runtime") or out.exists():
        raise RuntimeError("[PREFLIGHT_REFUSAL] Runtime-only new output required")
    result = json.loads((backend / "result.json").read_text())
    assert result["status"] == "PASS backend scoped"
    fixture = json.loads((backend / "fixture.json").read_text())
    assert fixture["name"].startswith("kltn-c11-location-")
    flags = subprocess.CREATE_NO_WINDOW
    env = os.environ.copy()
    env.update(VITE_DATA_MODE="api", VITE_API_BASE_URL="/api/v1", VITE_PROXY_TARGET="http://127.0.0.1:8297",
               C11_EVIDENCE=str(out), C11_PLAYWRIGHT=str(REPO / ".runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright"))
    def run(command, cwd=REPO):
        result = subprocess.run(command,cwd=cwd,env=env,capture_output=True,creationflags=flags,timeout=240)
        if result.returncode:
            raise RuntimeError("Native command failed: " + result.stderr.decode(errors="replace"))
        return result.stdout
    identity = run(["docker","inspect","--format","{{.Id}}|{{.State.Running}}",fixture["name"]]).decode().strip()
    assert identity == fixture["id"] + "|false", "Exact stopped fixture required"
    for port in (33671,8297,5297):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",port))
    jar = REPO / "backend/target/kdrive-0.1.0-SNAPSHOT.jar"
    assert hashlib.sha256(jar.read_bytes()).hexdigest() == (backend / "jar-sha256.txt").read_text()
    for rel,sha in json.loads((backend / "source-before.json").read_text()).items():
        assert hashlib.sha256((REPO / rel).read_bytes()).hexdigest() == sha, rel
    paths = [p for p in (REPO / "frontend/src").rglob("*") if p.is_file()]
    paths += list(Path(__file__).parent.glob("*.*"))
    before = {str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    out.mkdir(parents=True)
    (out / "inputs-before.json").write_text(json.dumps(before,indent=2))
    procs=[]; handles=[]; started=False
    def spawn(command,label,cwd=REPO):
        stdout=(out / (label+".log")).open("wb");stderr=(out / (label+"-error.log")).open("wb")
        handles.extend([stdout,stderr])
        proc=subprocess.Popen(command,cwd=cwd,env=env,stdout=stdout,stderr=stderr,creationflags=flags)
        procs.append(proc);return proc
    try:
        run(["docker","start",fixture["name"]]);started=True
        config = backend / "application.private.properties"
        if args.fresh_schema:
            private = config.read_text()
            password = next(line.split("=",1)[1] for line in private.splitlines() if line.startswith("spring.datasource.password="))
            deadline = time.monotonic()+60
            while time.monotonic()<deadline:
                probe=subprocess.run(["docker","exec","-e","MYSQL_PWD="+password,fixture["name"],"mysql","-uroot","-N","-e","SELECT 1"],env=env,capture_output=True,creationflags=flags,timeout=10)
                if probe.returncode==0 and probe.stdout.strip()==b"1":break
                time.sleep(1)
            else:raise RuntimeError("MySQL readiness deadline")
            schema = "kdrive_c11_browser_" + __import__("uuid").uuid4().hex[:12]
            run(["docker","exec","-e","MYSQL_PWD="+password,fixture["name"],"mysql","-uroot","-e","CREATE DATABASE "+schema])
            config = out / "application.private.properties"
            config.write_text(private.replace("/"+fixture["schema"]+"?", "/"+schema+"?"))
            (out / "browser-schema.txt").write_text(schema)
        spawn(["E:/Tools/Java/jdk-21.0.12.1+1/bin/java.exe","-jar",str(jar),"--spring.config.additional-location=file:"+config.as_posix()],"backend")
        build=run(["node", "node_modules/vite/bin/vite.js","build"],REPO / "frontend")
        (out / "api-build.log").write_bytes(build)
        spawn(["node", "node_modules/vite/bin/vite.js","preview","--host","127.0.0.1","--port","5297","--strictPort"],"frontend",REPO / "frontend")
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            assert all(p.poll() is None for p in procs), "Owned service exited"
            try:
                urllib.request.urlopen("http://127.0.0.1:5297",timeout=2).close()
                req=urllib.request.Request("http://127.0.0.1:8297/api/v1/auth/login",data=b'{"email":"admin@example.test","password":"LocationApiTestOnly123!"}',headers={"Content-Type":"application/json"})
                urllib.request.urlopen(req,timeout=2).close()
                break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError("Services deadline")
        browser=subprocess.run(["node",str(Path(__file__).with_name("verify-browser.cjs"))],cwd=REPO,env=env,capture_output=True,creationflags=flags,timeout=180)
        (out / "browser.log").write_bytes(browser.stdout+browser.stderr)
        (out / "browser-exit.txt").write_text(str(browser.returncode))
        assert browser.returncode==0, "Browser failure; see browser.log"
        for rel,sha in before.items():
            assert hashlib.sha256((REPO / rel).read_bytes()).hexdigest()==sha, "Source drift "+rel
        final_paths = [p for p in (REPO / "frontend/src").rglob("*") if p.is_file()] + list(Path(__file__).parent.glob("*.*"))
        assert set(before)=={str(p.relative_to(REPO)) for p in final_paths}, "Source keyset drift"
        (out / "result.json").write_text(json.dumps({"status":"PASS browser scoped","assertions":len(json.loads((out / "browser-assertions.json").read_text()))}))
    finally:
        for proc in reversed(procs):
            if proc.poll() is None:
                proc.terminate();proc.wait(timeout=20)
        for handle in handles:handle.close()
        if started:
            assert run(["docker","inspect","--format","{{.Id}}",fixture["name"]]).decode().strip()==fixture["id"]
            run(["docker","stop",fixture["name"]])
            assert run(["docker","inspect","--format","{{.State.Running}}",fixture["name"]]).decode().strip()=="false"
        (out / "cleanup.json").write_text(json.dumps({"allOwnedProcessesStopped":all(p.poll() is not None for p in procs),"fixtureStopped":True,"volume":"KEEP","pids":[p.pid for p in procs]}))


if __name__ == "__main__":main()
