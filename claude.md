# CLAUDE.md

How to build this app: the workflow, the rules and the goals. Design comes first; the system must scale from day one.

## Goals

1. **People understand it without being taught.** Someone non-technical finishes the main task on the first try, on a phone, without reading anything.
2. **It looks made by a person, not a template.** One clear visual idea, a deliberate palette and real typography. No generic "AI startup" look.
3. **It works end to end before it gets polished.** A thin, real, deployed flow beats a beautiful mockup.
4. **It scales by design, not by rewrite.** Stateless servers, managed storage and database, and limits enforced in code. Moving from a free tier to production changes config, not architecture.
5. **Be honest about status.** Everything claimed as done has been run and verified. Everything skipped is listed.

## Workflow

Work through these phases in order. Don't start a phase until the one before it has produced its output.

### 1. Understand (before any code)
- Restate the product in one sentence: who it is for, what they do, and what they get.
- List the **core promises** the user must feel, at most three. Every screen should prove one of them.
- Write down the hard constraints: deadline, budget (free tiers?), devices, data sensitivity.
- Ask only questions whose answers change what gets built. For everything else, pick a sensible default and state it.

### 2. Plan the design (design consultation)
- Pick **one visual concept** (a metaphor, a material, a mood) and name it. Every later choice must fit it.
- Generate **3–4 distinct directions** before committing: palette, type pairing, hero idea and motion style for each. Show them side by side (simple HTML pages are fine). The user picks one; record why.
- Lock a **design system** before building screens:
  - Colour tokens on `:root`: background levels (2–3), ink, dim ink, **one** primary accent, one secondary, one danger. A dark/light pair if both are needed.
  - Typography: one display face with personality and one clean body face (plus mono for numbers and code). A fixed type scale.
  - Spacing scale (4/8-based), radius scale and shadow/glow levels.
  - Motion: durations (fast 150 ms, base 300 ms, slow 600 ms+), one easing curve, and when motion is allowed (feedback, state change, delight moments). Respect `prefers-reduced-motion`.
  - Components: button (primary / secondary / danger), input, card, status pill, progress, toast, empty and error states.
- Write the **screen flow** as a storyboard: every state of every screen (idle, loading, success, error, expired, offline, too many requests). Unplanned states are where apps feel broken.

### 3. Plan the engineering (engineering review)
- Sketch the architecture: clients → API → database / object storage / queue. Mark what is stateful.
- Define the **data model** and the **API contract** (routes, request/response shapes, error codes) before the UI uses them.
- Identify the **critical invariants** (e.g. "only N users may join", "a resource is consumed exactly once") and enforce them in the database with transactions and row locks, never only in the UI.
- Decide the limits up front: rate limits, size caps, quotas, timeouts, retention/expiry. Put them in config with env overrides.
- Write the threat model / failure list: what happens if the server restarts mid-flow, the network drops, a user double-clicks, two tabs open, or a request is retried.
- Run a review pass on the plan (eng + design) and fix what it finds **before** building.

### 4. Build in vertical slices
- **Slice 1:** the ugliest possible working path through the core flow, deployed to a real URL.
- **Slice 2:** apply the design system to that path.
- **Slice 3 onwards:** add states, edge cases, animations and secondary features, one at a time, each verified before the next.
- After each slice, run tests, open the app in a real browser at **phone width and desktop width**, and click through the flow.
- If time is short, cut scope, not quality. Keep a running "skipped / not done" list and report it.

### 5. Verify
- Automated: unit tests for core logic and the protocol; API tests for every route, including limits and race conditions (fire concurrent requests at the invariants).
- Manual: the full flow on **two real devices** over the public URL, not localhost.
- Visual: screenshots at 375 px and 1440 px; check overflow, alignment, contrast and the focus states.
- Measure the production build: memory use of the server and bundle size of the client.

