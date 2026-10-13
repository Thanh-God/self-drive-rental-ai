import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const container = "kltn-phase5-rerun";
const expectedId = "ab0698eba8cf545bd23ab40451bfbae01a51a9666bfb66b166a44f81ea418007";
const volume = "kltn_phase5_rerun_20261004_1823";
const mapping = { v1: "Toyota Vios", v2: "Mitsubishi Xpander", v3: "Hyundai Accent" };
export function makePlan(photos, vehicles) {
  if (photos.length < 17 || photos.length > 30 || new Set(photos.map(p => p.sha256)).size !== photos.length) throw Error("[ASSET_GUARD] Invalid photo count/duplicate bytes");
  for (const [id, name] of Object.entries(mapping)) if (vehicles.find(v => v.id === id)?.name !== name) throw Error("[TARGET_GUARD] Vehicle mapping changed: " + id);
  if (photos.some(p => !Object.values(mapping).includes(p.model))) throw Error("[ASSET_GUARD] Unmapped model");
  return Object.entries(mapping).flatMap(([vehicleId, name]) => photos.filter(p => p.model === name).map((p, sortOrder) => {
    if (!p.url.startsWith("/media/vehicles/") || !p.author || !p.sourceUrl.startsWith("https://commons.wikimedia.org/") || !p.licenseUrl.startsWith("https://creativecommons.org/") || p.attribution.length > 1000) throw Error("[ASSET_GUARD] Missing source/license/credit");
    const hash = crypto.createHash("sha256").update(`${vehicleId}|${p.url}`).digest("hex");
    return { id: `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`, vehicleId, url: p.url, sortOrder, attribution: p.attribution };
  }));
}
export function decideImport(plan, current) {
  if (!current.length) return "INSERT";
  if (current.length === plan.length && plan.every(p => current.some(c => c.vehicleId === p.vehicleId && c.url === p.url && c.sortOrder === p.sortOrder && c.attribution === p.attribution))) return "NOOP";
  throw Error("[EXISTING_MEDIA_GUARD] Existing media differs; no overwrite/partial append allowed");
}
function native(args, input) { const result = spawnSync("docker", args, { encoding: "utf8", input, timeout: 60000 }); if (result.status !== 0) throw Error("[DOCKER_FAILURE] Command failed (details retained by caller; no credential output)"); return result.stdout.trim(); }
function sql(query) { return native(["exec", "-i", container, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'], `USE kdrive;\n${query}\n`); }
const quoted = v => `CONVERT(0x${Buffer.from(v,"utf8").toString("hex")} USING utf8mb4)`;
function media() { const value = sql("SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'vehicleId',vehicle_id,'url',url,'sortOrder',sort_order,'attribution',attribution)) FROM vehicle_images;"); return value === "NULL" ? [] : JSON.parse(value); }
function checksums() {
  const tables = sql("SELECT table_name FROM information_schema.tables WHERE table_schema='kdrive' AND table_type='BASE TABLE' ORDER BY table_name;").split("\n");
  const result = sql("CHECKSUM TABLE " + tables.filter(t => t.trim() !== "vehicle_images").map(t => `\`${t.trim()}\``).join(",") + ";");
  if (!result || result.split("\n").some(line => !/\t\d+$/.test(line))) throw Error("[CHECKSUM_GUARD] Non-numeric/unsupported checksum");
  return result;
}
export function main(args) {
  const apply = args.includes("--apply");
  const evidenceArg = args.indexOf("--evidence");
  if (evidenceArg < 0 || !args[evidenceArg+1]) throw Error("[EVIDENCE_GUARD] --evidence new runtime directory required");
  const evidence = path.resolve(root, args[evidenceArg+1]);
  if (!evidence.startsWith(path.join(root,".runtime") + path.sep) || fs.existsSync(evidence)) throw Error("[EVIDENCE_GUARD] Refuse existing/outside evidence directory");
  const identity = native(["inspect","--format","{{.Id}}|{{.State.Running}}|{{range .Mounts}}{{.Name}};{{end}}",container]);
  if (identity !== `${expectedId}|true|${volume};`) throw Error("[IDENTITY_GUARD] Protected target identity differs");
  const registry = path.join(root,"frontend/public/media/vehicles/licenses.json");
  const photos = JSON.parse(fs.readFileSync(registry,"utf8"));
  for (const p of photos) { const file = path.join(root,"frontend/public",p.url); if (crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== p.sha256) throw Error("[ASSET_GUARD] Asset bytes changed"); }
  const vehicles = JSON.parse(sql("SELECT JSON_ARRAYAGG(JSON_OBJECT('id',id,'name',name)) FROM vehicles;"));
  const plan = makePlan(photos,vehicles), before = media(), action = decideImport(plan,before);
  const businessBefore = checksums();
  fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(evidence,"before.json"),JSON.stringify({identity,vehicles,images:before,businessChecksums:businessBefore},null,2));
  fs.writeFileSync(path.join(evidence,"plan.json"),JSON.stringify({apply,action,rows:plan},null,2));
  if (apply && action === "INSERT") {
    const values = plan.map(p => `(${quoted(p.id)},${quoted(p.vehicleId)},${quoted(p.url)},${p.sortOrder},${quoted(p.attribution)})`).join(",\n");
    sql(`SET SESSION innodb_lock_wait_timeout=10; START TRANSACTION;
      SELECT id FROM vehicles WHERE id IN ('v1','v2','v3') ORDER BY id FOR UPDATE;
      CREATE TEMPORARY TABLE c10b_media_guard(n INT CHECK(n=0));
      INSERT INTO c10b_media_guard SELECT COUNT(*) FROM vehicle_images;
      INSERT INTO vehicle_images(id,vehicle_id,url,sort_order,attribution) VALUES ${values};
      COMMIT;`);
  }
  const after = media(), businessAfter = checksums();
  if (businessAfter !== businessBefore) throw Error("[PRESERVATION_FAILURE] Non-media table checksum changed");
  if (apply && decideImport(plan,after) !== "NOOP") throw Error("[READBACK_FAILURE] Media differs from approved plan");
  fs.writeFileSync(path.join(evidence,"after.json"),JSON.stringify({images:after,businessChecksums:businessAfter},null,2));
  fs.writeFileSync(path.join(evidence,"summary.json"),JSON.stringify({status:apply?"APPLIED_VERIFIED":"DRYRUN",action,rows:plan.length,businessPreserved:true,identity},null,2));
  console.log(JSON.stringify({status:apply?"APPLIED_VERIFIED":"DRYRUN",action,rows:plan.length,businessPreserved:true}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
