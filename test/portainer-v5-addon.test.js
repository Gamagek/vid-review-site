import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBackup } from "../scripts/portainer-backup.mjs";
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

test("optional v5 updater never sends a rollback PUT after 524, 502, conflict or connection reset", t => {
 const root=fileURLToPath(new URL('..',import.meta.url));
 const secrets={api:'fake-addon-api-secret',id:'fake-addon-client.access',client:'fake-addon-client-secret',sign:'fake-existing-sign-secret'};
 const env=[{name:'SIGN_SECRET',value:secrets.sign}];
 const stack={Id:27,Name:'video-site',EndpointId:3,Type:2,Status:1,Env:env};
 const containers=['app','cloudflared','rapidapi-tester'].map(service=>({
   Id:'existing-'+service,ImageID:'sha256:reviewed-'+service,State:'running',Status:'Up (healthy)',
   Labels:{'com.docker.compose.project':'video-site','com.docker.compose.service':service}
 }));
 for(const failure of [524,502,409,'connection-reset']){
   const dir=mkdtempSync(join(tmpdir(),'vidbest-addon-safety-'));
   t.after(()=>rmSync(dir,{recursive:true,force:true}));
   const backup=join(dir,'stack.enc.json'),auditPath=join(dir,'requests.json'),mockPath=join(dir,'fetch.mjs');
   writeBackup(backup,{version:1,stackId:27,endpointId:3,name:'video-site',yaml:base,env},secrets.api);
   writeFileSync(mockPath,`
     import {writeFileSync} from 'node:fs';
     const requests=[];
     globalThis.setTimeout=fn=>{queueMicrotask(fn);return 0};
     globalThis.fetch=async (url,options)=>{
       requests.push({method:options.method,path:url.pathname});
       writeFileSync(${JSON.stringify(auditPath)},JSON.stringify(requests));
       if(options.method==='PUT'){
         if(${JSON.stringify(failure)}==='connection-reset')throw Object.assign(new TypeError('PRIVATE_RESET_DETAILS'),{cause:{code:'ECONNRESET'}});
         return new Response('PRIVATE_RESPONSE',{status:${typeof failure==='number'?failure:524}});
       }
       let data={};
       if(url.pathname==='/api/stacks/27')data=${JSON.stringify(stack)};
       if(url.pathname==='/api/stacks/27/file')data={StackFileContent:${JSON.stringify(base)}};
       if(url.pathname.endsWith('/containers/json'))data=${JSON.stringify(containers)};
       if(url.pathname==='/api/endpoints/3/docker/images/json')data=[{Id:'sha256:reviewed-cloudflared',RepoTags:['cloudflare/cloudflared:latest']}];
       return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
     };
   `);
   let output='',status=0;
   try{output=execFileSync(process.execPath,['--import',mockPath,'scripts/deploy-portainer-v5-addon.mjs','--deploy'],{
     cwd:root,encoding:'utf8',stdio:'pipe',timeout:15000,env:{...process.env,
       PORTAINER_URL:'https://portainer.megasale.win',PORTAINER_STACK_ID:'27',PORTAINER_ENDPOINT_ID:'3',
       PORTAINER_API_KEY:secrets.api,CF_ACCESS_CLIENT_ID:secrets.id,CF_ACCESS_CLIENT_SECRET:secrets.client,
       PORTAINER_BACKUP_FILE:backup,PORTAINER_BACKUP_ENCRYPTION_KEY:'',PORTAINER_ADDON_ACTIVATION:'true'}
   });}catch(error){status=error.status;output=String(error.stdout)+String(error.stderr);}
   assert.notEqual(status,0,output);
   const requests=JSON.parse(readFileSync(auditPath,'utf8'));
   assert.equal(requests.filter(r=>r.method==='PUT').length,1);
   assert.equal(requests.filter(r=>r.method==='POST'||r.method==='DELETE').length,0);
   assert.match(output,/No automatic rollback attempted/);
   assert.match(output,/READ-ONLY RECOVERY SNAPSHOT/);
   for(const secret of [...Object.values(secrets),'PRIVATE_RESET_DETAILS','PRIVATE_RESPONSE'])assert.ok(!output.includes(secret));
 }
});
