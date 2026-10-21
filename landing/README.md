# MyNiyam landing page

The landing page now lives inside the app, so it is served at the site's root (`/`), for example https://myniyam.vercel.app.

- The page: `app/public/landing.html` (one static HTML file: its styles and a small script).
- Its images: `app/public/brand/`.
- `app/next.config.ts` serves it at `/` for visitors, and sends signed-in members from `/` to `/home`.

## Run it

Start the app (`npm run dev` inside `app/`) and open http://localhost:3100.
