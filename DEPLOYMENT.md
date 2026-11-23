# Deploying Muney to a Raspberry Pi (with Tailscale)

Same shape as the task dashboard: Postgres, the FastAPI backend, and the built
frontend served by nginx, as three Docker containers, reachable from any device
on your tailnet, with a one-command update path.

## 0. What you'll end up with

- `docker compose up -d` on the Pi runs everything.
- Muney is at `http://<pi-tailscale-address>:8080` from any device on the
  tailnet — no port forwarding, nothing public.
- `./deploy.sh` pulls the latest `main` and redeploys, migrations included.
- `scripts/backup-db.sh` dumps the database and can push it to Google Drive
  and/or another tailnet device (§7).

### Ports — read this first

The task dashboard is already running on this Pi. **Muney binds none of its
ports:**

| | Task dashboard | Muney |
|---|---|---|
| Frontend | `80` | **`8080`** (`MUNEY_WEB_PORT`) |
| Backend | `8000` | **`8001`** (`MUNEY_API_PORT`) |
| Postgres | `5432` | **not published** |

Muney's Postgres is deliberately unpublished — it's reachable only from
Muney's own containers on their private network. That removes any chance of a
5432 collision, and keeps the database off the tailnet entirely. Backups still
work: `backup-db.sh` goes through `docker compose exec`, not a host port.

Compose also namespaces everything under the project name `muney`, so
containers, networks and volumes can't clash with the dashboard's either.

## 1. One-time Pi setup

