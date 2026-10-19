# tracksem

> track your sem grades before they track you

A TUI-style semester grade tracker for IIIT-H courses. Pick your branch and semester, get the curriculum's courses with their evaluation breakdowns pre-filled, enter scores and class stats, and get live absolute and curved (relative) projections, SGPA/CGPA, and "what do I need" targets. Data is stored in a local SQLite file.

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

Requests with any other `Host` header get a 403 (protection against DNS rebinding). `localhost`, `127.0.0.1`, and `::1` are always allowed.

## home server

The production image builds with Bun and runs on Node 22 (for the SQLite native module).

Create `data/` and a `.env` file alongside `compose.yaml`:

```dotenv
TRACKSEM_BIND_IP=100.83.24.70
TRACKSEM_PORT=3173
TRACKSEM_ORIGIN=http://grades.example.com:3173
```

```bash
mkdir -p data
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

Open <http://grades.example.com:3173> while connected to Tailscale. The port binds only to the configured Tailscale IP, and `compose.yaml` allows that IP plus the `ORIGIN` host in the `Host` check. `data/` is mounted outside the container so rebuilding or restarting keeps your grades. Its owner must be UID 1000, the container's `node` user.

Schema migrations run automatically on startup (tracked with SQLite's `user_version`), and they are safe to run repeatedly. Take a backup before deploying a new version.

For updates, copy the source without `.env` or `data/`, then run `docker compose up -d --build` again.

Add this entry to Glance's monitor widget:

```yaml
- title: Tracksem
  url: http://grades.example.com:3173/
  check-url: http://100.83.24.70:3173/api/semesters
  icon: si:bookstack
```

The separate health-check address uses Glance's [monitor configuration](https://github.com/glanceapp/glance/blob/main/docs/configuration.md#monitor).

## backups, export and import

From the dashboard's **data** menu:

- **export JSON**: every semester, course, component and score (`GET /api/export`)
- **download database backup**: a consistent SQLite snapshot (`GET /api/export/db`)
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
- **Class stats and curved grades**: enter the class average, median, max, σ, and the % of students with full marks. Missing values are assumed and labelled. Inconsistent stats are flagged. A component can be scaled against another one.
- **What do I need**: the score you need on a remaining component to reach a target %, plus a running total of marks secured so far and the maximum still possible.
- **SGPA / CGPA**: credit-weighted, using the official grade when you've entered one, otherwise the projected curved or absolute grade (toggle in the header). Courses with hidden grades are skipped.
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
- [ ] Multi-user support
