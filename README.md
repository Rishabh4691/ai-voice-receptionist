# ai-reception

AI-powered voice receptionist API — handles appointment booking, call session logging, and a Groq LLM proxy for real-time voice interactions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Tech Stack](#tech-stack)
3. [Environment Map](#environment-map)
4. [API Reference](#api-reference)
5. [First-Time VPS Setup](#first-time-vps-setup)
6. [GitHub Secrets & Environments Setup](#github-secrets--environments-setup)
7. [Branch → Deploy Flow](#branch--deploy-flow)
8. [Secrets (env files on the VPS)](#secrets-env-files-on-the-vps)
9. [Changing the Tech Stack](#changing-the-tech-stack)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
GitHub (push to branch)
        │
        ▼
GitHub Actions (SSH into VPS)
        │
        ▼
VPS: /home/kanal/apps/voice-bot-api
        │
        ├── git pull (right branch)
        │
        └── docker compose -f docker-compose.<env>.yml up --build -d
                │
                ├── ai-reception-dev     → 127.0.0.1:3040
                ├── ai-reception-staging → 127.0.0.1:3041
                └── ai-reception-prod    → 127.0.0.1:3042
                        │
                        └── nginx (reverse proxy, TLS termination)
                                │
                                └── voicebot.veraxiss.me  (public)
```

Each environment runs as an **isolated Docker container** with its own:
- Port binding (loopback only — nginx forwards externally)
- SQLite database volume (`./data`, `./data-staging`, `./data-prod`)
- Secrets file on the VPS (`/home/kanal/secrets/voice-bot-<env>.env`)

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20 (Alpine) |
| Framework | Express | ^4.18 |
| Database | SQLite (better-sqlite3) | ^9.4 |
| LLM Proxy | Groq API | REST |
| Container | Docker + Docker Compose | 29.x |
| CI/CD | GitHub Actions | — |
| Reverse Proxy | nginx | (host-managed) |

---

## Environment Map

| Environment | Branch | Port | Container | Secrets file |
|---|---|---|---|---|
| **dev** (default) | `main` | `3040` | `ai-reception-dev` | `voice-bot.env` |
| **staging** | `staging` | `3041` | `ai-reception-staging` | `voice-bot-staging.env` |
| **prod** | `prod` | `3042` | `ai-reception-prod` | `voice-bot-prod.env` |

Typical promotion flow:
```
feature/xyz  →  main (auto-deploys dev)
                 │
                 └──(manual merge)──►  staging (auto-deploys staging)
                                            │
                                            └──(manual merge)──►  prod (auto-deploys prod)
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Liveness probe |
| GET | `/api/availability?date=YYYY-MM-DD` | Available slots for a date |
| GET | `/api/availability/summary` | 14-day availability text for AI prompt |
| GET | `/api/appointments?from=&to=&demo=true` | List appointments |
| POST | `/api/appointments` | Book an appointment |
| DELETE | `/api/appointments/:id` | Cancel appointment |
| POST | `/api/calls/start` | Start a call session |
| POST | `/api/calls/end` | End a call session with transcript |
| GET | `/api/calls?limit=50` | List call sessions |
| GET | `/api/calls/:id` | Get single call session |
| POST | `/api/chat` | Groq LLM proxy (key never leaves server) |

---

## First-Time VPS Setup

These steps are done **once** when you first clone this repo onto the VPS.

### 1. Generate a deploy SSH key (on the VPS)

```bash
ssh-keygen -t ed25519 -C "github-deploy-ai-reception" -f ~/.ssh/ai-reception-deploy -N ""
cat ~/.ssh/ai-reception-deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Print the private key — you'll paste this into GitHub Secrets (step 2 below)
cat ~/.ssh/ai-reception-deploy
```

### 2. Configure the VPS git remote (HTTPS)

GitHub Actions will SSH in and run `git pull`. The repo must be cloned on the VPS:

```bash
# One-time: clone using HTTPS (no token needed for public repos)
# If the repo is private, use: https://<PAT>@github.com/KANAL1234/ai-reception.git
cd /home/kanal/apps
git clone https://github.com/KANAL1234/ai-reception.git voice-bot-api
cd voice-bot-api

# Verify all three branches exist
git fetch --all
git branch -r
```

> If the directory already exists (you're reading this on first deploy), just add the remote:
> ```bash
> cd /home/kanal/apps/voice-bot-api
> git init
> git remote add origin https://github.com/KANAL1234/ai-reception.git
> git fetch --all
> ```

### 3. Create the staging and prod secrets files

```bash
cp /home/kanal/secrets/voice-bot.env /home/kanal/secrets/voice-bot-staging.env
cp /home/kanal/secrets/voice-bot.env /home/kanal/secrets/voice-bot-prod.env

# Edit each with the correct API keys for that environment
nano /home/kanal/secrets/voice-bot-staging.env
nano /home/kanal/secrets/voice-bot-prod.env
```

### 4. Create data directories for staging and prod

```bash
mkdir -p /home/kanal/apps/voice-bot-api/data-staging
mkdir -p /home/kanal/apps/voice-bot-api/data-prod
```

### 5. Make the manual deploy script executable

```bash
chmod +x /home/kanal/apps/voice-bot-api/scripts/deploy.sh
```

---

## GitHub Secrets & Environments Setup

### Create GitHub Environments

Go to: `github.com/KANAL1234/ai-reception` → Settings → Environments

Create three environments: `dev`, `staging`, `prod`.

You can optionally add **required reviewers** to `prod` so no one can deploy to production without approval.

### Add Repository Secrets

Go to: Settings → Secrets and variables → Actions → Repository secrets

| Secret name | Value |
|---|---|
| `VPS_HOST` | `187.124.227.155` |
| `VPS_USER` | `kanal` |
| `VPS_SSH_KEY` | Contents of `~/.ssh/ai-reception-deploy` (the **private** key) |

> These three secrets are shared across all environments. You can override them at the environment level (e.g., different VPS per environment) by adding the same secret names inside each GitHub Environment.

---

## Branch → Deploy Flow

| Push to | Triggers | Deploys to | Health check URL |
|---|---|---|---|
| `main` | `deploy-dev.yml` | `ai-reception-dev` | `http://127.0.0.1:3040/api/health` |
| `staging` | `deploy-staging.yml` | `ai-reception-staging` | `http://127.0.0.1:3041/api/health` |
| `prod` | `deploy-prod.yml` | `ai-reception-prod` | `http://127.0.0.1:3042/api/health` |

Each workflow:
1. SSHs into the VPS
2. `git fetch && git reset --hard origin/<branch>` (clean pull, no merge conflicts)
3. `docker compose -f docker-compose.<env>.yml up --build -d` (rebuilds only if Dockerfile or source changed)
4. `docker image prune -f` (cleans up dangling images)
5. Waits 5s then hits `/api/health` — fails the workflow if unhealthy

### Manual deploy (emergency / no push needed)

```bash
ssh kanal@187.124.227.155
./apps/voice-bot-api/scripts/deploy.sh dev       # or staging, prod
```

---

## Secrets (env files on the VPS)

Secrets are **never** in git. They live only on the VPS at `/home/kanal/secrets/`.

```
/home/kanal/secrets/
├── voice-bot.env          ← dev
├── voice-bot-staging.env  ← staging
└── voice-bot-prod.env     ← prod
```

Minimum required content (see `.env.example`):

```bash
PORT=3000
GROQ_API_KEY=gsk_...
```

---

## Changing the Tech Stack

This section walks through **every layer** you might swap and what you need to update to keep CI/CD working without breaking anything.

---

### Swapping the Runtime / Language (e.g., Node → Python/Go/Rust)

The `Dockerfile` is the single source of truth for the runtime.

**Steps:**

1. **Rewrite `Dockerfile`** — change the `FROM` base image and build commands.

   Example (Node → Python):
   ```dockerfile
   FROM python:3.12-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt
   COPY . .
   EXPOSE 3000
   CMD ["python", "server.py"]
   ```

2. **Update the healthcheck** in all three `docker-compose.*.yml` files if the health endpoint path changes.

3. **Update `package.json`** → replace with `requirements.txt`, `go.mod`, `Cargo.toml`, etc. Make sure the new build artifacts aren't committed (update `.gitignore`).

4. **Test locally first:**
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   curl http://127.0.0.1:3040/api/health
   ```

5. Push to `main`. The GitHub Actions workflow is language-agnostic — it just runs docker compose.

---

### Swapping the Database (e.g., SQLite → PostgreSQL)

Currently the SQLite database lives in `./data/voicebot.db` (mounted as a Docker volume).

**Steps:**

1. **Run the new database as a separate service** in each `docker-compose.*.yml`:

   ```yaml
   services:
     db:
       image: postgres:16-alpine
       container_name: ai-reception-db-dev
       restart: unless-stopped
       volumes:
         - ./data:/var/lib/postgresql/data
       environment:
         POSTGRES_DB: voicebot
         POSTGRES_USER: voicebot
         POSTGRES_PASSWORD: ${DB_PASSWORD}

     api:
       depends_on: [db]
       environment:
         DATABASE_URL: postgres://voicebot:${DB_PASSWORD}@db:5432/voicebot
   ```

2. **Add `DB_PASSWORD`** to each `/home/kanal/secrets/voice-bot-*.env`.

3. **Rewrite `db.js`** to use `pg` or an ORM (Prisma, Drizzle, etc.).

4. **Handle migrations** — add a migration step before starting the API:
   ```dockerfile
   CMD ["sh", "-c", "npm run migrate && node server.js"]
   ```

5. The data volume paths (`./data`, `./data-staging`, `./data-prod`) in docker-compose files will now store Postgres data instead of SQLite files. **Do not delete these directories** on the VPS.

---

### Swapping the LLM Provider (e.g., Groq → OpenAI / Anthropic)

Currently `server.js:116` proxies to `https://api.groq.com/openai/v1/chat/completions`.

**Steps:**

1. **Update the proxy endpoint** in `server.js`.

2. **Rename or add the API key** in each secrets file on the VPS:
   ```bash
   # Replace GROQ_API_KEY with OPENAI_API_KEY (or add both during migration)
   nano /home/kanal/secrets/voice-bot.env
   ```

3. **Do not change GitHub Secrets** — API keys live only on the VPS, never in GitHub.

4. Update `.env.example` to reflect the new variable name so future developers know what's needed.

---

### Swapping the Web Framework (e.g., Express → Fastify / Hono)

1. Replace `server.js` with the new framework code.
2. Ensure the app still listens on `process.env.PORT` (already used).
3. Ensure `/api/health` returns `200 OK` — all three workflows health-check this route.
4. Run `npm install <new-framework>` and commit the updated `package.json` and `package-lock.json`.

---

### Adding a Frontend (e.g., React / Next.js)

If you add a frontend to this repo (monorepo approach):

1. Create a `Dockerfile.frontend` and a new service in each `docker-compose.*.yml`:
   ```yaml
   frontend:
     build:
       context: .
       dockerfile: Dockerfile.frontend
     container_name: ai-reception-frontend-dev
     ports:
       - "127.0.0.1:3050:3000"
   ```

2. Add the new port to the nginx config for each environment.

3. The CI/CD workflows will automatically build and restart all services on push — no workflow changes needed.

---

### Changing Ports

Ports are defined in three places. Change all three consistently:

| File | What to change |
|---|---|
| `docker-compose.dev.yml` | `ports: - "127.0.0.1:NEW_PORT:3000"` |
| `docker-compose.staging.yml` | Same |
| `docker-compose.prod.yml` | Same |
| `.github/workflows/deploy-*.yml` | The `curl` health check URL |
| nginx config (on VPS, host-managed) | `proxy_pass http://127.0.0.1:NEW_PORT` |
| `scripts/deploy.sh` | The `PORT` variable for that env |

---

### Adding a New Environment (e.g., `qa`)

1. Copy `docker-compose.staging.yml` → `docker-compose.qa.yml`, pick a new port (e.g. `3043`), update container name.
2. Copy `.github/workflows/deploy-staging.yml` → `.github/workflows/deploy-qa.yml`, change `branches: [qa]` and compose file reference.
3. Create `voice-bot-qa.env` on the VPS.
4. Create a `qa` GitHub Environment in the repo settings.
5. Create the `qa` branch: `git checkout -b qa && git push origin qa`.

---

## Troubleshooting

### Container won't start

```bash
# Check logs for the failing environment
docker compose -f docker-compose.dev.yml logs --tail=50

# Check if the port is already in use
ss -tlnp | grep 3040
```

### Health check fails after deploy

```bash
# Is the container running?
docker ps | grep ai-reception

# Manual health check
curl -v http://127.0.0.1:3040/api/health

# Check container logs for startup errors
docker logs ai-reception-dev --tail=100
```

### GitHub Actions SSH fails

```bash
# Test the deploy key from a local machine
ssh -i ~/.ssh/ai-reception-deploy kanal@187.124.227.155 echo "ok"

# Verify authorized_keys has the public key
cat ~/.ssh/authorized_keys | grep github-deploy-ai-reception
```

### `git pull` fails on VPS (authentication)

If the repo is private, the HTTPS clone needs a PAT embedded:
```bash
cd /home/kanal/apps/voice-bot-api
git remote set-url origin https://YOUR_GITHUB_PAT@github.com/KANAL1234/ai-reception.git
```

### Database is empty / demo data missing

The seed runs automatically on first startup if the `meta` table has no `seeded` key. If you wiped the DB and want to re-seed:
```bash
docker exec -it ai-reception-dev sh -c "rm -f /app/data/voicebot.db"
docker compose -f docker-compose.dev.yml restart
```

### Old image still running after deploy

```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up --build -d
```

### Disk filling up with old Docker images

```bash
docker system prune -f           # removes stopped containers + dangling images
docker system prune -a --volumes # nuclear option — removes everything unused
```

---

## Repo Structure

```
.
├── .github/
│   └── workflows/
│       ├── deploy-dev.yml        # triggers on push to main
│       ├── deploy-staging.yml    # triggers on push to staging
│       └── deploy-prod.yml       # triggers on push to prod
├── scripts/
│   └── deploy.sh                 # manual deploy helper
├── data/                         # dev SQLite DB (gitignored)
├── data-staging/                 # staging SQLite DB (gitignored, created on VPS)
├── data-prod/                    # prod SQLite DB (gitignored, created on VPS)
├── docker-compose.dev.yml
├── docker-compose.staging.yml
├── docker-compose.prod.yml
├── Dockerfile
├── server.js                     # Express app + all routes
├── db.js                         # SQLite schema, queries, seed data
├── package.json
├── .env.example                  # template — never commit real secrets
├── .gitignore
└── .dockerignore
```
