import fs from 'node:fs';
import request from '../content/editorial-quality/2026-10-20-owner-av-request.json' with {type:'json'};
const key=process.env.GEMINI_API_KEY||'';
const report={checkedAt:new Date().toISOString(),status:'prepared',provider:'Gemini API',videos:[],productionWrites:0,imageGeneration:0};
function emit(){
 fs.writeFileSync('owner-video-evidence.json',JSON.stringify(report,null,2)+'\n');
 const encoded=Buffer.from(JSON.stringify(report)).toString('base64'),size=5000,n=Math.ceil(encoded.length/size);
 for(let i=0;i<n;i++)console.log('VIDBEST_VIDEO_CHUNK '+(i+1)+'/'+n+' '+encoded.slice(i*size,(i+1)*size));
 console.log(JSON.stringify({status:report.status,analyzed:report.videos.filter(v=>v.status==='evidence_ready').length,pending:request.youtube.length-report.videos.filter(v=>v.status==='evidence_ready').length,productionWrites:0}));
}
if(!key){report.status='GEMINI_API_KEY_not_configured';emit();process.exit(0);}
const root='https://generativelanguage.googleapis.com/v1beta/models';
const headers={'x-goog-api-key':key,'Content-Type':'application/json'};
const list=await fetch(root+'?pageSize=100',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(20000)});
if(!list.ok){report.status='models_list_http_'+list.status;report.retryAfter=list.headers.get('retry-after');emit();process.exit(0);}
const available=(await list.json()).models||[];
const models=available.filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name.replace(/^models\//,''));
const preferred=['gemini-3.8-flash',...(process.env.GEMINI_FALLBACK_MODELS||'').split(',').map(x=>x.trim()).filter(Boolean)];
const model=preferred.find(x=>models.includes(x))||models.find(x=>/^gemini-.*flash/.test(x)&&!/image|tts|audio|live|embedding/i.test(x));
if(!model){report.status='No_supported_video_model';report.availableModels=models;emit();process.exit(0);}
report.model=model;
let stop=false,cursor=0;
const prompt='Inspect this exact video, both frames and actual audible track. Return JSON only with accessible:boolean,visual_access:boolean,audio_access:boolean,duration_seconds:number,scenes:[{start_seconds:number,end_seconds:number,visible_action:string,heard_audio:string,uncertainty:string}],audio_overview:string,editing_observations:[string],uncertainties:[string]. Describe chronological visible gags and actual speech meaning/music/effects; paraphrase speech, do not quote lyrics or invent dialogue. Mark audio inaccessible if not actually inspected. Do not identify a real person from appearance or infer a location, injury, motive, creator or music credit. Be concise and source-specific, with enough observations for at least3subtopics. If access fails, say so and do not infer scenes from a title or another video.';
async function one(v){
 const base={id:v.id,sourceId:v.sourceId,source_url:v.url,input_uri:'https://www.youtube.com/watch?v='+v.sourceId,model,requestedAt:new Date().toISOString()};
 try{
  const res=await fetch(root+'/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers,
   body:JSON.stringify({contents:[{parts:[{file_data:{file_uri:base.input_uri}},{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json',maxOutputTokens:5000}}),signal:AbortSignal.timeout(90000)});
  if(!res.ok){
   const status='http_'+res.status;if([401,403,429].includes(res.status))stop=true;
   await res.body?.cancel();report.videos.push({...base,status,retryAfter:res.headers.get('retry-after')});return;
  }
  const data=await res.json(),candidate=data.candidates?.[0];
  if(candidate?.finishReason&&candidate.finishReason!=='STOP'){report.videos.push({...base,status:'incomplete_response',finishReason:candidate.finishReason});return;}
  const text=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
  const analysis=JSON.parse(text);
  const matchesDuration=typeof analysis.duration_seconds==='number'&&Math.abs(analysis.duration_seconds-v.expectedDurationSeconds)<=3;
  const ready=analysis.accessible===true&&analysis.visual_access===true&&Array.isArray(analysis.scenes)&&analysis.scenes.length>0&&matchesDuration;
  report.videos.push({...base,status:ready?'evidence_ready':'requires_review',matchesDuration,analysis});
 }catch(e){report.videos.push({...base,status:'request_or_parse_failed',errorType:e.name||'Error'});}
 console.log(JSON.stringify({completedSource:v.sourceId,id:v.id,status:report.videos.find(x=>x.id===v.id)?.status}));
}
async function worker(){while(!stop&&cursor<request.youtube.length){const v=request.youtube[cursor++];await one(v);}}
await Promise.all([worker(),worker()]);
report.status=stop?'stopped_on_auth_or_quota':report.videos.every(x=>x.status==='evidence_ready')?'completed':'completed_with_evidence_holds';
report.videos.sort((a,b)=>b.id-a.id);emit();
