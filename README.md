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

> **Why does Approach C also require binding D1 manually?** This project's `wrangler.toml` **does not declare D1** by default (that config block is commented out with a `#@d1 ` prefix on each line), so that all three deployment approaches can share one clean config and anyone who forks the repo gets something that works without editing a file. The cost is that the one-click button won't auto-create the database and write the ID back — that step has moved to after deployment, done by you with one click in the panel (step 4). If you'd rather have "fully automatic, no need to manage D1 at all," use **local CLI deployment** (see the end of the page); it runs `wrangler d1 create` to create the database automatically.
>
> ⚠️ **A panel binding only holds as long as nothing deploys again.** Approach C creates an independent clone repo with no Git auto-deploy wired up, so binding once is normally enough. But **the moment another deploy is triggered** (say you merge upstream by hand and push, or click Redeploy in the panel), Cloudflare applies the "no D1" config from the repo and **the D1 binding is wiped from the panel** — you have to add it again. If you expect to sync upstream often, use one of the two "write D1 into the config" options from Approach B's B1 below (Option 1 or Option 2) instead; those are permanent.

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

This path has Cloudflare pull your repo directly, read the config in the repo, and run `wrangler deploy` — **it does not go through GitHub Actions**. Every push to the production branch redeploys automatically. There are three things to handle: **make D1 take effect** (B1, pick one of three options), **configure the three secrets** (B3), and leave the rest to automatic table creation on first access (B5).

**B1. Make the D1 binding take effect (three options, pick one)**

