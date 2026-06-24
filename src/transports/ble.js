import {
  SCOUT_SERVICE_UUID, SCOUT_TX_CHAR_UUID, SCOUT_RX_CHAR_UUID, SCOUT_DEVINFO_CHAR_UUID,
  CMD_CONFIGURE, CMD_STATUS, CMD_DIAGNOSTIC, CMD_SENSOR_TEST, CMD_LORA_TEST,
  DEVICE_MODELS, SENSOR_TYPES,
} from '../constants.js';
import { logComm } from '../ui/log.js';
import { setConnected } from '../ui/connected.js';

export default class BleTransport {
  constructor() {
    this.type = 'ble';
    this.bleDevice = null;
    this.bleServer = null;
    this.txChar = null;
    this.rxChar = null;
    this.infoChar = null;
    this.seqId = 0;
    this.pendingCallbacks = {};
  }

  async connect() {
    logComm('info', 'Requesting BLE scan...');
    this.bleDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'ROVER-' },
        { namePrefix: 'CURIOSITY-' },
        { namePrefix: 'SPIRIT-' },
        { namePrefix: 'INGENUITY-' },
      ],
      optionalServices: [SCOUT_SERVICE_UUID],
    });

    logComm('info', `Selected: ${this.bleDevice.name}`);
    this.bleDevice.addEventListener('gattserverdisconnected', () => {
      logComm('info', 'BLE device disconnected');
      setConnected(false);
    });

    logComm('info', 'Connecting to GATT server...');
    this.bleServer = await this.bleDevice.gatt.connect();
    logComm('info', 'Connected. Discovering SCOUT service...');

    const service = await this.bleServer.getPrimaryService(SCOUT_SERVICE_UUID);
    this.txChar   = await service.getCharacteristic(SCOUT_TX_CHAR_UUID);
    this.rxChar   = await service.getCharacteristic(SCOUT_RX_CHAR_UUID);
    this.infoChar = await service.getCharacteristic(SCOUT_DEVINFO_CHAR_UUID);
    logComm('info', 'SCOUT service discovered. Reading device info...');

    await this.rxChar.startNotifications();
    this.rxChar.addEventListener('characteristicvaluechanged', e => this._onRxNotification(e));
  }

  async getInfo() {
    const val = await this.infoChar.readValue();
    return {
      transport:        'ble',
      device_name:      this.bleDevice.name,
      protocol_version: val.getUint8(0),
      class_code:       val.getUint8(1),
      model_code:       val.getUint8(2),
      fw_version:       `${val.getUint8(3)}.${val.getUint8(4)}.${val.getUint8(5)}`,
      mac: Array.from({ length: 6 }, (_, i) =>
        val.getUint8(6 + i).toString(16).padStart(2, '0')).join(':').toUpperCase(),
      battery:          val.getUint8(12),
      sensor_type:      val.getUint8(13),
      transport_type:   val.getUint8(14),
      config_state:     val.getUint8(15),
      capabilities:     val.getUint8(16),
      error_state:      val.getUint8(17),
      model_name:       DEVICE_MODELS[val.getUint8(2)] || `Model 0x${val.getUint8(2).toString(16)}`,
      sensor_name:      SENSOR_TYPES[val.getUint8(13)] || '?',
      has_lora:         (val.getUint8(16) & 0x01) !== 0,
      configured:       val.getUint8(15) !== 0,
    };
  }

  async configure(params) {
    const enc = new TextEncoder();

    if (params.station_name) {
      const nameBytes = enc.encode(params.station_name);
      const resp = await this._sendCommand(CMD_CONFIGURE, [0x01, nameBytes.length, ...nameBytes]);
      if (!resp || resp.status !== 0) throw new Error('Failed to set station name');
    }

    if (params.zone) {
      const zoneBytes = enc.encode(params.zone);
      const resp = await this._sendCommand(CMD_CONFIGURE, [0x03, zoneBytes.length, ...zoneBytes]);
      if (!resp || resp.status !== 0) throw new Error('Failed to set zone');
    }

    // WiFi credentials — INGENUITY-specific command 0x09 (CMD_WIFI_CONFIG)
    if (params.wifi_ssid) {
      const ssidBytes = enc.encode(params.wifi_ssid);
      const resp = await this._sendCommand(0x09, [0x01, ssidBytes.length, ...ssidBytes]);
      if (!resp || resp.status !== 0) throw new Error('Failed to set WiFi SSID');
    }

    if (params.wifi_password !== undefined && params.wifi_password !== '') {
      const passBytes = enc.encode(params.wifi_password);
      const resp = await this._sendCommand(0x09, [0x02, passBytes.length, ...passBytes]);
      if (!resp || resp.status !== 0) throw new Error('Failed to set WiFi password');
    }

    if (params.gps_lat !== undefined && params.gps_lon !== undefined) {
      const buf = new ArrayBuffer(11);
      const view = new DataView(buf);
      view.setUint8(0, 0x02);
      view.setFloat32(1, params.gps_lat, true);
      view.setFloat32(5, params.gps_lon, true);
      view.setInt16(9, params.gps_alt || 0, true);
      const resp = await this._sendCommand(CMD_CONFIGURE, Array.from(new Uint8Array(buf)));
      if (!resp || resp.status !== 0) throw new Error('Failed to set GPS');
    }

    // Sensor mode — ROVER-BAIT only. CMD_SENSOR_MODE (0x0A), 1-byte payload.
    if (params.sensor_mode !== undefined) {
      const resp = await this._sendCommand(0x0A, [params.sensor_mode]);
      if (!resp || resp.status !== 0) throw new Error('Failed to set sensor mode');
    }

    return { success: true };
  }

  async getStatus() {
    const resp = await this._sendCommand(CMD_STATUS);
    if (!resp || resp.status !== 0) throw new Error('Status request failed');
    const d = resp.data;
    return {
      battery:           d.getUint8(4),
      uptime:            d.getUint32(5, true),
      last_tx:           d.getUint32(9, true),
      pending_events:    d.getUint8(13),
      sensor_status:     ['OK', 'Failed', 'Simulated'][d.getUint8(14)] || '?',
      transport_status:  ['OK', 'Disconnected', 'Error'][d.getUint8(15)] || '?',
      boot_count:        d.getUint16(16, true),
      false_triggers:    d.getUint16(18, true),
      last_error:        d.getUint8(20),
      configured:        d.getUint8(21) !== 0,
    };
  }

  async sensorTest() {
    const resp = await this._sendCommand(CMD_SENSOR_TEST);
    if (!resp || resp.status !== 0) throw new Error('Sensor test failed');
    return { _raw: resp.data, _offset: 4, transport: 'ble' };
  }

  async loraTest() {
    const resp = await this._sendCommand(CMD_LORA_TEST);
    if (!resp) throw new Error('No response from device');
    const d = resp.data;
    return {
      result:   d.getUint8(4),
      rssi:     d.getInt16(5, true),
      snr:      d.getInt8(7) / 10,
      tx_power: d.getUint8(8),
      sf:       d.getUint8(9),
    };
  }

  async getDiagnostic() {
    const resp = await this._sendCommand(CMD_DIAGNOSTIC);
    if (!resp || resp.status !== 0) throw new Error('Diagnostic request failed');
    const d = resp.data;
    const offset = 7;
    return {
      transport:          'ble',
      boot_count:         d.getUint32(offset, true),
      uptime_seconds:     d.getUint32(offset + 4, true),
      false_triggers:     d.getUint16(offset + 8, true),
      pending_events:     d.getUint8(offset + 10),
      consecutive_errors: d.getUint8(offset + 11),
      last_error_code:    d.getUint8(offset + 12),
      sensor_type:        d.getUint8(offset + 13),
      transport_type:     d.getUint8(offset + 14),
      power_source:       d.getUint8(offset + 15) === 0x01 ? 'USB' : 'Battery',
      battery_mv:         d.getUint16(offset + 16, true),
      chunk_index:        d.getUint8(4),
      total_chunks:       d.getUint8(5),
    };
  }

  disconnect() {
    if (this.bleDevice?.gatt.connected) this.bleDevice.gatt.disconnect();
  }

  getDeviceName() {
    return this.bleDevice?.name ?? '—';
  }

  // ─── Internal BLE helpers ───────────────────────

  _nextSeq() { this.seqId = (this.seqId + 1) % 256; return this.seqId; }

  async _sendCommand(cmdCode, payload = []) {
    if (!this.txChar) throw new Error('Not connected');
    const seq = this._nextSeq();
    const packet = new Uint8Array([cmdCode, seq, 0x00, payload.length, ...payload]);
    logComm('tx', `BLE CMD 0x${cmdCode.toString(16).padStart(2, '0')} seq=${seq} len=${payload.length}`);

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        delete this.pendingCallbacks[seq];
        logComm('err', `Timeout waiting for BLE response seq=${seq}`);
        resolve(null);
      }, 10000);

      this.pendingCallbacks[seq] = (data) => {
        clearTimeout(timeout);
        delete this.pendingCallbacks[seq];
        resolve(data);
      };

      try {
        await this.txChar.writeValue(packet);
      } catch (err) {
        clearTimeout(timeout);
        delete this.pendingCallbacks[seq];
        logComm('err', `BLE write failed: ${err.message}`);
        reject(err);
      }
    });
  }

  _onRxNotification(event) {
    const data    = event.target.value;
    const cmdCode = data.getUint8(0);
    const seq     = data.getUint8(1);
    const status  = data.getUint8(2);
    const len     = data.getUint8(3);
    logComm('rx', `BLE RSP 0x${cmdCode.toString(16).padStart(2, '0')} seq=${seq} status=${status} len=${len}`);
    if (this.pendingCallbacks[seq]) this.pendingCallbacks[seq]({ cmdCode, seq, status, len, data });
  }
}
