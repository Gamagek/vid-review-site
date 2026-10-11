// One bounded transport for deployment and read-only incident diagnostics.
// Only transient GET failures can be retried. A write is always sent once.
const transientStatuses = new Set([502, 503, 504, 522, 524]);
const tlsCodes = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function failure(message, kind, retryable = false, httpStatus) {
  const error = new Error(message);
  Object.assign(error, { kind, retryable, httpStatus });
  return error;
}

export function createPortainerClient({ base, headers, readOnly = true, log = console.log, wait = sleep }) {
  return async function api(path, { method = 'GET', body, timeout = 45000, retries = 2 } = {}) {
    if (readOnly && method !== 'GET') throw new Error('Read-only mode refuses all non-GET API requests');
    const url = new URL(path.replace(/^\//, ''), base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) {
      throw new Error('Portainer request must stay on the configured API origin');
    }
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180000 ||
        !Number.isInteger(retries) || retries < 0 || retries > 2) {
      throw new Error('Invalid bounded Portainer request settings');
    }
    const attempts = method === 'GET' ? retries + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      let response;
      try {
        try {
          response = await fetch(url, {
            method, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            redirect: 'manual', signal: AbortSignal.timeout(timeout)
          });
        } catch (error) {
          const timedOut = ['TimeoutError', 'AbortError'].includes(error?.name) ||
            error?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT';
          const tls = tlsCodes.has(error?.cause?.code) || tlsCodes.has(error?.code);
          throw failure('Portainer API ' + method + ' ' + url.pathname +
            ' failed: ' + (timedOut ? 'request timeout after ' + timeout + 'ms' :
              tls ? 'trusted TLS verification failed' : 'transport connection failed') +
            '; no HTTP response received', timedOut ? 'timeout' : tls ? 'tls' : 'transport', !tls);
        }
        const reportedMime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const mime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(reportedMime) ? reportedMime : '';
        log('Portainer API ' + method + ' ' + url.pathname + ' -> HTTP ' + response.status +
          '; Content-Type: ' + (mime || 'missing or invalid') + '; attempt ' + attempt + '/' + attempts +
          '; elapsed ' + (Date.now() - started) + 'ms');
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location') || '';
          const login = location.includes('/cdn-cgi/access/') || location.includes('cloudflareaccess.com');
          throw failure('Portainer API returned HTTP ' + response.status +
            (login ? ' (Cloudflare Access login redirect; check Service Auth token)' : ' (unexpected redirect)') +
            ' at ' + url.pathname, 'redirect', false, response.status);
        }
        if (!response.ok) {
          throw failure('Portainer ' + method + ' ' + url.pathname + ' returned HTTP ' + response.status +
            ' (' + (mime || 'unknown content type') + ')', 'http', transientStatuses.has(response.status), response.status);
        }
        if (mime !== 'application/json' && !mime.endsWith('+json')) {
          throw failure('Portainer API returned HTTP ' + response.status + ' ' + (mime || 'missing Content-Type') +
            ' at ' + url.pathname + '; expected JSON (possible Access login or proxy rewrite)', 'mime');
        }
        let raw;
        try { raw = await response.text(); }
        catch {
          throw failure('Portainer API ' + method + ' ' + url.pathname + ' response body timed out or disconnected',
            'body-transport', true, response.status);
        }
        if (!raw.trim()) throw failure('Portainer API returned an empty JSON response at ' + url.pathname, 'json');
        try { return JSON.parse(raw); }
        catch { throw failure('Portainer API returned HTTP ' + response.status +
          ' with malformed JSON at ' + url.pathname, 'json', false, response.status); }
      } catch (error) {
        // Do not print request headers, response bodies, redirect URLs or nested transport causes.
        await response?.body?.cancel().catch(() => {});
        if (!error.retryable || attempt === attempts) throw error;
        log('Retrying read-only ' + method + ' ' + url.pathname + ': ' + error.kind +
          '; attempt ' + attempt + '/' + attempts + '; elapsed ' + (Date.now() - started) + 'ms');
        await wait(attempt * 2000);
      }
    }
  };
}

export async function readDockerInventory(api, endpointId, path) {
  try { return await api(path); }
  catch (error) {
    // A reachable Portainer control plane does not prove Docker is responsive.
    // Snapshot metadata is diagnostic only; never use stale snapshots as live health.
    console.error('Live Docker inventory unavailable; production writes are blocked. Running GET-only diagnostics.');
    try {
      const endpoint = await api('api/endpoints/' + endpointId, { timeout: 10000, retries: 0 });
      if (Number(endpoint.Id) !== endpointId) throw new Error('Endpoint identity mismatch');
      const status = [1, 2].includes(Number(endpoint.Status)) ? Number(endpoint.Status) : 'unknown';
      const last = Math.max(0, ...(endpoint.Snapshots || []).map(s => Number(s.Time)).filter(Number.isFinite));
      const age = last > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - last)) : 'unavailable';
      console.error('READ-ONLY DOCKER DIAGNOSTIC: endpoint=' + endpointId + '; status=' + status +
        '; snapshot-age-seconds=' + age + ' (diagnostic only, not a live health result)');
    } catch { console.error('READ-ONLY DOCKER DIAGNOSTIC: endpoint metadata unavailable'); }
    try {
      const version = await api('api/endpoints/' + endpointId + '/docker/version', { timeout: 10000, retries: 0 });
      const safe = value => typeof value === 'string' && /^[0-9.]{1,24}$/.test(value) ? value : 'unavailable';
      console.error('READ-ONLY DOCKER DIAGNOSTIC: Docker API reachable; API version=' + safe(version.ApiVersion) +
        '; minimum=' + safe(version.MinAPIVersion));
    } catch { console.error('READ-ONLY DOCKER DIAGNOSTIC: Docker version GET unavailable; inspect endpoint/daemon connectivity'); }
    throw error;
  }
}