Already done if the dashboard is running. Otherwise, 64-bit Raspberry Pi OS
(Bookworm+), Pi 4 (4GB+) or Pi 5:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status   # note the MagicDNS name, e.g. raspberrypi.tailxxxxx.ts.net
```

## 2. Get the code onto the Pi

```bash
git clone <your-repo-url> Muney
cd Muney
chmod +x deploy.sh scripts/backup-db.sh backend/entrypoint.sh
```

That `chmod` matters — this repo was authored on Windows, so the executable bit
isn't recorded in git.

## 3. Configure

```bash
cp .env.example .env
nano .env
```

At minimum set:

- **`POSTGRES_PASSWORD`** — anything real.
- **`JWT_SECRET`** — `openssl rand -base64 48`. Changing it later signs you out.

You do **not** need to put the Pi's Tailscale address anywhere. That's the one
difference from the dashboard's setup, and it's deliberate: nginx proxies
`/api` to the backend on the same origin, so

- there is no CORS configuration to get wrong, and
- `VITE_API_BASE_URL` stays `/api`, meaning a change of hostname or Tailscale
  address never requires rebuilding the frontend image.

`backend/.env` and `frontend/.env.local` are for running natively on your dev
machine. They are not used by Docker and aren't needed on the Pi.

## 4. First deploy

```bash
docker compose up -d --build
```

Postgres starts, the backend waits for it to be healthy, runs
`alembic upgrade head` (see `backend/entrypoint.sh`), then serves. nginx starts
last.

Check it:

```bash
docker compose ps
curl http://localhost:8001/api/health     # {"status":"ok","database":"ok"}
curl -I http://localhost:8080             # 200
```

From any other device on the tailnet:

```
http://<pi-tailscale-address>:8080
```

**First run:** the sign-in screen offers to create an account while the users
table is empty. Create it, then set `ALLOW_BOOTSTRAP_REGISTRATION=false` in
`.env` and `./deploy.sh` to close registration permanently.

Then open **Rates & settings → Refresh rates** to pull live FX. (The backend
also warms the cache at startup and whenever rates go stale.)

*(Optional: `tailscale serve` can front the web container with a real HTTPS
cert on your `.ts.net` domain if you'd rather not type `:8080`.)*

## 5. Pushing changes

### Manual

```bash
ssh <user>@<pi-tailscale-address>
cd Muney
./deploy.sh
```

`deploy.sh` does `git fetch` + `git reset --hard origin/main`, rebuilds what
changed, restarts, waits for the backend to report healthy, and prunes dangling
images. Migrations run automatically inside the backend container. Safe to run
repeatedly. `./deploy.sh --no-pull` redeploys the working tree without touching
git.

### Automatic on push

`.github/workflows/deploy.yml` is in the repo and **skips itself** until these
secrets exist (repo → Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | Tailscale OAuth client, scoped to a tag such as `tag:ci`; your ACLs must let `tag:ci` reach the Pi on port 22. |
| `PI_TAILSCALE_HOST` | MagicDNS name or `100.x.y.z`. |
| `PI_SSH_USER` | Pi username to SSH as. |
| `PI_SSH_PRIVATE_KEY` | Private half of a dedicated deploy key (`ssh-keygen -t ed25519 -f deploy_key -N ""`); public half goes in the Pi's `~/.ssh/authorized_keys`. |
| `PI_DEPLOY_SCRIPT_PATH` | e.g. `/home/pi/Muney/deploy.sh` |

Restrict what that key can do, so a leak can only ever trigger a redeploy:

```
command="/home/pi/Muney/deploy.sh",no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAA... muney-deploy
```

If you're already using a deploy key for the dashboard, generate a **separate**
one for Muney — the `command=` restriction pins each key to one script.

## 6. Everyday operations

```bash
docker compose logs -f backend
docker compose restart backend
docker compose down            # stops Muney only; data volume persists
docker compose exec db psql -U muney muney
```

All of these act only on Muney because of the `name: muney` project scope — run
them from the `Muney/` directory and the dashboard is untouched.

## 7. Backups (off the Pi)

A Docker volume doesn't help if the SD card dies. `scripts/backup-db.sh` dumps
the DB, keeps a rotating local window, and can push copies to Google Drive
and/or another tailnet device — each an independent switch.

```bash
cp backup.env.example backup.env
nano backup.env
```

The dump goes through `docker compose exec db pg_dump`, so it works even though
Postgres isn't published to the host.

### 7.1 Google Drive (`BACKUP_TO_GDRIVE=true`)

If you already configured rclone for the dashboard's backups, **reuse that
remote** — just keep `GDRIVE_FOLDER=muney-backups` distinct so the two don't
prune each other's files. Then:

```bash
rclone mkdir gdrive:muney-backups
./scripts/backup-db.sh
rclone ls gdrive:muney-backups
```

Fresh rclone setup (`rclone config`) if you haven't done it before:

1. `n` — new remote; name it `gdrive` (must match `GDRIVE_REMOTE_NAME`)
2. Storage type: `drive`
3. `client_id` / `client_secret`: blank
4. **`scope`: read the option text, don't trust the numbering** — it varies by
   rclone version. Pick the one described as *"Access to files created by
   rclone"* (`drive.file`). If unsure, *"Full access all files, excluding
   Application Data Folder"* (`drive`) is foolproof for a personal backup.
   Choosing a **read-only** scope here is the usual cause of
   `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` on the first upload.
5. `root_folder_id`, `service_account_file`: blank; advanced config: `n`
6. `Use auto config?` → **`n`** (the Pi has no browser). Run the printed
   `rclone authorize "drive" ...` command on your PC, sign in, paste the token
   back.

`GDRIVE_RETENTION_DAYS` (default 30) keeps it a rolling window.

### 7.2 Another tailnet device (`BACKUP_TO_REMOTE=true`)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/backup_key -N ""
ssh-copy-id -i ~/.ssh/backup_key.pub user@remote     # Linux/Mac
```

On a **Windows** remote you need the *OpenSSH Server* optional feature, then
append the public key to `C:\Users\<user>\.ssh\authorized_keys` (or
`C:\ProgramData\ssh\administrators_authorized_keys`, with restricted ACLs, for
an admin account). `REMOTE_PATH` must already exist.

### 7.3 Scheduling (optional)

```bash
crontab -e
# 3:30am, offset from the dashboard's 3:00am job so they don't overlap:
30 3 * * * /home/pi/Muney/scripts/backup-db.sh >> /home/pi/Muney/backups/backup.log 2>&1
```

If a destination is unreachable the script logs it and continues — the local
copy still lands, and `LOCAL_RETENTION_DAYS` is the window in which a later run
can catch the destination up.

