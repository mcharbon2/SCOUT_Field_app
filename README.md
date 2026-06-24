# SCOUT Field Tech

Provisioning & diagnostics PWA for TerraDigital **SCOUT** IoT devices. A field technician connects to a SCOUT device over **BLE**, **WiFi AP**, or **MeshCore** (in progress), configures it, tests it, and registers it to the cloud — from a phone, in the bush.

Part of the **TerraDigital OS** ecosystem (sibling repos: `PILOTE_WEB`, `ESP32-SCOUT-PROJECT`, `pilote-terrain-companion`).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build & deploy

```bash
npm run build    # → dist/
npm run deploy   # publish dist/ to GitHub Pages
```

Open on **Chrome for Android** — Web Bluetooth (BLE) is not supported in Safari or Firefox.

## How it works

One transport-abstraction layer, three transports, identical command interface
(`connect → getInfo → configure → status → sensorTest → diagnostic`):

| Transport | Devices | Link |
|---|---|---|
| BLE (`ble.js`) | ESP32 — ROVER-*, INGENUITY, CURIOSITY | Web Bluetooth GATT |
| WiFi (`wifi.js`) | ESP8266 — ROVER-BASIC/TEMP/PRO-WIFI | HTTP to `192.168.4.1` |
| MeshCore (`meshcore.js`) | PATHFINDER relays, `-MESH` companions | Companion Protocol — **Sprint F0** |

See [`CLAUDE.md`](CLAUDE.md) for architecture and protocol contracts, and
[`docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md`](docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md)
for the mesh roadmap.
