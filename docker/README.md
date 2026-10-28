# Local Database

The Node API stores application data and uploaded assets in one SQLite file. Docker is not required. The repository-root [`README.md`](../README.md) is the user guide; architecture and deployment details are in [`docs/`](../docs/README.md).

## File

By default the file is:

```text
server/data/forge3d.sqlite
```

`server/data/` is gitignored, so the file stays on this machine. To put it somewhere else, set `SQLITE_PATH` in `.env`.

The service creates the file on startup, applies the SQLite migrations in [`../migrations/`](../migrations/), and copies `server/seed/` into an empty database. Stopping the process does not delete the file. Delete `server/data/forge3d.sqlite` (and its `-wal` and `-shm` siblings, if present) to start over.

## What is stored

- Canvases, sessions, runs, turns, Agent traces, accounts, and the credit ledger live in the tables defined by `migrations/`. Nested graphs and messages are JSON text. This is the same schema Cloudflare D1 applies.
- `forge3d_assets` stores image and model bytes. That table is created by the Node process only; the Worker does not upload assets.
- The JSON store in `server/store.ts` is not used by the running API.

The local file and the Cloudflare D1 database do not synchronize. Deploying does not upload local canvases.

## Related Files

- [`../server/sqlite-store.ts`](../server/sqlite-store.ts): local SQLite store.
- [`../migrations/`](../migrations/): schema shared with D1.
- [`../server/seed/`](../server/seed/): initial data for an empty local database.
- [`../.env.example`](../.env.example): local environment variable example.
