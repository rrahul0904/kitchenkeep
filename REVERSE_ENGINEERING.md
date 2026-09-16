# Reverse-engineering notes

## Publicly observed promise

The referenced SideProject post describes MiamBot as one place to store and clean recipes from YouTube, TikTok, Instagram, blogs, photos and PDFs; extract ingredients and instructions; provide a screen-awake Cook Mode; plan meals; and aggregate ingredients into a grocery list.

The author also stated in the Reddit discussion that `yt-dlp` is used for video import in the original product. KitchenKeep does not copy that implementation; its YouTube adapter reads public page metadata and caption tracks where available.

## Product loop

**Capture → Extract → Normalize → Save → Plan → Shop → Cook**

The durable technical challenge is resilient source ingestion plus ingredient identity/quantity normalization. Grocery aggregation makes normalization failures obvious: “scallions” and “green onions” should not become two shopping-list items.

## v0.2 implemented boundary

Repository-certified:

- Recipe URL import with JSON-LD first and readable-text fallback.
- Public YouTube description/caption extraction when caption tracks are exposed.
- Public social/web fallback through fetched page content.
- Pasted text and text-like file imports.
- Basic digital PDF text extraction.
- Optional multimodal AI extraction for images and difficult/scanned PDFs.
- Provenance and extraction confidence metadata.
- Recipe save/search/scale/export/delete.
- Weekly planner → alias-aware grocery aggregation.
- Cook Mode + Screen Wake Lock.
- Responsive PWA shell and offline app assets.
- Release health check, Docker/Railway configuration, CI tests and smoke boot.

## Important truthful limitations

- Instagram/TikTok websites frequently restrict automated access. The adapter is best-effort for public pages and intentionally does not bypass authentication or platform controls.
- YouTube extraction depends on the video exposing a usable public caption track or enough recipe content in the description. AI fallback can improve caption/description normalization but does not download restricted video media.
- Basic built-in PDF extraction handles common text PDFs; scanned/complex PDFs rely on optional AI media extraction.
- Image extraction requires `OPENAI_API_KEY` because this repository intentionally avoids shipping a large browser OCR model.
- Current user data is browser-local. There is no account/cloud-sync layer yet; that is not required for the single-user MVP demonstrated by the source post, but it would be the next step for multi-device households.

## Release gate

A release is truthful when:

1. `npm run check` passes.
2. Local browser verification passes on Recipes, Planner, Groceries, import modal and Cook Mode.
3. GitHub exact-head CI passes.
4. Deployment `/api/health` returns `ok: true`.
5. Live homepage and one non-AI import path are verified.
6. Image/scanned-PDF support is only claimed on environments where `OPENAI_API_KEY` is configured.
