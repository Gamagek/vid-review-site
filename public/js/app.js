const ADMIN_PASSWORD = prompt('Admin Password:') || '';
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

let currentPage = 1;
let selectedCategory = '';
let selectedSubcategory = '';
let carouselIndex = 0;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  loadFeaturedVideos();
  loadAllVideos();
  setupFilters();
  setupCarousel();
});

// Setup filters
function setupFilters() {
  const primaryFilter = document.getElementById('primaryFilter');
  const subcategoryFilter = document.getElementById('subcategoryFilter');

  primaryFilter.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
    updateSubcategories();
    currentPage = 1;
    loadAllVideos();
  });

  subcategoryFilter.addEventListener('change', (e) => {
    selectedSubcategory = e.target.value;
    currentPage = 1;
    loadAllVideos();
  });
}

function updateSubcategories() {
  const subcategoryFilter = document.getElementById('subcategoryFilter');
  subcategoryFilter.innerHTML = '<option value="">All Subcategories</option>';

  if (selectedCategory && CATEGORIES[selectedCategory]) {
    CATEGORIES[selectedCategory].forEach(sub => {
      const option = document.createElement('option');
      option.value = sub;
      option.textContent = sub;
      subcategoryFilter.appendChild(option);
    });
  }
}

// Load featured videos for carousel
async function loadFeaturedVideos() {
  try {
    const response = await fetch('/api/videos?limit=5');
    const data = await response.json();

    if (data.success && data.data.length > 0) {
      const carousel = document.getElementById('mainCarousel');
      carousel.innerHTML = '';

      data.data.forEach((video, index) => {
        const slide = document.createElement('div');
        slide.className = `carousel-slide ${index === 0 ? 'active' : ''}`;
        slide.innerHTML = `<iframe src="${video.video_url}" allowfullscreen loading="lazy"></iframe>`;
        carousel.appendChild(slide);
      });
    }
  } catch (error) {
    console.error('Failed to load featured videos:', error);
  }
}

// Load all videos
async function loadAllVideos() {
  try {
    let url = `/api/videos?page=${currentPage}`;
    if (selectedCategory) url += `&category=${selectedCategory}`;
    if (selectedSubcategory) url += `&subcategory=${selectedSubcategory}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      const grid = document.getElementById('videosGrid');
      grid.innerHTML = '';

      data.data.forEach(video => {
        const tile = createVideoTile(video);
        grid.appendChild(tile);
      });
    }
  } catch (error) {
    console.error('Failed to load videos:', error);
  }
}

// Create video tile
function createVideoTile(video) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  
  tile.innerHTML = `
    <div class="video-thumbnail">
      <img src="${video.thumbnail_url}" alt="${video.title}" loading="lazy">
    </div>
    <div class="video-content">
      <span class="category-badge">${video.primary_category}</span>
      <h3 class="video-title">${video.title}</h3>
      <p class="video-description">${video.description || 'No description available'}</p>
      
      <div class="video-meta">
        <span>👁️ ${video.views} views</span>
        <span>❤️ ${video.reactions} reactions</span>
      </div>

      <div class="reactions-container">
        <button class="reaction-btn" onclick="addReaction(${video.id})">👍 Like</button>
        <button class="reaction-btn" onclick="addReaction(${video.id})">😍 Love</button>
        <button class="reaction-btn" onclick="addReaction(${video.id})">🔥 Fire</button>
      </div>

      <div class="quick-comment">
        <input type="text" placeholder="Quick comment..." id="comment-${video.id}">
        <button onclick="addComment(${video.id})">Post</button>
      </div>
    </div>
  `;

  tile.addEventListener('click', () => {
    window.location.href = `/video/${video.id}`;
  });

  return tile;
}

// Add reaction
async function addReaction(videoId) {
  try {
    await fetch(`/api/videos/${videoId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction_type: 'like' })
    });
    loadAllVideos();
  } catch (error) {
    console.error('Failed to add reaction:', error);
  }
}

// Add comment
async function addComment(videoId) {
  const input = document.getElementById(`comment-${videoId}`);
  const text = input.value.trim();

  if (!text) return;

  try {
    await fetch(`/api/videos/${videoId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'Anonymous', text })
    });
    input.value = '';
    loadAllVideos();
  } catch (error) {
    console.error('Failed to add comment:', error);
  }
}

// Setup carousel navigation
function setupCarousel() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');

  prevBtn.addEventListener('click', () => {
    carouselIndex = (carouselIndex - 1 + 5) % 5;
    updateCarousel();
  });

  nextBtn.addEventListener('click', () => {
    carouselIndex = (carouselIndex + 1) % 5;
    updateCarousel();
  });
}

function updateCarousel() {
  const slides = document.querySelectorAll('.carousel-slide');
  slides.forEach((slide, index) => {
    slide.classList.remove('active');
    if (index === carouselIndex) {
      slide.classList.add('active');
    }
  });
}
