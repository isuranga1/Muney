# Muney

A personal money tracker. Your bank accounts in their own currencies, every
transaction sorted into categories and months, a percentage rule for each
month's income, and bank SMS forwarded from your iPhone recorded for you.

- **Frontend** — Vite + React 19 + TypeScript + Tailwind CSS v4
- **Backend** — FastAPI + SQLAlchemy 2.0
- **Database** — PostgreSQL, migrated with Alembic
- **Auth** — single-user JWT (the first account you create is the only one)

```
Muney/
├── backend/            FastAPI service
│   ├── alembic/        migrations
│   ├── app/
│   │   ├── api/routes/ endpoints
│   │   ├── core/       config + security
│   │   ├── models/     SQLAlchemy tables
│   │   ├── schemas/    Pydantic request/response models
│   │   └── services/   ledger, FX, reports, SMS ingest, LLM, categoriser
│   └── scripts/        one-off helpers
└── frontend/           Vite app
    └── src/
        ├── components/ layout, UI primitives, charts
        ├── lib/        API client, auth, query hooks, formatting
        └── pages/      Home, Accounts, Activity, Budget, Funds, Inbox, News, Settings
```

## What it does

**Accounts** — savings, current, credit cards, cash and wallets, each in its own
currency. A USD account shows its USD balance with the LKR (and USD, for LKR
accounts) value beside it; net worth is shown in both. Every transaction moves
its account's balance, and editing or deleting one puts the balance back.

**Activity** — expenses, income and transfers between your own accounts,
grouped by day. Switch to the yearly view for month-by-month income vs spending
and a category × month table. Amounts are frozen in LKR at the rate of the day,
so past months don't shift when rates move.

**Categories** — keywords file transactions instantly; recategorising one
teaches a rule for that merchant; anything left goes to the on-board LLM, which
picks an existing category or proposes a new one (flagged for you to review).

**Budget rule** — split income by percentage, e.g. 20% emergency fund, 50% daily
expenses, 20% investment, 10% carefree. Each bucket is an envelope: every month
it gets its percentage of that month's income automatically, spending in the
categories mapped to it comes out, and whatever's left carries into next month.
The money never has to move between accounts. Add, remove or re-weight buckets
any time; a change applies from the current month on, and past months keep the
percentages they had. Removing a bucket hands its balance to another one.

**Overspending** — when a bucket goes below zero, the Budget and Funds pages
show an alert with a one-tap fix: cover the gap from another bucket. That moves
money between the two balances; the percentages stay as they are.

**Funds** — what each bucket holds now, and how it got there: income shared out,
spending, and money moved in or out. Move money between buckets, add an opening
balance, or take money out for spending outside a bucket's categories. Every
move can be undone.

**SMS inbox** — an iPhone Shortcut forwards bank SMS over Tailscale. Regex
parsers (HNB built in) read known formats instantly; anything else goes to a
small LLM running on the Pi itself (llama.cpp + Qwen2.5-1.5B, offline). A debit
and a matching credit between your own accounts become one transfer. Anything
unreadable waits for you. Setup: [DEPLOYMENT.md §9](DEPLOYMENT.md).

**News** — RSS feeds, unchanged.

---

## Setup

Prerequisites: **Python 3.11+**, **Node 20+**, and a running **PostgreSQL** server.

### 1. Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Create `backend/.env` from the template and set your PostgreSQL password:

```powershell
Copy-Item .env.example .env
```

Then edit `DATABASE_URL` in `.env`:

```
DATABASE_URL=postgresql+psycopg://postgres:YOUR_PASSWORD@localhost:5432/muney
```

Generate a real `JWT_SECRET` while you're in there:

```powershell
.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Create the database and apply the migrations:

```powershell
.venv\Scripts\python scripts/create_db.py
.venv\Scripts\alembic upgrade head
```

Run the API:

```powershell
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://127.0.0.1:8000/docs>

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to the backend on port
8000, so no CORS setup is needed for local work.

### 3. First run

The sign-in screen offers to **create an account** while the users table is empty.
Once that account exists, registration closes itself — set
`ALLOW_BOOTSTRAP_REGISTRATION=false` in `.env` if you want it locked permanently.

Then: add your accounts (with their last digits) → check the budget rule →
add a transaction with the + button. Hit **Refresh rates** in Settings to pull
live FX.

---

## Configuration

All backend settings live in `backend/.env`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/muney` | |
| `JWT_SECRET` | — | Change this. Rotating it signs everyone out. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `20160` | 14 days |
| `ALLOW_BOOTSTRAP_REGISTRATION` | `true` | Only ever applies while zero users exist |
| `BASE_CURRENCY` | `LKR` | Everything converts to this |
| `SUPPORTED_CURRENCIES` | `LKR,USD,SGD,EUR,GBP,AUD,INR` | Comma-separated |
| `FX_API_URL` | fawazahmed0/currency-api on jsDelivr | Free, no API key, no rate limit |
| `FX_FALLBACK_API_URL` | `https://latest.currency-api.pages.dev/…` | Same data, used only if the primary fails |
| `FX_PIVOT_CURRENCY` | `USD` | Cross rates are computed through this. The pivot is part of the URL path, so change both URLs to match |
| `FX_STALE_AFTER_HOURS` | `12` | Older than this triggers a refresh at startup |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated |

Adding a currency means adding it to `SUPPORTED_CURRENCIES` and restarting the API —
no migration needed, since currencies are stored as ISO codes rather than an enum.

## Working on it

```powershell
# Backend: create a migration after changing a model
cd backend
.venv\Scripts\alembic revision --autogenerate -m "describe the change"
.venv\Scripts\alembic upgrade head

# Frontend
cd frontend
npm run typecheck
npm run build
```

## Design notes

- **Money is `Decimal` end to end** — `NUMERIC(18,2)` in Postgres, `Decimal` in
  Python, serialised as a JSON number. No binary floats touch a balance.
- **Rates are read from one map per request.** A request loads the currency→LKR map
  once and every row in the response converts against it — no N+1 lookups, and every
  figure in a response is consistent with the same snapshot.
- **`overdue` is derived, never stored**, so an expense can't drift out of sync with
  the calendar.
- **Chart colours** come from a colourblind-validated categorical palette, stepped
  separately for light and dark surfaces. Every bar is directly labelled, so colour
  never carries meaning on its own.
