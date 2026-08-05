import { Router } from 'itty-router';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

// Initialize Gemini AI
const initializeGemini = (env) => {
  const genAI = new GoogleGenerativeAI(env.GEMINI_KEY);
  return genAI.getGenerativeModel({ model: 'gemini-pro' });
};

// Database initialization
const initDB = async (db) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS video_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      video_url TEXT NOT NULL,
      media_source TEXT,
      primary_category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      seo_description TEXT,
      seo_tags TEXT,
      review_text TEXT,
      thumbnail_url TEXT,
      reactions INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      author TEXT,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(video_id) REFERENCES video_reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      reaction_type TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      FOREIGN KEY(video_id) REFERENCES video_reviews(id) ON DELETE CASCADE
    );
  `);
};

// Parse media links
const parseMediaLink = (url) => {
  const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
  const tiktokRegex = /(?:tiktok\.com\/@[\w.]+\/video\/|vm\.tiktok\.com\/)(\d+)/;
  const facebookRegex = /facebook\.com\/(?:watch\/\?v=)?([0-9]+)/;

  const youtubeMatch = url.match(youtubeRegex);
  if (youtubeMatch) {
    return {
      source: 'youtube',
      embed_url: `https://www.youtube.com/embed/${youtubeMatch[1]}`,
      id: youtubeMatch[1]
    };
  }

  const tiktokMatch = url.match(tiktokRegex);
  if (tiktokMatch) {
    return {
      source: 'tiktok',
      embed_url: `https://www.tiktok.com/embed/v2/${tiktokMatch[1]}`,
      id: tiktokMatch[1]
    };
  }

  const facebookMatch = url.match(facebookRegex);
  if (facebookMatch) {
    return {
      source: 'facebook',
      embed_url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}`,
      id: facebookMatch[1]
    };
  }

  return {
    source: 'external',
    embed_url: url,
    id: 'unknown'
  };
};

// API: Generate SEO content using Gemini
router.post('/api/generate-seo', async (request, env, ctx) => {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { title, category, subcategory } = await request.json();
    const model = initializeGemini(env);

    const prompt = `Generate professional content for a video review platform called "Vid.Best". 
    
Video Title: ${title}
Category: ${category}
Subcategory: ${subcategory}

Please provide in JSON format:
{
  "seo_description": "A compelling 160-character meta description for SEO",
  "seo_tags": "comma,separated,seo,keywords",
  "review_text": "A 300-500 word professional review of this type of content"
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const contentData = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      seo_description: "Professional video review",
      seo_tags: "video,review,entertainment",
      review_text: "Review content generated successfully"
    };

    return new Response(JSON.stringify(contentData), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Save video review
router.post('/api/videos', async (request, env, ctx) => {
  try {
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.ADMIN_PASSWORD}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const data = await request.json();
    const mediaInfo = parseMediaLink(data.video_url);

    const result = await env.DB.prepare(`
      INSERT INTO video_reviews (
        title, description, video_url, media_source, primary_category,
        subcategory, seo_description, seo_tags, review_text, thumbnail_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.title,
      data.description,
      mediaInfo.embed_url,
      mediaInfo.source,
      data.primary_category,
      data.subcategory,
      data.seo_description,
      data.seo_tags,
      data.review_text,
      data.thumbnail_url || `https://img.youtube.com/vi/${mediaInfo.id}/maxresdefault.jpg`
    ).run();

    return new Response(JSON.stringify({ 
      success: true, 
      id: result.meta.last_row_id 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Get all videos
router.get('/api/videos', async (request, env, ctx) => {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const subcategory = url.searchParams.get('subcategory');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = 20;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM video_reviews WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND primary_category = ?';
      params.push(category);
    }
    if (subcategory) {
      query += ' AND subcategory = ?';
      params.push(subcategory);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results,
      pagination: { page, limit, total: result.results.length }
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Get single video with SEO metadata
router.get('/api/videos/:id', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const result = await env.DB.prepare('SELECT * FROM video_reviews WHERE id = ?').bind(id).first();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Video not found' }), { status: 404 });
    }

    // Increment views
    await env.DB.prepare('UPDATE video_reviews SET views = views + 1 WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({
      success: true,
      data: result
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Add reaction
router.post('/api/videos/:id/react', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const { reaction_type } = await request.json();

    await env.DB.prepare('UPDATE video_reviews SET reactions = reactions + 1 WHERE id = ?').bind(id).run();

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Reaction recorded' 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Add comment
router.post('/api/videos/:id/comments', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const { author, text } = await request.json();

    const result = await env.DB.prepare(`
      INSERT INTO comments (video_id, author, text) VALUES (?, ?, ?)
    `).bind(id, author, text).run();

    return new Response(JSON.stringify({ 
      success: true, 
      comment_id: result.meta.last_row_id 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// API: Get comments
router.get('/api/videos/:id/comments', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const result = await env.DB.prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY created_at DESC').bind(id).all();

    return new Response(JSON.stringify({
      success: true,
      data: result.results
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

// SEO: Dynamic meta tags for video pages
router.get('/video/:id', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const video = await env.DB.prepare('SELECT * FROM video_reviews WHERE id = ?').bind(id).first();

    if (!video) {
      return new Response('Video not found', { status: 404 });
    }

    const jsonLD = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      "name": video.title,
      "description": video.seo_description,
      "thumbnailUrl": video.thumbnail_url,
      "uploadDate": video.created_at,
      "contentUrl": video.video_url,
      "keywords": video.seo_tags
    };

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${video.title} | Vid.Best</title>
      <meta name="description" content="${video.seo_description}">
      <meta name="keywords" content="${video.seo_tags}">
      <meta property="og:title" content="${video.title}">
      <meta property="og:description" content="${video.seo_description}">
      <meta property="og:image" content="${video.thumbnail_url}">
      <meta property="og:type" content="video.other">
      <script type="application/ld+json">${JSON.stringify(jsonLD)}</script>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f0f0f; color: #fff; padding: 2rem; }
        .container { max-width: 900px; margin: 0 auto; }
        .back-link { color: #00d4ff; text-decoration: none; margin-bottom: 2rem; }
        .video-container { aspect-ratio: 16/9; margin-bottom: 2rem; border-radius: 12px; overflow: hidden; }
        iframe { width: 100%; height: 100%; border: none; }
        h1 { font-size: 2.5rem; margin-bottom: 1rem; }
        .meta { display: flex; gap: 1rem; margin-bottom: 2rem; font-size: 0.9rem; color: #aaa; }
        .review { line-height: 1.8; }
      </style>
    </head>
    <body>
      <div class="container">
        <a href="/" class="back-link">← Back to Vid.Best</a>
        <h1>${video.title}</h1>
        <div class="meta">
          <span>Category: ${video.primary_category}</span>
          <span>Subcategory: ${video.subcategory}</span>
          <span>Views: ${video.views}</span>
        </div>
        <div class="video-container">
          <iframe src="${video.video_url}" allowfullscreen loading="lazy"></iframe>
        </div>
        <div class="review">
          <h2>Review</h2>
          <p>${video.review_text}</p>
        </div>
      </div>
      <script>
        // Track page view
        fetch('/api/videos/${id}').catch(() => {});
      </script>
    </body>
    </html>
    `;

    return new Response(html, { 
      headers: { 'Content-Type': 'text/html; charset=utf-8' } 
    });
  } catch (error) {
    return new Response('Server error', { status: 500 });
  }
});

// Initialize DB on first request
router.all('*', async (request, env, ctx) => {
  // Initialize database
  if (!env.DB._initialized) {
    await initDB(env.DB);
    env.DB._initialized = true;
  }
});

export default router.handle;
