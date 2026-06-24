import { state } from '../state.js';
import { TRANSPORT_TYPES } from '../constants.js';

export function setConnected(connected) {
  const badge = document.getElementById('connBadge');
  const text  = document.getElementById('connText');

  if (connected) {
    const t = state.transport.type;
    badge.className = `conn-badge connected-${t}`;
    text.textContent = state.transport.getDeviceName();
    document.getElementById('screenScan').classList.add('hidden');
    document.getElementById('screenConnected').classList.remove('hidden');
    updateDeviceBar();
    updateTabVisibility();
    switchTab('configure');
    document.getElementById('logTabTitle').textContent =
      t === 'wifi' ? 'HTTP Communication Log' :
      t === 'mesh' ? 'MeshCore Communication Log' : 'BLE Communication Log';
  } else {
    badge.className = 'conn-badge disconnected';
    text.textContent = 'Disconnected';
    document.getElementById('screenScan').classList.remove('hidden');
    document.getElementById('screenConnected').classList.add('hidden');
    state.transport = null;
    state.deviceInfo = {};
    state.capturedGPS = null;
  }
}

export function updateDeviceBar() {
  const di = state.deviceInfo;
  const t  = state.transport;
  const nameEl = document.getElementById('devName');
  nameEl.textContent = di.device_name || t.getDeviceName();
  nameEl.className = `device-name${t.type === 'wifi' ? ' wifi-transport' : t.type === 'mesh' ? ' mesh-transport' : ''}`;
  document.getElementById('devModel').textContent = di.model_name || '—';
  document.getElementById('devBattery').textContent = di.battery === 0xFF ? '—' : `${di.battery}%`;
  document.getElementById('devSensor').textContent  = di.sensor_name || '?';
  document.getElementById('devTransport').textContent =
    t.type === 'wifi' ? 'WiFi' : t.type === 'mesh' ? 'Mesh' : (TRANSPORT_TYPES[di.transport_type] || '?');

  const batEl = document.getElementById('devBattery');
  if (di.battery !== 0xFF) {
    batEl.className = 'stat-value' + (di.battery > 50 ? ' good' : di.battery > 20 ? ' warn' : ' bad');
  }
}

// Conditional tab visibility per transport + device capability
export function updateTabVisibility() {
  const isWifi      = state.transport?.type === 'wifi';
  const isMesh      = state.transport?.type === 'mesh';
  const hasLoRa     = state.deviceInfo.has_lora || false;
  const isIngenuity = state.deviceInfo.class_code === 0x50;

  // LoRa tab: hidden for WiFi/mesh, devices without LoRa, and INGENUITY (it IS the endpoint)
  document.getElementById('tabBtnLora').classList.toggle('hidden', isWifi || isMesh || !hasLoRa || isIngenuity);

  // Sensor tab: hidden for INGENUITY (no sensor) and mesh (Sprint F3)
  const sensorTab = document.querySelector('[data-tab="sensor"]');
  if (sensorTab) sensorTab.classList.toggle('hidden', isIngenuity || isMesh);

  // WiFi credential fields: WiFi transport OR INGENUITY BLE (relays to Supabase)
  document.getElementById('wifiFieldsSection').classList.toggle('hidden', !isWifi && !isIngenuity);

  // Sensor Mode selector: ROVER-BAIT or any BLE-connected ROVER
  const isBait     = state.deviceInfo.sensor_type === 0x10 ||
                     (state.deviceInfo.model_name?.includes('BAIT'));
  const isRoverBle = !isWifi && !isMesh && state.deviceInfo.device_name?.includes('ROVER');
  document.getElementById('sensorModeSection').classList.toggle('hidden', !(isBait || isRoverBle));

  if (isBait && state.deviceInfo.sensor_mode !== undefined) {
    const radio = document.querySelector(`input[name="sensorMode"][value="${state.deviceInfo.sensor_mode}"]`);
    if (radio) radio.checked = true;
  }
}

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  const id = 'tab' + name.charAt(0).toUpperCase() + name.slice(1);
  document.getElementById(id)?.classList.remove('hidden');
}
