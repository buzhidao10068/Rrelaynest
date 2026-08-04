> **语言 / Language**：**English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)

# Rrelaynest

A self-hosted panel for centrally managing LLM API relay stations (new-api). One codebase, two deployment targets:

- **Docker / Node** — Single container, local SQLite persistence, in-process scheduled tasks. Best for your own server.
- **Cloudflare Workers + D1** — Serverless, global edge, zero ops. Best for serverless hosting.

Features: centralized site management, balance/quota scraping, daily auto check-in, liveness probing, multi-user (invite-only + full isolation), two-factor authentication (TOTP), and Passkey passwordless login.

---

## ⚠️ Disclaimer & Usage Notice

- **Ban risk**: Some features of this project (such as daily auto check-in, balance/quota scraping, liveness probing, etc.) access upstream relay stations (new-api and similar services) in an **automated manner**, which **may trigger the upstream's anti-abuse controls and get your account restricted or banned**. Whether to enable these features, and all consequences arising from doing so, are for you alone to assess and bear — **and have nothing to do with this project or its author**.
- **AI-authored notice**: This project is **entirely authored by AI** and may contain all kinds of errors, defects, or oversights. **No guarantee is made as to its correctness, stability, or fitness for any purpose.** Use it at your own discretion, only after fully understanding the code and the risks.

> After your first login, the panel displays the notice above and **requires you to check the agreement box before you can proceed**. The agreement state is recorded per account (persisted server-side); each account only needs to confirm once.

---

## ⚠️ Security prerequisite: HTTPS is mandatory in production

Sessions and login state are carried by cookies marked **`Secure`**, which browsers **only send back over HTTPS (or `http://localhost`)**.

This means: if you expose the service directly via `http://your-domain` or `http://internal-IP`, you'll hit the "**login succeeds, but the next request is unauthenticated again**" problem — because the cookie is never sent back by the browser.

**So:**

- ✅ `https://your-domain` — works
- ✅ `http://localhost:3100` — works (local debugging only; browsers grant localhost a security exemption)
- ❌ `http://your-domain` / `http://internal-IP` — **login will always fail; do not deploy this way**

The application itself (the Node entrypoint) only listens on a plaintext port and does no TLS. **In production, put it behind a reverse proxy and let the proxy terminate HTTPS.** Workers deployments come with HTTPS from the platform, so no extra handling is needed.

Nginx reverse-proxy example:

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    }
}
```

Caddy is even simpler (auto-issues Let's Encrypt certificates) — a single `Caddyfile`:

```
relay.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

Cloudflare Tunnel works too, likewise providing an HTTPS entrypoint without exposing a public port.

---

## Deployment 1: Docker

### 1. Prepare secrets

```bash
cp .env.example .env
```

Edit `.env` and fill in the three required values (missing any one causes the container to error out on startup):

| Variable | Purpose | How to generate |
| --- | --- | --- |
| `ADMIN_PASSWORD` | The **initial** login password for the first admin (username is fixed as `admin`) | A custom strong password |
| `SESSION_SECRET` | HMAC signing key for session cookies / MFA short-lived tickets / Passkey challenge tickets | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | AES-GCM encryption key for sensitive fields such as upstream API keys | `openssl rand -hex 32` |

> `ADMIN_PASSWORD` is **only used to seed the first admin on the initial startup when the database is empty**. After you change the password on the settings page, this variable no longer affects login — you can keep it or clear it.

### 2. Start

```bash
docker compose up -d --build
```

The first startup automatically: creates tables (runs all migrations) → seeds the first admin (username `admin`, password = `ADMIN_PASSWORD`) → backfills existing data. Everything is **idempotent**; repeated startups won't re-seed.

The sqlite file lands in the host's `./data/` (compose already mounts a volume), so removing the container won't lose data.

### 3. Access

The service listens on `3100`. **Be sure to place it behind an HTTPS reverse proxy** (see the security prerequisite above), then log in with `admin` + the initial password you set, and change the password on the settings page as soon as possible.

### 4. Upgrade

```bash
git pull
docker compose up -d --build
```