> ⚠️ **Understand the trap here first, or you'll keep falling into it:** on Approach B, every deploy takes **the config file in the repo** as the source of truth. This repo's `wrangler.toml` has the D1 block commented out by default (a `#@d1 ` prefix on each line, so that people who fork it don't have to edit a file), which effectively tells Cloudflare "this Worker has no D1 binding" — so **any D1 you add by hand in the panel gets wiped on every auto-deploy**.
>
> The `keep_vars = true` at the top of the file **does not save you here**: it only preserves *variables / secrets*, **not resource bindings** (D1 / KV / R2 and friends). For D1 to stick around, the config file has to actually contain it.

The three options below behave differently — pick based on how you work:

---

**Option 1 — Edit `wrangler.toml` (simplest, recommended for most people)**

In your forked repo, edit `wrangler.toml`: strip the `#@d1 ` prefix from those 4 lines and swap in your own `database_id` (find it in the panel under **Storage & Databases → D1 → open your database**; the **Database ID** on that page looks like `b48ad7cc-1e14-4fe7-a6aa-798485bfa0fc`):

```toml
[[d1_databases]]
binding = "DB"                        # must be uppercase DB, matching env.DB in the code
database_name = "rrelaynest-db"
database_id = "replace with your own Database ID"
```

Commit and push — no changes needed to the panel's build configuration.

- ✅ Fewest steps, easiest to understand, and it stays fixed once done
- ⚠️ When you later click **Sync fork** to sync upstream, this line may conflict with upstream (upstream has a placeholder there). If it conflicts, just keep your version

---

**Option 2 — Dedicated deploy branch + separate config (avoids Sync fork conflicts)**

Good for people who sync upstream frequently. The idea is to keep `wrangler.toml` **permanently identical** to upstream (so it never conflicts) and put your `database_id` in a separate file that **only exists on your deploy branch**.

1. Branch a deploy branch off your main branch, e.g. `deploy/cloudflare`
2. On that branch, create `wrangler.deploy.toml`: copy the contents of `wrangler.toml`, but uncomment the D1 block and fill in your real `database_id` (leave everything else identical)
3. Commit that file only on this branch (your main branch must not have it)
4. Change two settings in the panel under **Settings → Build**:
   - **Production branch** → `deploy/cloudflare`
   - **Deploy command** → `npx wrangler deploy --config wrangler.deploy.toml`
   - Leave the build command as `npm run build` and the non-production branch deploy command at its default
5. To deploy from then on: merge your main branch into the deploy branch and push
   ```bash
   git checkout deploy/cloudflare
   git merge main        # wrangler.toml is identical on both sides, so no conflict
   git push
   ```

- ✅ Zero conflicts when syncing upstream; your ID never appears on the main branch
- ⚠️ A few more steps, and you need to be comfortable with branches

---

**Option 3 — Panel binding only (zero file edits, but re-bind after every deploy)**

Touch no repo files at all; just bind once in the panel under **Settings → Bindings → Add binding → D1 database** (Variable name `DB`, uppercase).

- ✅ No files to touch, quickest way to get started
- ❌ **The binding disappears after every auto-deploy and you have to go re-bind it in the panel**; until you do, the app can't reach the database (pages will error). Approach B deploys on every push, so you'll pay this cost over and over
- Only worth it while you're trying things out to see how it works; for long-term use, pick Option 1 or Option 2

> `database_id` is not a secret, so committing it to a public repo is not a security problem — the ID alone gets nobody to your data without your API Token.

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

**B4. Confirm D1 is in effect**

D1 was already handled back in **B1** (Option 1/2 write it into the config file, Option 3 binds it in the panel); this step is just a check:

- After the deploy finishes, go to that Worker's **Settings → Bindings** — you should see one D1 binding whose **Variable name is `DB`** (must be uppercase, must be `DB`, matching `env.DB` in the code; a wrong name causes a "D1 not bound" runtime error)
- If you went with B1 Option 1 or 2, this binding is generated from the config file and will be there on every deploy — nothing to do
- If you went with B1 Option 3, **come back and check and re-bind after every deploy** (that's the cost of Option 3)

> If the binding is there but the app still reports a database error, first check that the Variable name is an uppercase `DB` and not `db` or something else.

**B5. First access, complete table creation + seed the admin**

After deployment D1 is still an empty database, but **you don't need to do anything manually**: open the Worker address once in a browser (of the form `https://rrelaynest.<your-subdomain>.workers.dev`), and the first request auto-creates tables + seeds the first admin (idempotent). Wait a second or two and refresh, then log in with `admin` + the initial password, and change the password on the settings page as soon as possible.

> If you want to confirm explicitly, you can also call the bootstrap endpoint (a POST with an `Authorization` header; the browser address bar can't do this — use Postman / Hoppscotch or curl):
> ```bash
> curl -X POST https://your-worker-domain/api/admin/bootstrap \
>   -H "Authorization: Bearer your_ADMIN_PASSWORD"
> ```
> A success returns `{"ok":true,...}`; `alreadyInitialized:true` means first access already bootstrapped it.

**B6. Upgrade**: Click **Sync fork** in the forked repo to sync upstream and push to your production branch; Cloudflare will automatically rebuild and deploy. New migrations are applied automatically on the next access (idempotent).

Whether the D1 binding needs handling again on upgrade depends on which B1 option you chose:

| B1 option | D1 after upgrade |
|---|---|
| Option 1 (edit `wrangler.toml`) | Nothing to do. But that line may conflict on Sync fork — keep your version |
| Option 2 (deploy branch + separate config) | Nothing to do, and no conflicts. Remember to merge your main branch into the deploy branch and push |
| Option 3 (panel binding only) | **Re-bind every single time**; until you do, the app can't reach the database |

---

> **Want to deploy with the local CLI?** That's supported too: `npx wrangler d1 create rrelaynest-db` to get the ID → open `wrangler.toml` and remove the leading `#@d1 ` on each line of the D1 block (uncomment it), and replace the placeholder with your real ID → `npx wrangler secret put` to set the three secrets → `npm run deploy` → visit once in a browser to auto-create tables.
>
> **Committing this change is optional, either way is fine**: if you don't commit it, it stays local (and you redo it once per machine); if you do commit it, you've effectively done B1 Option 1, and it then works for the CLI as well as for panel-connected Git — at the cost of that line possibly conflicting on Sync fork. Approach A's GitHub Actions is essentially this "uncomment + fill in ID" flow moved to the cloud (with the ID stored in a repo Secret).

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
