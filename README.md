# Union Connect — MVP

Vendor operations platform for small-to-mid-size businesses: dashboard, vendors, operations (invoices/POs/shipments/contracts/tasks/quotes), and vendor messaging. Multi-tenant with real authentication — each company that signs up gets its own private, isolated workspace. Backed by a real API and a persisted database, no hardcoded demo data.

## Stack

- Node.js + Express (REST API, serves the frontend)
- A single JSON file as the database (`server/db.js`), written atomically on every change — no native modules, so `npm install` never depends on compiling code or downloading prebuilt binaries on the deploy host.
- Auth via Node's built-in `crypto` module only (`server/auth.js`) — scrypt password hashing, opaque session tokens, hand-rolled cookie parsing. No bcrypt, no jsonwebtoken, no cookie-parser.
- Email via Node's built-in `fetch` calling the Resend HTTP API directly (`server/email.js`) — no email SDK dependency.
- Dependency list: `cors`, `express`, `multer` (file uploads), `nanoid`. All pure JS, nothing that needs native compilation, which is what's made this reliable to deploy from the start.
- Plain HTML/CSS/JS frontend (no build step)

## How accounts work

Anyone can sign up and create a new company workspace (pick a name + industry). The first person to sign up for a company becomes its **admin**. Admins can approve pending operations and add/manage teammates. Admins can invite additional teammates as either **admin** or **member** — members can view everything, message vendors, and create new operations, but cannot approve them.

Each company's vendors, operations, messages, and documents are completely private to that company — other companies signing up never see each other's data. At signup, you pick from 17 industries (the list ends with "Other"). The original 6 — Food & Beverage, Manufacturing, Logistics & Transportation, Retail, Construction, Technology — seed the new workspace with realistic demo data so it's not an empty screen on day one; the other 11 start with an empty workspace. Everything from there on is real and editable.

## Run it locally (1 command after install)

```bash
npm install
npm start
```

Open http://localhost:3000, click "Create one" to sign up a company, and you're in. The database is created automatically on first run at `data/union-connect.json`.

## Run it with Docker

```bash
docker build -t union-connect .
docker run -p 3000:3000 -v union-connect-data:/data union-connect
```

The `-v` flag gives you a named volume so your data survives container restarts.

## Deploy it live — fastest options

### Option A: Railway (recommended, ~5 min)
1. Push this folder to a GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo → select the repo.
3. Railway auto-detects the Dockerfile and builds it. Do **not** add a `VOLUME` line back into the Dockerfile — Railway rejects that instruction at build time.
4. Add a Volume (Command palette → New Volume, or right-click the project canvas) attached to this service, mount path `/data`, so the database file persists across deploys.
5. Deploy, then Settings → Networking → Generate Domain to get a public `*.up.railway.app` URL.

### Option B: Render
1. Push to GitHub, then New → Web Service → connect the repo.
2. Render detects the Dockerfile automatically.
3. Add a Disk mounted at `/data` for persistence (requires a paid instance type; free tier has no persistent disk, so the DB resets on redeploy).
4. Deploy. You get a public `*.onrender.com` URL.

### Option C: Fly.io
1. `fly launch` in this directory (it will detect the Dockerfile).
2. `fly volumes create data --size 1` then mount it at `/data` in `fly.toml`.
3. `fly deploy`.

## Email (Resend)

Welcome emails (on signup) and password-reset emails are sen