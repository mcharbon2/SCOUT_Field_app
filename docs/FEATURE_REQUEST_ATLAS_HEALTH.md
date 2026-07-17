# Feature Request — "ATLAS HEALTH" check in SCOUT Field Tech

**Requested by:** owner (Martin), 2026-07-17
**Origin:** PILOT#001 first light on Théâtre du lac (see `PILOTE_WEB/RND_LOG.md`
2026-07-17 and `PILOTE_WEB/docs/SCOUT_PILOT_001_RUNBOOK.md`)
**Priority:** nice-to-have — **NOT a PILOT#001 blocker**. Post-pilot / when convenient.
**Status:** proposed (not yet scheduled)

---

## The problem it solves

During PILOT#001 first light, the owner placed a rooftop INGENUITY gateway and
walked a ROVER, then had to leave. Whether the data was actually reaching the
cloud (**ATLAS** — the data-sync organ, i.e. the shared Supabase) could only be
confirmed **afterward, from the office**, by querying `scout_telemetry_raw`.

The field technician has no way, **while standing next to the hardware**, to
answer the one question that matters after provisioning a device:

> "Is this device's data actually making it to ATLAS right now?"

BLE/WiFi/MeshCore transports prove the *phone↔device* link. They say nothing
about the *device→gateway→ATLAS* path — which is the path a deployed device
actually depends on. An in-app ATLAS HEALTH check would make a smoke test
self-evidently green (or red) on site, instead of a trip back to a computer.

## What it should do

A read-only "ATLAS link" check, keyed on the connected device's resolved
`device_id`, that reports whether recent telemetry from that device has landed
in the cloud. Transport-agnostic (it's a cloud read, not a device call), so it
works the same whether the tech connected over BLE, WiFi, or MeshCore.

**For a ROVER (or any relayed sensor):**
- Query `scout_telemetry_raw` for the most recent row where `device_id = <this device>`.
- Show, e.g.:
  - ✅ **"Reaching ATLAS — last heard 2 min ago via `INGENUITY-LORA-002`, RSSI −97 dBm (LoRa)"**
  - ⚠️ **"No telemetry in the last N min — not reaching ATLAS yet"** (below a configurable freshness threshold).

**For an INGENUITY gateway being provisioned:**
- Check its own recent rows (`received_via = 'wifi'`, most recent `recorded_at`,
  `battery_voltage`) to confirm the gateway itself is online and posting.
- Show, e.g. ✅ **"Gateway online — last heartbeat 40 s ago, battery 3.89 V."**

**UX suggestion (not prescriptive):** a new **"ATLAS"** tab on the connected
screen, or a **"Check ATLAS link"** button, showing a single status line +
freshness timestamp + gateway + RSSI, with an optional auto-refresh (poll every
~15 s) so the tech can watch the first packet land in real time. Reuse the
existing `logComm()` / `showToast()` / status-tab patterns; the value that
matters is the **freshness verdict**, not a data dump.

## Fields to display (all already exist in `scout_telemetry_raw`)

| Field | Meaning for the verdict |
|---|---|
| `recorded_at` | freshness — "last heard X ago" (the core signal) |
| `received_via` | `lora` / `wifi` / `meshcore` — how it arrived |
| `gateway_id` | which INGENUITY relayed it (null for direct-WiFi) |
| `rssi` / `snr` | link quality of the last hop |
| `battery_voltage` | gateway/device health, where present |

## Reuse — this maps onto existing app plumbing

- Device identity resolution already exists: `src/utils/deviceLookup.js`
  (`resolveHardwareIdCandidates()`) turns the connected device's BLE-reported
  identity into the right `device_id` (masked-first for LoRa rovers). The ATLAS
  check should key on the **same** resolved `device_id` this returns, so it
  agrees with what provisioning bound.
- Supabase anon access already exists (`src/constants.js`, inlined anon key).
- The reference query is exactly what `PILOTE_WEB/backend/scout_sim/walkabout_status.py`
  and the PILOT#001 office-side check ran, just scoped to one `device_id`.

## ⚠️ Prerequisite / open question — anon SELECT RLS on `scout_telemetry_raw`

This app runs **unauthenticated on the anon key**. Today it only **reads**
`scout_devices` and **writes** `scout_device_locations`/`_history`. This feature
needs anon **SELECT on `scout_telemetry_raw`**, which may not be granted.

Per this repo's own `location_source ↔ RLS` discipline (CLAUDE.md § "Standing
constraint"), a shared-Supabase access change belongs to PILOTE_WEB **first**:
if anon SELECT on `scout_telemetry_raw` is not already allowed, the RLS policy
must be widened there (a scoped, read-only SELECT — ideally limited to the
columns above, no bulk export), in the same shared-Supabase change, **before**
this feature can ship. First implementation step: verify the current anon RLS on
`scout_telemetry_raw` (a one-line `rest/v1` GET with the anon key) and report
back — do not assume it's readable.

## Explicitly out of scope

- No alerting/notifications, no history charts — a single live freshness verdict.
- No writes of any kind.
- Not a replacement for the device-side sensor/LoRa self-tests; this is the
  complementary **cloud-arrival** check they can't provide.

## Cross-repo notes

- Data source: PILOTE_WEB's `scout-ingress` populates `scout_telemetry_raw`.
- If an RLS change is needed, it is a **shared-Supabase contract change** →
  coordinate with PILOTE_WEB (`STATE_OF_PROJECT.md` §5/§7, migration notify rule).
