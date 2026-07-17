import { state } from '../state.js';
import BleTransport from '../transports/ble.js';
import WifiHttpTransport from '../transports/wifi.js';
import MeshCoreTransport from '../transports/meshcore.js';
import { setConnected } from './connected.js';
import { logScan } from './log.js';
import { showToast } from './toast.js';
import { preCaptureGPS, loadGPSFromURL } from '../utils/gps.js';

export function initScanScreen() {
  document.getElementById('btnScanBle').addEventListener('click', startBleScan);
  document.getElementById('btnConnectWifi').addEventListener('click', showWifiInstructions);
  document.getElementById('btnWifiConnect').addEventListener('click', connectWifi);
  document.getElementById('btnConnectMesh').addEventListener('click', connectMesh);

  // BLE browser support check
  if (!navigator.bluetooth || location.protocol === 'http:') {
    const btn = document.getElementById('btnScanBle');
    btn.disabled = true;
    btn.querySelector('.transport-btn-sub').textContent = location.protocol === 'http:'
      ? 'BLE requires HTTPS. Use the WiFi connection below for this device.'
      : 'Web Bluetooth requires Chrome on Android or desktop. Safari/Firefox not supported.';
    btn.style.opacity = '0.4';

    // MeshCore also runs over Web Bluetooth — same gating applies.
    const meshBtn = document.getElementById('btnConnectMesh');
    if (meshBtn) {
      meshBtn.disabled = true;
      const meshSub = meshBtn.querySelector('.transport-btn-sub');
      if (meshSub) {
        meshSub.textContent = location.protocol === 'http:'
          ? 'MeshCore requires HTTPS. Use the WiFi connection below for this device.'
          : 'Web Bluetooth requires Chrome on Android or desktop. Safari/Firefox not supported.';
      }
      meshBtn.style.opacity = '0.4';
    }
  }

  // On HTTP (served from ESP8266): auto-connect if URL has GPS params
  if (location.protocol === 'http:') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('lat') && params.has('lon')) {
      setTimeout(() => connectWifi(), 500);
    }
  }
}

function showWifiInstructions() {
  const panel = document.getElementById('wifiInstructions');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    // Bring the freshly-revealed instructions into view — on a phone the panel
    // opens below the fold, so without this it looks like nothing happened.
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (location.protocol === 'https:') preCaptureGPS();
  }
}

async function startBleScan() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth not supported in this browser', 'error'); return; }

  const btn  = document.getElementById('btnScanBle');
  const hero = document.getElementById('scanHero');
  const logDiv = document.getElementById('scanLog');

  btn.disabled = true;
  btn.querySelector('.transport-btn-label').textContent = 'Scanning...';
  hero.classList.add('scanning');
  logDiv.style.display = 'block';

  try {
    state.transport = new BleTransport();
    await state.transport.connect();
    state.deviceInfo = await state.transport.getInfo();
    logScan('info', `Model: ${state.deviceInfo.model_name}`);
    logScan('info', `Firmware: ${state.deviceInfo.fw_version}`);
    setConnected(true);
  } catch (err) {
    state.transport = null;
    logScan('err', `Error: ${err.message}`);
    if (err.name === 'NotFoundError') logScan('info', 'No device selected.');
  }

  btn.disabled = false;
  btn.querySelector('.transport-btn-label').textContent = 'Scan BLE Devices';
  hero.classList.remove('scanning');
}

async function connectWifi() {
  // On HTTPS (GitHub Pages): redirect to the device-served app, passing GPS in URL
  if (location.protocol === 'https:') {
    let url = 'http://192.168.4.1/app';
    if (window._preCapturedGPS) {
      const g = window._preCapturedGPS;
      url += `?lat=${g.lat}&lon=${g.lon}&alt=${g.alt}`;
      // Carries the true capture moment across the bridge so recorded_at
      // (gps.js performGPSUpload) reflects placement time, not whenever the
      // device-served page happens to parse these params.
      if (g.capturedAt) url += `&capturedAt=${encodeURIComponent(g.capturedAt)}`;
    }
    logScan('info', 'Redirecting to device-served app at ' + url);
    logScan('info', 'Make sure you have joined the SCOUT-CFG-* WiFi network first.');
    window.location.href = url;
    return;
  }

  // On HTTP (served from ESP8266): connect directly
  const btn    = document.getElementById('btnWifiConnect');
  const hero   = document.getElementById('scanHero');
  const logDiv = document.getElementById('scanLog');

  btn.disabled = true;
  btn.textContent = 'Connecting...';
  hero.classList.add('scanning');
  logDiv.style.display = 'block';

  try {
    state.transport = new WifiHttpTransport();
    await state.transport.connect();
    state.deviceInfo = await state.transport.getInfo();
    logScan('info', `Model: ${state.deviceInfo.model_name}`);
    logScan('info', `Sensor: ${state.deviceInfo.sensor_name}`);
    logScan('info', `Configured: ${state.deviceInfo.configured}`);

    const saved = state.transport.getSessionCreds();
    if (saved.ssid) {
      document.getElementById('cfgWifiSsid').value = saved.ssid;
      document.getElementById('cfgWifiPassword').value = saved.password;
    }
    loadGPSFromURL();
    setConnected(true);
  } catch (err) {
    state.transport = null;
    logScan('err', `WiFi connection failed: ${err.message}`);
    logScan('info', 'Make sure you have joined the SCOUT-CFG-* WiFi network first.');
  }

  btn.disabled = false;
  btn.textContent = 'Connect to Device at 192.168.4.1';
  hero.classList.remove('scanning');
}

async function connectMesh() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth not supported in this browser', 'error'); return; }

  const btn  = document.getElementById('btnConnectMesh');
  const hero = document.getElementById('scanHero');
  const logDiv = document.getElementById('scanLog');

  btn.disabled = true;
  btn.querySelector('.transport-btn-label').textContent = 'Connecting...';
  hero.classList.add('scanning');
  logDiv.style.display = 'block';

  try {
    logScan('info', 'Requesting MeshCore device...');
    state.transport = new MeshCoreTransport();
    await state.transport.connect();
    state.deviceInfo = await state.transport.getInfo();

    logScan('info', `Name: ${state.deviceInfo.device_name}`);
    logScan('info', `Model: ${state.deviceInfo.model_name}`);
    logScan('info', `Firmware: ${state.deviceInfo.fw_version}`);
    logScan('info', `Radio: SF${state.deviceInfo.radio_sf} BW${state.deviceInfo.radio_bw} kHz @ ${state.deviceInfo.radio_freq} MHz`);
    logScan('info', `BLE PIN: ${state.deviceInfo.ble_pin}`);

    setConnected(true);
  } catch (err) {
    state.transport = null;
    if (err.name === 'NotFoundError') {
      logScan('info', 'No device selected.');
    } else {
      logScan('err', `Error: ${err.message}`);
      logScan('info', 'If pairing failed: the node requires its BLE PIN on first connect.');
    }
  }

  btn.disabled = false;
  btn.querySelector('.transport-btn-label').textContent = 'MeshCore Device';
  hero.classList.remove('scanning');
}
