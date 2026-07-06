# SCOUT Field Tech App — MeshCore Integration Specification

## Unifying SCOUT Provisioning with MeshCore Radio/Mesh Management

**Document Version:** 1.0
**Date:** June 23, 2026
**Status:** Design — pre-implementation
**Author:** Martin Charbonneau
**Related:** SCOUT_UNIFIED_CONFIG_API_SPEC.md, SCOUT_BLE_SERVICE_SPEC.md,
ROVER_FSM_SPECIFICATION.md (§5 BLUETOOTH_CONFIG), SHCP_MESH_ARCHITECTURE.md,
MeshCore Companion Protocol (docs.meshcore.io/companion_protocol)

---

## Table of Contents

1. [Purpose & Principle](#purpose--principle)
2. [The Two-Layer Boundary](#the-two-layer-boundary)
3. [What We Leverage vs What We Build](#what-we-leverage-vs-what-we-build)
4. [Architecture: A Third Transport/Capability Layer](#architecture)
5. [MeshCore Companion Protocol — Endpoints We Consume](#meshcore-endpoints)
6. [SCOUT Endpoints — Existing & Extended](#scout-endpoints)
7. [Unified Provisioning Flow (MESH device)](#unified-flow)
8. [Extended Capabilities We Develop](#extended-capabilities)
9. [Integration Risks & Compliance](#risks)
10. [Build Sprints](#build-sprints)
11. [Open Questions](#open-questions)

---

## Purpose & Principle

The SCOUT Field Tech App already provisions ESP32 (BLE) and ESP8266 (WiFi-HTTP)
devices through a transport-abstraction layer with identical command semantics:
`getInfo() → configure() → status() → sensorTest()`.

This spec adds **MeshCore-based mesh devices** (PATHFINDER relays and `-MESH`
Companion sensors) to that same app — **without rebuilding the radio/mesh layer**.

**Guiding principle (two layers, two owners):**

> MeshCore owns the **radio/mesh** layer (frequency, SF, bandwidth, routing,
> node identity on the mesh). SCOUT owns the **application** layer (backend URL,
> device identity, SHCP, auto-registration). The Field Tech app is the **single
> pane of glass** that drives both, leveraging MeshCore's Companion Protocol for
> the first and SCOUT's existing config protocol for the second.

We leverage MeshCore code/protocol for what it already does well, and build
SCOUT-specific provisioning and extended field capabilities on top.

---

## The Two-Layer Boundary

This boundary mirrors the SHCP-payload-vs-MeshCore-transport split already
established in SHCP_MESH_ARCHITECTURE.md. A field technician provisioning a
`-MESH` device must configure **both** layers, but they are distinct concerns:

| Concern | Layer | Owner | Tooling source |
|---|---|---|---|
| Radio frequency / region | Radio/mesh | MeshCore | Companion Protocol |
| Spreading factor, bandwidth, coding rate | Radio/mesh | MeshCore | Companion Protocol |
| Mesh routing role (Companion vs Repeater) | Radio/mesh | MeshCore | firmware flash + protocol |
| Mesh node name / advert | Radio/mesh | MeshCore | Companion Protocol |
| Path/route visualization | Radio/mesh | MeshCore | Companion Protocol |
| **Supabase backend URL** | **Application** | **SCOUT** | SCOUT config protocol |
| **Customer/instance identity** | **Application** | **SCOUT** | SCOUT config protocol |
| **device_id / auto-registration** | **Application** | **SCOUT** | SCOUT + scout-ingress |
| **SHCP sensor config / test** | **Application** | **SCOUT** | SCOUT config protocol |
| **GPS deployment coordinates** | **Application** | **SCOUT** | SCOUT config protocol |

The technician sees one workflow; under the hood the app speaks two protocols
over the same BLE link.

---

## What We Leverage vs What We Build

### Leverage from MeshCore (do NOT reinvent)

- **The Companion Protocol** — a documented, platform-agnostic BLE command set
  with existing **JavaScript (`meshcore.js`)** and **Python (`meshcore_py`)**
  client libraries (MIT). This is the single biggest reuse: the entire
  radio-config surface is already specified and coded.
- **Radio parameter configuration** — SET frequency/SF/BW/CR over BLE, removing
  the need to build our own radio-config UI plumbing.
- **Route/path visualization & signal metrics** — MeshCore already exposes
  per-contact SNR, path history, and route tracing. Field-useful diagnostics for
  free.
- **Remote repeater management over RF** — administering a PATHFINDER over the
  mesh (vs physical access) is a MeshCore feature; valuable for ridge-mounted
  relays.
- **The flasher** (flasher.meshcore.io) for initial MeshCore firmware install,
  and `config.meshcore.dev` for screenless-repeater radio setup.

### Build in SCOUT (our differentiators)

- **SCOUT application provisioning over the same link** — inject Supabase URL,
  customer/instance identity, and trigger MAC→device_id auto-registration. This
  is SCOUT-specific and is NOT in MeshCore's app.
- **The unified Field Tech UX** — one guided workflow that sequences MeshCore
  radio config + SCOUT app config so a technician never juggles two apps.
- **SHCP sensor test over mesh** — verify the SCOUT payload codec end-to-end
  (extends the existing `CMD_SENSOR_TEST 0x07`).
- **Per-customer config templating** — preload the correct instance backend so
  field provisioning is "scan → confirm → deploy," not manual entry.
- **Extended capabilities** (see §8) — mesh deployment planning, link-budget
  field validation, instance binding, offline provisioning queue.

---

## Architecture

The MeshCore layer slots into the EXISTING transport abstraction as a third
capability — not a parallel app:

```
┌──────────────────────────────────────────────────────────────┐
│                    SCOUT Field Tech App                        │
│        getInfo() → configure() → status() → sensorTest()       │
│                   + meshConfig()  (NEW)                         │
├───────────────┬───────────────┬───────────────────────────────┤
│  BLE (ESP32)  │ WiFi-HTTP     │   MeshCore BLE Companion (NEW) │
│  NimBLE GATT  │ (ESP8266)     │   via meshcore.js / protocol   │
│  CMD_* codes  │ JSON REST     │   companion-protocol frames    │
├───────────────┴───────────────┴───────────────────────────────┤
│        SCOUT app-layer config (Supabase URL, identity,         │
│         device_id, SHCP) carried over WHICHEVER link           │
└──────────────────────────────────────────────────────────────┘
```

Key insight: a `-MESH` device runs **MeshCore BLE Companion firmware** for radio
config AND must accept **SCOUT app-layer config**. Two sub-cases for how SCOUT
config reaches it (decide in Sprint F1 — see Open Questions):
- **(A) Dual-channel:** SCOUT app config travels as a SCOUT-defined payload over
  MeshCore's companion link (custom command range), OR
- **(B) Dual-firmware-window:** device exposes SCOUT BLE config first
  (existing `ROVER-CFG-*` flow), then switches to MeshCore Companion for radio
  config — two BLE sessions, one technician workflow.

---

## MeshCore Endpoints We Consume

From the MeshCore Companion Protocol (BLE; default MTU 23B/20B payload, request
larger MTU up to 512B for bigger commands). The app consumes these via
`meshcore.js`:

| Companion command | Byte | SCOUT app use |
|---|---|---|
| `APP_START` | 0x01 | Initialize companion session (must be first) |
| `DEVICE_QUERY` | 0x16 | Read firmware version, model, BLE PIN, capabilities |
| `GET_SELF_INFO` | — | Read node identity / advert name |
| `SET_RADIO` (freq/SF/BW/CR) | — | Push SCOUT-standard radio params (reconcile w/ fleet) |
| `SET_CHANNEL` | 0x20 | Configure mesh channel/secret (32B name + 16B secret) |
| `GET_CONTACTS` | — | List reachable mesh nodes for link validation |
| `SEND_TRACE` / path tools | — | Field route/link diagnostics |
| `PACKET_ERROR` | 0x01 (resp) | Surface mesh-layer errors to technician |

Implementation notes (from the protocol docs):
- **One frame per BLE write/notification** at the firmware layer; queue commands.
- **Validate frame lengths**; treat unknown error codes as generic.
- **Auto-reconnect with exponential backoff** — devices disconnect on inactivity.
- **Use write-with-response** for reliability during provisioning.

> ✅ **Radio-param reconciliation gate — RESOLVED (2026-07-06).** The fleet on-air standard
> is **SF10 / BW125 / CR4:5 / sync word 0x53 / PHY-CRC ON**, per ESP32-SCOUT-PROJECT
> `docs/SHCP_MESH_ARCHITECTURE.md` (Sprint M0.1 — firmware-confirmed and RadioLib-verified
> against a live fleet packet). The old SF7/0x12 values came from a non-deployed early
> ROVER_BASIC build. `SET_RADIO` (Sprint F2) must push the SF10/0x53 params. This concerns
> the **LoRa radio layer**, not the BLE companion-protocol byte layouts above. Caveat:
> PATHFINDER's radio init does not yet apply the 0x53 sync word (PATHFINDER_DESIGN_NOTE.md
> Q10 — fix belongs in ESP32-SCOUT-PROJECT); a PATHFINDER node may ignore a `SET_RADIO`
> push until that is fixed.

---

## F1 Decision (2026-07-06): dual-firmware-window

**Decision:** SCOUT application-layer config (Supabase URL, identity, device_id, SHCP, GPS) runs over the existing **SCOUT BLE service session** (`BleTransport`); the mesh/radio layer runs over a **separate MeshCore companion-protocol session** (`MeshCoreTransport`). The technician connects to each in turn from the scan screen — two windows, one workflow.

**Why not dual-channel** (SCOUT config tunnelled inside the MeshCore companion link):
1. The pinned companion firmware (MeshCore @ e8d3c53) has no reserved command range for third-party application payloads — dual-channel means forking upstream MeshCore firmware, a cross-repo contract we don't control.
2. The companion firmware exposes only the Nordic-UART-style BLE service; no SCOUT GATT service coexists on that firmware, so a single-connection/two-services variant is equally unavailable.
3. This app's architecture is one active transport at a time (`state.transport` singleton) with per-transport scan buttons — two sequential sessions drop straight into the existing dispatch with no new abstraction.

**Cost accepted:** the technician performs two BLE connects per node (SCOUT window, then MeshCore window). MeshCore's static-PIN bonding happens once per phone/node pair.

**Consequence for the code:** `MeshCoreTransport` speaks *pure* companion protocol (`APP_START`, `DEVICE_QUERY` now; `SET_RADIO`/`SET_CHANNEL` in F2) and never carries SCOUT app-layer commands. `BleTransport` is untouched. The `@liamcottle/meshcore.js` library (MIT, official) was evaluated and NOT vendored for F0: it ships no dist build or tests, requires Vite external-module workarounds for its lazy `serialport`/`net` imports, adds `@noble/curves` to the bundle, and sends protocol version 0x01 (not 0x03) in `DEVICE_QUERY`. Hand-rolling two commands against firmware-verified bytes was smaller and exact. Revisit vendoring at F2 when the command surface grows.

**Revisit trigger:** if ESP32-SCOUT-PROJECT later adds a SCOUT command range to its companion firmware build, dual-channel can be reconsidered as a UX optimization.

---

## SCOUT Endpoints — Existing & Extended

The existing SCOUT command protocol (BLE CMD_* / WiFi HTTP) is unchanged for
WiFi/LoRa devices and **extended** for MESH:

| SCOUT command | BLE code | HTTP | MESH behaviour |
|---|---|---|---|
| `getInfo()` | read Device Info | `GET /api/info` | Returns `model_code: *-MESH`, `transport: meshcore`, mesh node id |
| `configure()` | `CMD_CONFIGURE 0x01` | `POST /api/configure` | Adds `mesh_role`, omits `wifi_ssid/pass` (mesh has no WiFi); keeps `supabase_url`, identity, GPS |
| `status()` | `CMD_STATUS 0x02` | `GET /api/status` | Adds mesh metrics (hop count, last relay, route state) |
| `sensorTest()` | `CMD_SENSOR_TEST 0x07` | `GET /api/sensor-test` | SHCP packet built and sent **over the mesh**; confirm receipt at PATHFINDER |
| `diagnostic()` | `CMD_DIAGNOSTIC 0x05` | `GET /api/diagnostic` | Adds mesh link budget, neighbour SNR |
| `meshConfig()` | **NEW** | n/a (BLE only) | Wraps MeshCore Companion Protocol radio config |

`config_fields` for a MESH device (returned by `getInfo()`):
`["supabase_url", "supabase_anon_key", "device_label", "gps_lat", "gps_lon",
"mesh_role"]` — note **no `wifi_ssid`/`wifi_password`** (mesh transport), and
`mesh_role` ∈ `{companion, repeater}`.

EEPROM/NVS map extends the existing scheme (0x000 device_id, 0x080 supabase_url,
…) with a `mesh_role` field; radio params live in MeshCore's own NVS, set via
Companion Protocol, not duplicated in SCOUT storage.

---

## Unified Provisioning Flow (MESH device)

What the technician experiences as one workflow; what the app does underneath:

```
Technician                     Field Tech App                Device (-MESH)
    │                                │                            │
    │ 1. Scan                        │  BLE scan: MeshCore + *-CFG │
    │───────────────────────────────►│◄───────────────────────────│
    │                                │                            │
    │ 2. Select device               │                            │
    │                                │  ── RADIO LAYER (MeshCore) ─┤
    │                                │  APP_START → DEVICE_QUERY    │
    │                                │  SET_RADIO (fleet SF/BW/CR)  │
    │                                │  SET_CHANNEL (instance mesh) │
    │                                │                            │
    │ 3. Confirm customer instance   │  ── APP LAYER (SCOUT) ──────┤
    │    (preloaded template)        │  configure(): supabase_url,  │
    │                                │   identity, gps, mesh_role   │
    │                                │  device saves to NVS         │
    │                                │                            │
    │ 4. Validate                    │  sensorTest(): SHCP over mesh│
    │                                │  status(): hop count, SNR    │
    │                                │  confirm device_id in DB     │
    │◄───────────────────────────────│  ✓ provisioned & registered │
```

The two layers are sequenced but presented as a single "provision this node"
action with a progress indicator.

---

## Extended Capabilities We Develop

Beyond parity with the WiFi/LoRa flow, MESH provisioning unlocks SCOUT-specific
field tools worth building (these are the differentiators, and good IRAP-fundable
R&D framing on the *sensing/deployment* side — no QS):

1. **Mesh deployment planner** — as the technician walks a site, use MeshCore's
   live SNR/route data to advise PATHFINDER placement ("move 40 m uphill for a
   second hop"). Turns link metrics into placement guidance.
2. **Link-budget field validation** — before leaving a node, confirm it reaches
   a PATHFINDER and ultimately the lodge gateway with margin; flag marginal links.
3. **Per-customer instance binding** — the app holds the active customer template
   (Supabase URL/key) so every node provisioned in a session binds to the correct
   isolated instance automatically (the per-customer model from
   TERRADIGITAL_PRODUCT_STRATEGY.md, enforced in the field).
4. **Offline provisioning queue** — in no-signal field conditions, queue device→
   customer bindings and flush registration to scout-ingress on reconnect (mirrors
   PATHFINDER's BUFFER_PERSIST pattern).
5. **Sleepy-Companion commissioning mode** — temporarily hold a `-MESH` Companion
   awake during provisioning/validation, then arm deep sleep on completion (ties
   to the MESH_DRAIN tuning from the FSM).

---

## Integration Risks & Compliance

| Risk | Mitigation |
|---|---|
| Radio params mis-set → device deaf to fleet | Resolve SF/sync discrepancy; app pushes fleet-standard `SET_RADIO`; validate with `GET_CONTACTS` before finishing |
| **Origin MAC not preserved** through provisioning | App confirms the **sensor's** MAC (not PATHFINDER's) appears in `scout_devices` as the final provisioning check |
| MeshCore BLE PIN / pairing friction | Read BLE PIN via `DEVICE_QUERY`; surface to technician; document per-device |
| Two-session UX confusion (radio then app) | Single progress workflow; never expose the two protocols as two apps |
| Freemium/iOS-lag dependency on official app | Consume the **Companion Protocol directly** via `meshcore.js`/`meshcore_py` (MIT), or MeshCore Open — never hard-depend on the freemium client |
| BLE MTU (23B default) too small for SCOUT config | Request larger MTU (up to 512B) at session start; chunk if unsupported |

Compliance carries from SHCP_MESH_ARCHITECTURE.md: SHCP packets stay opaque
across the mesh; CRC validates end-to-end; `received_via="meshcore"`; originating
MAC anchors auto-registration.

---

## Build Sprints

| Sprint | Goal | Done when |
|---|---|---|
| **F0** | Wire `meshcore.js` into the Field Tech app; `APP_START`+`DEVICE_QUERY` against a real MeshCore node | App reads a MeshCore node's info over BLE |
| **F1** | Decide dual-channel vs dual-firmware-window for SCOUT app config on MESH; prototype the chosen path | SCOUT `supabase_url` + identity reach a `-MESH` device |
| **F2** | `SET_RADIO`/`SET_CHANNEL` push fleet-standard params; `GET_CONTACTS` link check | Provisioned node hears the fleet; radio params correct |
| **F3** | `sensorTest()` SHCP-over-mesh + auto-registration confirm (sensor MAC in DB) | End-to-end MESH provisioning + correct device_id |
| **F4** | Extended capability #1–#2 (deployment planner + link-budget validation) | Technician gets placement guidance from live metrics |
| **F5** | Per-customer instance binding + offline queue (#3–#4) | Session binds nodes to correct instance; offline flush works |

Each sprint is a working app increment and a clean commit (per GIT_WORKFLOW_GUIDE.md).

---

## Open Questions

- **Dual-channel vs dual-firmware-window — DECIDED (2026-07-06):** dual-firmware-window. See § F1 Decision above.
- **SCOUT GATT service coexistence — ANSWERED (2026-07-06):** the pinned companion firmware exposes only the Nordic-UART-style service; no SCOUT GATT service coexists. Folded into the F1 decision.
- **Radio-param source of truth — RESOLVED (2026-07-06):** fleet standard is SF10 / BW125 / CR4:5 / sync 0x53 / PHY-CRC ON (`SHCP_MESH_ARCHITECTURE.md`, Sprint M0.1). SF7/0x12 was a non-deployed early ROVER_BASIC build.
- **iOS parity:** `meshcore.js` (web/React Native) vs native — which client stack
  for the SCOUT app, given iOS companion-client history?
- **Provisioning auth:** should per-customer instance binding require technician
  authentication so a node can't be bound to the wrong customer instance?

---

**END OF DOCUMENT**
