import { state } from '../../state.js';
import { formatUptime } from '../../utils/format.js';
import { SENSOR_TYPES, TRANSPORT_TYPES } from '../../constants.js';

export function initDiagnosticsTab() {
  document.getElementById('btnDownloadDiag').addEventListener('click', requestDiagnostics);
}

async function requestDiagnostics() {
  const container = document.getElementById('diagData');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim)">Downloading diagnostics...</div>';

  try {
    const d = await state.transport.getDiagnostic();

    let html = `
      <div class="data-row"><span class="data-key">Boot Count</span><span class="data-val">${d.boot_count}</span></div>
      <div class="data-row"><span class="data-key">Uptime</span><span class="data-val">${formatUptime(d.uptime_seconds)}</span></div>
      <div class="data-row"><span class="data-key">Pending Events</span><span class="data-val ${d.pending_events>0?'warn':''}">${d.pending_events}</span></div>
      <div class="data-row"><span class="data-key">Consecutive Errors</span><span class="data-val ${d.consecutive_errors>0?'warn':''}">${d.consecutive_errors}</span></div>
      <div class="data-row"><span class="data-key">Last Error</span><span class="data-val ${d.last_error_code?'bad':''}">${d.last_error_code?'0x'+d.last_error_code.toString(16).padStart(2,'0'):'None'}</span></div>
      <div class="data-row"><span class="data-key">Sensor</span><span class="data-val">${SENSOR_TYPES[d.sensor_type]||'0x'+d.sensor_type.toString(16)}</span></div>
      <div class="data-row"><span class="data-key">Transport</span><span class="data-val">${TRANSPORT_TYPES[d.transport_type]||'?'}</span></div>
      <div class="data-row"><span class="data-key">Power Source</span><span class="data-val">${d.power_source}</span></div>
      <div class="data-row"><span class="data-key">Battery Voltage</span><span class="data-val">${(d.battery_mv/1000).toFixed(2)}V</span></div>
    `;

    if (d.transport === 'ble') {
      html += `
        <div class="data-row"><span class="data-key">False Triggers</span><span class="data-val">${d.false_triggers}</span></div>
        <div class="data-row"><span class="data-key">Chunk</span><span class="data-val">${(d.chunk_index||0)+1} / ${d.total_chunks||1}</span></div>
      `;
    }

    if (d.transport === 'wifi') {
      html += `
        <div class="data-row"><span class="data-key">Firmware</span><span class="data-val">${d.fw_version||'?'}</span></div>
        <div class="data-row"><span class="data-key">TX Success</span><span class="data-val">${d.total_tx_count||0} sent / ${d.failed_tx_count||0} failed</span></div>
      `;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Failed: ${err.message}</div>`;
  }
}
