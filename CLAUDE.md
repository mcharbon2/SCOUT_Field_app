# CLAUDE.md — SCOUT Field Tech App

## What this is

**SCOUT Field Tech** is the provisioning and diagnostics PWA for TerraDigital **SCOUT** IoT devices (part of the **TerraDigital OS** platform for the Pourvoirie Fer à Cheval wilderness lodge). A field technician opens it on their phone, connects to a SCOUT device over **BLE**, **WiFi AP**, or **MeshCore** (in progress), configures it, tests its sensor/radio, and registers it to the shared Supabase backend.

The UI and device vocabulary are mostly English here (technical field tool); the wider TerraDigital ecosystem is French. Match the surrounding file when editing.

Deployed via **GitHub Pages** from `dist/`. Also served directly by ESP8266 device APs at `http://192.168.4.1/app` (the WiFi provisioning flow). Primary target browser: **Chrome on Android** (Web Bluetooth requirement).

### Part of the TerraDigital ecosystem — sibling repos (all Claude-managed)
- **`PILOTE_WEB`** — the main React ops platform + Flask/BI backends. Hosts the canonical project docs.
- **`ESP32-SCOUT-PROJECT`** — the SCOUT firmware this app provisions (BLE service, CMD_* codes, device-served WiFi app all live there). **This app's protocol constants are a contract with that firmware.**
- **`pilote-terrain-companion`** — the PILOTE *mobile* app (Capacitor). Separate concern — do NOT merge this app into it.
- **`forge-display`** — ESP32 desk displays.

All share the **same Supabase project** (`zzeefmyvtsrmpeluewhy`). A table/RLS/RPC change is a cross-repo contract.

## Commands

```bash
npm install      # first time
npm run dev      # Vite dev server (localhost:5173), live reload
npm run build    # → dist/
npm run preview  # serve the production build locally
npm run deploy   # gh-pages -d dist  (publish dist/ to GitHub Pages)
```

There is no test runner. Verify by running on Chrome Android against a real device, or with the device's WiFi AP.

## Architecture — Vite + vanilla JS modules (no framework)

The whole app is a transport-abstraction over a shared device-command interface. Every transport class implements the **same methods**, so the UI never branches on transport except for display:

```
connect() · getInfo() · configure(params) · getStatus()
sensorTest() · loraTest() · getDiagnostic() · disconnect() · getDeviceName()
```

MeshCore adds one more: `meshConfig()` (radio/mesh layer).

```
src/
  constants.js          BLE UUIDs, Supabase coords, CMD_* codes, device/sensor/transport maps
  state.js              mutable singleton { transport, deviceInfo, capturedGPS }
  main.js               DOMContentLoaded wiring — binds all buttons, inits tabs
  transports/
    ble.js              BleTransport — Web Bluetooth GATT, SCOUT BLE service, binary packets
    wifi.js             WifiHttpTransport — fetch() to 192.168.4.1/api/*, JSON
    meshcore.js         MeshCoreTransport — STUB, Sprint F0 (see roadmap below)
  ui/
    scan.js             scan screen, transport selection, connect flows
    connected.js        device bar, setConnected(), per-transport tab visibility, switchTab()
    log.js              logScan() / logComm() / clearLog()
    toast.js            showToast()
    tabs/
      configure.js      station name, zone, GPS, WiFi creds, sensor mode → transport.configure()
      status.js         device status polling
      sensor.js         live sensor test — binary (BLE) + JSON (WiFi) renderers
      lora.js           LoRa ping test (BLE-capable devices only)
      diagnostics.js    full diagnostic dump
  utils/
    gps.js              captureGPS, preCaptureGPS, loadGPSFromURL, uploadGPSToSupabase
    format.js           formatUptime
```

**Why vanilla, not React:** the value is the transport abstraction, not view state. A new transport is a new class implementing the interface — no framework needed. Keep it that way unless there's a real reason.

## Critical constants — DO NOT change without matching the firmware

These live in `src/constants.js` and mirror `scout_ble_config.h` / the device HTTP API in `ESP32-SCOUT-PROJECT`. Changing one side silently breaks provisioning.

