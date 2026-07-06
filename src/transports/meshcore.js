// MeshCore Companion Protocol transport — Sprint F0 (identity read: APP_START + DEVICE_QUERY)
// Protocol source of truth: MeshCore checkout @ e8d3c53 (docs/companion_protocol.md,
// src/helpers/esp32/SerialBLEInterface.cpp, examples/companion_radio/MyMesh.cpp) —
// the exact version ESP32-SCOUT-PROJECT's PATHFINDER firmware builds against.
//
// BLE (Nordic-UART-style service — NOT the SCOUT BLE service):
//   Service 6e400001-b5a3-f393-e0a9-e50e24dcca9e
//   RX (app→fw, write) 6e400002-… · TX (fw→app, notify) 6e400003-…
//   One protocol frame per write/notification · write-with-response · 5 s command timeout.
//   Firmware mandates static-PIN bonded pairing (PIN echoed in DEVICE_INFO bytes 4-7).
//   Device-side max frame = 176 bytes (firmware MAX_FRAME_SIZE); Chrome negotiates MTU itself.
//
// Commands (F0): APP_START  = [0x01, 7×0x00 reserved, app name UTF-8] → auto-reply PACKET_SELF_INFO (0x05)
//                DEVICE_QUERY = [0x16, 0x03]  (two bytes; 0x03 = app protocol version) → PACKET_DEVICE_INFO (0x0D)
//
// F1 decision (2026-07-06): dual-firmware-window — SCOUT app-layer config runs over the
// separate SCOUT BLE session (BleTransport); this transport speaks pure MeshCore companion
// protocol. See docs/SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md § F1 Decision.
//
// Radio params (LoRa layer — unrelated to the BLE bytes above): RESOLVED — fleet standard is
// SF10 / BW125 / CR4:5 / sync 0x53 / PHY-CRC ON (ESP32-SCOUT-PROJECT docs/SHCP_MESH_ARCHITECTURE.md,
// Sprint M0.1). SET_RADIO / meshConfig() is Sprint F2 — intentionally not implemented here.

import {
  MESHCORE_SERVICE_UUID, MESHCORE_RX_CHAR_UUID, MESHCORE_TX_CHAR_UUID,
  MC_CMD_APP_START, MC_CMD_DEVICE_QUERY, MC_PROTOCOL_VERSION,
  MC_RESP_SELF_INFO, MC_RESP_DEVICE_INFO,
} from '../constants.js';
import { logComm } from '../ui/log.js';
import { setConnected } from '../ui/connected.js';

const APP_NAME = 'SCOUT-FT';
const CMD_TIMEOUT_MS = 5000;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

// Trim trailing NUL padding from a fixed-width ASCII field.
function trimNulString(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
}

export default class MeshCoreTransport {
  constructor() {
    this.type = 'mesh';
    this.bleDevice = null;
    this.bleServer = null;
    this.txChar = null; // notify (firmware → app)
    this.rxChar = null; // write (app → firmware)
    this.selfInfo = null;
    this.deviceInfo = null;
    this._userInitiatedDisconnect = false;
    this._reconnecting = false;
    this._pending = null; // { expectedCode, resolve, reject, timer }
    this._notifyHandler = (e) => this._onNotification(e); // bound once — reconnect re-adds the same ref
  }

