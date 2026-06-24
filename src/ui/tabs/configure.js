import { state } from '../../state.js';
import { showToast } from '../toast.js';
import { logComm } from '../log.js';
import { uploadGPSToSupabase } from '../../utils/gps.js';

export function initConfigureTab() {
  document.getElementById('btnSaveConfig').addEventListener('click', sendConfigure);
}

async function sendConfigure() {
  const name = document.getElementById('cfgStationName').value.trim();
  const zone = document.getElementById('cfgZone').value.trim();
  if (!name) { showToast('Enter a station name', 'error'); return; }

  const btn = document.getElementById('btnSaveConfig');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const params = { station_name: name, zone };

    // WiFi creds — collect for WiFi transport OR INGENUITY BLE devices
    const isIngenuity = state.deviceInfo.class_code === 0x50;
    if (state.transport?.type === 'wifi' || isIngenuity) {
      const ssid = document.getElementById('cfgWifiSsid').value.trim();
      const pass = document.getElementById('cfgWifiPassword').value;
      if (!ssid) {
        showToast('Enter WiFi network name', 'error');
        btn.disabled = false; btn.textContent = 'Save Configuration';
        return;
      }
      params.wifi_ssid     = ssid;
      params.wifi_password = pass;
    }

    if (state.capturedGPS) {
      params.gps_lat = state.capturedGPS.lat;
      params.gps_lon = state.capturedGPS.lon;
      params.gps_alt = state.capturedGPS.alt;
    }

    // Sensor mode — only for BAIT devices via BLE when section is visible
    const sensorModeEl      = document.querySelector('input[name="sensorMode"]:checked');
    const sensorModeSection = document.getElementById('sensorModeSection');
    if (sensorModeEl && sensorModeSection && !sensorModeSection.classList.contains('hidden')) {
      params.sensor_mode = parseInt(sensorModeEl.value);
    }

    await state.transport.configure(params);
    showToast('Configuration saved ✓', 'success');

    if (state.transport?.type === 'wifi') {
      setTimeout(() => showToast('Device rebooting to apply settings…', 'success'), 1500);
    }

    if (state.capturedGPS) await uploadGPSToSupabase();
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
    logComm('err', `Configure error: ${err.message}`);
  }

  btn.disabled = false;
  btn.textContent = 'Save Configuration';
}
