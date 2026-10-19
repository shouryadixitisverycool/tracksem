# tracksem

> track your sem 2 grades before they track you

A TUI-style grade tracker for sem 2 courses — ISS, CSO, IoT, LA, DSA. Enter scores, get live projections, manage components dynamically with local SQLite persistence.

## stack

- [SvelteKit](https://kit.svelte.dev) + Svelte 5 runes
- [shadcn-svelte](https://shadcn-svelte.com) + Tailwind CSS v4
- [Bun](https://bun.sh)
- [SQLite](https://www.sqlite.org/index.html) for local persistence

## dev

```bash
bun install
bun run dev
```

→ `http://localhost:5173`

The SQLite database (`data/tracksem.db`) is auto-created on first run.

## home server

The production app uses SvelteKit's [Node adapter](https://svelte.dev/docs/kit/adapter-node), with Node 22 for the SQLite native module. Bun installs dependencies and builds the app.

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

Open <http://grades.example.com:3173> while connected to Tailscale. The port binds only to the configured Tailscale IP. `data/` is mounted outside the container so rebuilding or restarting keeps your grades. Its owner must be UID 1000, the container's `node` user.

For updates, copy the source without `.env` or `data/`, then run `docker compose up -d --build` again. Back up the running database with SQLite's backup API before transferring it, so pending WAL writes are included.

Add this entry to Glance's monitor widget:

```yaml
- title: Tracksem
  url: http://grades.example.com:3173/
  check-url: http://100.83.24.70:3173/api/semesters
  icon: si:bookstack
```

The separate health-check address uses Glance's [monitor configuration](https://github.com/glanceapp/glance/blob/main/docs/configuration.md#monitor).

## features

- **Dashboard** — all courses at a glance with letter grade, projected %, and per-component bars
- **Course detail** — click any card to open a live-editable table
  - edit component name, weight, score, max score inline
  - add custom components (bonus marks, participation, etc.)
  - remove any component
  - reset to defaults
- **Expandable components** — click ⊕ on any flat component to add sub-items (e.g. split "Quiz" into Quiz 1, Quiz 2)
- **Best-of scoring** — drop lowest N scores automatically (e.g. best 8 of 9 labs)
- **Live projection** — weighted average recalculates instantly as you type
- **Weight validation** — warns if component weights don't sum to 100%
- **SQLite persistence** — data lives in `data/tracksem.db`, survives restarts

## courses

| Course | Total Weight |
| ------ | ------------ |
| ISS    | 100%         |
| CSO    | 100%         |
| IoT    | 100%         |
| LA     | 100%         |
| DSA    | 92% ⚠        |

## grade scale

| Letter | Range  |
| ------ | ------ |
| A      | ≥ 90%  |
| A-     | 85–89% |
| B      | 80–84% |
| B-     | 75–79% |
| C      | 70–74% |
| C-     | 65–69% |
| D      | 60–64% |
| F      | < 60%  |

## Future Plans

- [ ] Export and Import
- [X] Semester Support
- [ ] Multi-user Support
