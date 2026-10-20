#!/usr/bin/env node
/**
 * Safe, opt-in D1 editorial updates. Usage:
 * node scripts/apply-verified-editorial.mjs --input editorial-reviewed.json --dry-run
 * node scripts/apply-verified-editorial.mjs --input editorial-reviewed.json --apply
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID only for --apply.
 * Input records: {id, source_url, expected_review_text, title, description,
 *   review_text, seo_title, seo_description, seo_tags}.
 * expected_review_text is the complete pre-edit review, preventing stale writes.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
const { values } = parseArgs({options:{input:{type:'string'},'dry-run':{type:'boolean'},apply:{type:'boolean'}}});
if (!values.input || Boolean(values.apply) === Boolean(values['dry-run'])) throw Error('Specify --input and exactly one of --dry-run or --apply');
const entries=JSON.parse(readFileSync(values.input,'utf8'));
if (!Array.isArray(entries)||!entries.length||entries.length>10) throw Error('Expected 1–10 reviewed entries');
const fields=['title','description','review_text','seo_title','seo_description','seo_tags'];
const unique=new Set();
for(const x of entries){
 if(!Number.isSafeInteger(x.id)||x.id<1||unique.has(x.id))throw Error('Invalid or duplicate id');
 unique.add(x.id);
 if(!/^https:\/\//.test(x.source_url)||typeof x.expected_review_text!=='string')throw Error('Missing original source or review');
 for(const k of fields)if(typeof x[k]!=='string'||!x[k].trim())throw Error('Missing '+k+' for '+x.id);
 if(x.review_text.length<1200||x.review_text===x.expected_review_text)throw Error('Review insufficient or unchanged: '+x.id);
 if(x.seo_title.length>80||x.seo_description.length>180)throw Error('SEO metadata too long: '+x.id);
 if(!Array.isArray(JSON.parse(x.seo_tags)))throw Error('Tags must be a JSON array');
}
if(values['dry-run']){console.log('Validated '+entries.length+' entries; no database writes.');process.exit(0);}
const token=process.env.CLOUDFLARE_API_TOKEN, account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('Missing Cloudflare credentials');
const db='d1a91eb2-1c41-44b8-aff1-24166f2c91f4';
async function query(sql,params=[]){
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/d1/database/'+db+'/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
 const j=await r.json();if(!r.ok||!j.success||j.result?.[0]?.success===false)throw Error('D1 query failed: '+JSON.stringify(j.errors||j.result?.[0]?.error));
 return j.result?.[0]||{};
}
await query(`CREATE TABLE IF NOT EXISTS vidbest_editorial_safe_backups (
 video_id INTEGER PRIMARY KEY, source_url TEXT NOT NULL, original_json TEXT NOT NULL,
 backed_up_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
for(const x of entries){
 const rows=(await query('SELECT id,source_url,title,description,review_text,seo_title,seo_description,seo_tags,created_at,published FROM videos WHERE id=?',[x.id])).results||[];
 const v=rows[0];
 if(!v||v.source_url!==x.source_url||v.review_text!==x.expected_review_text||v.published!==1)throw Error('Original state mismatch for '+x.id);
 const date=new Date(v.created_at).getTime()+330*60*1000;
 if(!(date>=Date.parse('2026-10-19T00:00:00Z')&&date<Date.parse('2026-10-20T00:00:00Z')))throw Error('Outside original Sri Lanka publication date: '+x.id);
 const original=JSON.stringify(Object.fromEntries(fields.map(k=>[k,v[k]])));
 await query('INSERT OR IGNORE INTO vidbest_editorial_safe_backups(video_id,source_url,original_json) VALUES(?,?,?)',[x.id,x.source_url,original]);
 const backup=(await query('SELECT original_json FROM vidbest_editorial_safe_backups WHERE video_id=?',[x.id])).results?.[0];
 if(backup?.original_json!==original)throw Error('Backup conflict for '+x.id);
 const update=await query(`UPDATE videos SET title=?,description=?,review_text=?,seo_title=?,seo_description=?,seo_tags=? WHERE id=? AND source_url=? AND review_text=? AND published=1 AND created_at=?`,[...fields.map(k=>x[k]),x.id,x.source_url,x.expected_review_text,v.created_at]);
 if(update.meta?.changes!==1)throw Error('Guarded update did not change exactly one row: '+x.id);
 const after=(await query('SELECT title,description,review_text,seo_title,seo_description,seo_tags,created_at,published,source_url FROM videos WHERE id=?',[x.id])).results?.[0];
 if(!after||fields.some(k=>after[k]!==x[k])||after.created_at!==v.created_at||after.source_url!==v.source_url||after.published!==v.published)throw Error('Post-write verification failed: '+x.id);
 console.log('Verified updated video '+x.id);
}
