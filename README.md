# tracksem

> track your sem grades before they track you

A TUI-style semester grade tracker for IIIT-H courses. Pick your branch and semester, get the curriculum's courses with their evaluation breakdowns pre-filled, enter scores and class stats, and get live absolute and curved (relative) projections, SGPA, and "what do I need" targets. Each person signs up with their name, roll number and a password and only sees their own data. Everything is stored in one SQLite file.

## stack

- [SvelteKit](https://kit.svelte.dev) + Svelte 5 runes, [Node adapter](https://svelte.dev/docs/kit/adapter-node)
- Tailwind CSS v4 (base layer) + hand-written component CSS
- [SQLite](https://www.sqlite.org/index.html) via `better-sqlite3`
- [Bun](https://bun.sh) for installing dependencies (`bun.lock`)

## dev

```bash
bun install
npm run dev      # or: bun run dev
```

→ `http://localhost:5173`

In dev the database is `data/dev.db` (auto-created), so you never touch production data. Other scripts: `npm run check`, `npm run build`, `npm test`.

### environment variables

| Variable                 | Default                                                    | Purpose                                                                 |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `TRACKSEM_DB_PATH`       | `data/tracksem.db` if `NODE_ENV=production`, else `data/dev.db` | SQLite file location                                              |
| `ORIGIN`                 | —                                                          | Public URL (adapter-node); its host is automatically allowed            |
| `TRACKSEM_ALLOWED_HOSTS` | —                                                          | Extra comma-separated hostnames/IPs allowed in the `Host` header        |
| `TRACKSEM_BASE_PATH`     | —                                                          | Sub-path to serve under, e.g. `/tracksem`. Read at **build** time       |
| `ADDRESS_HEADER`         | —                                                          | Header holding the client IP behind a proxy (used for signup limits)    |

Requests with any other `Host` header get a 403 (protection against DNS rebinding). `localhost`, `127.0.0.1`, and `::1` are always allowed.

## accounts

Sign-up asks for a name, roll number and password. Passwords are hashed with scrypt (random salt per user). Name and roll number are stored as-is; roll numbers are uppercased and must be unique. Sessions are a random cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days, extended while you use the app). The database stores only a SHA-256 of each session token.

Every semester belongs to one user, and every API route checks ownership: another account's ids behave like missing rows. Changing your password (data menu → change password) signs out your other devices. Failed logins are limited to 10 per roll number per 15 minutes.

To create an account from the shell, or to give an account the semesters that have no owner (data from before accounts existed):

```bash
docker exec tracksem node scripts/create-user.mjs --name "Full Name" --roll 2025115017 --claim
```

It prints a random temporary password unless `TRACKSEM_NEW_PASSWORD` is set.

## home server

The production image builds with Bun and runs on Node 22 (for the SQLite native module).

Create `data/` and a `.env` file alongside `compose.yaml`:

```dotenv
TRACKSEM_BIND_IP=127.0.0.1
TRACKSEM_PORT=3173
TRACKSEM_ORIGIN=https://grades.example.com
TRACKSEM_BASE_PATH=/tracksem
```

```bash
mkdir -p data
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

The container listens on `127.0.0.1:3173` only. Tailscale Funnel publishes it on the internet at <https://grades.example.com/tracksem>, next to uptime-kuma at `/` (Funnel only allows ports 443, 8443 and 10000, and all three are in use):

```bash
tailscale funnel --bg --set-path /tracksem http://127.0.0.1:3173/tracksem
```

The proxy target keeps the `/tracksem` prefix because the app is built with that base path. Changing `TRACKSEM_BASE_PATH` needs a rebuild and a matching Funnel path. `data/` is mounted outside the container so rebuilding or restarting keeps your grades. Its owner must be UID 1000, the container's `node` user.

Schema migrations run automatically on startup (tracked with SQLite's `user_version`), and they are safe to run repeatedly. Take a backup before deploying a new version.

For updates, copy the source without `.env` or `data/`, then run `docker compose up -d --build` again.

Add this entry to Glance's monitor widget:

```yaml
- title: Tracksem
  url: https://grades.example.com/tracksem/
  check-url: http://tracksem:3000/tracksem/api/health
  icon: si:bookstack
```

Glance joins the `tracksem_default` network for that check (see `glance/docker-compose.yml`), and `compose.yaml` allows the `tracksem` hostname. `/api/health` is the only API route that works without signing in.

## agent access (MCP)

Users can let their own AI agents read and edit their grades through an [MCP](https://modelcontextprotocol.io) server at `/tracksem/mcp`. The account page (data menu → account & agents) shows the URL and manages access.

There are two ways to connect:

- **Connectors** (claude.ai, ChatGPT, Claude Desktop). Add a custom connector with `https://grades.example.com/tracksem/mcp`. The client registers itself (OAuth dynamic client registration), sends you to a tracksem consent page, and you pick read-only or read & edit. Access tokens last an hour and refresh tokens 90 days; disconnecting on the account page revokes both.
- **Access tokens** (Claude Code, Cursor, anything that can send a header). Create a token on the account page, then for example:

  ```bash
  claude mcp add --transport http tracksem https://grades.example.com/tracksem/mcp \
    --header "Authorization: Bearer tsm_pat_..."
  ```

The tools cover listing semesters and courses with computed grades and SGPA/CGPA, "what do I need", the curriculum catalog, editing scores, weights, class stats and courses, adding and deleting components, sub-items, courses and semesters, and undoing changes. Read-only access hides the editing tools.

Every edit an agent makes goes into a change log on the account page with an undo button (undo restores deleted items with their original ids). Open tabs refetch as soon as an agent changes something. Bearer tokens work only on `/mcp`, which ignores cookies. The database stores only SHA-256 hashes of tokens and codes, and `/api/export/db` strips them. Each token or connection is limited to 600 requests per 10 minutes.

OAuth discovery looks for metadata at the host root (`/.well-known/oauth-protected-resource/tracksem/mcp`, `/.well-known/oauth-authorization-server/tracksem`), which Funnel otherwise sends to uptime-kuma. Map those paths to the app as well:

```bash
tailscale funnel --bg --set-path /.well-known/oauth-protected-resource/tracksem/mcp \
  http://127.0.0.1:3173/tracksem/.well-known/oauth-protected-resource/mcp
tailscale funnel --bg --set-path /.well-known/oauth-authorization-server/tracksem \
  http://127.0.0.1:3173/tracksem/.well-known/oauth-authorization-server
tailscale funnel --bg --set-path /.well-known/openid-configuration/tracksem \
  http://127.0.0.1:3173/tracksem/.well-known/openid-configuration
```

## backups, export and import

From the dashboard's **data** menu:

- **export JSON**: every semester, course, component and score of your account (`GET /api/export`)
- **download database backup**: a SQLite snapshot trimmed to your account, with no password hash or sessions (`GET /api/export/db`)
- **import JSON**: adds the semesters from an export as *new* semesters labelled "(imported)". Nothing existing is overwritten.

For scheduled backups, `scripts/backup.sh` snapshots the running container's database using SQLite's online backup API (so pending WAL writes are included). Snapshots go to `data/backups/tracksem-<UTC timestamp>.db`, and only the newest 30 are kept:

```bash
scripts/backup.sh                       # TRACKSEM_CONTAINER=tracksem KEEP=30 by default
```

To run it nightly, use cron (`crontab -e`):

```cron
15 3 * * * /path/to/tracksem/scripts/backup.sh >> /path/to/tracksem/data/backups/backup.log 2>&1
```

Or use a systemd user timer:

```ini
# ~/.config/systemd/user/tracksem-backup.service
[Service]
Type=oneshot
ExecStart=/path/to/tracksem/scripts/backup.sh

# ~/.config/systemd/user/tracksem-backup.timer
[Timer]
OnCalendar=*-*-* 03:15
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now tracksem-backup.timer
```

To restore, stop the container, replace `data/tracksem.db` with a snapshot (and remove any `tracksem.db-wal` / `tracksem.db-shm`), then start it again.

## features

- **Semesters**: seeded from the IIIT-H curriculum by branch and semester. You can switch, rename, reorder, and delete semesters, and open courses from any semester.
- **Course editor**: inline editing of components and sub-items (name, weight, score, max), best-of-N, and reset to the course's template.
  - Number fields accept decimals and commit on blur or Enter. Escape reverts.
  - Deletes can be undone for a few seconds.
- **Class stats and curved grades**: enter the class average, median, max, σ, and the % of students with full marks. Missing values are assumed and labelled. Inconsistent stats are flagged. A component or part can take its marks from other items (one or several, averaged by course weight or equally) or from the whole course, either copying the % (absolute) or matching your percentile on its own class curve (relative).
- **What do I need**: the score you need on a remaining component to reach a target %, plus a running total of marks secured so far and the maximum still possible.
- **SGPA**: credit-weighted, using the official grade when you've entered one, otherwise the projected curved grade. Courses with hidden grades are skipped.
- **Save status**: writes are queued and retried. Failures are shown with retry/discard options, and closing the tab with unsaved changes asks for confirmation.
- **Installable**: a web app manifest is included for adding to the home screen.

## absolute grade scale

| Letter | Points | Range  |
| ------ | ------ | ------ |
| A      | 10     | ≥ 90%  |
| A-     | 9      | ≥ 80%  |
| B      | 8      | ≥ 70%  |
| B-     | 7      | ≥ 60%  |
| C      | 6      | ≥ 50%  |
| C-     | 5      | ≥ 40%  |
| D      | 4      | ≥ 33%  |
| F      | 0      | < 33%  |

The curved grade uses percentile cutoffs: A ≥ P90, A- ≥ P80, B ≥ P65, B- ≥ P50, C ≥ P35, C- ≥ P20, D ≥ P10, F below that.

## future plans

- [x] Export and import
- [x] Semester support
- [x] Multi-user support
