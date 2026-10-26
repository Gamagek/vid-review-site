// Render citation links and the provider's required Search suggestions only with the exact paired review.
export function reviewGrounding(row, illustration, escape) {
  const context=illustration?.grounding;
  if(!context||context.reviewText!==row.review_text||!Array.isArray(context.sources)||!context.sources.length)return '';
  const links=context.sources.slice(0,10).flatMap(source=>{
    try{const u=new URL(source.url);if(u.protocol!=='https:'||u.username||u.password)return [];
      return [`<li><a href="${escape(u.href)}" target="_blank" rel="noopener noreferrer">${escape(source.title||u.hostname)}</a></li>`];
    }catch{return [];}
  }).join('');
  if(!links)return '';
  // srcdoc is escaped as an attribute and sandboxed: no scripts, top navigation, forms or same-origin access.
  // The provider HTML itself is retained, including its styles and search suggestion text.
  const suggestions=typeof context.searchEntryPoint==='string'&&context.searchEntryPoint.length<=50000
    ? `<iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${escape(context.searchEntryPoint)}" loading="lazy" style="width:100%;border:0;min-height:100px"></iframe>`:'';
  return `<section class="review-background-sources"><h2>Background sources</h2><ol>${links}</ol>${suggestions}</section>`;
}

export function relatedEditorialReviews(row,illustration,escape){
  if(illustration?.grounding?.reviewText!==row.review_text||!Array.isArray(illustration.relatedReviews))return '';
  const links=illustration.relatedReviews.slice(0,3).flatMap(item=>{
    if(!/^https:\/\/vid\.best\/watch\/[a-z0-9-]+$/.test(item.url||'')||!item.title||!item.reason)return [];
    return [`<li><a href="${escape(item.url)}">${escape(item.title)}</a> — ${escape(item.reason)}</li>`];
  }).join('');
  return links?`<section class="review-editorial-recommendations"><h2>Related reviews</h2><ul>${links}</ul></section>`:'';
}
