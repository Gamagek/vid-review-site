const MEMBER_COOKIE = "__Host-vidbest_member";
const MEMBER_SESSION_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_TOKEN_SECONDS = 60 * 20;
const encoder = new TextEncoder();

export async function requestMemberLogin(request, env) {
  requireSameOrigin(request);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new AppError(400, "Enter a valid email address.");

  const existing = await env.DB.prepare(
    "SELECT id, last_login_requested_at FROM members WHERE email = ?",
  ).bind(email).first();
  if (existing?.last_login_requested_at) {
    const elapsed = Date.now() - Date.parse(existing.last_login_requested_at);
    if (Number.isFinite(elapsed) && elapsed < 60_000) {
      throw new AppError(429, "A sign-in link was already requested recently. Please wait a moment.");
    }
  }

  const member = await env.DB.prepare(
    `INSERT INTO members (email, last_login_requested_at)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(email) DO UPDATE SET
       last_login_requested_at = excluded.last_login_requested_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING id, email`,
  ).bind(email).first();

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO member_login_tokens (member_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
  ).bind(member.id, tokenHash, new Date(Date.now() + LOGIN_TOKEN_SECONDS * 1000).toISOString()).run();

  await env.DB.prepare("DELETE FROM member_login_tokens WHERE expires_at < datetime('now') OR expires_at < ?")
    .bind(new Date().toISOString()).run();

  await sendEmail(env, {
    to: [email],
    subject: "Your Vid.Best sign-in link",
    text: `Sign in to Vid.Best: ${new URL("/?login_token=" + encodeURIComponent(token), getBaseUrl(env)).toString()}\n\nThis link expires in 20 minutes.`,
    html: `<p>Sign in to Vid.Best with this one-time link:</p><p><a href="${escapeHtml(new URL("/?login_token=" + encodeURIComponent(token), getBaseUrl(env)).toString())}">Sign in to Vid.Best</a></p><p>This link expires in 20 minutes.</p>`,
  });

  return json({ success: true, message: "Check your email for a one-time Vid.Best sign-in link." });
}

export async function verifyMemberLogin(request, env) {
  requireSameOrigin(request);
  const body = await readJson(request, 4096);
  const token = String(body.token || "").trim();
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(token)) throw new AppError(400, "Invalid sign-in token.");

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.member_id, m.email, m.display_name
     FROM member_login_tokens t
     JOIN members m ON m.id = t.member_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ?
     LIMIT 1`,
  ).bind(tokenHash, new Date().toISOString()).first();
  if (!row) throw new AppError(401, "This sign-in link is invalid or expired.");

  await env.DB.prepare(
    "UPDATE member_login_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND used_at IS NULL",
  ).bind(row.token_id).run();

  const session = randomToken();
  const sessionHash = await sha256Hex(session);
  const expiresAt = new Date(Date.now() + MEMBER_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO member_sessions (member_id, session_hash, expires_at) VALUES (?, ?, ?)",
  ).bind(row.member_id, sessionHash, expiresAt).run();
  await env.DB.prepare(
    "UPDATE members SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).bind(row.member_id).run();

  const response = json({
    success: true,
    member: { id: Number(row.member_id), email: row.email, display_name: row.display_name || "" },
  });
  response.headers.append("Set-Cookie", `${MEMBER_COOKIE}=${session}; Path=/; Max-Age=${MEMBER_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
  return response;
}

export async function getCurrentMember(request, env) {
  const session = readCookie(request, MEMBER_COOKIE);
  if (!session) return null;
  const hash = await sha256Hex(session);
  const row = await env.DB.prepare(
    `SELECT m.id, m.email, m.display_name, m.email_notifications, m.category_filter
     FROM member_sessions s
     JOIN members m ON m.id = s.member_id
     WHERE s.session_hash = ? AND s.expires_at > ?
     LIMIT 1`,
  ).bind(hash, new Date().toISOString()).first();
  return row ? {
    id: Number(row.id),
    email: row.email,
    display_name: row.display_name || "",
    email_notifications: Boolean(row.email_notifications),
    category_filter: parseCategoryFilter(row.category_filter),
  } : null;
}

