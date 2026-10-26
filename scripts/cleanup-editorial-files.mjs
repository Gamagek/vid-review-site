// Always-step recovery for interrupted analysis. The run-local journal contains only names of files this run uploaded.
import {readFile} from 'node:fs/promises';
import {GeminiClient} from './editorial/gemini.mjs';
const path=process.env.VIDBEST_GEMINI_JOURNAL;
if(path){
  let names;
  try{names=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')process.exit(0);throw error;}
  if(!Array.isArray(names)||names.length>20||names.some(n=>!/^files\/[a-z0-9-]{1,40}$/.test(n)))throw Error('Invalid run-local cleanup journal');
  if(names.length){const client=new GeminiClient();client.uploaded=new Set(names);await client.cleanup();}
  console.log('Run-local Gemini cleanup complete.');
}
