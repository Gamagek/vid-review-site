const ADMIN_PASSWORD = localStorage.getItem('adminPassword') || '';
const CATEGORIES = {
  'Entertainment': ['Movie Trailers', 'Film Reviews', 'Gameplay', 'Esports', 'Anime', 'Pop Culture'],
  'Lifestyle': ['Workout Routines', 'Nutrition', 'Mental Health', 'Mindfulness', 'Daily Vlogs', 'Fashion'],
  'Environment': ['Renewable Energy', 'Electric Vehicles & E-Bikes', 'Wildlife', 'Zero Waste', 'Eco-Tech'],
  'Technology': ['AI & Machine Learning', 'Gadget Reviews', 'Software', 'Web Development', 'Cybersecurity', 'Tech News'],
  'Food': ['Quick Recipes & Meal Prep', 'Street Food', 'Baking & Pastry', 'Restaurant & Product Reviews', 'Healthy Meals', 'Chef Secrets'],
  'Education': ['Tutorials', 'Science & History', 'Language Learning', 'Online Courses', 'Academic Lectures', 'Buddhist Studies'],
  'Comedy': ['Skits', 'Stand-Up', 'Pranks', 'Memes', 'Bloopers'],
  'Music': ['Music Videos', 'Live Performances', 'Instrument Tutorials', 'Cover Songs', 'Lo-Fi'],
  'Arts': ['Digital Art', 'Painting', 'Architecture', 'Photography', 'Literature'],
  'Adventure': ['Solo Travel', 'Camping', 'Extreme Sports', 'Travel Guides', 'Road Trips'],
  'Business': ['Startups', 'Personal Finance', 'E-Commerce', 'Crypto', 'Economy News'],
  'Social': ['YouTube Trends', 'TikTok Viral', 'Facebook Reels', 'Instagram Reels', 'Creator News']
};

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupForm();
  loadRecentVideos();
  setupCategoryFilter();
});

function checkAuth() {
  const password = prompt('Enter Admin Password:');
  if (!password) {
    window.location.href = '/';
    return;
  }
  localStorage.setItem('adminPassword', password);
}

function setupCategoryFilter() {
  document.getElementById('primaryCategory').addEventListener('change', (e) => {
    const subcategorySelect = document.getElementById('subcategory');
    subcategorySelect.innerHTML = '<option>Select Subcategory</option>';

    if (CATEGORIES[e.target.value]) {
      CATEGORIES[e.target.value].forEach(sub => {
        const option = document.createElement('option');
        option.value = sub;
        option.textContent = sub;
        subcategorySelect.appendChild(option);
      });
    }
  });
}

function setupForm() {
  document.getElementById('videoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveVideo();
  });

  document.getElementById('generateBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await generateSEOContent();
  });
}

async function generateSEOContent() {
  const title = document.getElementById('videoTitle').value;
  const category = document.getElementById('primaryCategory').value;
  const subcategory = document.getElementById('subcategory').value;

  if (!title || !category || !subcategory) {
    showStatus('Please fill in title and categories first', 'error');
    return;
  }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  try {
    const response = await fetch('/api/generate-seo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminPassword')}`
      },
      body: JSON.stringify({ title, category, subcategory })
    });

    if (!response.ok) throw new Error('Failed to generate content');

    const data = await response.json();
    document.getElementById('seoDescription').value = data.seo_description;
    document.getElementById('seoTags').value = data.seo_tags;
    document.getElementById('reviewText').value = data.review_text;

    showStatus('✨ AI content generated successfully!', 'success');
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Generate SEO Content & Review';
  }
}

async function saveVideo() {
  const videoUrl = document.getElementById('videoUrl').value;
  const title = document.getElementById('videoTitle').value;
  const description = document.getElementById('videoDescription').value;
  const primaryCategory = document.getElementById('primaryCategory').value;
  const subcategory = document.getElementById('subcategory').value;
  const seoDescription = document.getElementById('seoDescription').value;
  const seoTags = document.getElementById('seoTags').value;
  const reviewText = document.getElementById('reviewText').value;

  if (!videoUrl || !title || !primaryCategory || !subcategory) {
    showStatus('Please fill in all required fields', 'error');
    return;
  }

  try {
    const response = await fetch('/api/videos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminPassword')}`
      },
      body: JSON.stringify({
        video_url: videoUrl,
        title,
        description,
        primary_category: primaryCategory,
        subcategory,
        seo_description: seoDescription,
        seo_tags: seoTags,
        review_text: reviewText
      })
    });

    if (!response.ok) throw new Error('Failed to save video');

    document.getElementById('videoForm').reset();
    showStatus('✅ Video saved successfully!', 'success');
    loadRecentVideos();
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
}

function showStatus(message, type) {
  const el = document.getElementById('statusMessage');
  el.textContent = message;
  el.className = `status-message ${type}`;
  setTimeout(() => {
    el.className = 'status-message';
  }, 5000);
}

async function loadRecentVideos() {
  try {
    const response = await fetch('/api/videos?limit=5');
    const data = await response.json();

    const list = document.getElementById('recentList');
    list.innerHTML = '';

    if (data.success && data.data.length > 0) {
      data.data.forEach(video => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        item.innerHTML = `
          <div class="title">${video.title}</div>
          <div class="meta">${video.primary_category} • ${video.subcategory}</div>
          <div class="meta">Views: ${video.views} | Reactions: ${video.reactions}</div>
        `;
        list.appendChild(item);
      });
    }
  } catch (error) {
    console.error('Failed to load recent videos:', error);
  }
}
