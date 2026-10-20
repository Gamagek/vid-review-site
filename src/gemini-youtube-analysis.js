/**
 * Admin-only, on-demand YouTube review evidence via Gemini.
 * The Gemini API key stays in Cloudflare Secrets and is never returned.
 * No automatic publication or changes to source videos are performed.
 */
export async function analyzeYoutubeDraftWithGemini(request, env, videoId) {
  const row = await env.DB.prepare(
    "SELECT id, title, source_url, media_type, published FROM videos WHERE id = ?"
  ).bind(videoId).first();
  if (!row) return reply({ error: "Video not found" }, 404);
  // Published videos may be analyzed for editorial improvement; this endpoint never writes to D1.
  if (row.media_type !== "youtube") return reply({ error: "YouTube drafts only" }, 400);
  const url = parseYoutubeUrl(row.source_url);
  if (!url) return reply({ error: "Invalid YouTube source URL" }, 400);
  if (!env.GEMINI_API_KEY) return reply({ error: "GEMINI_API_KEY not configured" }, 503);

  const prompt = [
    "You are a careful editorial video analyst for Vid.Best.",
    "Analyze the actual YouTube video content (visuals, audio, on-screen text).",
    "Do not invent people, dialogue, actions, or scenes. Distinguish observed facts from uncertainty.",
    "If the video cannot be viewed, say so explicitly and do not write a speculative review.",
    "Respond ONLY as JSON with keys: accessible (boolean), observed_scenes (array of strings),",
    "audio_summary (string), uncertainty (array of strings), suggested_title (string),",
    "review (string, 250-450 words if evidence is sufficient), seo_description (string, <=155 characters).",
    "Avoid copied source descriptions and generic filler. Never imply that you personally witnessed",
    "details unless they are directly supported by the video input.",
    "Original title: " + String(row.title || "").slice(0, 180)
  ].join("\n");

  let response;
  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: prompt }, { file_data: { file_uri: url } }]
          }],
          generationConfig: { temperature: 0.25, responseMimeType: "application/json", maxOutputTokens: 3000 }
        }),
        signal: AbortSignal.timeout(90000)
      }
    );
  } catch {
    return reply({ error: "Gemini request timed out or could not connect" }, 502);
  }
  if (!response.ok) {
    return reply({ error: "Gemini request failed", upstream_status: response.status }, 502);
  }
  const payload = await response.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  let analysis;
  try { analysis = JSON.parse(raw); }
  catch { return reply({ error: "Gemini did not return valid structured analysis" }, 502); }
  if (!analysis || typeof analysis !== "object") return reply({ error: "Empty Gemini analysis" }, 502);
  return reply({
    success: true, video_id: row.id, source_url: url, model: "gemini-3.8-flash",
    verified: false, requires_editorial_review: true, analysis
  });
}

function parseYoutubeUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return null;
    const id = host === "youtu.be" ? u.pathname.slice(1) :
      u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] :
      u.pathname === "/watch" ? u.searchParams.get("v") : null;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return null;
    return "https://www.youtube.com/watch?v=" + id;
  } catch { return null; }
}

function reply(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
