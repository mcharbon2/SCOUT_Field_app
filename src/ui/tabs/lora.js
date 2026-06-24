import { state } from '../../state.js';

export function initLoraTab() {
  document.getElementById('btnLoRaPing').addEventListener('click', requestLoRaTest);
}

async function requestLoRaTest() {
  const container = document.getElementById('loraData');
  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-dim)">Pinging INGENUITY via LoRa...</div>';

  try {
    const r = await state.transport.loraTest();

    if (r.result === 0x00) {
      container.innerHTML = `<div class="lora-result">
        <div class="lora-result-icon">✅</div>
        <div class="lora-result-title" style="color:var(--success)">Link Established</div>
        <div style="margin-top:16px" class="sensor-grid">
          <div class="sensor-box"><div class="sensor-box-value ${r.rssi>-80?'good':r.rssi>-100?'warn':'bad'}" style="font-size:20px">${r.rssi}</div><div class="sensor-box-unit">dBm</div><div class="sensor-box-label">RSSI</div></div>
          <div class="sensor-box"><div class="sensor-box-value" style="font-size:20px">${r.snr.toFixed(1)}</div><div class="sensor-box-unit">dB</div><div class="sensor-box-label">SNR</div></div>
        </div>
        <div class="lora-result-detail" style="margin-top:12px">TX Power: ${r.tx_power} dBm | SF: ${r.sf}</div>
      </div>`;
    } else if (r.result === 0x01) {
      container.innerHTML = `<div class="lora-result">
        <div class="lora-result-icon">📡</div>
        <div class="lora-result-title" style="color:var(--warning)">No Response (Timeout)</div>
        <div class="lora-result-detail">INGENUITY may be out of range or powered off.<br>TX Power: ${r.tx_power} dBm | SF: ${r.sf}</div>
      </div>`;
    } else {
      container.innerHTML = `<div class="lora-result">
        <div class="lora-result-icon">❌</div>
        <div class="lora-result-title" style="color:var(--danger)">LoRa Init Failed</div>
        <div class="lora-result-detail">Could not initialize LoRa radio on device.</div>
      </div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="lora-result">
      <div class="lora-result-icon">⚠️</div>
      <div class="lora-result-title" style="color:var(--danger)">Error</div>
      <div class="lora-result-detail">${err.message}</div>
    </div>`;
  }
}
