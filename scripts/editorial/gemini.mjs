import { readFile, stat, writeFile } from 'node:fs/promises';

const ROOT = 'https://generativelanguage.googleapis.com';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class GeminiClient {
  constructor({ key = process.env.GEMINI_API_KEY, fetcher = fetch, wait = delay, journal = process.env.VIDBEST_GEMINI_JOURNAL } = {}) {
    if (!key) throw Error('Configure GEMINI_API_KEY');
    this.key = key; this.fetch = fetcher; this.wait = wait; this.uploaded = new Set(); this.journal=journal;
  }
  async saveJournal(){if(this.journal)await writeFile(this.journal,JSON.stringify([...this.uploaded])+'\n',{mode:0o600});}
  async request(path, options = {}) {
    const url = new URL(path, ROOT);
    // Never send API credentials to a model-supplied or redirected host.
    if (url.origin !== ROOT) throw Error('Untrusted Gemini API URL');
    const res = await this.fetch(url, { ...options, redirect: 'error',
      headers: { 'x-goog-api-key': this.key, ...options.headers }, signal: AbortSignal.timeout(180000) });
    return res;
  }
  async models(requested) {
    if (!Array.isArray(requested) || !requested.length || requested.some(x => !/^gemini-[\w.-]+$/.test(x))) throw Error('Invalid Gemini model names');
    const names = [];
    let token;
    for (let page = 0; page < 10; page++) {
      const res = await this.request('/v1beta/models?pageSize=100' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
      if (!res.ok) throw Error(`Gemini models.list HTTP ${res.status}`);
      const data = await res.json();
      names.push(...(data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace(/^models\//, '')));
      token = data.nextPageToken;
      if (!token) break;
    }
    this.available = new Set(names);
    const choices = [...new Set(requested)].filter(n => this.available.has(n));
    if (!choices.length) throw Error('Configured Gemini models are unavailable; set a currently available model and fallback');
    return choices;
  }
  async generate(models, parts, { json = true, search = false, image = false } = {}) {
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = { contents: [{ role: 'user', parts }], generationConfig: {
          ...(json ? { responseMimeType: 'application/json' } : {}), temperature: image ? 0.6 : 0.3,
          maxOutputTokens: image ? 8192 : 14000, ...(image ? { responseModalities: ['TEXT', 'IMAGE'] } : {}),
        }, ...(search ? { tools: [{ google_search: {} }] } : {}) };
        const res = await this.request(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          const payload = await res.json(); const c = payload.candidates?.[0];
          if (!c?.content?.parts?.length || c.finishReason && c.finishReason !== 'STOP') throw Error('Incomplete or blocked Gemini response');
          const text = c.content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
          // Technical evidence stays in the package, never a fabricated human byline.
          return { model, value: json ? JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) : text,
            parts: c.content.parts, grounding: c.groundingMetadata || null };
        }
        const retryable = [408, 429, 500, 502, 503, 504].includes(res.status);
        if (!retryable && ![400, 404].includes(res.status)) throw Error(`Gemini generateContent HTTP ${res.status}`);
        // 400/404 may mean this model lacks a modality/tool; try the configured fallback.
        if (!retryable) break;
        if (attempt === 0) await this.wait(3000);
      }
    }
    throw Error('All configured Gemini models failed; no review published');
  }
  async upload(path) {
    const bytes = (await stat(path)).size;
    if (bytes <= 0 || bytes > 50_000_000) throw Error('Analysis segment exceeds 50 MB');
    const start = await this.request('/upload/v1beta/files', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'video/mp4',
    }, body: JSON.stringify({ file: { display_name: 'VidBest temporary editorial segment' } }) });
    if (!start.ok) throw Error(`Gemini upload start HTTP ${start.status}`);
    const session = start.headers.get('x-goog-upload-url');
    if (!session || new URL(session).origin !== ROOT) throw Error('Untrusted upload session');
    const uploaded = await this.request(session, { method: 'POST', headers: {
      'Content-Type': 'video/mp4', 'Content-Length': String(bytes), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize',
    }, body: await readFile(path) });
    if (!uploaded.ok) throw Error(`Gemini upload HTTP ${uploaded.status}`);
    let file = (await uploaded.json()).file;
    if (!/^files\/[a-z0-9-]{1,40}$/.test(file?.name || '')) throw Error('Invalid uploaded file identity');
    this.uploaded.add(file.name); // Also cleaned after processing/generation failure.
    await this.saveJournal();
    for (let attempt = 0; file.state === 'PROCESSING' && attempt < 90; attempt++) {
      await this.wait(2000);
      const status = await this.request('/v1beta/' + file.name);
      if (!status.ok) throw Error(`Gemini file status HTTP ${status.status}`);
      file = await status.json();
    }
    if (file.state !== 'ACTIVE' || !file.uri || new URL(file.uri).origin !== ROOT) throw Error('Gemini video file did not become active');
    return file;
  }
  async removeFile(name) {
    if (!this.uploaded.has(name)) throw Error('Refusing deletion of an unowned Gemini file');
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.request('/v1beta/' + name, { method: 'DELETE' });
      if (res.ok || res.status === 404) { this.uploaded.delete(name); await this.saveJournal(); return; }
      if (attempt === 0) await this.wait(1000);
    }
    throw Error('Temporary Gemini file deletion failed; do not mark package complete');
  }
  async cleanup() {
    let failed=false;
    for(const name of [...this.uploaded])try{await this.removeFile(name);}catch{failed=true;}
    if (failed) throw Error('Temporary provider file cleanup incomplete');
  }
}

export function groundingSources(response) {
  const chunks = response.grounding?.groundingChunks || [];
  const supports = response.grounding?.groundingSupports || [];
  const cited = new Set(supports.flatMap(s => s.groundingChunkIndices || []));
  const sources = [];
  for (const [i, chunk] of chunks.entries()) {
    if (!cited.has(i) || !chunk.web?.uri) continue;
    try {
      const u = new URL(chunk.web.uri);
      if (u.protocol !== 'https:' || u.username || u.password) continue;
      sources.push({ url: u.href, title: String(chunk.web.title || ''),
        supported_text: supports.filter(s => s.groundingChunkIndices?.includes(i)).map(s => s.segment?.text || '').join(' ') });
    } catch { /* Malformed source is not evidence. */ }
  }
  return { text: response.value, sources, search_entry_point: response.grounding?.searchEntryPoint?.renderedContent || null,
    status: sources.length ? 'grounded' : 'no_citable_sources' };
}
