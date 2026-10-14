#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import catalog from '../content/daily-weekly-best/catalog.json' with {type:'json'};

async function boundedBytes(response) {
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(!reader)return Buffer.alloc(0);
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('editorial_asset_too_large');}chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks);
}
export async function verifyEditorialAssets({fetchImpl=globalThis.fetch}={}) {
  const assets=[{path:'/daily-weekly-best.css',type:'text/css'},...catalog.reviews.map(item=>({path:'/daily-weekly-covers/'+item.cover+'-illustrated-v1.webp',type:'image/webp'}))];
  const records=[];
  for(const asset of assets){
    const row={path:asset.path,verified:false};
    try{
      const expected=await readFile(new URL('../public'+asset.path,import.meta.url));
      const response=await fetchImpl('https://vid.best'+asset.path+(asset.type==='text/css'?'?v=20261015-1':''),{redirect:'manual',signal:AbortSignal.timeout(20000)});
      row.status=response.status;row.type=(response.headers.get('content-type')||'').split(';')[0];
      if(response.status!==200||row.type!==asset.type){await response.body?.cancel();throw new Error('editorial_asset_unavailable');}
      const actual=await boundedBytes(response);
      if(!actual.equals(expected))throw new Error('editorial_asset_content_mismatch');
      row.bytes=actual.length;row.sha256=createHash('sha256').update(actual).digest('hex');row.verified=true;
    }catch(error){row.error=['editorial_asset_unavailable','editorial_asset_content_mismatch','editorial_asset_too_large'].includes(error.message)?error.message:'editorial_asset_network_or_read_error';}
    records.push(row);
  }
  return {status:records.every(row=>row.verified)?'success':'failed',records,productionWrites:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await verifyEditorialAssets();
  await writeFile('daily-weekly-best-asset-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.status!=='success')process.exitCode=1;
}
