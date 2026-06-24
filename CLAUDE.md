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

Full spec in [`docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md`](docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md). The principle: **MeshCore owns the radio/mesh layer** (freq, SF, BW, routing — consumed via the MIT `meshcore.js` Companion Protocol library), **SCOUT owns the application layer** (Supabase URL, identity, device_id, SHCP, GPS). The Field Tech app drives both as one workflow.

`src/transports/meshcore.js` is a stub. Sprints:
- **F0** — wire `meshcore.js`; `APP_START` + `DEVICE_QUERY` against a real node.
- **F1** — decide *dual-channel* (SCOUT config inside MeshCore companion link) vs *dual-firmware-window* (separate SCOUT BLE session, then MeshCore). This decision shapes how `meshcore.js` and `BleTransport` interact.
- **F2** — `SET_RADIO`/`SET_CHANNEL` fleet params; `GET_CONTACTS` link check.
- **F3** — SHCP sensor test over mesh + auto-registration confirm (sensor MAC in DB).
- **F4–F5** — deployment planner, link-budget validation, per-customer instance binding, offline queue.

> ⚠️ **Blocking gate before F2:** the on-air fleet radio params are unresolved — **SF7/0x12 vs SF10/0x53** doc discrepancy. Do NOT implement `SET_RADIO` until this is settled against ground truth, or provisioned nodes will be deaf to the fleet.

## Working rules

- **Never commit to `main`** if `main` is production for this repo — branch first. (Confirm the repo's convention; the wider ecosystem treats `main` as production and works on `develop`/`feature/*`.)
- Never hardcode transport URLs/ports — use `WIFI_AP_BASE_URL` and the UUID/CMD constants from `constants.js`.
- BLE only works over HTTPS, **except** when the app is served from the device AP at `http://192.168.4.1`. The scan button auto-disables on plain HTTP.
- Test on **Chrome Android** before reporting a transport change complete. Safari/Firefox don't support Web Bluetooth.
- This is a migration from a single 1879-line `index.html` (was published from the `SCOUT_Field_app` GitHub repo via Pages). Behaviour parity with that file is the baseline — don't drop features when refactoring.