### 7.4 Restoring

Onto a fresh, empty database (restoring over a populated one hits constraint
conflicts):

```bash
docker compose down
docker volume rm muney_db_data          # only if you want a clean slate
docker compose up -d db
gunzip -c backups/muney-<timestamp>.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose up -d
```

## 8. Troubleshooting

- **Port already in use on 8080 or 8001** — something else grabbed it. Change
  `MUNEY_WEB_PORT` / `MUNEY_API_PORT` in `.env` and `./deploy.sh`. Check with
  `sudo ss -tlnp | grep -E '8080|8001'`.
- **`502 Bad Gateway` from the web container** — the backend isn't up. Almost
  always a migration or DB failure: `docker compose logs backend`. nginx
  re-resolves the backend per request, so it recovers on its own once the
  backend is healthy — no nginx restart needed.
- **`dependency failed to start: container muney-db-1 is unhealthy`** — read
  `docker compose logs db`. If it mentions the data directory, PGDATA, or
  initdb, the volume was created by an older version of this compose file that
  didn't pin `PGDATA`. Because Postgres 18 relocated its default data directory
  to `/var/lib/postgresql/18/docker`, the mount has to be pinned explicitly
  (it is, now). Fix with `docker compose down -v` to drop the empty volume,
  then `docker compose up -d --build`. **`-v` deletes the database** — only do
  this before you have real data, or restore from a backup afterwards (§7.4).
  If Postgres 18 misbehaves on your Pi for any other reason, setting
  `POSTGRES_IMAGE=postgres:17-alpine` in `.env` is a safe fallback for a fresh
  install.
- **Backend restarting in a loop** — check `docker compose logs backend`. If
  it's `password authentication failed`, you changed `POSTGRES_PASSWORD` after
  the volume was created; the volume keeps the *original* password. Either
  restore the old value or wipe the volume (`docker volume rm muney_db_data`)
  and restore from a backup.
- **`pip install` fails building a wheel on the Pi** — a pin lost its arm64
  wheel. Uncomment the `build-essential libpq-dev` line in `backend/Dockerfile`.
- **Amounts show "no rate"** — the Pi couldn't reach the FX provider. Check
  outbound DNS/internet, hit **Refresh rates**, or set a rate by hand in
  Rates & settings (manual rates survive every refresh).
- **`permission denied: ./deploy.sh`** — the `chmod +x` from step 2 was missed.
- **Changed `.env` but nothing happened** — most values are read at container
  start, so `./deploy.sh` (or `docker compose up -d`) is required.
  `VITE_API_BASE_URL` is the one baked at *build* time, needing
  `docker compose up -d --build web`.

## 9. Forwarding bank SMS from an iPhone

Every bank SMS your iPhone forwards goes to `POST /api/ingest/sms`. The
backend saves it right away and reads it in the background, so the
Shortcut never waits:

1. **Regex parsers** (`backend/app/services/sms_parser.py`). These are
   instant and exact. Out of the box they read HNB's three formats:
   debit/credit alerts, the ATM e-receipt, and the "SMS ALERT: PURCHASE"
   message. They also drop real OTPs, declined payments and bill reminders.
2. **The on-board LLM**, for anything no parser knows: llama.cpp's
   `llama-server` running Qwen2.5-1.5B in the `llm` container, on the Pi,
   with no internet needed. It pulls out the amount, currency, merchant,
   account number and balance. Every number it reports is checked against
   the SMS text; if anything doesn't add up, the SMS waits in the inbox
   instead of being recorded wrong.
3. **Categorising.** First your learned merchant rules (anything you've
   recategorised by hand), then category keywords, then the model's pick.
4. **Recording.** The transaction is saved and the account is set to the
   balance the bank reported. An ATM fee becomes its own expense under
   *Fees & charges*. A debit on one of your accounts and a credit on
   another at the same moment (USD 50 out, LKR 16,457.50 in) become **one
   transfer**, so moving money around never shows up as spending or income.

Anything that couldn't be read waits in **SMS inbox → Needs review**.

### Server

In `.env`:

