#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ORIGIN = 'https://vid.best';
const PREFIX = '/daily-weekly-best';
const branches = { films: 'Films & series', basketball: 'Basketball', games: 'Games' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
export const wordCount = value => (String(value).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;

export function renderMarkdown(markdown) {
  const sections = [];
  let html = '', paragraph = [];
  const flush = () => { if (paragraph.length) { html += `<p>${escape(paragraph.join(' '))}</p>\n`; paragraph = []; } };
  for (const line of markdown.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      const title = line.slice(3), id = `section-${sections.length + 1}`;
      sections.push({title,id});
      html += `<h2 id="${id}">${escape(title)}</h2>\n`;
    } else if (!line.trim()) flush();
    else paragraph.push(line.trim());
  }
  flush();
  return { html, sections };
}

const imageUrl = item => `${ORIGIN}/daily-weekly-covers/${item.cover}-illustrated-v1.webp`;
const pageUrl = item => `${ORIGIN}${PREFIX}/${item.slug}`;
const date = value => new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Colombo',day:'numeric',month:'long',year:'numeric'}).format(new Date(value));
function footer() {
  return '<footer class="site-footer"><span>Vid.Best · Video discovery and reviews</span><nav aria-label="Footer"><a href="/daily-weekly-best">Daily Weekly Best</a> · <a href="/about">About</a> · <a href="/editorial">Editorial</a> · <a href="/contact">Contact</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></nav></footer>';
}
function page({title,description,canonical,body,schema,image,article=false}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} | Vid.Best</title><meta name="description" content="${escape(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1">
<link rel="canonical" href="${escape(canonical)}"><meta property="og:type" content="${article?'article':'website'}">
<meta property="og:site_name" content="Vid.Best"><meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}">
${image?`<meta property="og:image" content="${escape(image)}"><meta property="og:image:width" content="1279"><meta property="og:image:height" content="720"><meta name="twitter:image" content="${escape(image)}">`:''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/daily-weekly-best.css?v=20261015-1">
<script type="application/ld+json">${json(schema)}</script></head><body class="dwb-page">
<a class="dwb-skip" href="#main">Skip to content</a><header class="site-header compact"><a class="brand" href="/" aria-label="Vid.Best homepage"><span class="brand-mark">V</span><span>Vid.Best</span></a><a class="button ghost" href="${PREFIX}">Daily Weekly Best</a></header>
<main id="main" class="dwb-shell">${body}</main>${footer()}</body></html>\n`;
}
function cards(items) {
  return `<div class="dwb-grid">${items.map(item=>`<article class="dwb-card glass-panel"><a href="${PREFIX}/${item.slug}"><img src="${imageUrl(item)}" alt="${escape(item.coverAlt)}" width="1279" height="720" loading="lazy" decoding="async"></a><div class="dwb-card-copy"><p class="eyebrow">${escape(branches[item.branch])} · Editorial selection</p><h2><a href="${PREFIX}/${item.slug}">${escape(item.title)}</a></h2><p>${escape(item.description)}</p><p class="dwb-small">Official video: ${escape(item.publisher)} · ${date(item.sourcePublishedAt)}</p><a class="button ghost" href="${PREFIX}/${item.slug}">Read the full analysis</a></div></article>`).join('')}</div>`;
}
function collection(catalog, branch) {
  const items = catalog.reviews.filter(item=>!branch||item.branch===branch);
  const name = branch?branches[branch]:'Daily Weekly Best';
  const canonical = ORIGIN+PREFIX+(branch?'/'+branch:'');
  const description = branch?`${name} editorial picks with official embedded videos, substantial independent previews and source links.`:'Independent film, series, basketball and game selections with official videos and thoughtful long-form analysis.';
  const body = `<nav class="dwb-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / ${branch?`<a href="${PREFIX}">Daily Weekly Best</a> / ${escape(name)}`:'Daily Weekly Best'}</nav>
<section class="dwb-intro glass-panel"><p class="eyebrow">${escape(catalog.edition)} · Editorial desk</p><h1>${escape(name)}</h1><p class="lead">Watch the official preview. Stay for the story behind it.</p><p>${escape(description)}</p><p>“Best” means our editorial selections, not a measured worldwide popularity ranking. Original video dates remain visible: an upcoming release can be relevant this month even when its trailer is older.</p><nav class="dwb-branches" aria-label="Editorial branches"><a class="button ${branch?'ghost':'primary'}" href="${PREFIX}">All selections</a>${Object.entries(branches).map(([key,label])=>`<a class="button ${key===branch?'primary':'ghost'}" href="${PREFIX}/${key}">${escape(label)}</a>`).join('')}</nav><p class="dwb-small">Fresh official uploads in this edition include Hexed (12 October), Ranabaali (8 October) and the NBA China Games highlights (11 October). Film previews are distinguished from full-film reviews; gameplay claims are distinguished from hands-on testing.</p></section>
<section aria-label="Selected long-form reviews">${cards(items)}</section>`;
  return page({title:name,description,canonical,body,image:imageUrl(items[0]),schema:{'@context':'https://schema.org','@type':'CollectionPage',name,url:canonical,description,mainEntity:{'@type':'ItemList',itemListElement:items.map((item,index)=>({'@type':'ListItem',position:index+1,name:item.title,url:pageUrl(item)}))}}});
}
function review(catalog,item,markdown) {
  const {html,sections}=renderMarkdown(markdown), canonical=pageUrl(item), words=wordCount(markdown);
  const embed=`https://www.youtube-nocookie.com/embed/${item.videoId}`;
  const source=`https://www.youtube.com/watch?v=${item.videoId}`;
  const related=catalog.reviews.filter(other=>other.slug!==item.slug&&other.branch===item.branch).slice(0,3);
  const body=`<nav class="dwb-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="${PREFIX}">Daily Weekly Best</a> / <a href="${PREFIX}/${item.branch}">${escape(branches[item.branch])}</a></nav>
<article class="dwb-article"><header class="dwb-intro glass-panel"><p class="eyebrow">${escape(catalog.edition)} · ${escape(branches[item.branch])}</p><h1>${escape(item.title)}</h1><p class="lead">${escape(item.description)}</p><p>By <a href="/editorial">Vid.Best Editorial</a> · Published <time datetime="${escape(catalog.publishedAt)}">${date(catalog.publishedAt)}</time> · ${Math.ceil(words/220)} minute read</p><p class="dwb-basis">${escape(item.basis)}</p></header>
<figure class="dwb-cover"><img src="${imageUrl(item)}" alt="${escape(item.coverAlt)}" width="1279" height="720" fetchpriority="high" decoding="async"><figcaption>Illustrated editorial cover — not official artwork or a video frame.</figcaption></figure>
<section class="dwb-video glass-panel" aria-labelledby="official-video"><h2 id="official-video">Watch the official video</h2><p>${escape(item.videoTitle)}</p><div class="dwb-player"><iframe src="${embed}" title="${escape(item.videoTitle)}" width="640" height="360" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><p class="dwb-small">${escape(item.publisher)} · Original video published <time datetime="${escape(item.sourcePublishedAt)}">${date(item.sourcePublishedAt)}</time>. <a href="${source}" target="_blank" rel="noopener noreferrer">Watch on the original channel</a></p><p>${escape(item.releaseNote)}</p><p class="dwb-small">YouTube delivers this official embed and applies its own privacy and availability rules. Vid.Best does not copy or host this video.</p></section>
<details class="dwb-toc glass-panel"><summary>In this review</summary><ol>${sections.map(section=>`<li><a href="#${section.id}">${escape(section.title)}</a></li>`).join('')}</ol></details>
<div class="dwb-prose glass-panel">${html}</div>
<section class="dwb-sources glass-panel" aria-labelledby="sources"><h2 id="sources">Official sources &amp; further reading</h2><ul>${item.sources.map(s=>`<li><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.name)}</a></li>`).join('')}</ul><p>The facts above follow these public sources. Interpretive questions and provisional assessments are independent editorial analysis; unreleased films and untested game features are not presented as firsthand findings.</p><p class="dwb-tags">${item.tags.map(tag=>`#${escape(tag)}`).join(' ')}</p></section></article>
<nav class="dwb-related glass-panel" aria-label="More editorial selections"><h2>Keep exploring</h2>${related.length?`<ul>${related.map(other=>`<li><a href="${PREFIX}/${other.slug}">${escape(other.title)}</a></li>`).join('')}</ul>`:''}<a class="button ghost" href="${PREFIX}/${item.branch}">More ${escape(branches[item.branch].toLowerCase())}</a> <a class="button ghost" href="${PREFIX}">All Daily Weekly Best selections</a></nav>`;
  const schema={'@context':'https://schema.org','@graph':[
    {'@type':'Article','@id':canonical+'#article',url:canonical,headline:item.title,description:item.description,datePublished:catalog.publishedAt,wordCount:words,image:imageUrl(item),inLanguage:'en',author:{'@type':'Organization',name:'Vid.Best Editorial',url:ORIGIN+'/editorial'},publisher:{'@type':'Organization',name:'Vid.Best',url:ORIGIN},mainEntityOfPage:canonical,video:{'@id':canonical+'#video'}},
    {'@type':'VideoObject','@id':canonical+'#video',name:item.videoTitle,description:`${item.publisher}'s official video. ${item.releaseNote}`,uploadDate:item.sourcePublishedAt,thumbnailUrl:`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,embedUrl:embed,creator:{'@type':'Organization',name:item.publisher}},
    {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Daily Weekly Best',item:ORIGIN+PREFIX},{'@type':'ListItem',position:2,name:branches[item.branch],item:ORIGIN+PREFIX+'/'+item.branch},{'@type':'ListItem',position:3,name:item.title,item:canonical}]}
  ]};
  return page({title:item.title,description:item.description,canonical,body,schema,image:imageUrl(item),article:true});
}

