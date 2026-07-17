import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants.js';
import { state } from '../state.js';
import { showToast } from '../ui/toast.js';
import { logComm } from '../ui/log.js';
import { resolveHardwareIdCandidates } from './deviceLookup.js';
import { enqueueUpload, registerUploadHandler } from './uploadQueue.js';

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
        lat:        pos.coords.latitude,
        lon:        pos.coords.longitude,
        alt:        Math.round(pos.coords.altitude || 0),
        accuracy:   Math.round(pos.coords.accuracy || 0),
        source:     'gps',
        capturedAt: new Date().toISOString(),
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

  state.capturedGPS = { lat, lon, alt, accuracy: null, source: 'manual', capturedAt: new Date().toISOString() };
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
  // capturedAt travels through the redirect too (see scan.js connectWifi()) so
  // the true placement moment survives the HTTPS→HTTP bridge, not just the
  // moment this device-served page happened to parse the URL.
  const capturedAtParam = params.get('capturedAt');
  const capturedAt = capturedAtParam && !isNaN(Date.parse(capturedAtParam))
    ? capturedAtParam
    : new Date().toISOString();

  if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
    state.capturedGPS = { lat, lon, alt, accuracy: 0, source: 'gps', capturedAt };
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
      window._preCapturedGPS = { lat, lon, alt, accuracy: acc, capturedAt: new Date().toISOString() };
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

