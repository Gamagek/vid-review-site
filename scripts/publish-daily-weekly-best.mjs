#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncSearchConsole} from './search-console-audit.mjs';
import catalog from '../content/daily-weekly-best/catalog.json' with {type:'json'};

// Explicit editorial publication only: the regular deployment diagnostic remains read-only.
export async function publishEditorialDiscovery(report, options={}) {
  const paths=['/daily-weekly-best','/daily-weekly-best/films','/daily-weekly-best/basketball','/daily-weekly-best/games',...catalog.reviews.map(item=>'/daily-weekly-best/'+item.slug)];
  if(report.publicAuditStatus!=='success'||paths.some(path=>!report.pages.some(page=>page.url==='https://vid.best'+path&&page.getStatus===200&&page.headStatus===200&&page.errors.length===0)))throw new Error('editorial_public_verification_required');
  return syncSearchConsole(catalog.reviews.map(item=>'https://vid.best/daily-weekly-best/'+item.slug),{
    ...options,submitSitemaps:true,budget:10,reviewSitemaps:['https://vid.best/sitemaps/daily-weekly-best.xml'],
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const publicReport=JSON.parse(await readFile('seo-audit-report.json','utf8'));
  const result=await publishEditorialDiscovery(publicReport,{
    secret:process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON||'',
    site:process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY||'sc-domain:vid.best',
    progress:message=>console.log('[Editorial discovery] '+message),
  });
  await writeFile('daily-weekly-best-google-report.json',JSON.stringify(result,null,2)+'\n');
  const rows=result.inspections||[];
  const status={status:result.status,sitemapSubmitted:result.sitemapSubmitted,editorialSitemapSubmitted:result.reviewSitemaps?.[0]?.submitted||false,newPagesInspected:rows.length,indexed:rows.filter(row=>row.verdict==='PASS').length,coverage:[...new Set(rows.map(row=>row.coverageState))],productionWrites:false};
  await writeFile('daily-weekly-best-google-summary.txt',JSON.stringify(status)+'\n');
  console.log(JSON.stringify(status));
  if(result.status!=='success')process.exitCode=1;
}