export async function build({check=false}={}) {
  const catalog=JSON.parse(await readFile(resolve(ROOT,'content/daily-weekly-best/catalog.json'),'utf8'));
  if(catalog.reviews.length!==10)throw new Error('Expected ten initial editorial selections');
  const outputs=new Map([['public/daily-weekly-best.html',collection(catalog)]]);
  for(const branch of Object.keys(branches))outputs.set(`public/daily-weekly-best/${branch}.html`,collection(catalog,branch));
  const counts=[];
  for(const item of catalog.reviews){
    if(!/^[a-z0-9-]+$/.test(item.slug)||!/^[A-Za-z0-9_-]{11}$/.test(item.videoId)||!branches[item.branch])throw new Error('Invalid editorial metadata');
    const markdown=await readFile(resolve(ROOT,`content/daily-weekly-best/${item.slug}.md`),'utf8');
    const words=wordCount(markdown);
    if(words<3000)throw new Error(`${item.slug}: ${words} words; requested long-form review is incomplete`);
    const cover=await readFile(resolve(ROOT,`public/daily-weekly-covers/${item.cover}-illustrated-v1.webp`));
    if(cover.length<16||cover.toString('ascii',0,4)!=='RIFF'||cover.toString('ascii',8,12)!=='WEBP'||cover.readUInt32LE(4)+8!==cover.length)throw new Error(`Invalid or empty editorial cover: ${item.cover}`);
    outputs.set(`public/daily-weekly-best/${item.slug}.html`,review(catalog,item,markdown));
    counts.push({slug:item.slug,words});
  }
  for(const [path,content] of outputs){
    if(check){if(await readFile(resolve(ROOT,path),'utf8')!==content)throw new Error(`Rebuild required: ${path}`);}
    else {await mkdir(resolve(ROOT,path,'..'),{recursive:true});await writeFile(resolve(ROOT,path),content);}
  }
  return counts;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const counts=await build({check:process.argv.includes('--check')});
  console.log(JSON.stringify({pages:14,reviews:counts.length,counts}));
}