**BLE SCOUT service UUIDs** (NimBLE):
- Service: `53434f55-5400-0001-4e45-54574f524b53`
- TX char: `…0002…` · RX char: `…0003…` · DevInfo: `…0004…`

**BLE command codes:** `0x01 CONFIGURE`, `0x02 STATUS`, `0x04 FIRMWARE`, `0x05 DIAGNOSTIC`, `0x07 SENSOR_TEST`, `0x08 LORA_TEST`, `0x09 WIFI_CONFIG` (INGENUITY only), `0x0A SENSOR_MODE` (ROVER-BAIT only).

**DevInfo characteristic** is an 18-byte packed struct; **status/diagnostic** responses are packed binary at offset 4/7. Byte offsets in `ble.js` match the firmware struct layout — verify against firmware before editing.

**Supabase** project `zzeefmyvtsrmpeluewhy`. Tables touched directly: `scout_devices` (hardware_id → device_id lookup) and `scout_device_locations` (GPS upsert for the ATLAS map). The anon key is **intentionally inlined** in `constants.js` — this app runs on the device's own HTTP server where build-time env vars don't exist. Do not move it to `.env`.

**WiFi AP** `192.168.4.1`, HTTP only. GPS bridging trick: the HTTPS (GitHub Pages) app captures GPS, then redirects to `http://192.168.4.1/app?lat=&lon=&alt=`; the device-served copy reads those params (`loadGPSFromURL`) because geolocation needs HTTPS and the device AP is HTTP.

## MeshCore integration — sprint roadmap (in progress)

Full spec in [`docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md`](docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md). The principle: **MeshCore owns the radio/mesh layer** (freq, SF, BW, routing — spoken directly by `MeshCoreTransport` — hand-rolled companion protocol, byte-verified against the pinned firmware; the MIT `@liamcottle/meshcore.js` library exists but is not vendored (see § F1 Decision in the integration doc)), **SCOUT owns the application layer** (Supabase URL, identity, device_id, SHCP, GPS). The Field Tech app drives both as one workflow.

`src/transports/meshcore.js` is a stub. Sprints:
- **F0** — ✅ implemented (2026-07-06): `MeshCoreTransport` speaks the companion protocol directly (hand-rolled, byte-verified against MeshCore @ e8d3c53); `APP_START` + `DEVICE_QUERY` read node identity. Awaiting on-hardware confirmation.
- **F1** — ✅ decided (2026-07-06): **dual-firmware-window** — SCOUT app-layer config over the SCOUT BLE session, mesh/radio layer over a separate MeshCore companion session. Rationale in `docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md` § F1 Decision.
- **F2** — `SET_RADIO`/`SET_CHANNEL` fleet params; `GET_CONTACTS` link check.
- **F3** — SHCP sensor test over mesh + auto-registration confirm (sensor MAC in DB).
- **F4–F5** — deployment planner, link-budget validation, per-customer instance binding, offline queue.

> ✅ **Radio-param gate — RESOLVED (2026-07-06):** the fleet on-air standard is **SF10 / BW125 / CR4:5 / sync word 0x53 / PHY-CRC ON**, firmware-confirmed and RadioLib-verified against a live fleet packet (ESP32-SCOUT-PROJECT `docs/SHCP_MESH_ARCHITECTURE.md`, Sprint M0.1). The old SF7/0x12 values came from a non-deployed early ROVER_BASIC build. `SET_RADIO` (Sprint F2) must push the SF10/0x53 params. This is the **LoRa radio layer** — unrelated to the BLE companion-protocol bytes. Remaining caveat (fix belongs in ESP32-SCOUT-PROJECT, not here): PATHFINDER's own radio init does not yet use the 0x53 sync word (PATHFINDER_DESIGN_NOTE.md Q10), so a PATHFINDER node may not obey a `SET_RADIO` push until that firmware bug is fixed.

## Working rules

