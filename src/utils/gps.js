import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants.js';
import { state } from '../state.js';
import { showToast } from '../ui/toast.js';
import { logComm } from '../ui/log.js';

export function captureGPS() {
  const statusEl = document.getElementById('gpsStatus');
  const btn = document.getElementById('btnGPS');

  // On HTTP: GPS was already loaded from URL params, or we can't get it
  if (location.protocol === 'http:') {
    if (state.capturedGPS) {
      statusEl.textContent = '✓ GPS already captured from HTTPS app';
      return;
    }
    statusEl.textContent = 'GPS requires HTTPS. Open the app from GitHub Pages first, then connect to WiFi device — coordinates transfer automatically.';
    statusEl.style.color = 'var(--warning)';
    return;
  }

  statusEl.textContent = 'Acquiring GPS...';
  btn.disabled = true;

  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation not supported on this device.';
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.capturedGPS = {
        lat:      pos.coords.latitude,
        lon:      pos.coords.longitude,
        alt:      Math.round(pos.coords.altitude || 0),
        accuracy: Math.round(pos.coords.accuracy || 0),
      };
      document.getElementById('gpsLat').textContent = state.capturedGPS.lat.toFixed(6);
      document.getElementById('gpsLon').textContent = state.capturedGPS.lon.toFixed(6);
      statusEl.textContent = `✓ Captured — Accuracy: ±${state.capturedGPS.accuracy}m`;
      btn.disabled = false;
    },
    (err) => {
      statusEl.textContent = `GPS error: ${err.message}`;
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}

// Parse GPS from URL query params (passed from HTTPS app to HTTP device app)
export function loadGPSFromURL() {
  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  const alt = parseInt(params.get('alt')) || 0;

  if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
    state.capturedGPS = { lat, lon, alt, accuracy: 0 };
    document.getElementById('gpsLat').textContent = lat.toFixed(6);
    document.getElementById('gpsLon').textContent = lon.toFixed(6);
    const statusEl = document.getElementById('gpsStatus');
    statusEl.textContent = '✓ GPS received from Field Tech app (captured on HTTPS)';
    statusEl.style.color = 'var(--success)';
    logComm('info', `GPS from URL: ${lat.toFixed(6)}, ${lon.toFixed(6)}, alt=${alt}`);
    return true;
  }
  return false;
}

// Auto-capture GPS on HTTPS so coordinates survive the HTTP transition
export function preCaptureGPS() {
  if (!navigator.geolocation) return;
  const capturingEl = document.getElementById('gpsPreCapturing');
  const capturedEl  = document.getElementById('gpsPreCapture');
  capturingEl.classList.remove('hidden');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon, altitude, accuracy } = pos.coords;
      const alt = Math.round(altitude || 0);
      const acc = Math.round(accuracy || 0);
      window._preCapturedGPS = { lat, lon, alt, accuracy: acc };
      capturingEl.classList.add('hidden');
      capturedEl.classList.remove('hidden');
      document.getElementById('gpsPre').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)} (±${acc}m)`;
    },
    (err) => {
      capturingEl.textContent = `📍 GPS unavailable: ${err.message}. Coordinates can be entered manually on the device.`;
      capturingEl.style.borderColor = 'rgba(239,68,68,0.3)';
      capturingEl.style.color = 'var(--text-dim)';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

export async function uploadGPSToSupabase() {
  if (!state.capturedGPS || !state.deviceInfo.mac) return;
  const statusEl = document.getElementById('gpsStatus');
  statusEl.textContent = 'Uploading GPS to cloud...';

  try {
    const lookupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/scout_devices?hardware_id=eq.${encodeURIComponent(state.deviceInfo.mac)}&select=device_id`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    const devices = await lookupResp.json();
    if (!devices || devices.length === 0) {
      statusEl.textContent = 'GPS saved to device. Cloud upload skipped (not yet registered).';
      return;
    }
    const targetDeviceId = devices[0].device_id;

    await fetch(
      `${SUPABASE_URL}/rest/v1/scout_device_locations?device_id=eq.${encodeURIComponent(targetDeviceId)}`,
      { method: 'DELETE', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );

    const insertResp = await fetch(
      `${SUPABASE_URL}/rest/v1/scout_device_locations`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=representation',
        },
        body: JSON.stringify({
          device_id:   targetDeviceId,
          latitude:    state.capturedGPS.lat,
          longitude:   state.capturedGPS.lon,
          altitude:    state.capturedGPS.alt || null,
          accuracy:    state.capturedGPS.accuracy || null,
          recorded_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
        }),
      },
    );

    if (insertResp.ok) {
      statusEl.textContent = `✅ GPS synced to ATLAS for ${targetDeviceId}`;
      showToast('GPS synced to ATLAS ✓', 'success');
    } else {
      statusEl.textContent = 'GPS saved to device. Cloud upload failed.';
    }
  } catch {
    statusEl.textContent = 'GPS saved to device. Cloud sync error.';
  }
}
