# Gemini Chat → Google Drive → Vid.Best review import

## Purpose
An administrator can ask Gemini to analyze a specific video, save the resulting structured JSON in Google Drive, and import it to Vid.Best after editorial verification. This is **not** automatic access to private Gemini chat history. Google Drive access must be connected and authorized separately; ChatGPT can read a connected file and use the import endpoint only when its authenticated admin credentials are available.

## Gemini prompt
Analyze the ACTUAL linked YouTube video, not its title or thumbnail alone. Return precise scene descriptions in chronological order, distinguish observations from guesses, and identify inaccessible video explicitly. Produce original English commentary, at least three substantive headings, and SEO fields. Return ONLY the JSON object described below. Do not invent dialogue, scene timestamps, or details. Set analysis.accessible=false when unable to view.

## JSON file template
```json
{
  "video_id": 395,
  "source_url": "https://www.youtube.com/shorts/DX9n4qhXBc0",
  "analysis": {
    "accessible": true,
    "observed_scenes": ["First verified scene with timestamp", "Second verified scene with timestamp", "Third verified scene with timestamp"],
    "uncertainty": [],
    "review": "Full original review based on actual observed scenes, at least 650 characters."
  },
  "description": "Unique short listing description",
  "review_text": "Original 650+ character detailed review with 3+ subheadings and source-grounded commentary.",
  "seo_title": "Specific review SEO title",
  "seo_description": "Unique search description",
  "seo_tags": "relevant, source-grounded, tags",
  "commit": false,
  "editorial_verified": false
}
```

The sample ID and URL are illustrative and must be checked against the database before use. Never set `accessible:true` without video evidence.

## Import workflow
1. Save each Gemini analysis as a JSON file in a Google Drive folder (e.g. `VidBest/Gemini-Reviews/`). Connect Google Drive to ChatGPT and authorize access.
2. Match each `video_id` and `source_url` to the exact Vid.Best record.
3. POST JSON to `/api/admin/gemini-review-import` using an authenticated administrator session. The default `commit:false` returns a preview; it **does not update D1**.
4. Check observations and SEO for accuracy. Set `commit:true` and `editorial_verified:true` only after reviewing the evidence. Send the same POST again to update D1.
5. Verify the result and public watch page. The importer never changes `created_at`, `published`, `slug`, views, or reactions. It refuses to overwrite reviews already >=600 characters unless `override_existing:true` is explicitly provided.

### Safety
This endpoint is admin-only. Never put admin keys in Drive files, public browser scripts, or GitHub. A Drive share URL alone is not a trustworthy webhook. There is no automatic Drive polling or unattended publishing. Failed verification should remain a draft. Source URL matching prevents importing a review to a different YouTube video.