- **Never commit to `main`** if `main` is production for this repo — branch first. (Confirm the repo's convention; the wider ecosystem treats `main` as production and works on `develop`/`feature/*`.)
- Never hardcode transport URLs/ports — use `WIFI_AP_BASE_URL` and the UUID/CMD constants from `constants.js`.
- BLE only works over HTTPS, **except** when the app is served from the device AP at `http://192.168.4.1`. The scan button auto-disables on plain HTTP.
- Test on **Chrome Android** before reporting a transport change complete. Safari/Firefox don't support Web Bluetooth.
- This is a migration from a single 1879-line `index.html` (was published from the `SCOUT_Field_app` GitHub repo via Pages). Behaviour parity with that file is the baseline — don't drop features when refactoring.

## PILOT#001 — rôle de ce dépôt

**Runbook:** `PILOTE_WEB/docs/SCOUT_PILOT_001_RUNBOOK.md` (canonical PILOT#001 procedure lives there).

This app is the **on-site field tool** for the PILOT#001 pilot (lake-house window, weeks 2–3 walkabout). Two field jobs land here:

1. **Provision INGENUITY WiFi over BLE** — the `0x09 WIFI_CONFIG` command (INGENUITY-only) pushes WiFi credentials to the node during setup.
2. **Record real device positions + relocations** — `uploadGPSToSupabase()` (`src/utils/gps.js`) upserts `scout_device_locations` (current position) **and** appends a `scout_device_location_history` row for every position/relocation. It **upserts** (SELECT → PATCH-or-POST), never delete-then-insert, so a failed write never leaves a device with no location. A **manual coordinate entry** fallback (`applyManualGPS()`) covers degraded GPS under forest canopy.

**Why the history matters:** those `scout_device_location_history` writes feed PILOTE_WEB's RF calibration — `backend/scout_sim/calibrate.py` segments telemetry into **position epochs** from this table (`_fetch_location_history()` / `_assign_epoch()`). A relocation without a history row silently corrupts the calibration geometry.

**Device resolution is class-aware, masked-first for LoRa rovers (fixed on `fix/masked-mac-lookup`, Escape 2):** `scout_devices` lookup used to be a plain full-BLE-MAC match, so it could BIND the INGENUITY (full-MAC, WiFi-registered) but never a LoRa rover — a LoRa-relayed device only ever registers *masked* (`??:??:??:XX:YY:ZZ`, scout-ingress only ever sees the last 3 octets from the relay JSON), so the full-MAC lookup returned 0 rows and the app refused to record its position. `src/utils/deviceLookup.js` (`resolveHardwareIdCandidates()`) now derives the lookup order from what the connected device SAYS IT IS over BLE: a LoRa-transport ROVER/ROVER-BAIT tries the **masked form first**, falling back to full MAC only if masked misses (covers a WiFi-provisioned rover with no masked row yet); INGENUITY and WiFi-transport devices still resolve by full MAC only, as before. This distinction matters because the same physical board can carry **two** `scout_devices` rows — e.g. MAC `90:15:06:D8:43:B8` has both a full-MAC row from a past WiFi-gateway life (`INGENUITY-LORA-001`, stale) and a masked row for its current LoRa-rover identity (`??:??:??:D8:43:B8` = `ROVER-BAIT-LORA-006`, live) — so a naive "try full, then fall back to masked" would silently bind GPS to the wrong, stale identity for exactly those boards. Cross-repo pin: PILOTE_WEB's `backend/scout_sim/verify_identity_resolution.py` (exit 2 KNOWN-GAP) tracked this gap; `sim_identity.py`'s `masked_form()` is mirrored in `deviceLookup.js`. Rovers can also still be located via PILOTE_WEB's `provision_real_location` CLI in masked form as a backstop.

### Standing constraint — `location_source` ↔ RLS contract

This app runs **unauthenticated on the anon key**. PILOTE_WEB migration `20260716120000` grants anon INSERT on `scout_device_location_history` **only** `WITH CHECK (location_source IN ('gps', 'manual'))`. `src/utils/gps.js` therefore writes `location_source` as **only** `'gps'` or `'manual'` (line ~218). **Do not introduce any other `location_source` value from this app** (e.g. `'qr_scan'`, `'inferred'`) — those are reserved for authenticated paths and an anon POST with such a value returns **HTTP 42501 (RLS violation)**, blocking the field upload. If this app ever needs a new source tag, the PILOTE_WEB RLS policy must be widened **first**, in the same shared-Supabase change.