export async function memberMe(request, env) {
  const member = await getCurrentMember(request, env);
  return json({ authenticated: Boolean(member), member });
}

export async function updateMemberPreferences(request, env) {
  requireSameOrigin(request);
  const member = await getCurrentMember(request, env);
  if (!member) throw new AppError(401, "Please sign in with email first.");

  const body = await readJson(request, 4096);
  const emailNotifications = toBoolean(body.email_notifications, member.email_notifications);
  const categoryFilter = normalizeCategoryFilter(body.category_filter);
  const displayName = cleanText(body.display_name, 80, member.display_name);

  await env.DB.prepare(
    `UPDATE members SET display_name = ?, email_notifications = ?, category_filter = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
  ).bind(displayName, Number(emailNotifications), JSON.stringify(categoryFilter), member.id).run();

  return json({
    success: true,
    member: { ...member, display_name: displayName, email_notifications: emailNotifications, category_filter: categoryFilter },
  });
}

export async function logoutMember(request, env) {
  requireSameOrigin(request);
  const session = readCookie(request, MEMBER_COOKIE);
  if (session) {
    await env.DB.prepare("DELETE FROM member_sessions WHERE session_hash = ?").bind(await sha256Hex(session)).run();
  }
  const response = json({ success: true });
  response.headers.append("Set-Cookie", `${MEMBER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return response;
}

export async function notifyNewVideoSubscribers(env, video) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM || "").trim();
  if (!apiKey || !from || !env.DB) return { sent: 0, skipped: true };

  const rows = await env.DB.prepare(
    `SELECT id, email, display_name, category_filter, last_email_video_id
     FROM members
     WHERE email_notifications = 1
     ORDER BY id ASC
     LIMIT 200`,
  ).all();

  let sent = 0;
  for (const member of rows.results || []) {
    if (Number(member.last_email_video_id || 0) === Number(video.id)) continue;
    const filters = parseCategoryFilter(member.category_filter);
    if (filters.length && !filters.includes(String(video.primary_category))) continue;

    const url = `${getBaseUrl(env)}/watch/${encodeURIComponent(video.slug)}`;
    try {
      await sendEmail(env, {
        to: [member.email],
        subject: `New on Vid.Best: ${cleanText(video.title, 90, "New video")}`,
        text: `A new video is available on Vid.Best: ${video.title}\n\n${url}`,
        html: `<p>Hi ${escapeHtml(member.display_name || "there")},</p><p>A new video is available on Vid.Best:</p><p><strong>${escapeHtml(video.title)}</strong></p><p><a href="${escapeHtml(url)}">Watch on Vid.Best</a></p>`,
      });
      await env.DB.prepare("UPDATE members SET last_email_video_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(Number(video.id), Number(member.id)).run();
      sent += 1;
    } catch (error) {
      console.error("Vid.Best member email failed", error?.message || error);
    }
  }
  return { sent, skipped: false };
}

async function sendEmail(env, email) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) throw new AppError(503, "Email sign-in is not configured yet. Add RESEND_API_KEY and EMAIL_FROM to Cloudflare.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ from, ...email }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 180); } catch {}
    throw new AppError(502, "Email provider rejected the message." + (detail ? ` ${detail}` : ""));
  }
  return response.json();
}

function getBaseUrl(env) {
  const configured = String(env.PUBLIC_BASE_URL || "").trim();
  try {
    return new URL(configured || "https://vid.best").origin;
  } catch {
    return "https://vid.best";
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AppError(403, "Cross-origin request rejected");
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function normalizeEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "";
  return email;
}

function normalizeCategoryFilter(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 100)).filter(Boolean))].slice(0, 20);
}

function parseCategoryFilter(value) {
  try { return normalizeCategoryFilter(JSON.parse(String(value || "[]"))); } catch { return []; }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanText(value, maximum, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

function base64Url(bytes) {
  let text = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readJson(request, maximum = 8192) {
  return request.json().catch(() => { throw new AppError(400, "Invalid JSON body."); });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[character]);
}

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
