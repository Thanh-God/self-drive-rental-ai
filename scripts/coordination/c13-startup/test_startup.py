"""Actual entrypoint guard tests; controlled build/JDK doubles are not startup proof."""
from pathlib import Path
import http.server
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest

REPO=Path(__file__).resolve().parents[3]
BASH=Path(os.environ.get("KDRIVE_GIT_BASH", "E:/data github/Git/bin/bash.exe"))

class StartupGuards(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix="c13-startup-",dir=REPO/".runtime")
  self.root=Path(self.temp.name).resolve();assert self.root.is_relative_to(REPO/".runtime")
  for directory in ["scripts","backend/target","frontend","jdk/bin","fakebin"]:(self.root/directory).mkdir(parents=True,exist_ok=True)
  for script in ["run-backend-gitbash.sh","run-frontend-gitbash.sh"]:shutil.copyfile(REPO/"scripts"/script,self.root/"scripts"/script)
  self.jar=self.root/"backend/target/kdrive-0.1.0-SNAPSHOT.jar";self.jar.write_bytes(b"old jar must not launch on build failure")
  self.env=os.environ.copy()
  for key in ["DB_URL","DB_USER","DB_PASSWORD","JWT_SECRET","PORT","JAVA_HOME","BACKEND_ENV_FILE","FRONTEND_PORT","VITE_PROXY_TARGET","VITE_DATA_MODE","VITE_API_BASE_URL","MSYS2_ENV_CONV_EXCL"]:self.env.pop(key,None)
  self.env.update(DB_URL="jdbc:mysql://127.0.0.1:1/unit_fixture",DB_USER="fixture",DB_PASSWORD="unit-only",JWT_SECRET="unit-only-secret",JAVA_HOME=self.root.joinpath("jdk").as_posix(),PORT="18299",FRONTEND_PORT="15299")
  self.env["PATH"]=self.root.joinpath("fakebin").as_posix()+os.pathsep+self.env["PATH"]
  self.write("jdk/bin/java", '#!/usr/bin/env bash\nif [[ $1 == -version ]]; then echo \'openjdk version "21.0.1"\' >&2; else printf "%s" "$DB_USER" > java.marker; fi\n')
  self.write("backend/mvnw", '#!/usr/bin/env bash\nprintf "%s" "$*" > build.marker\nexit "${FAKE_MAVEN_EXIT:-0}"\n')
  self.write("fakebin/npm", '#!/usr/bin/env bash\nprintf "%s\\n" "$VITE_DATA_MODE|$VITE_API_BASE_URL|$MSYS2_ENV_CONV_EXCL|$*" >> npm.marker\nexit "${FAKE_NPM_EXIT:-0}"\n')
 def write(self,name,text):
  p=self.root/name;p.write_text(text,encoding="utf-8",newline="\n");p.chmod(0o755)
 def tearDown(self):self.temp.cleanup()
 def run_script(self,script,*args):
  return subprocess.run([str(BASH),"--noprofile","--norc",str(self.root/"scripts"/script),*args],cwd=self.root.parent,env=self.env,capture_output=True,text=True,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
 def no_build(self):
  self.assertFalse((self.root/"backend/build.marker").exists());self.assertFalse((self.root/"frontend/npm.marker").exists());self.assertEqual(self.jar.read_bytes(),b"old jar must not launch on build failure")
 def backend(self,*args):return self.run_script("run-backend-gitbash.sh",*args)
 def frontend(self):return self.run_script("run-frontend-gitbash.sh")
 def test_missing_setting(self):
  del self.env["DB_PASSWORD"];r=self.backend();self.assertEqual(r.returncode,2);self.assertIn("DB_PASSWORD",r.stderr);self.no_build()
 def test_missing_selected_file(self):
  r=self.backend("--env-file","missing.env");self.assertEqual(r.returncode,2);self.assertIn("does not exist",r.stderr);self.no_build()
 def test_wrong_jdk(self):
  self.write("jdk/bin/java", '#!/usr/bin/env bash\necho \'openjdk version "17.0.1"\' >&2\n');r=self.backend();self.assertEqual(r.returncode,2);self.assertIn("Java 21",r.stderr);self.no_build()
 def test_backend_invalid_port(self):
  for port in ["0","65536","abc"]:
   self.env["PORT"]=port;r=self.backend();self.assertEqual(r.returncode,2);self.no_build()
 def test_backend_occupied_port(self):
  with socket.socket() as sock:
   sock.bind(("127.0.0.1",0));sock.listen();self.env["PORT"]=str(sock.getsockname()[1]);r=self.backend();self.assertEqual(r.returncode,2);self.assertIn("already in use",r.stderr);self.no_build()
 def test_build_failure_never_launches_old_jar(self):
  self.env["FAKE_MAVEN_EXIT"]="7";r=self.backend();self.assertEqual(r.returncode,7);self.assertFalse((self.root/"backend/java.marker").exists());self.assertNotIn("Starting backend",r.stdout)
 def test_env_is_data_and_existing_shell_wins(self):
  envfile=self.root/"selected file.env";envfile.write_text("\ufeffDB_USER='$(touch injected.marker)'\r\nUNRECOGNIZED=$(touch injected.marker)\r\n",encoding="utf-8")
  r=self.backend("--env-file",str(envfile));self.assertEqual(r.returncode,0,r.stderr);self.assertEqual((self.root/"backend/java.marker").read_text(),"fixture");self.assertFalse(list(self.root.rglob("injected.marker")))
 def test_frontend_invalid_port(self):
  self.env["FRONTEND_PORT"]="65536";r=self.frontend();self.assertEqual(r.returncode,2);self.no_build()
 def test_frontend_occupied_port(self):
  with socket.socket() as sock:
   sock.bind(("127.0.0.1",0));sock.listen();self.env["FRONTEND_PORT"]=str(sock.getsockname()[1]);r=self.frontend();self.assertEqual(r.returncode,2);self.assertIn("already in use",r.stderr);self.no_build()
 def test_frontend_unreachable_backend(self):
  with socket.socket() as sock:sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
  self.env["VITE_PROXY_TARGET"]=f"http://127.0.0.1:{port}";r=self.frontend();self.assertEqual(r.returncode,2);self.assertIn("Backend is not ready",r.stderr);self.no_build()
 def healthy(self,status=200):
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(handler):handler.send_response(status);handler.send_header("Content-Type","application/json");handler.end_headers();handler.wfile.write(b'{"status":"UP"}')
   def log_message(*args):pass
  server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  self.addCleanup(server.server_close);self.addCleanup(server.shutdown);self.env["VITE_PROXY_TARGET"]=f"http://127.0.0.1:{server.server_port}"
 def test_frontend_bad_health(self):
  self.healthy(503);r=self.frontend();self.assertEqual(r.returncode,2);self.no_build()
 def test_frontend_forces_api_and_strict_configured_port(self):
  self.healthy();self.env.update(VITE_DATA_MODE="demo",VITE_API_BASE_URL="bad",MSYS2_ENV_CONV_EXCL="OTHER");r=self.frontend();self.assertEqual(r.returncode,0,r.stderr)
  calls=(self.root/"frontend/npm.marker").read_text();self.assertIn("api|/api/v1|OTHER;VITE_API_BASE_URL|run build",calls);self.assertIn("--port 15299 --strictPort",calls)
 def test_frontend_build_failure_never_starts_vite(self):
  self.healthy();self.env["FAKE_NPM_EXIT"]="9";r=self.frontend();self.assertEqual(r.returncode,9);self.assertNotIn("run dev",(self.root/"frontend/npm.marker").read_text())

if __name__=="__main__":unittest.main()
