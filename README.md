# RentFlow

**Enterprise event equipment & tent rental management** — inventory, bookings, deposits, dispatch, returns, payments, settlements, and reports in one system.

Currency is **ETB**. Staff use a React web app; customers can submit payment proof over **Telegram**. Optional email shares settlement PDFs.

---

## Table of contents

1. [Product overview](#product-overview)
2. [Money & rental workflow](#money--rental-workflow)
3. [Tech stack](#tech-stack)
4. [Repository layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [Quick start](#quick-start)
7. [Push to GitHub (you run these)](#push-to-github-you-run-these)
8. [Free deployment (Vercel + Render + Neon)](#free-deployment-vercel--render--neon)
9. [Environment variables](#environment-variables)
10. [Demo accounts & seed data](#demo-accounts--seed-data)
11. [UI modules](#ui-modules)
12. [Roles (RBAC)](#roles-rbac)
13. [API map](#api-map)
14. [Integrations](#integrations)
15. [Background jobs](#background-jobs)
16. [Security](#security)
17. [Ports](#ports)
18. [Troubleshooting](#troubleshooting)

---

## Product overview

RentFlow helps a rental shop run day-to-day operations:

| Area | What it covers |
|------|----------------|
| **Inventory** | Items, condition (good / semi / damaged), rates, late & damage fees, stock adjustments |
| **Customers** | Profiles, KYC upload, rating (low rating → higher collateral), Telegram link |
| **Bookings** | Calendar & list, availability checks, collateral tiers, deposit gate before dispatch |
| **Returns** | Check-in by condition, damage fees, settlement, collect rental, deposit refund |
| **Payments** | Record / approve payments, Telegram proof review, official PDF receipts |
| **Reports** | Revenue charts, KPI insights, Excel exports (inventory snapshot + payment log) |
| **Settings** | Collateral tiers, policies, staff users (admin), audit logs with retention |

---

## Money & rental workflow

The intended cash flow is fixed and enforced in the UI and API:

```
1. Collect security deposit  →  2. Print lease / dispatch
        ↓
3. Return check-in (condition + damage)  →  4. Collect rental (after return)
        ↓
5. Refund leftover deposit (only after return)
```

### Step detail

1. **Create booking** — Customer, dates, line items, collateral tier (`low` / `medium` / `higher`) or explicit deposit. Low customer rating can raise deposit via `low_rating_collateral_multiplier`.
2. **Deposit** — Record `collateral_deposit` (cash / bank_transfer / telebirr). Managers/admins may auto-approve; cashiers create pending payments that need approval.
3. **Dispatch** — Status can move to `out_for_rent` only when the deposit is fully paid. Lease / work-order PDF is available after deposit.
4. **Return** — Staff record good / semi-damaged / damaged quantities. Damage fees are added to the booking total. Status → `returned`.
5. **Settlement** — System applies held deposit to unpaid rental when appropriate, then supports collecting remaining rental and queuing a deposit refund.
6. **Refund** — Deposit refunds are **blocked until the booking is returned**. Approve/confirm after check-in.

Client-facing **settlement PDF** summarizes charges, deposit story, and how the bill was paid (printable / shareable via Telegram or email).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js **≥ 24** (recommended; Express 5 async error handling) |
| **API** | Express.js 5 (MVC), `pg`, JWT in **HTTP-only cookies**, Helmet, rate limits, express-validator, Multer |
| **Database** | PostgreSQL 16 (Docker Compose maps host **5434** → container 5432) |
| **Realtime** | Socket.io (dashboard / stock / overdue alerts; same auth cookie) |
| **In-process** | `node-cache` (inventory GET cache), `node-cron` (overdue, due-soon, audit archive) |
| **Frontend** | React 19, Vite 8, Tailwind CSS 4, React Router 7, Axios, Lucide, Recharts, dayjs |
| **Docs / export** | PDFKit (receipts, lease, settlement), ExcelJS |
| **Messaging** | `node-telegram-bot-api` (customer bot + manager alerts), Nodemailer (optional SMTP) |

> **Not used:** Redis / BullMQ. Caching and scheduled jobs run inside the API process.

---

## Repository layout

```
RentFlow/
├── README.md
├── docker-compose.yml          # PostgreSQL 16 on port 5434
├── backend/
│   ├── .env.example
│   ├── package.json            # npm start | npm run dev | npm run migrate
│   ├── scripts/
│   │   ├── migrate.js          # schema + seeds + incremental alters
│   │   └── schema.sql
│   ├── uploads/                # KYC, receipts, barcodes, Excel exports
│   └── src/
│       ├── server.js
│       ├── bots/               # Telegram customer bot
│       ├── config/             # db, cache
│       ├── controllers/
│       ├── jobs/               # overdueScheduler, auditRetention
│       ├── middleware/
│       ├── routes/
│       ├── services/           # pdf, excel, settlement, telegram, email, stock, asyncJobs
│       ├── sockets/
│       └── utils/
└── frontend/
    ├── package.json
    ├── vite.config.js          # :5173, proxies /api and /uploads → :5000
    └── src/
        ├── pages/              # Login, Dashboard, Inventory, Customers, Bookings,
        │                       # Returns, Payments, Reports, Settings
        ├── components/
        ├── context/AuthContext.jsx
        └── lib/                # api, roles, socket, labels
```

---

## Prerequisites

- **Node.js 24 LTS** (or newer ≥ 24)
- **npm**
- **Docker** (recommended for PostgreSQL)

---

## Quick start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Backend — install, configure, migrate

```bash
cd backend
cp .env.example .env    # defaults match docker-compose (port 5434)
npm install
npm run migrate
```

`npm run migrate` applies `schema.sql`, seeds demo users/inventory when empty, and applies incremental changes (e.g. nullable `payments.booking_id` for Telegram open-access payments, audit archive table).

### 3. Run the API

```bash
cd backend
npm run dev
# → http://localhost:5000
# Health: GET http://localhost:5000/api/health
```

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Vite proxies `/api` and `/uploads` to the backend, so the browser talks only to `:5173` in development.

### 5. Optional Telegram & email

In `backend/.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_MANAGER_CHAT_ID=...
TELEGRAM_BOT_USERNAME=YourBotUsername   # optional; used in deep links

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=RentFlow <noreply@example.com>
```

Restart the API after changing env. The customer bot starts automatically when `TELEGRAM_BOT_TOKEN` is set.

---

## Push to GitHub (you run these)

This repo is **not** pushed for you. Create an empty GitHub repository first (no README/license), then run:

```bash
cd /home/abel/my_project/RentFlow

git init
git add .
git status    # confirm .env and uploads are NOT staged
git commit -m "$(cat <<'EOF'
Initial RentFlow app ready for Vercel, Render, and Neon.

EOF
)"

git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Replace `YOUR_USERNAME` / `YOUR_REPO` with your GitHub values.  
Do **not** commit `backend/.env` (it is gitignored).

Later updates:

```bash
git add .
git commit -m "Describe your change"
git push
```

---

## Free deployment (Vercel + Render + Neon)

Target layout:

| Piece | Free host |
|-------|-----------|
| Frontend | **Vercel** |
| Backend API | **Render** (Web Service) |
| Database | **Neon** (Postgres) |

### Important free-tier limits

- **Render free** services **sleep** after idle time (~15 min). First request can be slow; Telegram long-polling may disconnect while asleep.
- **Uploads** (KYC, receipts, PDFs) live on Render’s disk and are **ephemeral** — they can disappear on redeploy/restart. Database data on Neon is durable.
- Neon free has connection limits — keep `DB_POOL_MAX` around `10`.

### 1) Neon database

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the connection string (prefer the one with `sslmode=require`).
3. From your machine (with that URL), migrate once:

```bash
cd backend
DATABASE_URL='postgresql://USER:PASSWORD@HOST/DB?sslmode=require' DB_SSL=true npm run migrate
```

Or open Render Shell later and run `npm run migrate` there with `DATABASE_URL` already set.

### 2) Render backend

1. New → **Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
   - **Node version:** `24` (env `NODE_VERSION=24`)
3. Environment variables:

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon connection string |
| `DB_SSL` | `true` |
| `DB_POOL_MAX` | `10` |
| `JWT_SECRET` | long random string |
| `JWT_EXPIRES_IN` | `8h` |
| `CLIENT_URL` | your Vercel URL, e.g. `https://rentflow.vercel.app` (no trailing slash) |
| `COOKIE_SAMESITE` | `none` |
| `TELEGRAM_BOT_TOKEN` | optional |
| `TELEGRAM_MANAGER_CHAT_ID` | optional |
| `SMTP_*` | optional |

4. Deploy. Note the API URL, e.g. `https://rentflow-api.onrender.com`.
5. Run migrate if you have not already:

```bash
# Render Shell (backend root)
npm run migrate
```

Optional: root `render.yaml` is included for Blueprint deploys; you can still configure the service manually.

### 3) Vercel frontend

1. Import the same GitHub repo in [vercel.com](https://vercel.com).
2. Settings:
   - **Root Directory:** `frontend`
   - **Framework:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Environment variable (Production + Preview):

| Key | Value |
|-----|--------|
| `VITE_API_URL` | `https://your-api.onrender.com` (no `/api`, no trailing slash) |

4. Deploy. Copy the Vercel URL.
5. Go back to Render and set `CLIENT_URL` to that Vercel URL, then **redeploy** the API so CORS + cookies match.

`frontend/vercel.json` rewrites all routes to `index.html` for React Router.

### 4) Local vs production API URL

| Environment | Frontend API calls |
|-------------|--------------------|
| Local Vite | `/api` via proxy → `localhost:5000` (`VITE_API_URL` unset) |
| Vercel | `VITE_API_URL` + `/api`, cookies with `SameSite=None; Secure` |

### 5) Smoke test after deploy

1. Open the Vercel site → login with `admin@rentflow.local` / `Admin123!`
2. Hit `https://YOUR-API.onrender.com/api/health`
3. Create a customer / inventory item and confirm it persists after refresh (Neon)
4. If login fails with cookies blocked: confirm HTTPS on both hosts and `COOKIE_SAMESITE=none` + matching `CLIENT_URL`

---

## Environment variables

From `backend/.env.example` (never commit real secrets):

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` / `production` |
| `PORT` | API port (Render sets this automatically) |
| `CLIENT_URL` | Frontend origin for CORS + cookies (Vercel URL in prod) |
| `COOKIE_SAMESITE` | Set `none` for Vercel ↔ Render cross-site cookies |
| `DATABASE_URL` | Neon (or any) Postgres URL — preferred in production |
| `DB_SSL` | `true` for Neon / managed SSL |
| `DB_POOL_MAX` | Pool size (use `10` on Neon free) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Local Docker alternative to `DATABASE_URL` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth cookie JWT (default expiry `8h`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MANAGER_CHAT_ID` | Optional bot + manager alerts |
| `TELEGRAM_BOT_USERNAME` | Optional; deep-link username |
| `SMTP_*` | Optional email for sharing settlement PDFs |
| `UPLOAD_MAX_MB` | Max upload size (default `10`) |
| `AUDIT_LOG_RETENTION_DAYS` | Hot audit retention before archive (default **90**) |

**Frontend (Vercel):**

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Render API origin, e.g. `https://rentflow-api.onrender.com` |

Leave `VITE_API_URL` unset for local `npm run dev` (Vite proxy).

---

## Demo accounts & seed data

**Password for all seeded users:** `Admin123!`

| Email | Role | Access |
|-------|------|--------|
| `admin@rentflow.local` | admin | Full access (users, policies, inventory delete, deposit overrides) |
| `manager@rentflow.local` | manager | Ops + reports + payment approval + audit; no user admin |
| `cashier@rentflow.local` | cashier | Front desk (UI label: **Agent**); record payments, no approve / no reports |

**Sample inventory** (seeded only if the inventory table is empty): party tent, banquet chairs, round table, LED lights, portable sound system — with rates, buffer hours, damage and late fees.

No customers or bookings are seeded.

---

## UI modules

1. **Login** — Premium staff sign-in; demo role shortcuts on the login card  
2. **Dashboard** — Revenue / ops snapshot, overdue & recent activity, Socket alerts  
3. **Inventory** — Search-as-you-type, pagination (15/page), edit fees, update stock  
4. **Customers** — KYC, ratings, search + pagination (10/page), Telegram link status  
5. **Schedule & Bookings** — Month calendar, status filters, search by name/date, pagination, booking wizard, deposit gate before dispatch, lease print  
6. **Return Equipment** — Check-in by condition, settlement, collect rental, refund, customer settlement PDF  
7. **Payments & Receipts** — Filters (needs payment / waiting approval / refund / all), search + pagination, record payment, review Telegram proofs (TXN + assign booking)  
8. **Reports & Analytics** — Daily / weekly / monthly / annual / custom charts; Excel exports with **Today / This month / This year / Custom** for payment logs; inventory audit = **current stock snapshot**  
9. **Settings & Audit** — Store policies / collateral tiers, staff management (admin), paginated audit logs with period filters and 90-day hot retention  

---

## Roles (RBAC)

| Capability | Admin | Manager | Cashier (Agent) |
|------------|:-----:|:-------:|:---------------:|
| Inventory create / fees / stock | ✓ | ✓ | View only |
| Soft-delete inventory | ✓ | | |
| Customers CRUD | ✓ | ✓ | ✓ (create/edit as allowed) |
| Bookings / returns / record payments | ✓ | ✓ | ✓ |
| Approve / reject payments | ✓ | ✓ | |
| Cancel bookings | ✓ | ✓ | |
| Set deposit override | ✓ | | |
| Reports & Excel | ✓ | ✓ | |
| Settings policies | ✓ | View | View tiers only |
| Manage staff users | ✓ | | |
| Audit logs | ✓ | ✓ | |

---

## API map

Base path: **`/api`**. Auth uses cookie `access_token`.

| Area | Base path | Notes |
|------|-----------|--------|
| Health | `GET /api/health` | Liveness |
| Auth / users | `/api/auth` | `login`, `logout`, `me`; user CRUD **admin only** |
| Inventory | `/api/inventory` | Cached list/get; create/update/adjust manager+; soft-delete admin |
| Customers | `/api/customers` | KYC required on create; soft-delete manager+ |
| Bookings | `/api/bookings` | List, calendar, availability, status, deposit, cancel, work-order PDF |
| Returns | `/api/returns` | Process return, settle, collect-rental, confirm-refund, settlement-pdf, share |
| Payments | `/api/payments` | Create (+ receipt upload); approve/reject **manager+** (can assign booking) |
| Reports | `/api/reports` | Dashboard (all roles); revenue + exports **manager+** |
| Settings / audit | `/api/settings` | Get settings; put key **admin**; audit-logs manager+ |

### Useful report export query params

- `GET /api/reports/export/payments?from=YYYY-MM-DD&to=YYYY-MM-DD` — payment log (calendar days, Africa/Addis_Ababa)
- `GET /api/reports/export/inventory` — full current stock snapshot
- `GET /api/reports/export/customers/:customerId` — customer booking history

---

## Integrations

### Telegram (customer bot)

When `TELEGRAM_BOT_TOKEN` is set:

1. Customer sends **`/start`** — bot auto-links (creates customer from Telegram name if needed; optional deep link `c_<customerUuid>`).
2. Customer sends **photo or PDF** of payment + **amount** + **transaction ID**.
3. API creates a **pending** payment (`booking_id` may be null; `customer_id` set).
4. Staff open **Payments → Review & approve**, verify TXN, **assign a booking**, optionally send official receipt PDF back on Telegram.
5. Managers can receive notify/forward alerts via `TELEGRAM_MANAGER_CHAT_ID`.

Deposit refunds still require the booking to be **returned** before create/approve.

### Email (SMTP)

Used to share settlement PDFs when SMTP vars are configured.

### PDFs

- Official payment receipts  
- Lease / work order (after deposit)  
- Customer settlement summary after return  

### Excel

- **Inventory audit** — current availability, condition, rates, fees  
- **Payment log** — filtered by Today / This month / This year / Custom  

---

## Background jobs

| Job | Schedule | Behavior |
|-----|----------|----------|
| Overdue + late fees | Hourly | Marks overdue bookings, accrues late fees |
| Due-soon reminders | Daily ~08:00 | Telegram reminders for upcoming returns |
| Audit retention | Daily ~03:15 | Moves audit rows older than `AUDIT_LOG_RETENTION_DAYS` (default 90) into `audit_logs_archive` |

PDF / Telegram / email delivery runs as fire-and-forget **async jobs** inside the API (no Redis queue).

### Caching

- Inventory GETs use `node-cache` (TTL ~300s).  
- Cache cleared on inventory create/update/adjust/delete and related booking/return stock changes.

### Concurrency

Booking create uses **`BEGIN ISOLATION LEVEL SERIALIZABLE`** with in-transaction stock recheck to reduce double-booking risk.

---

## Security

- Helmet headers; rate limits on auth and sensitive payment routes  
- Parameterized SQL (`$1`, `$2`, …)  
- express-validator on write endpoints  
- Soft deletes on inventory & customers  
- Audit log for price changes, stock overrides, cancellations, payment approvals, staff changes  
- JWT stored in **HTTP-only** cookies (not `localStorage`)  

---

## Ports

| Service | Port |
|---------|------|
| Frontend (Vite) | **5173** |
| Backend API + Socket.io | **5000** |
| PostgreSQL (Docker host) | **5434** → 5432 in container |

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| API cannot connect to DB | Local: `docker compose ps` + `DB_PORT=5434`. Prod: Neon `DATABASE_URL` + `DB_SSL=true` |
| Login works locally but not on Vercel | `CLIENT_URL` must be the Vercel origin; `COOKIE_SAMESITE=none`; both sites HTTPS; redeploy API after changing env |
| CORS / Network error from UI | `VITE_API_URL` points at Render (no `/api` suffix); Render service is awake |
| Empty payment Excel for a day | Period uses East Africa calendar dates; try **This month** or Custom |
| Uploads / PDFs missing after Render restart | Free disk is ephemeral — re-upload or move files to object storage later |
| Telegram bot silent | Token set; API awake (free Render sleeps); only one poller process |
| Settlement email fails | `SMTP_*` filled correctly |
| Node engine warning | Set `NODE_VERSION=24` on Render |

---

## Scripts reference

```bash
# Backend
cd backend
npm run migrate   # schema + seeds + alters
npm run dev       # nodemon
npm start         # production-style node

# Frontend
cd frontend
npm run dev       # Vite
npm run build     # production bundle
npm run preview   # preview build
```

---

## License

ISC (see `backend/package.json`).