// Thrown by performGPSUpload for any failed network step. `retryable` tells
// the offline queue (src/utils/uploadQueue.js) whether retrying later can
// plausibly succeed (connectivity/5xx/unknown) vs a permanent rejection
// (RLS/FK/unique-violation — "won't heal", drop with a warning instead of
// retrying forever).
export class UploadError extends Error {
  constructor(message, { retryable = true, code = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'UploadError';
    this.retryable = retryable;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const PERMANENT_PG_CODES = new Set([
  '42501', // insufficient_privilege (RLS)
  '23503', // foreign_key_violation
  '23505', // unique_violation
]);

async function bodyOrNull(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

function isPermanentPgError(body) {
  return !!(body && PERMANENT_PG_CODES.has(body.code));
}

// Detects PostgREST's "unknown column" rejection for ant_height_m — the
// PILOTE_WEB migration adding the column may not be applied to prod yet.
// PostgREST reports this as code PGRST204 with a message naming the column;
// match both the code and a message fallback in case the code varies.
function isUnknownColumnError(body) {
  if (!body) return false;
  if (body.code === 'PGRST204') return true;
  const haystack = `${body.message || ''} ${body.hint || ''} ${body.details || ''}`.toLowerCase();
  return haystack.includes('ant_height_m');
}

async function fetchOk(url, options, label) {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    throw new UploadError(`${label} network error: ${err.message}`, { retryable: true });
  }
  if (!resp.ok) {
    const body = await bodyOrNull(resp);
    throw new UploadError(`${label} failed (HTTP ${resp.status})`, {
      retryable: !isPermanentPgError(body),
      code: body && body.code,
      httpStatus: resp.status,
    });
  }
  return resp;
}

/**
 * The one shared upload code path — used by the live "Save Configuration"
 * flow AND by the offline queue flush (src/utils/uploadQueue.js), via
 * registerUploadHandler() below, so the two can never diverge.
 *
 * `recordedAtIso` is written as `recorded_at` on BOTH the scout_device_locations
 * upsert and the scout_device_location_history insert. Callers MUST pass the
 * original capture moment (gps.capturedAt), not "now" — PILOTE_WEB's
 * calibrate.py segments telemetry into position epochs from these
 * timestamps, so a flush that happened minutes/hours after capture must not
 * shift the epoch boundary to the flush time.
 *
 * Returns { ok:true, targetDeviceId, wasUpdate, heightDropped, historyOk,
 * historyStatus } on success, or { ok:false, reason:'device-not-registered' }
 * when no scout_devices row exists yet (not thrown — this is a legitimate,
 * possibly-temporary lookup miss, not a network failure). Throws UploadError
 * for any failed network step (fetch throw / non-ok HTTP on lookup or write).
 */
export async function performGPSUpload(candidates, gps, antHeightM, recordedAtIso) {
  let devices = [];
  for (const candidateId of candidates) {
    const lookupResp = await fetchOk(
      `${SUPABASE_URL}/rest/v1/scout_devices?hardware_id=eq.${encodeURIComponent(candidateId)}&select=id,device_id`,
      { headers: SB_HEADERS },
      'device lookup',
    );
    devices = await lookupResp.json();
    if (devices && devices.length > 0) break;
  }
  if (!devices || devices.length === 0) {
    return { ok: false, reason: 'device-not-registered', candidates };
  }
  // scout_device_locations keys on the text device_id; the history table
  // keys on the scout_devices UUID `id` — resolve both from the same row.
  const { id: scoutDeviceUuid, device_id: targetDeviceId } = devices[0];

  // Upsert the current position: SELECT then PATCH-or-POST, never
  // DELETE-then-POST — a failed POST after the DELETE committed would leave
  // the device with no location row at all (same convention as PILOTE_WEB
  // backend/scout_sim/provision_real_location.py).
  const existingResp = await fetchOk(
    `${SUPABASE_URL}/rest/v1/scout_device_locations?device_id=eq.${encodeURIComponent(targetDeviceId)}&select=id`,
    { headers: SB_HEADERS },
    'location lookup',
  );
  const hasRow = (await existingResp.json()).length > 0;

  const hasHeight = antHeightM !== null && antHeightM !== undefined;
  let locationPayload = {
    latitude:    gps.lat,
    longitude:   gps.lon,
    altitude:    gps.alt || null,
    accuracy:    gps.accuracy || null,
    recorded_at: recordedAtIso,
    received_at: new Date().toISOString(),
  };
  if (hasHeight) locationPayload.ant_height_m = antHeightM;

  const doUpsert = async (payload) => {
    try {
      return await fetch(
        hasRow
          ? `${SUPABASE_URL}/rest/v1/scout_device_locations?device_id=eq.${encodeURIComponent(targetDeviceId)}`
          : `${SUPABASE_URL}/rest/v1/scout_device_locations`,
        {
          method: hasRow ? 'PATCH' : 'POST',
          headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(hasRow ? payload : { device_id: targetDeviceId, ...payload }),
        },
      );
    } catch (err) {
      throw new UploadError(`location upload network error: ${err.message}`, { retryable: true });
    }
  };

  let upsertResp = await doUpsert(locationPayload);
  let heightDropped = false;
  if (!upsertResp.ok && hasHeight) {
    const body = await bodyOrNull(upsertResp);
    if (isUnknownColumnError(body)) {
      // Retry once without ant_height_m — migration not applied yet. The
      // position must still land; height is a nice-to-have on top of it.
      heightDropped = true;
      const { ant_height_m, ...withoutHeight } = locationPayload;
      locationPayload = withoutHeight;
      upsertResp = await doUpsert(locationPayload);
    } else {
      throw new UploadError(`location ${hasRow ? 'PATCH' : 'POST'} failed (HTTP ${upsertResp.status})`, {
        retryable: !isPermanentPgError(body), code: body && body.code, httpStatus: upsertResp.status,
      });
    }
  }
  if (!upsertResp.ok) {
    const body = await bodyOrNull(upsertResp);
    throw new UploadError(`location ${hasRow ? 'PATCH' : 'POST'} failed (HTTP ${upsertResp.status})`, {
      retryable: !isPermanentPgError(body), code: body && body.code, httpStatus: upsertResp.status,
    });
  }
  // A PATCH that RLS filters down to 0 rows still returns 200 with an empty
  // representation — treat that as a failure, not a success.
  const upsertRows = await upsertResp.json().catch(() => []);
  if (!upsertRows || upsertRows.length === 0) {
    throw new UploadError('location upsert returned 0 rows (likely RLS-filtered)', { retryable: false });
  }

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
  // even though the INSERT policy admits it. We never use the returned row —
  // resp.ok on the 201 suffices. A rejected history row does not undo the
  // already-saved position — it's reported to the caller, not thrown.
  let historyPayload = {
    scout_device_id:   scoutDeviceUuid,
    latitude:          gps.lat,
    longitude:         gps.lon,
    location_source:   gps.source === 'manual' ? 'manual' : 'gps',
    location_accuracy: gps.accuracy || null,
    recorded_at:       recordedAtIso,
    notes: `Position enregistrée via SCOUT Field Tech (${gps.source === 'manual' ? 'saisie manuelle' : 'GPS du téléphone'})`,
  };
  if (hasHeight && !heightDropped) historyPayload.ant_height_m = antHeightM;

  const doHistory = async (payload) => {
    try {
      return await fetch(`${SUPABASE_URL}/rest/v1/scout_device_location_history`, {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new UploadError(`history upload network error: ${err.message}`, { retryable: true });
    }
  };

  let historyResp = await doHistory(historyPayload);
  if (!historyResp.ok && hasHeight && !heightDropped) {
    const body = await bodyOrNull(historyResp);
    if (isUnknownColumnError(body)) {
      heightDropped = true;
      const { ant_height_m, ...withoutHeight } = historyPayload;
      historyPayload = withoutHeight;
      historyResp = await doHistory(historyPayload);
    }
  }

  return {
    ok: true,
    targetDeviceId,
    wasUpdate: hasRow,
    heightDropped,
    historyOk: historyResp.ok,
    historyStatus: historyResp.status,
  };
}

// Wire performGPSUpload into the offline queue without uploadQueue.js having
// to statically import this module back (would create a real circular
// import — this file already imports enqueueUpload/registerUploadHandler
// from uploadQueue.js). Registration runs once at module load.
registerUploadHandler(performGPSUpload);

// Reads and validates the optional "antenna height above ground (m)" input.
// Empty = not sent at all (absent key) — this is a per-epoch calibration
// value, not a required field. Returns { value, valid }; value is null when
// empty or invalid.
function readAntHeightInput() {
  const el = document.getElementById('cfgAntHeight');
  if (!el) return { value: null, valid: true };
  const raw = el.value.trim();
  if (raw === '') return { value: null, valid: true };
  const num = parseFloat(raw);
  if (isNaN(num) || num < 0.1 || num > 100) {
    return { value: null, valid: false };
  }
  return { value: num, valid: true };
}

export async function uploadGPSToSupabase() {
  if (!state.capturedGPS || !state.deviceInfo.mac) return;
  const statusEl = document.getElementById('gpsStatus');
  const gps = state.capturedGPS;

  const { value: antHeightM, valid: antHeightValid } = readAntHeightInput();
  if (!antHeightValid) {
    gpsUploadError(
      statusEl,
      '❌ Antenna height must be between 0.1 and 100 m (or left empty).',
      'Invalid antenna height — must be 0.1–100 m',
      'GPS upload aborted: invalid ant_height_m input',
    );
    return;
  }

  statusEl.textContent = 'Uploading GPS to cloud...';
  statusEl.style.color = 'var(--text-dim)';

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
  // The true placement moment is when GPS was captured, not when this
  // upload happens to run — recorded_at must reflect that (see
  // performGPSUpload's docstring re: calibrate.py epoch segmentation).
  const recordedAtIso = gps.capturedAt || new Date().toISOString();

  try {
    const result = await performGPSUpload(candidates, gps, antHeightM, recordedAtIso);

    if (!result.ok) {
      gpsUploadError(
        statusEl,
        '❌ Position NOT recorded in cloud — this device has no scout_devices row yet. Let it register first (power it on so it transmits once), then upload again.',
        'Position NOT saved to cloud — device not registered',
        `GPS upload refused: no scout_devices row for hardware_id candidates=[${candidates.join(', ')}]`,
      );
      return;
    }

    logComm('info', `scout_device_locations ${result.wasUpdate ? 'updated' : 'inserted'} for ${result.targetDeviceId}`);

    if (result.heightDropped) {
      showToast('Height not recorded (backend migration pending)', 'error');
      logComm('err', 'ant_height_m rejected by Supabase (unknown column) — retried without it; PILOTE_WEB migration adding the column is likely not applied to prod yet');
    }

    if (result.historyOk) {
      statusEl.textContent = `✅ GPS synced to ATLAS for ${result.targetDeviceId} (position + history epoch)`;
      statusEl.style.color = 'var(--success)';
      showToast('GPS synced to ATLAS ✓', 'success');
    } else {
      statusEl.textContent = `⚠️ Position synced for ${result.targetDeviceId}, but the location-history row was rejected (HTTP ${result.historyStatus}) — RF calibration will not see this move. Report it so the epoch can be recorded manually.`;
      statusEl.style.color = 'var(--warning)';
      showToast('Position saved — history write rejected', 'error');
      logComm('err', `scout_device_location_history insert failed: HTTP ${result.historyStatus}`);
    }
  } catch (err) {
    gpsUploadError(
      statusEl,
      `❌ Position NOT recorded in cloud — ${err.message}. Queued for automatic retry once you have coverage.`,
      'Position NOT saved to cloud — queued for retry',
      `GPS upload error: ${err.message}`,
    );

    // Forest/no-cellular case: don't lose the position — store it and retry
    // automatically (window 'online' event / app load / after next save).
    enqueueUpload({
      mac: state.deviceInfo.mac,
      deviceInfo: {
        class_code:     state.deviceInfo.class_code,
        model_name:     state.deviceInfo.model_name,
        transport_type: state.deviceInfo.transport_type,
      },
      gps: { lat: gps.lat, lon: gps.lon, alt: gps.alt, accuracy: gps.accuracy, source: gps.source },
      antHeightM,
      capturedAt: recordedAtIso,
    });
  }
}
