import { state } from '../../state.js';

export function initSensorTab() {
  document.getElementById('btnReadSensor').addEventListener('click', requestSensorTest);
}

async function requestSensorTest() {
  const container = document.getElementById('sensorData');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim)">Reading sensor...</div>';
  try {
    const result = await state.transport.sensorTest();
    if (result.transport === 'wifi') renderJson(container, result._json);
    else renderBinary(container, result._raw, result._offset);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">Failed: ${err.message}</div>`;
  }
}

function renderJson(container, json) {
  // { sensor_type: "DHT22", readings: [{name, value, unit}, ...] }
  if (!json?.readings) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-secondary)">${JSON.stringify(json)}</div>`;
    return;
  }
  const boxes = json.readings.map(r => `
    <div class="sensor-box">
      <div class="sensor-box-value">${typeof r.value === 'number' ? r.value.toFixed(r.value % 1 === 0 ? 0 : 1) : r.value}</div>
      <div class="sensor-box-unit">${r.unit || ''}</div>
      <div class="sensor-box-label">${r.name}</div>
    </div>`).join('');
  container.innerHTML = `
    <div style="font-family:var(--mono);font-size:11px;color:var(--text-dim);margin-bottom:10px;">${json.sensor_type}</div>
    <div class="sensor-grid">${boxes}</div>`;
}

function renderBinary(container, d, offset) {
  const sensorType = d.getUint8(offset);
  const readingCount = d.getUint8(offset + 1);
  let html = '';

  if (sensorType === 0x10 || sensorType === 0x11) {
    const x = d.getInt16(offset + 2, true) / 100;
    const y = d.getInt16(offset + 4, true) / 100;
    const z = d.getInt16(offset + 6, true) / 100;
    const mag = d.getUint16(offset + 8, true) / 100;
    html = `<div class="sensor-grid">
      <div class="sensor-box"><div class="sensor-box-value">${x.toFixed(2)}</div><div class="sensor-box-unit">g</div><div class="sensor-box-label">X Axis</div></div>
      <div class="sensor-box"><div class="sensor-box-value">${y.toFixed(2)}</div><div class="sensor-box-unit">g</div><div class="sensor-box-label">Y Axis</div></div>
      <div class="sensor-box"><div class="sensor-box-value">${z.toFixed(2)}</div><div class="sensor-box-unit">g</div><div class="sensor-box-label">Z Axis</div></div>
      <div class="sensor-box"><div class="sensor-box-value" style="color:var(--accent)">${mag.toFixed(2)}</div><div class="sensor-box-unit">g</div><div class="sensor-box-label">Magnitude</div></div>
    </div>`;
  } else if (sensorType === 0x01) {
    const temp = d.getInt16(offset + 2, true) / 10;
    const hum  = d.getUint8(offset + 4);
    html = `<div class="sensor-grid">
      <div class="sensor-box"><div class="sensor-box-value">${temp.toFixed(1)}</div><div class="sensor-box-unit">°C</div><div class="sensor-box-label">Temperature</div></div>
      <div class="sensor-box"><div class="sensor-box-value">${hum}</div><div class="sensor-box-unit">%</div><div class="sensor-box-label">Humidity</div></div>
    </div>`;
  } else if (sensorType === 0x02) {
    const temp = d.getInt16(offset + 2, true) / 10;
    html = `<div class="sensor-grid">
      <div class="sensor-box"><div class="sensor-box-value">${temp.toFixed(1)}</div><div class="sensor-box-unit">°C</div><div class="sensor-box-label">Temperature</div></div>
    </div>`;
  } else if (sensorType === 0x03) {
    const temp     = d.getInt16(offset + 2, true) / 10;
    const hum      = d.getUint8(offset + 4);
    const pressure = d.getUint32(offset + 5, true);
    html = `<div class="sensor-grid">
      <div class="sensor-box"><div class="sensor-box-value">${temp.toFixed(1)}</div><div class="sensor-box-unit">°C</div><div class="sensor-box-label">Temperature</div></div>
      <div class="sensor-box"><div class="sensor-box-value">${hum}</div><div class="sensor-box-unit">%</div><div class="sensor-box-label">Humidity</div></div>
      <div class="sensor-box"><div class="sensor-box-value">${(pressure/100).toFixed(1)}</div><div class="sensor-box-unit">hPa</div><div class="sensor-box-label">Pressure</div></div>
    </div>`;
  } else {
    html = `<div style="text-align:center;padding:20px;color:var(--text-secondary)">Sensor type 0x${sensorType.toString(16)}: ${readingCount} reading(s) received</div>`;
  }
  container.innerHTML = html;
}