  async connect() {
    logComm('info', 'Requesting MeshCore BLE device...');
    this.bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MESHCORE_SERVICE_UUID] }],
    });

    logComm('info', `Selected: ${this.bleDevice.name}`);
    this.bleDevice.addEventListener('gattserverdisconnected', () => this._onDisconnected());

    await this._acquireServiceAndChars();

    logComm('info', 'Sending APP_START...');
    this.selfInfo = await this._sendAppStart();
    logComm('info', `PACKET_SELF_INFO received: ${this.selfInfo.device_name || '(unnamed)'}`);

    logComm('info', 'Sending DEVICE_QUERY...');
    this.deviceInfo = await this._sendDeviceQuery();
    logComm('info', `PACKET_DEVICE_INFO received: ${this.deviceInfo.model_name || '(unknown model)'}`);
  }

  async getInfo() {
    const self = this.selfInfo || {};
    const dev = this.deviceInfo || {};
    return {
      transport:        'mesh',
      device_name:      self.device_name || this.getDeviceName(),
      model_name:       dev.model_name || '—',
      fw_version:       dev.fw_version || '—',
      fw_build:         dev.fw_build || '—',
      protocol_version: dev.protocol_version,
      public_key:       self.public_key || '',
      ble_pin:          dev.ble_pin,
      radio_freq:       self.radio_freq,
      radio_bw:         self.radio_bw,
      radio_sf:         self.radio_sf,
      radio_cr:         self.radio_cr,
      tx_power:         self.tx_power,
      max_tx_power:     self.max_tx_power,
      adv_lat:          self.adv_lat,
      adv_lon:          self.adv_lon,
      has_lora:         true,
      configured:       true,
      // Fields other transports populate that connected.js also reads —
      // kept defined (rather than undefined) so shared UI code doesn't crash.
      battery:          0xFF,
      sensor_name:      '—',
      sensor_type:      undefined,
      class_code:       undefined,
      transport_type:   undefined,
    };
  }

  async configure() {
    throw new Error('Not on the mesh link — SCOUT app-layer config uses the SCOUT BLE session (F1: dual-firmware-window)');
  }

  async getStatus() {
    throw new Error('Not on the mesh link — SCOUT app-layer status uses the SCOUT BLE session (F1: dual-firmware-window)');
  }

  async sensorTest() {
    throw new Error('Not on the mesh link — SCOUT app-layer sensor test uses the SCOUT BLE session (F1: dual-firmware-window)');
  }

  async loraTest() {
    throw new Error('LoRa test N/A on mesh — use meshConfig() link check');
  }

  async getDiagnostic() {
    throw new Error('Not on the mesh link — SCOUT app-layer diagnostics use the SCOUT BLE session (F1: dual-firmware-window)');
  }

  async meshConfig() {
    throw new Error('meshConfig (SET_RADIO/SET_CHANNEL) is Sprint F2 — not implemented');
  }

  disconnect() {
    this._userInitiatedDisconnect = true;
    if (this.bleDevice?.gatt?.connected) this.bleDevice.gatt.disconnect();
    logComm('info', 'MeshCore transport disconnected');
  }

  getDeviceName() {
    return this.bleDevice?.name ?? this.selfInfo?.device_name ?? 'MESH-NODE';
  }

  // ─── Internal MeshCore helpers ───────────────────────

  async _acquireServiceAndChars() {
    logComm('info', 'Connecting to GATT server...');
    this.bleServer = await this.bleDevice.gatt.connect();
    logComm('info', 'Connected. Discovering MeshCore service...');

    const service = await this.bleServer.getPrimaryService(MESHCORE_SERVICE_UUID);
    this.rxChar = await service.getCharacteristic(MESHCORE_RX_CHAR_UUID);
    this.txChar = await service.getCharacteristic(MESHCORE_TX_CHAR_UUID);

    // Subscribe BEFORE writing APP_START, or the firmware's auto-reply is lost.
    // Remove-then-add keeps the handler single across reconnects (Chrome caches
    // characteristic objects, so re-acquisition can return the same instance).
    await this.txChar.startNotifications();
    this.txChar.removeEventListener('characteristicvaluechanged', this._notifyHandler);
    this.txChar.addEventListener('characteristicvaluechanged', this._notifyHandler);
    logComm('info', 'MeshCore service discovered, notifications active.');
  }

  async _sendAppStart() {
    const nameBytes = new TextEncoder().encode(APP_NAME);
    const frame = new Uint8Array(8 + nameBytes.length);
    frame[0] = MC_CMD_APP_START;
    // bytes 1-7 reserved, left as 0x00
    frame.set(nameBytes, 8);

    const resp = await this._sendCommand(frame, MC_RESP_SELF_INFO);
    return this._parseSelfInfo(resp);
  }

  async _sendDeviceQuery() {
    const frame = new Uint8Array([MC_CMD_DEVICE_QUERY, MC_PROTOCOL_VERSION]);
    const resp = await this._sendCommand(frame, MC_RESP_DEVICE_INFO);
    return this._parseDeviceInfo(resp);
  }

  async _sendCommand(frame, expectedCode) {
    if (this._reconnecting) throw new Error('MeshCore link reconnecting — retry shortly');
    if (!this.rxChar || !this.bleDevice?.gatt?.connected) throw new Error('Not connected');
    if (this._pending) throw new Error('MeshCore command already in flight');

    logComm('tx', `MeshCore CMD 0x${frame[0].toString(16).padStart(2, '0')} len=${frame.length}`);

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        const msg = `Timeout waiting for MeshCore response 0x${expectedCode.toString(16).padStart(2, '0')}`;
        logComm('err', msg);
        reject(new Error(msg));
      }, CMD_TIMEOUT_MS);

      this._pending = { expectedCode, resolve, reject, timer };

      try {
        await this.rxChar.writeValueWithResponse(frame);
      } catch (err) {
        clearTimeout(timer);
        this._pending = null;
        logComm('err', `MeshCore write failed: ${err.message}`);
        reject(err);
      }
    });
  }

  _onNotification(event) {
    const data = event.target.value; // DataView
    const code = data.getUint8(0);
    logComm('rx', `MeshCore RSP 0x${code.toString(16).padStart(2, '0')} len=${data.byteLength}`);

    if (this._pending && code === this._pending.expectedCode) {
      const { resolve, timer } = this._pending;
      clearTimeout(timer);
      this._pending = null;
      resolve(data);
    } else {
      // Firmware can push unsolicited frames (e.g. contact updates) — keep waiting.
      logComm('info', `ignoring unexpected MeshCore frame 0x${code.toString(16).padStart(2, '0')}`);
    }
  }

  _parseSelfInfo(data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pubKey = Array.from(bytes.slice(4, 36))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const nameBytes = bytes.slice(58);

    return {
      adv_type:     data.getUint8(1),
      tx_power:     data.getInt8(2),
      max_tx_power: data.getUint8(3),
      public_key:   pubKey,
      adv_lat:      data.getInt32(36, true) / 1e6,
      adv_lon:      data.getInt32(40, true) / 1e6,
      multi_acks:       data.getUint8(44),
      adv_loc_policy:   data.getUint8(45),
      telemetry_mode:   data.getUint8(46),
      manual_add_contacts: data.getUint8(47),
      radio_freq:   data.getUint32(48, true) / 1000.0,
      radio_bw:     data.getUint32(52, true) / 1000.0,
      radio_sf:     data.getUint8(56),
      radio_cr:     data.getUint8(57),
      device_name:  new TextDecoder().decode(nameBytes),
    };
  }

  _parseDeviceInfo(data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const fwVerCode = data.getUint8(1);

    const info = {
      protocol_version: fwVerCode,
      max_contacts:     data.getUint8(2) * 2,
      max_channels:     data.getUint8(3),
      ble_pin:          data.getUint32(4, true),
      fw_build:         trimNulString(bytes.slice(8, 20)),
      model_name:       trimNulString(bytes.slice(20, 60)),
      fw_version:       trimNulString(bytes.slice(60, 80)),
    };

    if (fwVerCode >= 9 && bytes.length > 80) info.client_repeat = data.getUint8(80);
    if (fwVerCode >= 10 && bytes.length > 81) info.path_hash_mode = data.getUint8(81);

    return info;
  }

  _onDisconnected() {
    logComm('info', 'MeshCore device disconnected');

    // Fail any in-flight command immediately — waiting out the 5 s timeout
    // would misreport a dead link as a device timeout.
    if (this._pending) {
      const { reject, timer } = this._pending;
      clearTimeout(timer);
      this._pending = null;
      reject(new Error('MeshCore link lost mid-command'));
    }

    if (this._userInitiatedDisconnect) {
      setConnected(false);
      return;
    }
    this._reconnecting = true;
    this._attemptReconnect(0);
  }

  async _attemptReconnect(attemptIndex) {
    if (attemptIndex >= RECONNECT_DELAYS_MS.length) {
      this._reconnecting = false;
      logComm('err', 'MeshCore reconnect failed after 3 attempts');
      setConnected(false);
      return;
    }

    const delay = RECONNECT_DELAYS_MS[attemptIndex];
    logComm('info', `MeshCore reconnecting (attempt ${attemptIndex + 1}/${RECONNECT_DELAYS_MS.length}, waiting ${delay}ms)...`);

    await new Promise(r => setTimeout(r, delay));

    try {
      await this._acquireServiceAndChars();
      // The companion session restarts with the new GATT link — APP_START again
      // so the firmware session is live and selfInfo stays fresh.
      this._reconnecting = false;
      this.selfInfo = await this._sendAppStart();
      logComm('info', 'MeshCore reconnected — session restarted');
    } catch (err) {
      this._reconnecting = true;
      logComm('err', `MeshCore reconnect attempt ${attemptIndex + 1} failed: ${err.message}`);
      this._attemptReconnect(attemptIndex + 1);
    }
  }
}
