# Muney

A personal finance board. Configurable banks and accounts, grouped expenses you can
tick off as paid, and recorded income — all converted to **LKR** automatically, so a
USD savings account and an SGD wallet roll into one net-worth figure.

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
│   │   └── services/   FX rates, conversion
│   └── scripts/        one-off helpers
└── frontend/           Vite app
    └── src/
        ├── components/ layout, UI primitives, charts
        ├── lib/        API client, auth, query hooks, formatting
        └── pages/      Dashboard, Banks, Expenses, Income, Settings
```

## What it does

**Banks & accounts** — add and remove banks, and under each bank add accounts with a
type (savings, current, fixed deposit, credit card, investment, wallet, loan), a
currency, a balance, and an account number. Accounts flagged as *liability* count
against net worth instead of toward it.

**Automatic LKR conversion** — every account, expense and income shows its own
currency *and* its LKR value. Rates come from a free public provider
(fawazahmed0/currency-api — no key, no rate limit, ~340 currencies), are cached in
Postgres, and refresh on demand or when they go stale. A second host is tried if the
first is unreachable. Any rate you set by hand wins and survives every refresh. If a
currency has no rate, the app says so rather than quietly leaving it out of a total.

**Expenses** — create groups ("Monthly bills", "Trip to Japan"), add expenses under
them, and click an expense to strike it out as paid. Each row carries an amount,
currency, due date, paid date, status, recurrence, vendor and the account it was paid
from. Select several rows to mark them paid in one go. Overdue items are flagged.

**Income** — the same shape, one level up: sources (salary, a client, dividends) with
entries that are *expected* or *received*.

**Dashboard** — net worth, assets, liabilities, this month's net, balances by bank,
expenses paid vs outstanding by group, and holdings by currency.

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

Then: add a bank → add accounts → create an expense group → add expenses. Hit
**Refresh rates** on the Rates & settings page to pull live FX.

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
