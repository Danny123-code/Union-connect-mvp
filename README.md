# Union Connect — MVP

Vendor operations platform: dashboard, vendors, operations (invoices/POs/shipments/contracts/tasks/quotes), and vendor messaging. Backed by a real API and a persisted database — no more hardcoded demo data. Approvals, new operations, new vendors, and messages all persist.

## Stack

- Node.js + Express (REST API, serves the frontend)
- A single JSON file as the database (`server/db.js`), written atomically on every change — no native modules, so `npm install` never depends on compiling code or downloading prebuilt binaries on the deploy host. This is the fastest thing to deploy anywhere Node runs. Swap it for real Postgres/SQLite later if you outgrow it (unlikely before a few thousand records) — `server/db.js` is a thin data-access layer, so the swap doesn't touch `server/index.js` much.
- Plain HTML/CSS/JS frontend (no build step)

Single-tenant, no login yet (by design, for fastest MVP launch — see "Adding auth" below).

## Run it locally (1 command after install)

```bash
npm install
npm start
```

Open http://localhost:3000. The database is created and seeded automatically on first run at `data/union-connect.json`.

## Run it with Docker

```bash
docker build -t union-connect .
docker run -p 3000:3000 -v union-connect-data:/data union-connect
```

The `-v` flag gives you a named volume so your data survives container restarts.

## Deploy it live — fastest options

### Option A: Railway (recommended, ~5 min)
1. Push this folder to a new GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo → select the repo.
3. Railway auto-detects the Dockerfile and builds it.
4. Add a Volume (Railway dashboard → your service → Volumes) mounted at `/data` so the database file persists across deploys.
5. Set env var `PORT=3000` (Railway sets this automatically, but the app already respects `process.env.PORT`).
6. Deploy. You'll get a public `*.up.railway.app` URL immediately.

### Option B: Render
1. Push to GitHub, then New → Web Service → connect the repo.
2. Render detects the Dockerfile automatically.
3. Add a Disk (Render dashboard → your service → Disks) mounted at `/data` for persistence (requires a paid instance type; free tier has no persistent disk, so the DB resets on redeploy — fine for a quick demo, not for real usage).
4. Deploy. You get a public `*.onrender.com` URL.

### Option C: Fly.io
1. `fly launch` in this directory (it will detect the Dockerfile).
2. `fly volumes create data --size 1` then mount it at `/data` in `fly.toml`.
3. `fly deploy`.

Any of these gets you a real public URL with a working backend in well under 15 minutes.

## API reference

All endpoints are JSON. Most take `industry` as a query param or body field: `food`, `manufacturing`, `logistics`, `retail`, `construction`, `tech`.

- `GET /api/industries`
- `GET /api/vendors?industry=food`
- `POST /api/vendors` `{ industry, name, type, rating, active }`
- `GET /api/operations?industry=food`
- `POST /api/operations` `{ industry, type, title, vendor, vendor_id, amount, desc }`
- `PATCH /api/operations/:industry/:id` `{ status }`
- `GET /api/messages?industry=food&vendorId=fs`
- `POST /api/messages` `{ industry, vendorId, msg, sender, fromName }`
- `GET /api/documents?industry=food&vendorId=fs`
- `POST /api/documents` `{ industry, vendorId, name, size }`
- `GET /api/dashboard?industry=food` — pending + recent operations, vendor count

## What's real vs. what's still a stub

Real and persisted: vendors, operations (create + status changes/approve), messages, documents metadata. All survive server restarts and are shared across anyone hitting the deployed URL.

Still stubbed for MVP speed: document *upload* (only metadata rows, no file storage/S3 yet), no authentication (anyone with the URL has full access), no email/