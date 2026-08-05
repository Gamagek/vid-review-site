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
    const { title, category } = await request.json();
    const model = initializeGemini(env);
    const result = await model.generateContent(`Generate SEO content for: ${title}`);
    const text = await result.response.text();
    return new Response(JSON.stringify({ content: text, seo_description: text, seo_tags: 'video,review', review_text: text }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// POST: Save video - NO PASSWORD REQUIRED
router.post('/api/videos', async (request, env) => {
  try {
    const data = await request.json();
    const result = await env.DB.prepare('INSERT INTO video_reviews (title, description, video_url, primary_category, subcategory, seo_description, seo_tags, review_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(data.title, data.description, data.video_url, data.primary_category, data.subcategory, data.seo_description || '', data.seo_tags || '', data.review_text || '').run();
    return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// GET: All videos
router.get('/api/videos', async (request, env) => {
  try {
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') || 50;
    const result = await env.DB.prepare(`SELECT * FROM video_reviews ORDER BY created_at DESC LIMIT ${limit}`).all();
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

// Serve static HTML files
router.get('/admin.html', async () => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Panel - Vid.Best</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0a0e27; color: #fff; }
    .admin-nav { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 3rem; background: rgba(10, 14, 39, 0.8); border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .admin-logo { font-size: 1.5rem; font-weight: bold; color: #00d4ff; }
    .back-home { color: #00d4ff; text-decoration: none; }
    .admin-container { padding: 3rem; max-width: 1200px; margin: 0 auto; }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
    input, textarea, select { width: 100%; padding: 0.8rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #fff; font-family: inherit; }
    button { padding: 1rem; background: linear-gradient(45deg, #00d4ff, #ff006e); border: none; border-radius: 8px; color: #0a0e27; font-weight: 700; cursor: pointer; }
    .status-message { margin-top: 1.5rem; padding: 1rem; border-radius: 8px; display: none; }
    .status-message.success { background: rgba(0, 255, 136, 0.2); color: #00ff88; display: block; }
    .status-message.error { background: rgba(255, 0, 110, 0.2); color: #ff006e; display: block; }
  </style>
</head>
<body>
  <nav class="admin-nav">
    <div class="admin-logo">🔐 Vid.Best Admin</div>
    <a href="/" class="back-home">← Back to Home</a>
  </nav>
  <div class="admin-container">
    <h1>Add New Video Review</h1>
    <form id="videoForm">
      <div class="form-group">
        <label>Video URL</label>
        <input type="url" id="videoUrl" required placeholder="https://youtube.com/watch?v=...">
      </div>
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="videoTitle" required placeholder="Video title">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="videoDescription" rows="3" placeholder="Video description"></textarea>
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="primaryCategory" required>
          <option value="">Select Category</option>
          <option value="Entertainment">Entertainment</option>
          <option value="Technology">Technology</option>
          <option value="Food">Food</option>
          <option value="Lifestyle">Lifestyle</option>
          <option value="Education">Education</option>
          <option value="Music">Music</option>
          <option value="Sports">Sports</option>
          <option value="Travel">Travel</option>
        </select>
      </div>
      <button type="submit">Save Video</button>
    </form>
    <div id="statusMessage" class="status-message"></div>
  </div>
  <script>
    document.getElementById('videoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/videos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_url: document.getElementById('videoUrl').value,
            title: document.getElementById('videoTitle').value,
            description: document.getElementById('videoDescription').value,
            primary_category: document.getElementById('primaryCategory').value,
            subcategory: 'General'
          })
        });
        const msg = document.getElementById('statusMessage');
        if (res.ok) {
          msg.textContent = '✅ Video saved successfully!';
          msg.className = 'status-message success';
          document.getElementById('videoForm').reset();
        } else {
          const errorData = await res.json();
          msg.textContent = '❌ Error: ' + (errorData.error || 'Unknown error');
          msg.className = 'status-message error';
        }
      } catch (e) {
        document.getElementById('statusMessage').textContent = '❌ Error: ' + e.message;
        document.getElementById('statusMessage').className = 'status-message error';
      }
    });
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Fallback: Serve index.html
router.get('/', async () => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vid.Best - Video Review Platform</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #0a0e27 0%, #1a1a3e 100%); color: #fff; }
    .navbar { padding: 1.5rem 3rem; background: rgba(10, 14, 39, 0.8); border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center; }
    .navbar h1 { color: #00d4ff; }
    .nav-links { display: flex; gap: 1rem; }
    .admin-btn { padding: 0.7rem 1.5rem; background: linear-gradient(45deg, #00d4ff, #ff006e); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; }
    .hero { padding: 4rem 3rem; text-align: center; }
    .hero h1 { font-size: 3rem; margin-bottom: 1rem; }
    .hero p { font-size: 1.2rem; color: #b0b0b0; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 2rem; padding: 4rem 3rem; }
    .card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 1.5rem; cursor: pointer; transition: all 0.3s; }
    .card:hover { transform: translateY(-10px); border-color: #00d4ff; }
    .card h3 { color: #00d4ff; margin-bottom: 1rem; }
    .card-meta { color: #b0b0b0; font-size: 0.9rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <nav class="navbar">
    <h1>🎬 Vid.Best</h1>
    <div class="nav-links">
      <a href="/admin.html"><button class="admin-btn">+ Add Video</button></a>
    </div>
  </nav>
  <header class="hero">
    <h1>Discover Extraordinary <span style="color: #00d4ff;">Video Reviews</span></h1>
    <p>Your gateway to the best video content across every category</p>
  </header>
  <section class="grid" id="videosGrid">
    <div class="card">
      <h3>Loading videos...</h3>
      <p>Fetching content from the database</p>
    </div>
  </section>
  <script>
    function loadVideos() {
      fetch('/api/videos').then(r => r.json()).then(data => {
        const grid = document.getElementById('videosGrid');
        grid.innerHTML = '';
        if (data.success && data.data.length > 0) {
          data.data.forEach(video => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = '<h3>' + video.title + '</h3><p>' + (video.description || 'No description') + '</p><div class="card-meta">👁️ ' + video.views + ' views | ❤️ ' + video.reactions + ' reactions</div>';
            grid.appendChild(card);
          });
        } else {
          grid.innerHTML = '<div class="card"><h3>No videos yet</h3><p>Be the first to add a video!</p></div>';
        }
      }).catch(e => console.error('Error loading videos:', e));
    }
    loadVideos();
    setInterval(loadVideos, 3000);
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Catch all for 404
router.all('*', () => {
  return new Response('404 - Not Found', { status: 404 });
});

export default {
  fetch: router.handle
};
