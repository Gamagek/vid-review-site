#!/usr/bin/env node
// Manual Gemini-only audiovisual editorial packages. No production writes or scheduler.
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { editorialQueue, editorialSource, sourceIdentity, sha256, baseline } from './editorial/core.mjs';
import { exportCatalog } from './editorial/catalog.mjs';
import { GeminiClient } from './editorial/gemini.mjs';
import { analyzeRecord, existingPackages, writeSummary } from './editorial/pipeline.mjs';

const {values}=parseArgs({options:{catalog:{type:'string'},url:{type:'string'},'video-id':{type:'string'},
  model:{type:'string',default:'gemini-3.8-flash'},limit:{type:'string',default:'1'},
  'output-dir':{type:'string',default:'editorial-output'},'local-file':{type:'string'},'plan-only':{type:'boolean'},out:{type:'string'}}});
if (!/^[1-5]$/.test(values.limit)) throw Error('--limit must be 1–5');
if (values['video-id'] && !/^[1-9]\d*$/.test(values['video-id'])) throw Error('Invalid Vid.Best ID');
const snapshot = values.catalog ? {rows:JSON.parse(await readFile(values.catalog,'utf8')),meta:{mode:'supplied_snapshot',request_count:0,rows_written:0}} : await exportCatalog();
const rows = snapshot.rows;
let id = values['video-id'] ? Number(values['video-id']) : undefined;
if (values.url) {
  const source=sourceIdentity(values.url);
  const matches=rows.filter(r=>{try{return editorialSource(r).url===source.url;}catch{return false;}});
  const selected=id===undefined?matches:matches.filter(r=>r.id===id);
  if (selected.length !== 1) throw Error('URL must match exactly one catalog record; use its Vid.Best ID to disambiguate duplicate sources');
  id=selected[0].id;
}
if(values['local-file'] && id===undefined)throw Error('A local media file requires an exact --video-id or catalog-matched --url');
const out=resolve(values['output-dir']); await mkdir(out,{recursive:true});
const previous=(await existingPackages(out)).filter(p=>rows.some(r=>r.id===p.baseline.id &&
  ['source_url','title','slug','created_at','review_sha256','metadata_sha256'].every(k=>baseline(r)[k]===p.baseline[k])));
const completed=previous.map(p=>p.baseline.id);
const queue=editorialQueue(rows,{limit:Number(values.limit),id,completed});
if(!queue.length)throw Error('No eligible unprocessed YouTube/TikTok reviews in this snapshot');
if (values['plan-only']) {
  await writeFile(out+'/queue.json',JSON.stringify({catalog:snapshot.meta,production_writes:0,queue:queue.map(r=>({id:r.id,title:r.title,
    review_words:r.review_text.match(/[\p{L}\p{N}]+/gu)?.length||0,source:editorialSource(r).url,created_at:r.created_at,
    download_authorized:r.analysis_download_authorized===true||Number(r.redistribution_certified)===1}))},null,2)+'\n');
  console.log(`Planned ${queue.length} reviews, shortest first; no media/API generation or writes.`);
} else {
  const client=new GeminiClient();
  const requested=[...new Set([values.model,...(process.env.GEMINI_FALLBACK_MODELS||'').split(',').map(s=>s.trim()).filter(Boolean)])];
  const models=await client.models(requested);
  const imageRequested=(process.env.GEMINI_IMAGE_MODEL||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(imageRequested.some(x=>!/^gemini-[\w.-]+$/.test(x)))throw Error('Invalid image model configuration');
  const imageModels=(imageRequested.length?imageRequested:[...client.available].filter(n=>/image/.test(n)).sort((a,b)=>Number(/flash/.test(b))-Number(/flash/.test(a))||b.localeCompare(a))).filter(n=>client.available.has(n)).slice(0,2);
  if(!imageModels.length)throw Error('No available image model; configure GEMINI_IMAGE_MODEL before media analysis');
  const packages=[...previous],failures=[];
  for(const row of queue){
    try{
      const p=await analyzeRecord(row,rows,{out,models,imageModels,client,localFile:values['local-file']});
      packages.push(p); console.log(`ID ${row.id}: evidence, review and two images ready for editorial review; media deleted.`);
    }catch(error){
      failures.push({id:row.id,reason:String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,350)});
      console.log(`ID ${row.id}: blocked; no publication. See summary.`);
    }
  }
  const summary=await writeSummary(out,packages,rows,failures,snapshot.meta);
  if(values.out)await writeFile(values.out,JSON.stringify(summary,null,2)+'\n');
  if(failures.length)process.exitCode=1;
}
