# MyNiyam landing page

The public front page for MyNiyam. One static HTML file, no build step, no framework.

- `index.html` holds the page, its styles and a small script.
- `brand/` holds the wordmark and the folded-hands mark, cut from `MyNiyam_logo.png`, plus the app icons.

## Run it

```bash
python -m http.server 4100 --directory landing
```

Then open http://localhost:4100.

## Point the join button at the app

The join form checks the pathshala code (exactly 6 letters or numbers). When the page is opened on localhost it sends people to the local join app at http://localhost:3100/join?code=CODE. Anywhere else, until an app URL is set, it tells people the app opens soon.
When the app has a URL, add this line above the page's main `<script>`:

```html
<script>window.MYNIYAM_APP_URL = "https://your-app-url";</script>
```

The form then opens `<app>/join?code=HEER01`. "Set up your pathshala" only shows a message, because the app has no setup page yet.

## Design notes

- Every load opens with a short intro (about 3 seconds): the wordmark writes itself in, the red dot drops onto the i, then grows into the sun and the page appears. A tap or key press skips it, and it never plays when the phone asks for reduced motion.
- In the evening colours the navy of the logo turns cream (`brand/wordmark-night.png`, `brand/mark-night.png`).
- On phones a "Join your pathshala" bar stays at the bottom once the first button scrolls away.

- Colours, fonts (Baloo 2 for headings, Mukta for body and Hindi) and the Panch Parmeshti category colours come from the MyNiyam plan.
- After about 6:45 PM local time the page switches to the Raat (Pratikraman) colours. The sun and moon button overrides it and remembers the choice.
- The phone shows the real home screen and loops one tap: Riya finishes her third Navkar mala. The loop pauses off screen and is replaced by a still image when the phone asks for reduced motion.
