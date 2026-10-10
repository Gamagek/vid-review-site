import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCompose } from "../scripts/portainer-safety.mjs";
import { createV5Candidate } from "../scripts/portainer-v5-addon.mjs";
import { isDeepStrictEqual } from "node:util";

const base = readFileSync("ops/portainer/vidbest-v56.yaml","utf8");
test("optional v5 services add without replacing existing app/tunnel/tester",()=>{
 const old=readCompose(base,"Baseline");
 const {content,services,unchanged}=createV5Candidate(base);
 const doc=readCompose(content,"Candidate");
 assert.equal(unchanged,false);
 assert.deepEqual(services,["legacy-v5-postgres","legacy-v5-redis","legacy-v5","legacy-v5-nginx"]);
 for(const n of ["app","cloudflared","rapidapi-tester"]){
   assert.ok(isDeepStrictEqual(old.services[n],doc.services[n]),"existing service changed: "+n);
 }
 for(const n of Object.keys(old.volumes||{})) assert.deepEqual(doc.volumes[n],old.volumes[n]);
 assert.equal(doc.services["legacy-v5"].environment.SIGN_SECRET,"$"+"{SIGN_SECRET}");
 assert.ok(!doc.services["legacy-v5-nginx"].ports);
 assert.ok(!doc.services["legacy-v5"].ports);
 assert.ok(!doc.services["legacy-v5-postgres"].ports);
 assert.ok(!doc.services["legacy-v5-redis"].ports);
 assert.match(doc.services["legacy-v5"].command[2],/crypto\.timingSafeEqual/);
 assert.match(doc.services["legacy-v5"].command[2],/24 \* 3600/);
});
test("addon merge refuses partial installations and preserves existing addon",()=>{
 const one=createV5Candidate(base);
 assert.equal(createV5Candidate(one.content).unchanged,true);
 const corrupted=one.content.replace(/legacy-v5-nginx:/,"legacy-v5-nginx-disabled:");
 assert.throws(()=>createV5Candidate(corrupted),/Partial optional v5 installation/);
});
test("legacy v5 source contains safe URL validation, metadata-only cache",()=>{
 const code=readFileSync("ops/portainer/legacy-v5-server.cjs","utf8");
 assert.match(code,/www\.tiktok\.com/);
 assert.match(code,/expires_at/);
 assert.match(code,/NEXT|nextFetch/);
 assert.match(code,/embed\.js/);
 assert.doesNotMatch(code,/yt-dlp|PutObjectCommand|downloadMp4|overload-protect/);
});