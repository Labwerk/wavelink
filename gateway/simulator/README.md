# Telemetry simulator

Stands in for a real device gateway (MQTT, OPC-UA, ...) until one is built. Every 2 seconds
it posts a batch of fake readings for three devices to the backend's authenticated ingestion
endpoint, the same way a real gateway would. It never calls a backend mutation directly.

| Device (`externalId`) | Name | Type | Zone |
|---|---|---|---|
| `sim-cnc-01` | CNC Mill 1 | `cnc-mill` | `line-a` |
| `sim-agv-01` | AGV 1 | `agv` | `warehouse` |
| `sim-arm-01` | Robot Arm 1 | `robot-arm` | `line-b` |

Each device reports `temperature_c` (40–70), `cycle_count` (increments each tick) and
`error_code` (`0`, with a 2% chance of `500`).

## Run it locally

These steps assume the native (no Docker) setup with a local `convex dev` deployment. For
Docker, see [Docker](#docker) below. The admin account must already exist; see
[`specs/auth-roles/README.md`](../../specs/auth-roles/README.md).

### 1. Start the app

In terminal 1, from the repo root:

```powershell
npm run dev
```

Leave it running. The backend must be up before you can set the token in step 2.

### 2. Create an ingestion token

In terminal 2, from the repo root. Keep using this same terminal for step 4 so `$token` is
still set:

```powershell
cd D:\Self\wavelink
$token = "simulator." + (-join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
npx convex env set INGEST_TOKENS $token
```

```sh
# bash / Git Bash / WSL equivalent
TOKEN="simulator.$(openssl rand -hex 24)"
npx convex env set INGEST_TOKENS "$TOKEN"
```

`INGEST_TOKENS` is a comma-separated list of `<sourceId>.<secret>` entries stored on the
Convex deployment. If it is unset or empty, every ingestion request is refused.

### 3. Register the three devices

Open [http://localhost:3000](http://localhost:3000), sign in as an admin, and use
**Register device** for each row in the table above.

The simulator does not register devices, because registration is admin-only. Readings for a
device that doesn't exist are rejected with reason `unknown_device` and not stored.

### 4. Run the simulator

In the same terminal as step 2:

```powershell
cd gateway\simulator
$env:WAVELINK_INGEST_URL   = "http://127.0.0.1:3213/ingest/readings"
$env:WAVELINK_INGEST_TOKEN = $token
npm run dev
```

```sh
# bash / Git Bash / WSL equivalent
cd gateway/simulator
WAVELINK_INGEST_URL=http://127.0.0.1:3213/ingest/readings \
WAVELINK_INGEST_TOKEN="$TOKEN" \
npm run dev
```

You should see a line like `Ingested batch ...: submitted=9 stored=9` every 2 seconds, and
the devices show as `online` with live readings on the dashboard.

> **Use the site URL, not the API URL.** Ingestion is an HTTP action served from the
> deployment's *site* origin. For a local `convex dev` deployment that is the
> `CONVEX_SITE_URL` in the repo-root `.env.local` (here `http://127.0.0.1:3213`), **not**
> `CONVEX_URL` (`:3212`). The port can change between runs, so check `.env.local` or the
> `convex dev` output. On Convex Cloud it is the `.convex.site` URL. Self-hosted Docker
> uses port `3211`.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `WAVELINK_INGEST_URL` | yes | none | Full ingestion endpoint, ending in `/ingest/readings`. |
| `WAVELINK_INGEST_TOKEN` | yes | none | One `<sourceId>.<secret>` entry from the deployment's `INGEST_TOKENS`. |
| `SIMULATOR_INTERVAL_MS` | no | `2000` | Delay between batches, in ms. |
| `WAVELINK_MAX_BATCH` | no | `50` | Readings per request. Must not exceed the deployment's `INGEST_MAX_READINGS_PER_BATCH`. |

The simulator exits immediately with an error if either required variable is missing.

## Docker

```sh
docker compose --profile simulator up simulator
```

The compose file sets the URL to `http://backend:3211/ingest/readings`. In the repo-root
`.env`, set `INGEST_TOKENS` (the deployment's list) and `WAVELINK_INGEST_TOKEN` (exactly one
`<sourceId>.<secret>` entry from that list). See the root
[README](../../README.md#docker-deployment) for the full setup.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `WAVELINK_INGEST_URL env var is required` | The variable isn't set in this terminal. Re-run the two `$env:` lines in step 4. |
| `Ingest request rejected (category=...)` / HTTP `401` | The token doesn't match `INGEST_TOKENS` on the deployment. Re-run step 2 and step 4 in the same terminal. The simulator keeps retrying, so once the token is correct, ingestion resumes without a restart. |
| Network error, `ECONNREFUSED` | `convex dev` isn't running, or the port is wrong. Check the site port in `.env.local`. |
| `Reading rejected: ... reason=unknown_device` | The device isn't registered yet. Do step 3. |
| `reason=inactive_device` | The device was deactivated. Reactivate it in the dashboard. |
| `429` / rate limited | The simulator backs off automatically (1 s up to 60 s, with jitter) and recovers on its own. |
| Devices flip to `offline` | No reading for about 60 seconds. The simulator stopped or is failing. |
| Devices show `online` but no readings appear | Check the URL ends in `/ingest/readings` and uses the site port, not the API port. |

On failure the simulator logs and retries. It does not exit, and it does not retry faster
than the capped backoff.
