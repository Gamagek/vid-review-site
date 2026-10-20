#!/usr/bin/env node
// Analyze an explicitly supplied public YouTube video using Gemini; never publish.
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
const {values}=parseArgs({options:{url:{type:'string'},'video-id':{type:'string'},model:{type:'string',default:'gemini-2.5-flash'},out:{type:'string',default:'gemini-evidence.json'}}});
const raw=values.url||'',u=new URL(raw);
const host=u.hostname.toLowerCase();
if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host))throw Error('Public YouTube URL required');
const id=host==='youtu.be'?u.pathname.slice(1):u.pathname.startsWith('/shorts/')?u.pathname.split('/')[2]:u.pathname==='/watch'?u.searchParams.get('v'):null;
if(!/^[\w-]{11}$/.test(id||''))throw Error('Invalid YouTube video ID');
if(!/^gemini-[\w.-]+$/.test(values.model))throw Error('Invalid Gemini model');
if(!process.env.GEMINI_API_KEY)throw Error('Missing GEMINI_API_KEY secret');
const source='https://www.youtube.com/watch?v='+id;
const prompt='Analyze the actual video, including observable scenes, on-screen text and clearly audible speech. Return JSON only: {accessible:boolean,observed_scenes:[{timestamp:string,description:string}],audio_summary:string,uncertainties:[string],editorial_outline:[{heading:string,notes:string}],suggested_title:string,suggested_description:string,seo_title:string,seo_description:string,seo_tags:[string]}. If video unavailable, accessible=false and do not invent details. Be precise; no fabricated quotes, scene descriptions or claims of human viewing. Distinguish effects and editing from real-world events. Editorial outline should have 3–6 substantive sections only if evidence supports them.';
const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(values.model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{file_data:{file_uri:source}},{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json',maxOutputTokens:4500}}),signal:AbortSignal.timeout(120000)});
if(!response.ok)throw Error('Gemini API HTTP '+response.status+' (no draft written)');
const payload=await response.json();
const candidate=payload.candidates?.[0];
if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw Error('Incomplete Gemini output: '+candidate.finishReason);
const txt=candidate?.content?.parts?.map(p=>p.text||'').join('')||'';
const analysis=JSON.parse(txt);
if(analysis.accessible!==true||!Array.isArray(analysis.observed_scenes)||analysis.observed_scenes.length===0)throw Error('Insufficient verified video evidence; no draft written');
const output={video_id:values['video-id']||null,source_url:source,model:values.model,generated_at:new Date().toISOString(),verified:false,requires_editorial_review:true,analysis};
mkdirSync('editorial/gemini-evidence',{recursive:true});
writeFileSync(values.out,JSON.stringify(output,null,2)+'\n',{flag:'w'});
console.log('Evidence draft created; no D1 writes. Scenes:',analysis.observed_scenes.length);
