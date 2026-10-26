import { mkdtemp, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { baseline, editorialSource, evidencePrompt, reviewPrompt, validateObservations, validateReview, sha256, collectionProposals } from './core.mjs';
import { GeminiClient, groundingSources } from './gemini.mjs';
import { acquire, segments, capture, illustration } from './media.mjs';

export async function analyzeRecord(row, catalog, { out, models, imageModels, localFile, client = new GeminiClient(),
  media = { acquire, segments, capture, illustration } }) {
  const dest = join(resolve(out),String(row.id));
  try { await statExisting(dest); throw Error('Package already exists; use a fresh output directory for a changed baseline'); }
  catch(e){if(e.code!=='ENOENT')throw e;}
  const work = await mkdtemp(join(tmpdir(), 'vidbest-editorial-'));
  const stage = await mkdtemp(join(resolve(out), '.pending-'));
  let committed = false;
  try {
    const source = await media.acquire(row, work, {localFile});
    const chunks = await media.segments(source, work);
    const observations = []; const usedModels = [];
    for (const chunk of chunks) {
      const file = await client.upload(chunk.path);
      const response = await client.generate(models, [{fileData:{fileUri:file.uri,mimeType:'video/mp4'}, videoMetadata:{fps:2}},
        {text:evidencePrompt(row,chunk)}]);
      observations.push(validateObservations(response.value, chunk)); usedModels.push(response.model);
      await client.removeFile(file.name);
    }
    // The source's opening and ending must be covered, including silent segments.
    if (!observations.length || observations[0].coverage.start !== 0 ||
      Math.abs(observations.at(-1).coverage.end - source.duration) > 0.5) throw Error('Incomplete source coverage');
    const context = await client.generate(models, [{text:`Research external background only for ${JSON.stringify({title:row.title,source:editorialSource(row).url})}.
Use Google Search and prefer the creator's original page, official credits and primary sources. Do not repeat other sites' reviews.
Separate verified credits/publication facts from uncertainty. No uncited popularity statistics, medical promises or unconfirmed identity.
Return a concise sourced background briefing, or say that reliable background is unavailable. Footage observations come from a separate actual-video analysis.`}], {json:false,search:true});
    const grounding = groundingSources(context);
    // Uncited web prose cannot become factual evidence in the review.
    const background = grounding.status === 'grounded' ? grounding.sources : [];
    const related = catalog.filter(r => r.id !== row.id && r.id > 10 && [1,true].includes(r.published) &&
      r.primary_category === row.primary_category && !/^(?:raw|test)$/.test(r.media_type)).slice(0,12)
      .map(r => ({id:r.id,title:r.title,review_summary:r.review_text.slice(0,900)}));
    const composition = await client.generate(models, [{text:reviewPrompt(row,observations,background,related)}]);
    const review = validateReview(composition.value, observations, related, row, background);
    const framePath = join(stage, 'frame.jpg');
    let frame,scene;
    for(const best of review.best_scenes.slice(0,3)){
      scene=observations.flatMap(x=>x.scenes).find(s=>s.id===best.scene_id);
      frame=await media.capture(source,scene.seconds,framePath);
      const check=await client.generate(models,[{inlineData:{mimeType:'image/jpeg',data:(await readFile(framePath)).toString('base64')}},
        {text:`Check this captured frame against this observed moment: ${JSON.stringify(scene.observation)}. Return JSON only {usable:boolean,matches_observation:boolean,reason:string}. Usable means a clear meaningful subject, not blank/black/blurred/transition/credits-only. Reject a mismatch; do not infer invisible details.`}]);
      if(check.value.usable===true&&check.value.matches_observation===true)break;
      frame=null;
    }
    if(!frame)throw Error('No clear, matching observed scene still; no two-image package created');
    const art = await media.illustration(client,imageModels,framePath,review.illustration_prompt,work,join(stage,'anime.webp'));
    const frameName = `${row.id}-${frame.sha256.slice(0,16)}.jpg`, artName = `${row.id}-${art.sha256.slice(0,16)}.webp`;
    await rename(framePath,join(stage,frameName)); await rename(join(stage,'anime.webp'),join(stage,artName));
    const output = { schema_version:'vidbest-av-editorial-v1',status:'ready_for_editorial_review',verified:false,
      requires_editorial_review:true,production_writes:0,baseline:baseline(row),
      source: {url:editorialSource(row).url,sha256:source.sha256,duration:source.duration,has_audio:source.has_audio},
      evidence:{observations,models:[...new Set([...usedModels,context.model,composition.model])],grounding},review,
      images:{frame:{...frame,file:frameName,path:`/review-source-images/${frameName}`,
        caption:`Frame from the reviewed video at ${scene.seconds.toFixed(2)} seconds.`,alt:scene.observation},
      artwork:{...art,file:artName,path:`/review-illustrations/${artName}`,alt:review.illustration_prompt}},
      cleanup:{local_video_deleted:false,provider_video_deleted:false},generated_at:new Date().toISOString() };
    await client.cleanup(); await rm(work,{recursive:true,force:true});
    output.cleanup = {local_video_deleted:true,provider_video_deleted:true};
    await writeFile(join(stage,'package.json'),JSON.stringify(output,null,2)+'\n');
    // Atomic package publication; raw media, upload/session URLs and credentials never become artifacts.
    await rename(stage,dest); committed = true; return output;
  } finally {
    // Also runs on provider errors, capture/image failures and invalid reviews.
    let cleanupError;
    try { await client.cleanup(); } catch (e) { cleanupError = e; }
    await rm(work,{recursive:true,force:true});
    if (!committed) await rm(stage,{recursive:true,force:true});
    if (cleanupError) throw cleanupError;
  }
}
async function statExisting(path) { return readdir(path); }

export async function existingPackages(out) {
  const result=[];
  for (const name of await readdir(out)) {
    if (!/^\d+$/.test(name)) continue;
    try { const p=JSON.parse(await readFile(join(out,name,'package.json'),'utf8')); if (p.status==='ready_for_editorial_review') result.push(p); }
    catch { /* Incomplete old output is never silently treated as completed. */ }
  }
  return result;
}

export async function writeSummary(out, packages, catalog, failures, exportMeta) {
  const summary={production_writes:0,ready:packages.map(p=>p.baseline.id),blocked:failures,catalog:exportMeta,
    catalog_sha256:sha256(JSON.stringify(catalog)),
    collection_proposals:collectionProposals(packages,catalog),
    publication:'Draft packages only. Verify evidence and prepare source changes; no D1, R2 or deployment mutations.'};
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  // A source hash detects a changed baseline across manual reruns without modifying dates.
  return summary;
}
