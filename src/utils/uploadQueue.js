import { showToast } from '../ui/toast.js';
import { logComm } from '../ui/log.js';
import { resolveHardwareIdCandidates } from './deviceLookup.js';

// Offline store-and-forward for GPS uploads. When uploadGPSToSupabase()
// (src/utils/gps.js) hits a failed network step — no cellular in the forest,
// a flaky connection, whatever — the position is enqueued here instead of
// lost, and replayed automatically once connectivity comes back.
//
// This module does NOT import gps.js directly (that would be a real circular
// import: gps.js already imports enqueueUpload/registerUploadHandler from
// here). Instead gps.js registers its own performGPSUpload as the upload
// handler at module load via registerUploadHandler() — a small dependency
// injection so flushQueue() can drive the exact same upload code path the
// live "Save Configuration" flow uses, with zero divergence.

const QUEUE_KEY = 'scoutFieldTechUploadQueue_v1';
const QUEUE_CAP = 50;

let uploadFn = null;
let flushing = false;

export function registerUploadHandler(fn) {
  uploadFn = fn;
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    logComm('err', `Upload queue could not be saved to localStorage: ${err.message}`);
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function updateQueueBadge() {
  const el = document.getElementById('queueBadge');
  if (!el) return;
  const n = loadQueue().length;
  if (n === 0) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = `📡 ${n} position${n > 1 ? 's' : ''} en attente de connexion`;
  }
}

/**
 * Enqueue a self-contained record so it can be replayed later without
 * touching any live app state (deviceInfo/state.capturedGPS may have moved
 * on to a different device by flush time). Device resolution itself is
 * deferred to flush time (resolveHardwareIdCandidates re-run there), but the
 * raw identity fields it needs are snapshotted now.
 */
export function enqueueUpload({ mac, deviceInfo, gps, antHeightM, capturedAt }) {
  const queue = loadQueue();
  const record = {
    id: makeId(),
    mac,
    deviceInfo: { ...deviceInfo },
    gps: { ...gps },
    ant_height_m: antHeightM === undefined ? null : antHeightM,
    capturedAt,
    enqueuedAt: new Date().toISOString(),
  };
  queue.push(record);

  let dropped = 0;
  while (queue.length > QUEUE_CAP) {
    queue.shift();
    dropped++;
  }

  saveQueue(queue);
  updateQueueBadge();
  logComm('warn', `Position queued for retry (captured ${capturedAt}) — ${queue.length} pending`);
  if (dropped > 0) {
    logComm('err', `Upload queue at capacity (${QUEUE_CAP}) — dropped ${dropped} oldest queued position(s)`);
    showToast(`Queue full — ${dropped} oldest position(s) dropped`, 'error');
  }
}

/**
 * Replay queued positions, oldest first. Sequential (not parallel) so a
 * flaky connection doesn't fan out into a burst of simultaneous requests.
 * - Success → removed from queue.
 * - Device still not registered → kept queued (not a 4xx, may resolve once
 *   the device transmits and scout-ingress registers it).
 * - UploadError with retryable:false (permanent — RLS/FK/unique-violation,
 *   "won't heal") → dropped with a logged warning + toast.
 * - Anything else (network error, 5xx, unknown) → kept queued for the next
 *   trigger (online event / app load / next successful save).
 */
export async function flushQueue() {
  if (flushing) return;
  if (!uploadFn) return; // gps.js hasn't registered its handler yet
  flushing = true;
  try {
    const queue = loadQueue();
    if (queue.length === 0) return;

    let successCount = 0;
    let droppedCount = 0;
    const remaining = [];

    for (const record of queue) {
      const deviceInfo = { mac: record.mac, ...record.deviceInfo };
      const candidates = resolveHardwareIdCandidates(deviceInfo);

      if (candidates.length === 0) {
        // No MAC to resolve from — can't ever succeed. Keep it (rather than
        // silently discard) but warn; this shouldn't happen in practice
        // since enqueue always snapshots a connected device's mac.
        remaining.push(record);
        logComm('err', `Queued position (captured ${record.capturedAt}) has no resolvable device identity — kept queued`);
        continue;
      }

      try {
        const result = await uploadFn(candidates, record.gps, record.ant_height_m, record.capturedAt);
        if (result.ok) {
          successCount++;
          logComm('info', `Queued position flushed for ${result.targetDeviceId} (captured ${record.capturedAt})`);
        } else {
          remaining.push(record);
          logComm('warn', `Queued position still pending — device not yet registered (captured ${record.capturedAt})`);
        }
      } catch (err) {
        if (err && err.retryable === false) {
          droppedCount++;
          logComm('err', `Dropped queued position (captured ${record.capturedAt}) — permanent error: ${err.message}`);
        } else {
          remaining.push(record);
          logComm('warn', `Queued position retry failed (captured ${record.capturedAt}): ${err.message}`);
        }
      }
    }

    saveQueue(remaining);
    updateQueueBadge();

    if (successCount > 0) {
      showToast(`${successCount} position${successCount > 1 ? 's' : ''} synchronisée${successCount > 1 ? 's' : ''}`, 'success');
    }
    if (droppedCount > 0) {
      showToast(`${droppedCount} queued position(s) could not be saved (permanent error) — dropped`, 'error');
    }
  } finally {
    flushing = false;
  }
}

export function initUploadQueue() {
  updateQueueBadge();
  window.addEventListener('online', () => { flushQueue(); });
  flushQueue(); // app-load trigger
}
