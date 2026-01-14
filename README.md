# Focuz Web

Frontend for **focuz-note** (local-first notes).

**Status**: alpha  
**Version**: 0.1.0-alpha

## Environment

Vite env variables:
- `VITE_API_BASE_URL`: API base URL (e.g. `http://localhost:8080`)
- `VITE_APP_ENV`: runtime environment (`production` | `test`)

## Run (via Docker Compose)

From repo root:

```bash
# production-like
APP_ENV=production docker compose up -d --build

# test environment toggles (feature flags enable experimental UI)
APP_ENV=test docker compose up -d --build
```