```bash
INGEST_TOKEN=<openssl rand -hex 24>
LLM_PROVIDER=llamacpp          # the default
```

`./deploy.sh`. On first start the `llm` container downloads the model
(about 1.1 GB, into the `llm_models` volume). It's ready when
`docker compose logs llm` shows the server listening. After that it loads
in seconds and stays in RAM (about 1.3 GB).

- **Speed:** each SMS the model reads takes a few seconds; expect roughly
  10–20 s on a Pi 5 and longer on a Pi 4. It runs in the background, so
  nothing waits on it. HNB messages skip the model entirely.
- **Web UI:** llama.cpp's own chat page is at `http://<pi>:8090`
  (`MUNEY_LLM_PORT`), handy for trying a tricky SMS by hand.
- **Try another model:** set `LLM_HF_MODEL` (a Hugging Face
  `<user>/<repo>:<quant>`) and `LLM_MODEL` (its display name) in `.env`,
  then `docker compose up -d llm`. Measure it on your own messages before
  committing to it:

  ```bash
  docker compose exec backend python scripts/llm_bench.py
  docker compose exec backend python scripts/llm_bench.py --llm-only   # model alone, no parsers
  ```

- **Not on the Pi:** `LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`
  uses Claude Haiku 5.5 instead (SMS text then leaves the Pi; stop the
  `llm` container to save its RAM). `LLM_PROVIDER=none` means parsers only.

Test it end to end:

```bash
curl -X POST http://localhost:8080/api/ingest/sms \
  -H 'X-Ingest-Token: <token>' -H 'Content-Type: application/json' \
  -d '{"message":"LKR 50.00 debited to Ac No:09802XXXXX06 on 22/11/26 10:29:06 Reason:MB BillPmt/Hutch Bal:LKR 81.65","sender":"HNB"}'
```

It appears in the inbox as "recorded" within a second (a parser read it).

### iPhone

The automation switches Tailscale on only while it forwards a message.

1. **Tailscale**: sign in to the same tailnet, then turn **Connect On
   Demand** off and disconnect.
2. **Shortcuts → Automation → + → Message**:
   - *Sender*: `HNB`, or, if it isn't in the picker, *Message Contains*
     `2462462` (part of HNB's hotline number, present in every HNB alert).
     Make one automation per bank.
   - **Run Immediately**, with "Notify When Run" off.
3. Actions, in order:
   1. **Tailscale → Connect** (or *Set VPN → Connect* with the Tailscale
      profile).
   2. **Wait** 3 seconds.
   3. **Get Contents of URL**:
      - URL: `http://<pi-magicdns-name>:8080/api/ingest/sms`
      - Method: `POST`
      - Headers: `X-Ingest-Token` = your token
      - Request Body: **JSON**
        - `message` (Text) = *Shortcut Input → Content*
        - `sender` (Text) = *Shortcut Input → Sender*
        - `received_at` (Text) = *Current Date*, formatted as **ISO 8601**
          with time
   4. **Tailscale → Disconnect**.
4. Test with an ordinary shortcut: a **Text** action holding a real SMS,
   the same four actions with `message` set to that Text, then **Show
   Result**. It should appear in the inbox within seconds.

If the request fails, the shortcut stops before step 4 and Tailscale stays
connected. Switch it off by hand and add that transaction manually.

The same SMS forwarded twice within `INGEST_DEDUPE_MINUTES` (default 10) is
only stored once.

### Accounts

On the Accounts page, enter each account's **number**: the full number is
best, or at least the last 4 digits. Banks print it masked, and differently
in different messages. HNB shows one savings account as both `09802XXXXX06`
and `0980***2106`. Both match an account stored as `…2106`, and when only a
couple of digits are visible, the SMS's currency decides between your LKR
and USD accounts. A message that matches no account is still recorded, but
no balance moves, and the inbox says so.

### Adding a regex parser

When a bank you use regularly isn't covered, add a parser for it in
`sms_parser.py`. The HNB ones are worked examples. Add a sample of the
message to `backend/scripts/sms_samples.json` and run `llm_bench.py` to
check it, deploy, then press **SMS inbox → Re-run** to process anything
still waiting.
