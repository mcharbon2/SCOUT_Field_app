import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants.js';
import { state } from '../state.js';
import { showToast } from '../ui/toast.js';
import { logComm } from '../ui/log.js';
import { resolveHardwareIdCandidates } from './deviceLookup.js';

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
        source:   'gps',
      };
      document.getElementById('gpsLat').textContent = state.capturedGPS.lat.toFixed(6);
      document.getElementById('gpsLon').textContent = state.capturedGPS.lon.toFixed(6);
      statusEl.textContent = `✓ Captured — Accuracy: ±${state.capturedGPS.accuracy}m`;
      statusEl.style.color = 'var(--success)';
      btn.disabled = false;
    },
    (err) => {
      statusEl.textContent = `GPS error: ${err.message}. If the signal is degraded (forest canopy), enter coordinates manually below.`;
      statusEl.style.color = 'var(--warning)';
      btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  );
}

// Manual coordinate entry — fallback for when phone GPS is degraded (forest
// canopy) or unavailable on HTTP. Feeds the same state.capturedGPS the
// captured path uses, tagged source:'manual' for the history row.
export function applyManualGPS() {
  const statusEl = document.getElementById('gpsStatus');
  const lat = parseFloat(document.getElementById('manualLat').value);
  const lon = parseFloat(document.getElementById('manualLon').value);
  const altRaw = document.getElementById('manualAlt').value.trim();
  const alt = altRaw === '' ? 0 : Math.round(parseFloat(altRaw));

  if (isNaN(lat) || lat < -90 || lat > 90)   { showToast('Latitude must be between -90 and 90', 'error'); return; }
  if (isNaN(lon) || lon < -180 || lon > 180) { showToast('Longitude must be between -180 and 180', 'error'); return; }
  if (isNaN(alt)) { showToast('Altitude must be a number (meters)', 'error'); return; }

  state.capturedGPS = { lat, lon, alt, accuracy: null, source: 'manual' };
  document.getElementById('gpsLat').textContent = lat.toFixed(6);
  document.getElementById('gpsLon').textContent = lon.toFixed(6);
  statusEl.textContent = '✓ Coordinates entered manually';
  statusEl.style.color = 'var(--success)';
  logComm('info', `Manual GPS entry: ${lat.toFixed(6)}, ${lon.toFixed(6)}, alt=${alt}`);
}

