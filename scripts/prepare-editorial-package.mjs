#!/usr/bin/env node
// Offline, reversible preparation only. This script cannot call D1, R2, GitHub or deploy.
import {parseArgs} from 'node:util';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baseline,sha256,validateCatalog,validateReview} from './editorial/core.mjs';
import {safeOutput} from './editorial/media.mjs';
import {capturedReviewFrame} from '../src/review-captured-frame.js';

const sqlValue=value=>value===null||value===undefined?'NULL':typeof value==='boolean'?(value?'1':'0'):"'"+String(value).replaceAll("'","''")+"'";
export function guardedSql(before,after) {
  const fields=['description','review_text','seo_title','seo_description','seo_tags'];
  const guards=['id','slug','title','source_url','source_page_url','thumbnail_url','created_at','published',...fields];
  return `UPDATE videos SET ${fields.map(k=>`${k}=${sqlValue(after[k])}`).join(',')} WHERE ${guards.map(k=>`${k} IS ${sqlValue(before[k])}`).join(' AND ')};\nSELECT changes() AS changed_rows;\n`;
}

export async function prepare({packageFile,catalog,root,out}) {
  validateCatalog(catalog);
  const p=JSON.parse(await readFile(packageFile,'utf8'));
  const row=catalog.find(r=>r.id===p.baseline?.id);
  if(!row||row.id<=10||![1,true].includes(row.published)||['raw','test'].includes(row.media_type)||
    p.schema_version!=='vidbest-av-editorial-v1'||p.status!=='ready_for_editorial_review'||
    !p.cleanup?.local_video_deleted||!p.cleanup?.provider_video_deleted)throw Error('Incomplete or protected editorial package');
  const current=baseline(row);
  for(const k of ['id','slug','title','source_url','created_at','review_sha256','metadata_sha256'])
    if(p.baseline[k]!==current[k])throw Error('Stale owner baseline: '+k);
  const review=validateReview(p.review,p.evidence.observations,catalog,row,p.evidence.grounding.sources);
  if(review.review_text!==p.review.review_text)throw Error('Review no longer matches its evidence');
  const manifest=JSON.parse(await readFile(join(root,'src/review-illustrations.json'),'utf8'));
  const prompts=JSON.parse(await readFile(join(root,'docs/review-illustration-prompts.json'),'utf8'));
  const images={};
  for(const kind of ['frame','artwork']){
    const image=p.images?.[kind];
    if(!image||!/^\d+-[a-f0-9]{16}\.(?:jpg|webp)$/.test(image.file)||
      image.path!==`/review-${kind==='frame'?'source-images':'illustrations'}/${image.file}`||
      image.kind!==(kind==='frame'?'video_frame':'conceptual_anime'))throw Error('Invalid image asset path');
    const bytes=await readFile(safeOutput(dirname(packageFile),image.file));
    if(sha256(bytes)!==image.sha256||bytes.length!==image.bytes||bytes.length>(kind==='frame'?150000:350000))throw Error('Image byte/hash mismatch');
    const dest=safeOutput(out,'public'+image.path);await mkdir(dirname(dest),{recursive:true});await copyFile(safeOutput(dirname(packageFile),image.file),dest);
    images[kind]=image;
  }
  const sourceImage={...images.frame,mime:'image/jpeg',url:row.thumbnail_url||'',sourceUrl:row.source_url,sourceDuration:p.source.duration,
    expectedThumbnail:row.thumbnail_url||''};
  if(sourceImage.source_sha256!==p.source.sha256||!capturedReviewFrame(row,sourceImage,row.thumbnail_url,'https://vid.best'))throw Error('Frame provenance mismatch');
  const entry={id:row.id,slug:row.slug,sourceUrl:row.source_url,expectedTitle:row.title,...images.artwork,
    alt:images.artwork.alt+'; conceptual anime illustration, not video footage',
    caption:images.artwork.caption+' This is not a frame from the source video.',
    generationMode:'Gemini API audiovisual editorial pipeline',sourceImage,relatedReviews:review.recommendations,
    grounding:{reviewText:review.review_text,sources:p.evidence.grounding.sources,
      searchEntryPoint:p.evidence.grounding.search_entry_point}};
  delete entry.file;delete entry.sourceImage.file;
  const old=manifest.findIndex(m=>m.id===row.id);
  if(old>=0)manifest[old]=entry;else manifest.push(entry);
  const promptEntry={id:row.id,sha256:entry.sha256,prompt:review.illustration_prompt,
    generationMode:entry.generationMode,sourceFrame:{sha256:sourceImage.sha256,seconds:sourceImage.seconds,source_sha256:sourceImage.source_sha256}};
  const pi=prompts.images.findIndex(x=>x.id===row.id);
  if(pi>=0){promptEntry.history=[...(prompts.images[pi].history||[]),prompts.images[pi]];prompts.images[pi]=promptEntry;}else prompts.images.push(promptEntry);
  const after={...row,description:review.description,review_text:review.review_text,seo_title:review.seo_title,
    seo_description:review.seo_description,seo_tags:JSON.stringify(review.tags)};
  const files={'src/review-illustrations.json':manifest,'docs/review-illustration-prompts.json':prompts,
    [`content/editorial-quality/av-${row.id}.json`]:{requires_editorial_review:true,production_writes:0,before:row,after,
      evidence_package_sha256:sha256(await readFile(packageFile)),preserved:['created_at','updated_at','slug','source_url','title','published','views','reaction_count','comments_count']}};
  for(const [path,value]of Object.entries(files)){const dest=safeOutput(out,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,JSON.stringify(value,null,2)+'\n');}
  await writeFile(join(out,'guarded-update.sql'),guardedSql(row,after));
  await writeFile(join(out,'guarded-rollback.sql'),guardedSql(after,row));
  await writeFile(join(out,'REVIEW-BEFORE-PUBLISHING.md'),`Review package for ${row.title}\n\nOriginal published date: ${row.created_at}\nCanonical: ${current.canonical}\n\nNo production changes were made. Inspect the evidence, full review, best-scene still and conceptual illustration before release. Merge source assets only after CI. The guarded update must change exactly one row, then verify live HTML, both image URLs, Article/VideoObject and the image/video sitemaps. Rollback SQL is included and also matches the expected content. Counters and all dates are absent from SET. Google Search suggestions and citations are rendered from the paired manifest when this exact review is visible.\n`);
  return {id:row.id,out,production_writes:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {values}=parseArgs({options:{package:{type:'string'},catalog:{type:'string'},out:{type:'string'},root:{type:'string',default:'.'}}});
  if(!values.package||!values.catalog||!values.out)throw Error('Specify --package, --catalog and --out');
  const root=resolve(values.root),out=resolve(values.out);
  if(out===root||root.startsWith(out+'/'))throw Error('Preparation must use a separate output directory');
  await mkdir(out,{recursive:true});
  console.log(JSON.stringify(await prepare({packageFile:resolve(values.package),catalog:JSON.parse(await readFile(values.catalog,'utf8')),root,out})));
}
