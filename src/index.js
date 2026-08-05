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

    const prompt = `Generate professional content for a video review platform called "Vid.Best". Video Title: ${title}. Category: ${category}. Subcategory: ${subcategory}. Please provide JSON with seo_description, seo_tags, and review_text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
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

// API: Get single video
router.get('/api/videos/:id', async (request, env, ctx) => {
  try {
    const { id } = request.params;
    const result = await env.DB.prepare('SELECT * FROM video_reviews WHERE id = ?').bind(id).first();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Video not found' }), { status: 404 });
    }

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

// Fallback: Serve index.html
router.get('*', async (request, env) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vid.Best</title>
</head>
<body>
  <h1>Vid.Best - Video Review Platform</h1>
  <p>Welcome! Visit the admin panel or use the API.</p>
</body>
</html>`;

  return new Response(html, { 
    headers: { 'Content-Type': 'text/html' } 
  });
});

// Export handler
export default {
  fetch: router.handle
};
