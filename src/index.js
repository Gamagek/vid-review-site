import { Router } from 'itty-router';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

const initializeGemini = (env) => {
  const genAI = new GoogleGenerativeAI(env.GEMINI_KEY);
  return genAI.getGenerativeModel({ model: 'gemini-pro' });
};

// POST: Generate SEO content
router.post('/api/generate-seo', async (request, env) => {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const { title, category } = await request.json();
    const model = initializeGemini(env);
    const result = await model.generateContent(`Generate SEO content for: ${title}`);
    const text = await result.response.text();
    return new Response(JSON.stringify({ content: text }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// POST: Save video
router.post('/api/videos', async (request, env) => {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const data = await request.json();
    const result = await env.DB.prepare('INSERT INTO video_reviews (title, description, video_url, primary_category, subcategory) VALUES (?, ?, ?, ?, ?)').bind(data.title, data.description, data.video_url, data.primary_category, data.subcategory).run();
    return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// GET: All videos
router.get('/api/videos', async (request, env) => {
  try {
    const result = await env.DB.prepare('SELECT * FROM video_reviews ORDER BY created_at DESC LIMIT 50').all();
    return new Response(JSON.stringify({ success: true, data: result.results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// GET: Single video
router.get('/api/videos/:id', async (request, env) => {
  try {
    const { id } = request.params;
    const result = await env.DB.prepare('SELECT * FROM video_reviews WHERE id = ?').bind(id).first();
    if (!result) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    await env.DB.prepare('UPDATE video_reviews SET views = views + 1 WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ success: true, data: result }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// POST: React to video
router.post('/api/videos/:id/react', async (request, env) => {
  try {
    const { id } = request.params;
    await env.DB.prepare('UPDATE video_reviews SET reactions = reactions + 1 WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// POST: Add comment
router.post('/api/videos/:id/comments', async (request, env) => {
  try {
    const { id } = request.params;
    const { author, text } = await request.json();
    const result = await env.DB.prepare('INSERT INTO comments (video_id, author, text) VALUES (?, ?, ?)').bind(id, author, text).run();
    return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// GET: Comments
router.get('/api/videos/:id/comments', async (request, env) => {
  try {
    const { id } = request.params;
    const result = await env.DB.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC').bind(id).all();
    return new Response(JSON.stringify({ success: true, data: result.results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// Fallback: Serve HTML
router.all('*', () => {
  return new Response('Vid.Best API is running', { headers: { 'Content-Type': 'text/plain' } });
});

export default {
  fetch: router.handle
};
