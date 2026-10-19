#!/usr/bin/env bash
# Snapshot the live tracksem database with SQLite's online backup API (includes
# pending WAL writes) into data/backups/, keeping the newest $KEEP snapshots.
#
# Usage: scripts/backup.sh            (run from anywhere; uses the repo's data/)
# Env:   TRACKSEM_CONTAINER (default: tracksem), KEEP (default: 30)
set -euo pipefail

CONTAINER="${TRACKSEM_CONTAINER:-tracksem}"
KEEP="${KEEP:-30}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$REPO_DIR/data/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="tracksem-$STAMP.db"

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" node -e "
const Database = require('better-sqlite3');
const fs = require('node:fs');
fs.mkdirSync('/app/data/backups', { recursive: true });
const db = new Database('/app/data/tracksem.db', { readonly: true, fileMustExist: true });
db.backup('/app/data/backups/$NAME')
  .then(() => { db.close(); })
  .catch((error) => { console.error(error); process.exit(1); });
"

if [[ ! -s "$BACKUP_DIR/$NAME" ]]; then
	echo "backup failed: $BACKUP_DIR/$NAME is missing or empty" >&2
	exit 1
fi
echo "wrote $BACKUP_DIR/$NAME"

# Retention: newest $KEEP snapshots survive.
ls -1t "$BACKUP_DIR"/tracksem-*.db 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
	rm -f -- "$old"
	echo "pruned $old"
done