// Parse GPS from URL query params (passed from HTTPS app to HTTP device app)
export function loadGPSFromURL() {
  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  const alt = parseInt(params.get('alt')) || 0;

  if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
    state.capturedGPS = { lat, lon, alt, accuracy: 0, source: 'gps' };
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

const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

function gpsUploadError(statusEl, statusMsg, toastMsg, logMsg) {
  statusEl.textContent = statusMsg;
  statusEl.style.color = 'var(--danger)';
  showToast(toastMsg, 'error');
  logComm('err', logMsg);
}

export async function uploadGPSToSupabase() {
  if (!state.capturedGPS || !state.deviceInfo.mac) return;
  const statusEl = document.getElementById('gpsStatus');
  const gps = state.capturedGPS;
  statusEl.textContent = 'Uploading GPS to cloud...';
  statusEl.style.color = 'var(--text-dim)';

  try {
    // Escape 2 fix: a LoRa-relayed ROVER registers in scout_devices under a
    // MASKED hardware_id ("??:??:??:XX:YY:ZZ") — scout-ingress only ever
    // sees the last 3 MAC octets from the relay JSON — so a plain full-MAC
    // lookup finds 0 rows for exactly the devices a field tech is standing
    // at. resolveHardwareIdCandidates() (src/utils/deviceLookup.js) derives
    // the right candidate order from what the connected device SAYS IT IS
    // over BLE (class/model/transport), not a blind "try both": a
    // dual-identity board (same MAC, one stale full-MAC gateway row + one
    // live masked LoRa-rover row) would otherwise bind GPS to the wrong
    // identity. See verify_identity_resolution.py in PILOTE_WEB for the
    // cross-repo pin (exit 2 KNOWN-GAP) this closes.
    const candidates = resolveHardwareIdCandidates(state.deviceInfo);
    let devices = [];
    for (const candidateId of candidates) {
      const lookupResp = await fetch(
        `${SUPABASE_URL}/rest/v1/scout_devices?hardware_id=eq.${encodeURIComponent(candidateId)}&select=id,device_id`,
        { headers: SB_HEADERS },
      );
      if (!lookupResp.ok) throw new Error(`device lookup failed (HTTP ${lookupResp.status})`);
      devices = await lookupResp.json();
      if (devices && devices.length > 0) break;
    }
    if (!devices || devices.length === 0) {
      gpsUploadError(
        statusEl,
        '❌ Position NOT recorded in cloud — this device has no scout_devices row yet. Let it register first (power it on so it transmits once), then upload again.',
        'Position NOT saved to cloud — device not registered',
        `GPS upload refused: no scout_devices row for hardware_id candidates=[${candidates.join(', ')}]`,
      );
      return;
    }
    // scout_device_locations keys on the text device_id; the history table
    // keys on the scout_devices UUID `id` — resolve both from the same row.
    const { id: scoutDeviceUuid, device_id: targetDeviceId } = devices[0];

    // Upsert the current position: SELECT then PATCH-or-POST, never
    // DELETE-then-POST — a failed POST after the DELETE committed would leave
    // the device with no location row at all (same convention as PILOTE_WEB
    // backend/scout_sim/provision_real_location.py).
    const existingResp = await fetch(
      `${SUPABASE_URL}/rest/v1/scout_device_locations?device_id=eq.${encodeURIComponent(targetDeviceId)}&select=id`,
      { headers: SB_HEADERS },
    );
    if (!existingResp.ok) throw new Error(`location lookup failed (HTTP ${existingResp.status})`);
    const hasRow = (await existingResp.json()).length > 0;

    const nowIso = new Date().toISOString();
    const locationPayload = {
      latitude:    gps.lat,
      longitude:   gps.lon,
      altitude:    gps.alt || null,
      accuracy:    gps.accuracy || null,
      recorded_at: nowIso,
      received_at: nowIso,
    };

    const upsertResp = await fetch(
      hasRow
        ? `${SUPABASE_URL}/rest/v1/scout_device_locations?device_id=eq.${encodeURIComponent(targetDeviceId)}`
        : `${SUPABASE_URL}/rest/v1/scout_device_locations`,
      {
        method: hasRow ? 'PATCH' : 'POST',
        headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(hasRow ? locationPayload : { device_id: targetDeviceId, ...locationPayload }),
      },
    );
    // A PATCH that RLS filters down to 0 rows still returns 200 with an empty
    // representation — treat that as a failure, not a success.
    const upsertRows = upsertResp.ok ? await upsertResp.json() : [];
    if (!upsertResp.ok || upsertRows.length === 0) {
      gpsUploadError(
        statusEl,
        `❌ Position NOT recorded in cloud (HTTP ${upsertResp.status}). The previously recorded position is untouched — retry when you have coverage.`,
        'Position NOT saved to cloud — upload failed',
        `GPS ${hasRow ? 'PATCH' : 'POST'} scout_device_locations failed: HTTP ${upsertResp.status}`,
      );
      return;
    }
    logComm('info', `scout_device_locations ${hasRow ? 'updated' : 'inserted'} for ${targetDeviceId}`);

    // Append the position-epoch history row: PILOTE_WEB's RF-calibration
    // (backend/scout_sim/calibrate.py) segments telemetry into position epochs
    // from scout_device_location_history — a location change without a history
    // row silently corrupts calibration geometry. Column shape per PILOTE_WEB
    // migration 20260111004740 (no altitude column on this table).
    // Prefer: return=minimal — NOT return=representation. Under Postgres RLS,
    // INSERT ... RETURNING also requires SELECT access on the returned row,
    // and this table's SELECT policy is authenticated-only (anon can INSERT
    // gps/manual rows but deliberately cannot READ the history table — least
    // privilege). With return=representation the whole INSERT fails 42501
    // even though the INSERT policy admits it (found live 2026-07-17 by
    // PILOTE_WEB's verify_authz_conformance probe, which mirrors this exact
    // request). We never use the returned row — resp.ok on the 201 suffices.
    const historyResp = await fetch(`${SUPABASE_URL}/rest/v1/scout_device_location_history`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        scout_device_id:   scoutDeviceUuid,
        latitude:          gps.lat,
        longitude:         gps.lon,
        location_source:   gps.source === 'manual' ? 'manual' : 'gps',
        location_accuracy: gps.accuracy || null,
        recorded_at:       nowIso,
        notes: `Position enregistrée via SCOUT Field Tech (${gps.source === 'manual' ? 'saisie manuelle' : 'GPS du téléphone'})`,
      }),
    });

    if (historyResp.ok) {
      statusEl.textContent = `✅ GPS synced to ATLAS for ${targetDeviceId} (position + history epoch)`;
      statusEl.style.color = 'var(--success)';
      showToast('GPS synced to ATLAS ✓', 'success');
    } else {
      statusEl.textContent = `⚠️ Position synced for ${targetDeviceId}, but the location-history row was rejected (HTTP ${historyResp.status}) — RF calibration will not see this move. Report it so the epoch can be recorded manually.`;
      statusEl.style.color = 'var(--warning)';
      showToast('Position saved — history write rejected', 'error');
      logComm('err', `scout_device_location_history insert failed: HTTP ${historyResp.status} — anon INSERT is blocked by RLS until PILOTE_WEB adds a policy`);
    }
  } catch (err) {
    gpsUploadError(
      statusEl,
      `❌ Position NOT recorded in cloud — ${err.message}. Retry when you have coverage.`,
      'Position NOT saved to cloud',
      `GPS upload error: ${err.message}`,
    );
  }
}
