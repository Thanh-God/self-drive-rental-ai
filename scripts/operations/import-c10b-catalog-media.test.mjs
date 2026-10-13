import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { makePlan, decideImport } from "./import-c10b-catalog-media.mjs";
const photos=JSON.parse(fs.readFileSync(new URL("../../frontend/public/media/vehicles/licenses.json",import.meta.url),"utf8"));
const vehicles=[{id:"v1",name:"Toyota Vios"},{id:"v2",name:"Mitsubishi Xpander"},{id:"v3",name:"Hyundai Accent"}];
test("Approved registry produces exactly 6/6/5 media rows with stable unique IDs",()=>{const p=makePlan(photos,vehicles);assert.equal(p.length,17);assert.equal(new Set(p.map(x=>x.id)).size,17);assert.deepEqual(vehicles.map(v=>p.filter(x=>x.vehicleId===v.id).length),[6,6,5]);assert.deepEqual(makePlan(photos,vehicles),p);});
test("Importer refuses changed target model, duplicate asset bytes and missing rights",()=>{assert.throws(()=>makePlan(photos,[{id:"v1",name:"Wrong"},...vehicles.slice(1)]),/TARGET_GUARD/);assert.throws(()=>makePlan([...photos.slice(0,16),photos[0]],vehicles),/ASSET_GUARD/);assert.throws(()=>makePlan(photos.map((p,i)=>i? p:{...p,licenseUrl:""}),vehicles),/ASSET_GUARD/);});
test("Only empty target inserts; exact rerun is NOOP; partial or different media refuses",()=>{const p=makePlan(photos,vehicles);assert.equal(decideImport(p,[]),"INSERT");assert.equal(decideImport(p,p),"NOOP");assert.throws(()=>decideImport(p,p.slice(1)),/EXISTING_MEDIA_GUARD/);assert.throws(()=>decideImport(p,p.map((r,i)=>i?r:{...r,url:"changed"})),/EXISTING_MEDIA_GUARD/);});