### 6. Ship
- One command to run locally (`dev`) and one to run a public demo (build + serve + tunnel).
- Before starting a server, check whether the port is already taken. Fail clearly; never silently start a second copy.
- Deploy config lives in the repo (`render.yaml`, `vercel.json`, Dockerfile, etc.). Set the root directory and framework preset explicitly.
- A health endpoint (`/healthz`), used by the platform and by the post-deploy check.
- Write a README covering: what it is, how to run it, how to deploy it, env vars and limits.

## Design rules

- **One accent colour does the work.** Use it for the primary action and the key moment only. Everything else stays neutral.
- **One hero idea per screen.** One big thing, one primary button. Secondary actions are visibly secondary.
- **Words are UI.** Use plain verbs on buttons ("Send files", not "Submit"). Say what happened and what to do next. No jargon in the main flow; put technical detail behind a "how it works" link.
- **Avoid AI-template tells:**
  - generic gradients;
  - three-icon feature rows;
  - emoji bullets;
  - accent bars and underlines under titles;
  - "Unlock the power of…" copy;
  - perfectly symmetric card grids everywhere.
- **Motion has a job.** It explains a state change, shows progress or rewards completion. Keep the signature animations; never block input waiting on one.
- **Mobile first.** Design at 375 px, then scale up. Use a 16 px side gutter, tap targets of at least 44 px and no horizontal scroll. Test with a real thumb.
- **Fast first paint.** Defer heavy effects (WebGL, canvas) until after the content is usable; give them a cheap fallback and pause them when off-screen.
- **Accessible by default.** WCAG AA contrast, visible focus, labelled controls, keyboard paths, and reduced motion.
- **Every async action has four states:** idle, working (with progress where possible), done and failed (with a retry).
- **Danger looks dangerous.** Destructive or security-critical states get the danger colour, clear copy and a confirmation.
- **Stay consistent.** Every colour, size and spacing value comes from the tokens. No one-off hex values in components.

## Engineering rules for scale

- **Large data goes straight to object storage.** Use presigned URLs (S3/R2/GCS) and multipart uploads in fixed-size parts. App servers never proxy big bodies.
- **Choose the database deliberately.** Use managed Postgres. Embedded databases are for tests only (they are memory-hungry and single-instance). Use migrations from day one.
- **Correctness in the database.** Use transactions, `SELECT … FOR UPDATE` and unique constraints for invariants. Make writes idempotent where clients may retry.
- **Background work is explicit.** Sweepers, expiry and cleanup run as scheduled jobs, safe to run on many instances (use locks or `SKIP LOCKED`).
- **Plan for realtime that degrades.** Use SSE/WebSockets when available, plus polling as a fallback. Proxies and tunnels often buffer streams.
- **Limits everywhere.** Rate limits per IP/user, body size caps, per-resource quotas and global budgets. Return clear 429/413 errors that the UI turns into human messages.
- **Config from the environment.** All tunables live in one config module with defaults. Secrets live only in server env vars, never in client bundles, the repo or logs.
- **Security headers and CSP** from the first deploy. Validate every input at the API boundary with a schema.
- **Observability.** Structured logs with request IDs, a health check and basic metrics (latency, error rate, active resources).
- **Keep the frontend lean.** Use a small framework (or none) unless the app genuinely needs one. Code-split heavy features. Use service workers only where they add capability (offline, streaming).

## Working rules (for Claude)

- Plan → review → build → verify → report. Don't skip the review step to save time; it is the cheapest place to fix mistakes.
- Read existing code before changing it, and match its style.
- After any UI change, look at it in a browser at phone and desktop widths before calling it done.
- Never claim "working" without running it. Report failures with the actual error output.
- Before killing processes, freeing ports or deleting files, check what they are. They may belong to the user.
- When a deploy path fails twice, stop and switch to the simplest path that works (e.g. a tunnel or a single-service deploy). Explain the trade-off.
- Keep a `DOCUMENTATION.md` current with the architecture, flows, limits and env vars.
- End each work session with:
  - what was built;
  - how it was verified;
  - what was skipped;
  - the live URLs and limits.
