// Shared by watch, home and admin. Metadata requests never load a player or a script.
(() => {
  const ORIGIN = 'https://www.tiktok.com', TTL = 300000;
  const pending = new Map(), memory = new Map();
  function parse(value) {
    try {
      const u = new URL(String(value || ''));
      const m = u.pathname.match(/^\/@([a-zA-Z0-9_.]{1,32})\/video\/(\d{15,25})\/?$/);
      if (u.protocol !== 'https:' || u.username || u.password || u.port ||
          !['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(u.hostname) || !m) return null;
      return { id: m[2], url: `${ORIGIN}/@${m[1]}/video/${m[2]}` };
    } catch { return null; }
  }
  function playerUrl(id) {
    if (!/^\d{15,25}$/.test(String(id))) return '';
    return `${ORIGIN}/player/v1/${id}?autoplay=0&controls=1&loop=0&rel=0`;
  }
  function read(key) {
    try { return memory.get(key) || JSON.parse(sessionStorage.getItem(key)); } catch { return memory.get(key); }
  }
  function write(key, value) {
    memory.set(key, value);
    if (memory.size > 50) { const oldest = memory.keys().next().value; memory.delete(oldest); try { sessionStorage.removeItem(oldest); } catch {} }
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  async function getMetadata(value) {
    const share = parse(value);
    if (!share) throw new Error('Use the full TikTok video sharing link.');
    const key = 'vidbest:tiktok:v3:' + share.id, cached = read(key);
    if (cached?.until > Date.now()) {
      if (cached.error) throw Object.assign(new Error(cached.error), { retryAfter: Math.ceil((cached.until - Date.now()) / 1000) });
      if (cached.payload?.video_id === share.id) return cached.payload;
    }
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        const endpoint = new URL('/api/tiktok/embed', location.origin);
        endpoint.searchParams.set('url', share.url);
        const response = await fetch(endpoint.pathname + endpoint.search, { credentials: 'same-origin',
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          const h = response.headers.get('Retry-After');
          const retry = /^\d+$/.test(h || '') ? Number(h) : Math.ceil((Date.parse(h) - Date.now()) / 1000);
          throw Object.assign(new Error('Video details are temporarily unavailable. The player can still be tried.'),
            { retryAfter: Math.max(10, Number.isFinite(retry) ? retry : 30) });
        }
        if (String(payload.video_id) !== share.id || parse(payload.source_url)?.id !== share.id) throw new Error('The preview returned a different TikTok video.');
        write(key, { payload, until: Date.now() + (payload.cache_source?.includes('stale') ? 30000 : TTL) });
        return payload;
      } catch (error) {
        const retryAfter = Math.min(86400, Math.max(10, error.retryAfter || 30));
        write(key, { error: error.message, until: Date.now() + retryAfter * 1000 });
        throw error;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }
  function observe(frame, callbacks = {}) {
    let ready = false, disposed = false;
    const timer = window.setTimeout(() => {
      if (!ready && !disposed) callbacks.error?.('TikTok did not respond. Wait a moment, then retry or check connection help.');
    }, 8000);
    const markReady = () => {
      if (ready) return;
      ready = true; window.clearTimeout(timer); callbacks.ready?.();
    };
    const message = event => {
      if (disposed || event.origin !== ORIGIN || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || data['x-tiktok-player'] !== true) return;
      if (data.type === 'onPlayerReady') markReady();
      if (data.type === 'onPlayerError') {
        if (Number(data.value?.errorCode) === 3002) { markReady(); callbacks.autoplay?.(); }
        else {
          window.clearTimeout(timer);
          callbacks.error?.(Number(data.value?.errorCode) === 1001 ? 'This video is unavailable on TikTok.' : 'TikTok could not play this video. Please try again later.');
        }
      }
      callbacks.message?.(data);
    };
    window.addEventListener('message', message);
    // An iframe load event also fires for 429/Access Denied HTML. It is never readiness.
    return () => { disposed = true; window.clearTimeout(timer); window.removeEventListener('message', message); };
  }
  function command(frame, type, value) {
    frame?.contentWindow?.postMessage({ 'x-tiktok-player': true, type, value }, ORIGIN);
  }
  window.VidBestTikTok = Object.freeze({ parse, playerUrl, getMetadata, observe, command });
})();