New migrations are applied automatically on startup (idempotent; won't touch existing data).

### 5. Add users

This panel is **invite-only**: after the first admin logs in, go to "Admin → Users" to generate an invite and send the invite link to the other person to register. Data is fully isolated between users; the admin can view it read-only.

---

## Deployment 2: Cloudflare Workers + D1

Serverless, with HTTPS built in from the platform (no need to configure your own reverse proxy). There are three approaches, none of which requires a local terminal — pick whichever you like:

- **Approach C — One-click deploy button (easiest for the first time, recommended for beginners)**: Click the button below and Cloudflare automatically clones the repo, creates a D1, guides you through filling in the three secrets, and builds and deploys. After deployment, add a D1 binding once in the panel (table creation happens automatically on first access).
- **Approach A — GitHub Actions**: Secrets are filled in on **GitHub** in the repo, and you click Run on the web to deploy. CI automatically injects the D1 ID and triggers table creation — no panel binding needed. Best for those who want deployment to go through GitHub and control their own CI.
- **Approach B — Cloudflare connects to Git**: Secrets are filled in on the **Cloudflare** panel, and pushing auto-deploys — you don't even touch GitHub Actions. **No need to edit any file in the repo**; bind D1 once from a dropdown in the panel.

> For all three approaches, table creation (running migrations + seeding the first admin) happens on **first access automatically** — when the Worker receives its first `/api/*` request, it idempotently runs the bootstrap once, so there's no need to curl manually.

### Approach C — One-click deploy button (recommended)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/buzhidao10068/Rrelaynest)

1. Click the **Deploy to Cloudflare** button above and authorize/log in to Cloudflare with your GitHub account
2. Follow the prompts to **fill in the values of the three secrets** (`ADMIN_PASSWORD` / `SESSION_SECRET` / `ENCRYPTION_KEY`; for values see "General preparation, step 3" below; be sure to change the example default for `ADMIN_PASSWORD`)
3. Click deploy (at this point the Worker is up, but D1 is not yet bound)
4. **Bind D1**: First create a database under **Storage & Databases → D1** (any name, e.g. `rrelaynest-db`); then go to that Worker's **Settings → Bindings → Add binding → D1 database**, set **Variable name to `DB`** (must be uppercase, must be `DB`), and select the database you just created from the dropdown; after saving, click **Retry/Redeploy** to make the binding take effect
5. Open the assigned `*.workers.dev` address; first access auto-creates tables + seeds the admin. Log in with `admin` + the initial password you filled in, and change the password on the settings page as soon as possible

> **Why does Approach C also require binding D1 manually?** This project's `wrangler.toml` does not declare D1 by default (it uses panel binding instead, together with `keep_vars = true`, so all three deployment approaches share the same clean config). Therefore the one-click button no longer auto-creates the database and writes back the ID — that step has moved to after deployment, done by you with one click in the panel (step 4). If you'd rather have "fully automatic, no need to manage D1 at all," use **local CLI deployment** (see the end of the page); it runs `wrangler d1 create` to create the database automatically.

> **Upgrade**: Approach C creates an **independent clone repo (not a Fork)** under your GitHub account, so there's **no "Sync fork" one-click sync button**. To pull in later updates from this project, do it manually: add an upstream remote to your repo (`git remote add upstream <this repo URL>`), then `git fetch upstream && git merge upstream/main` and push; Cloudflare will automatically rebuild and deploy.
>
> If you value **one-click syncing of upstream updates** more, use **Approach A / B** (they're Fork-based, and GitHub has a "Sync fork" button to pull upstream code in one click). Approach C wins on being the easiest for the first deployment, but later updates are actually more cumbersome.

---

Approaches A / B require the "General preparation" below first. Approach C only needs the "Create a D1 database" part (step 2); the Fork and secret preparation can be skipped (the one-click button guides you through them).

### General preparation (required for both Approach A and B)

**1. Fork this repo**

Open this project's page, click **Fork** in the top-right, and fork it to your own GitHub account. All subsequent operations happen in your forked repo.

**2. Create a D1 database**

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/), then in the left sidebar **Storage & Databases → D1 SQL Database → Create**
2. Name the database `rrelaynest-db`; after creating it, open its detail page and **record the Database ID**

**3. Prepare the values of the three secrets**

| Secret | Description | Value |
| --- | --- | --- |
| `ADMIN_PASSWORD` | The **initial** login password for the first admin (username is fixed as `admin`) | A custom strong password |
| `SESSION_SECRET` | HMAC signing key for session cookies / MFA short-lived tickets / Passkey challenge tickets | A random 32-byte hex string |
| `ENCRYPTION_KEY` | AES-GCM encryption key for sensitive fields such as upstream API keys | A random 32-byte hex string |

> `SESSION_SECRET` / `ENCRYPTION_KEY` need random values. If you have a terminal, generate them with `openssl rand -hex 32`; if not, any online random hex generator works — produce two 64-character hex strings. Make sure the two are different.

---

### Approach A — GitHub Actions

**A1. First obtain an API Token and Account ID**

1. Cloudflare dashboard, top-right avatar → **My Profile → API Tokens**
2. Click **Create Token**, choose the **Edit Cloudflare Workers** template, and after creating it **record the generated Token** (shown only once)
3. Back on the dashboard home page, the **Account ID** is visible in the right sidebar — **record it**

**A2. Configure GitHub Secrets**

In your forked repo: **Settings → Secrets and variables → Actions → New repository secret**, and add all 6 one by one:

| Secret name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | The Token recorded in A1 |
| `CLOUDFLARE_ACCOUNT_ID` | The Account ID recorded in A1 |
| `D1_DATABASE_ID` | The Database ID recorded in step 2 of General preparation |
| `ADMIN_PASSWORD` | The strong password from step 3 of General preparation |
| `SESSION_SECRET` | The random string from step 3 of General preparation |
| `ENCRYPTION_KEY` | The random string from step 3 of General preparation |

**A3. Run the deployment**

In your forked repo: on the **Actions** page → (if prompted to enable Actions first, click enable) → select **Deploy to Cloudflare Workers** on the left → **Run workflow** on the right → choose the `main` branch → **Run workflow**.

The workflow automatically: builds the frontend → injects the D1 ID and the three secrets → deploys the Worker → **calls `/api/admin/bootstrap` once to complete table creation + seeding the first admin** (idempotent; repeated runs won't re-seed).

After it finishes, expand the last step's log to see the access URL (of the form `https://rrelaynest.<your-subdomain>.workers.dev`). Log in with `admin` + the initial password, and change the password on the settings page as soon as possible.

> Table creation happens automatically on first access (common to all three approaches); the bootstrap step in the workflow just lets the CI log show the bootstrap result directly — redundant but harmless.

**A4. Upgrade**: This workflow is **manual-trigger only** (it won't run automatically just because you push code or sync). Upgrade steps: click **Sync fork** in the forked repo to sync upstream → ⚠️ **then you must go back to the Actions page and click Run workflow once** for the deployment to actually update. (Just clicking Sync fork won't auto-deploy — a web sync is a fast-forward merge and doesn't produce a push event that triggers the workflow.) New migrations are applied idempotently in the bootstrap call after deployment.

---

### Approach B — Cloudflare connects to Git (secrets filled in on Cloudflare)

This path has Cloudflare pull your repo directly, read the `wrangler.toml` in the repo, and run `wrangler deploy` — **it does not go through GitHub Actions**. **You never edit any file in the repo throughout** — bind D1 from a dropdown in the Cloudflare panel. You only need to do two things in the panel: **configure the three secrets** (B3) and **add a D1 binding once** (B4); table creation happens on first access automatically (B5).

**B1. No need to change repo files**

The `wrangler.toml` in the repo does **not declare D1** by default (that config block is commented out), together with `keep_vars = true` at the top of the file — meaning "on deploy, keep the bindings I added manually in the panel; don't let the config file override and delete them." So on this path you **don't touch `wrangler.toml`**; leave D1 to be bound in the panel in B4.

> Why not write it into the repo? Although `database_id` is not a secret (committing it to the repo poses no security issue), hardcoding it into the config means everyone who forks has to edit the file once. Switching to panel binding keeps the repo clean and out-of-the-box for everyone, at the cost of just one click in the panel to bind after the first deploy (B4).

**B2. Import the repo in Cloudflare**

1. Cloudflare dashboard **Workers & Pages → Create → Get started** next to **Import a repository**
2. Authorize and select your forked repo
3. Build configuration:
   - **Build command**: `npm run build`
   - **Deploy command**: keep the default `npx wrangler deploy`
   - It's recommended to keep the Worker name as `rrelaynest` (**must match the `name` in `wrangler.toml`**, otherwise the build fails)

**B3. Configure runtime secrets**

In that Worker's **Settings → Variables and Secrets**, add three **Secret-type** variables (not build variables — build variables can't be read at runtime): `ADMIN_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, with values from step 3 of General preparation.

> If you already deployed once by clicking Save and Deploy in B2, you need to trigger another deploy after configuring the secrets for them to take effect (push a change to the repo, or click Retry/Redeploy in the panel).

**B4. Bind the D1 database in the panel**

This is the only binding you need to do manually in the panel on this path. In that Worker's **Settings → Bindings → Add binding → D1 database**:

- **Variable name**: `DB` (**must be uppercase, must be `DB`**, to match `env.DB` in the code; a wrong value causes a "D1 not bound" runtime error)
- **D1 database**: select the `rrelaynest-db` created in step 2 of General preparation from the dropdown

After saving, **trigger another deploy** for the binding to take effect (push a change to the repo, or click Retry/Redeploy in the panel). Because `wrangler.toml` has `keep_vars = true`, this binding is preserved on every subsequent auto-deploy — no need to repeat.

**B5. First access, complete table creation + seed the admin**

After deployment D1 is still an empty database, but **you don't need to do anything manually**: open the Worker address once in a browser (of the form `https://rrelaynest.<your-subdomain>.workers.dev`), and the first request auto-creates tables + seeds the first admin (idempotent). Wait a second or two and refresh, then log in with `admin` + the initial password, and change the password on the settings page as soon as possible.

> If you want to confirm explicitly, you can also call the bootstrap endpoint (a POST with an `Authorization` header; the browser address bar can't do this — use Postman / Hoppscotch or curl):
> ```bash
> curl -X POST https://your-worker-domain/api/admin/bootstrap \
>   -H "Authorization: Bearer your_ADMIN_PASSWORD"
> ```
> A success returns `{"ok":true,...}`; `alreadyInitialized:true` means first access already bootstrapped it.

**B6. Upgrade**: Click **Sync fork** in the forked repo to sync upstream and push to `main`; Cloudflare will automatically rebuild and deploy. New migrations are applied automatically on the next access (idempotent). The D1 binding is preserved thanks to `keep_vars = true`, so there's no need to touch it on upgrade.

---

> **Want to deploy with the local CLI?** That's supported too: `npx wrangler d1 create rrelaynest-db` to get the ID → open `wrangler.toml` and remove the leading `#@d1 ` on each line of the D1 block (uncomment it), and replace the placeholder with your real ID (**keep this change local only, don't commit it**, otherwise it pollutes the panel-binding approach) → `npx wrangler secret put` to set the three secrets → `npm run deploy` → visit once in a browser to auto-create tables. Or, more conveniently: skip editing the file, just `npm run deploy` and then bind D1 in the panel per B4. Approach A's GitHub Actions is essentially this "uncomment + fill in ID" flow moved to the cloud.

---

## Local development

```bash
npm ci
npm run dev            # frontend (Vite)

# In another terminal, start the Node backend:
export ADMIN_PASSWORD=dev-admin
export SESSION_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
npm run build:server && npm run start:node   # http://localhost:3100

# Or Workers locally:
npm run dev:worker     # http://localhost:7738
```

Tests and type checking:

```bash
npm test               # vitest
npm run typecheck      # tsc (client + server, two configs)
```

---

## Environment variables reference

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Yes | — | Initial password for the first admin / Workers bootstrap token |
| `SESSION_SECRET` | Yes | — | Session signing key |
| `ENCRYPTION_KEY` | Yes | — | Encryption key for sensitive fields |
| `PORT` | No | `3100` | Node listening port |
| `DB_PATH` | No | `data/rrelaynest.sqlite` | Node SQLite file path |
| `DIST_DIR` | No | `dist` | Node frontend static assets directory |

> Node deployment requires **Node 22+** (depends on the built-in `node:sqlite`). The Docker image is pinned to Node 24.

---

## License

[MIT](LICENSE). Free to use, modify, use commercially, and redistribute, as long as you retain the copyright and license notice.
