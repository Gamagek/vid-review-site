#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import catalog from '../content/daily-weekly-best/catalog.json' with {type:'json'};

async function bytes(response) {
  const reader=response.body?.getReader();const chunks=[];let size=0;
  if(!reader)return new Uint8Array();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('source_response_too_large');}chunks.push(value);}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function verifyEditorialSources({fetchImpl=globalThis.fetch}={}) {
  const records=[];
  for(const item of catalog.reviews){
    const row={slug:item.slug,videoId:item.videoId,verified:false};
    try{
      const oembed=await fetchImpl('https://www.youtube.com/oembed?url='+encodeURIComponent('https://www.youtube.com/watch?v='+item.videoId)+'&format=json',{redirect:'manual',signal:AbortSignal.timeout(20000)});
      row.oembedStatus=oembed.status;
      if(!oembed.ok||!oembed.headers.get('content-type')?.includes('json')){await oembed.body?.cancel();throw new Error('source_metadata_unavailable');}
      const data=JSON.parse(new TextDecoder().decode(await bytes(oembed)));
      if(data.title!==item.videoTitle||data.author_name!==item.publisher||!data.html?.includes('/embed/'+item.videoId))throw new Error('source_identity_or_embed_mismatch');
      const image=await fetchImpl('https://i.ytimg.com/vi/'+item.videoId+'/hqdefault.jpg',{redirect:'manual',signal:AbortSignal.timeout(20000)});
      row.posterStatus=image.status;row.posterType=(image.headers.get('content-type')||'').split(';')[0];
      if(!image.ok||row.posterType!=='image/jpeg'){await image.body?.cancel();throw new Error('source_poster_unavailable');}
      const imageBytes=await bytes(image);
      if(imageBytes[0]!==255||imageBytes[1]!==216||imageBytes[2]!==255)throw new Error('source_poster_not_jpeg');
      row.posterBytes=imageBytes.length;row.verified=true;
    }catch(error){row.error=['source_response_too_large','source_metadata_unavailable','source_identity_or_embed_mismatch','source_poster_unavailable','source_poster_not_jpeg'].includes(error.message)?error.message:'source_network_or_parse_error';}
    records.push(row);
  }
  return {status:records.every(row=>row.verified)?'success':'failed',records,productionWrites:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await verifyEditorialSources();
  await writeFile('daily-weekly-best-source-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.status!=='success')process.exitCode=1;
}
