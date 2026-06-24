import { state } from '../../state.js';
import { formatUptime } from '../../utils/format.js';

export function initStatusTab() {
  document.getElementById('btnRefreshStatus').addEventListener('click', requestStatus);
}

async function requestStatus() {
  const container = document.getElementById('statusData');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim)">Requesting...</div>';

  try {
    const s = await state.transport.getStatus();
    const uptimeStr = formatUptime(s.uptime);
    const lastTxStr = s.last_tx > 0
      ? new Date((s.last_tx + 946684800) * 1000).toLocaleString() : 'Never';

    let html = `
      <div class="data-row"><span class="data-key">Battery</span><span class="data-val ${s.battery>50?'good':s.battery>20?'warn':'bad'}">${s.battery===0xFF?'—':s.battery+'%'}</span></div>
      <div class="data-row"><span class="data-key">Uptime</span><span class="data-val">${uptimeStr}</span></div>
      <div class="data-row"><span class="data-key">Last Transmit</span><span class="data-val">${lastTxStr}</span></div>
      <div class="data-row"><span class="data-key">Pending Events</span><span class="data-val ${s.pending_events>0?'warn':''}">${s.pending_events}</span></div>
      <div class="data-row"><span class="data-key">Sensor</span><span class="data-val ${s.sensor_status==='OK'?'good':'warn'}">${s.sensor_status}</span></div>
      <div class="data-row"><span class="data-key">Transport</span><span class="data-val ${s.transport_status==='OK'?'good':'warn'}">${s.transport_status}</span></div>
      <div class="data-row"><span class="data-key">Boot Count</span><span class="data-val">${s.boot_count}</span></div>
      <div class="data-row"><span class="data-key">Last Error</span><span class="data-val ${s.last_error?'bad':''}">${s.last_error?'0x'+s.last_error.toString(16):'None'}</span></div>
      <div class="data-row"><span class="data-key">Config State</span><span class="data-val ${s.configured?'good':'warn'}">${s.configured?'Configured':'Unconfigured'}</span></div>
    `;

    if (state.transport?.type === 'wifi') {
      html += `
        <div class="data-row"><span class="data-key">WiFi SSID</span><span class="data-val">${s.wifi_ssid||'—'}</span></div>
        <div class="data-row"><span class="data-key">WiFi Connected</span><span class="data-val ${s.wifi_connected?'good':'warn'}">${s.wifi_connected?'Yes':'No'}</span></div>
      `;
      if (s.wifi_rssi !== undefined)
        html += `<div class="data-row"><span class="data-key">WiFi RSSI</span><span class="data-val">${s.wifi_rssi} dBm</span></div>`;
      if (s.ip_address)
        html += `<div class="data-row"><span class="data-key">IP Address</span><span class="data-val">${s.ip_address}</span></div>`;
      if (s.total_tx_count !== undefined)
        html += `<div class="data-row"><span class="data-key">TX Count</span><span class="data-val">${s.total_tx_count} sent / ${s.failed_tx_count||0} failed</span></div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Failed: ${err.message}</div>`;
  }
}
