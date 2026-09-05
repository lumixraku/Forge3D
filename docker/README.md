# Docker and the Local Database

This directory documents the Docker-based PostgreSQL environment used by Forge3D. The repository-root [`README.md`](../README.md) is the user guide; architecture, data-model, and deployment details are available in [`docs/`](../docs/README.md).

## Start PostgreSQL

The Docker Compose file is located in the repository root:

```bash
docker compose up -d postgres
```

Default connection settings:

```text
host: 127.0.0.1
port: 5432
database: forge3d
user: forge3d
password: forge3d
```

Connection string:

```text
postgresql://forge3d:forge3d@127.0.0.1:5432/forge3d
```

Data is persisted in the `forge3d-postgres` Docker volume. Stopping the container does not delete the data. To remove the local database and its data:

```bash
docker compose down -v
```

## Storage Responsibilities

When `DATABASE_URL` is configured, the local Node API uses PostgreSQL:

- `forge3d_documents` stores canvases, sessions, execution records, Agent traces, accounts, credit-ledger entries, and other application documents.
- `forge3d_assets` stores binary image and model assets.
- Application documents use `JSONB`; binary assets use `BYTEA`.
- The service applies migrations from `server/migrations/` at startup.
- An empty database is initialized from the read-only data in `server/seed/`.

PostgreSQL is used by the local Node runtime, not by the Cloudflare web deployment. The Cloudflare Worker uses the D1 binding from `wrangler.toml`; these databases do not synchronize automatically.

## File-store Fallback

When `DATABASE_URL` is not configured, the Node API uses the file store:

- Application data is written to `server/data/*.json`.
- Binary assets are written to `server/data/assets/`.

The file store is suitable for quick evaluation and development without a database. It does not automatically migrate or synchronize data with PostgreSQL.

## Related Files

- [`../docker-compose.yml`](../docker-compose.yml): PostgreSQL 16 container definition.
- [`../server/postgres-store.ts`](../server/postgres-store.ts): PostgreSQL store implementation.
- [`../server/migrations/`](../server/migrations/): PostgreSQL migrations.
- [`../server/seed/`](../server/seed/): initial data for an empty local database.
- [`../.env.example`](../.env.example): local environment variable example.
