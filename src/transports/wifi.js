import { SUPABASE_URL, SUPABASE_ANON_KEY, WIFI_AP_BASE_URL } from '../constants.js';
import { logComm } from '../ui/log.js';

export default class WifiHttpTransport {
  constructor() {
    this.type = 'wifi';
    this._cachedInfo = null;
    const saved = sessionStorage.getItem('wifiCreds');
    this._sessionCreds = saved ? JSON.parse(saved) : { ssid: '', password: '' };
  }

  async connect() {
    logComm('info', 'Attempting HTTP connection to 192.168.4.1...');
    const info = await this._fetch('/api/info');
    this._cachedInfo = info;
    logComm('rx', `Device found: ${info.model_code || info.device_name}`);
    logComm('info', `Firmware: ${info.fw_version}`);
    logComm('info', `MAC: ${info.mac}`);
  }

  async getInfo() {
    const raw = this._cachedInfo || await this._fetch('/api/info');
    this._cachedInfo = raw;
    const sensorTypeByte = this._sensorNameToByte(raw.sensor_type);
    const transportTypeByte = raw.transport_type_byte ||
      (raw.transport_type === 'WiFi' ? 0x01 : 0x02);
    return {
      transport:        'wifi',
      device_name:      raw.device_name || raw.model_code || 'SCOUT-WIFI',
      protocol_version: raw.protocol_version || 1,
      class_code:       raw.class_code || 0x01,
      model_code:       raw.model_code_byte || 0x11,
      fw_version:       raw.fw_version || '?.?.?',
      mac:              raw.mac || '??:??:??:??:??:??',
      battery:          raw.battery_pct !== undefined ? raw.battery_pct : 0xFF,
      sensor_type:      sensorTypeByte,
      transport_type:   transportTypeByte,
      config_state:     raw.configured ? 1 : 0,
      capabilities:     0x00,  // WiFi devices never have LoRa
      error_state:      raw.error_state || 0,
      model_name:       raw.model_code || 'ROVER-WIFI',
      sensor_name:      raw.sensor_type || '?',
      has_lora:         false,
      configured:       !!raw.configured,
      wifi_ssid:        raw.wifi_ssid || '',
      wifi_connected:   raw.wifi_connected || false,
      station_name:     raw.station_name || '',
      zone:             raw.zone || '',
    };
  }

  async configure(params) {
    const body = {
      station_name:      params.station_name || '',
      zone:              params.zone || '',
      supabase_url:      SUPABASE_URL,
      supabase_anon_key: SUPABASE_ANON_KEY,
    };
    if (params.wifi_ssid)     body.wifi_ssid = params.wifi_ssid;
    if (params.wifi_password) body.wifi_password = params.wifi_password;
    if (params.gps_lat !== undefined) body.gps_latitude  = params.gps_lat;
    if (params.gps_lon !== undefined) body.gps_longitude = params.gps_lon;
    if (params.gps_alt !== undefined) body.gps_altitude  = params.gps_alt;

    if (params.wifi_ssid) {
      this._sessionCreds = { ssid: params.wifi_ssid, password: params.wifi_password || '' };
      sessionStorage.setItem('wifiCreds', JSON.stringify(this._sessionCreds));
    }

    logComm('tx', `POST /api/configure: station=${body.station_name} zone=${body.zone}`);
    const result = await this._fetch('/api/configure', 'POST', body);
    logComm('rx', `Configure result: ${JSON.stringify(result)}`);
    return result;
  }

  async getStatus() {
    const raw = await this._fetch('/api/status');
    logComm('rx', `GET /api/status: ${JSON.stringify(raw)}`);
    return {
      battery:          raw.battery_pct !== undefined ? raw.battery_pct : 0xFF,
      uptime:           raw.uptime_seconds || 0,
      last_tx:          raw.last_tx_epoch || 0,
      pending_events:   raw.pending_events || 0,
      sensor_status:    raw.sensor_status || '?',
      transport_status: raw.transport_status || '?',
      boot_count:       raw.boot_count || 0,
      false_triggers:   raw.false_triggers || 0,
      last_error:       raw.last_error_code || 0,
      configured:       !!raw.configured,
      wifi_ssid:        raw.wifi_ssid || '',
      wifi_connected:   raw.wifi_connected || false,
      wifi_rssi:        raw.wifi_rssi,
      ip_address:       raw.ip_address || '',
      total_tx_count:   raw.total_tx_count || 0,
      failed_tx_count:  raw.failed_tx_count || 0,
    };
  }

  async sensorTest() {
    const raw = await this._fetch('/api/sensor-test');
    logComm('rx', `GET /api/sensor-test: ${JSON.stringify(raw)}`);
    return { _json: raw, transport: 'wifi' };
  }

  async loraTest() {
    throw new Error('LoRa not available on WiFi devices');
  }

  async getDiagnostic() {
    const raw = await this._fetch('/api/diagnostic');
    logComm('rx', `GET /api/diagnostic: ${JSON.stringify(raw)}`);
    return {
      transport:          'wifi',
      boot_count:         raw.boot_count || 0,
      uptime_seconds:     raw.uptime_seconds || 0,
      false_triggers:     raw.false_triggers || 0,
      pending_events:     raw.pending_events || 0,
      consecutive_errors: raw.consecutive_errors || 0,
      last_error_code:    raw.last_error_code || 0,
      sensor_type:        this._sensorNameToByte(raw.sensor_type),
      transport_type:     0x01,
      power_source:       raw.power_source || '?',
      battery_mv:         raw.battery_mv || 0,
      total_tx_count:     raw.total_tx_count || 0,
      failed_tx_count:    raw.failed_tx_count || 0,
      fw_version:         raw.fw_version || '?',
    };
  }

  disconnect() {
    logComm('info', 'WiFi transport disconnected (stateless)');
  }

  getDeviceName() {
    return this._cachedInfo
      ? (this._cachedInfo.device_name || this._cachedInfo.model_code || 'SCOUT-WIFI')
      : 'SCOUT-WIFI';
  }

  getSessionCreds() { return this._sessionCreds; }

  async _fetch(path, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(WIFI_AP_BASE_URL + path, opts);
    if (!resp.ok) { const txt = await resp.text(); throw new Error(`HTTP ${resp.status}: ${txt}`); }
    return resp.json();
  }

  _sensorNameToByte(name) {
    const map = {
      'DHT22': 0x01, 'DS18B20': 0x02, 'BME280': 0x03, 'AHT20+BMP280': 0x03,
      'VEML6075': 0x04, 'ADXL345': 0x10, 'MPU6050': 0x11,
      'Simulated': 0xFE, 'SIMULATED': 0xFE,
    };
    return map[name] || 0xFF;
  }
}
