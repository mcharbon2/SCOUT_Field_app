import { state } from './state.js';
import { initScanScreen } from './ui/scan.js';
import { switchTab, setConnected } from './ui/connected.js';
import { initConfigureTab } from './ui/tabs/configure.js';
import { initStatusTab } from './ui/tabs/status.js';
import { initSensorTab } from './ui/tabs/sensor.js';
import { initLoraTab } from './ui/tabs/lora.js';
import { initDiagnosticsTab } from './ui/tabs/diagnostics.js';
import { clearLog } from './ui/log.js';
import { captureGPS, applyManualGPS } from './utils/gps.js';
import { initUploadQueue } from './utils/uploadQueue.js';

document.addEventListener('DOMContentLoaded', () => {
  initScanScreen();
  initConfigureTab();
  initStatusTab();
  initSensorTab();
  initLoraTab();
  initDiagnosticsTab();
  initUploadQueue(); // wires 'online' listener + does the app-load flush trigger

  // Tab switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Disconnect
  document.getElementById('btnDisconnect').addEventListener('click', () => {
    if (state.transport) state.transport.disconnect();
    setConnected(false);
  });

  // GPS capture, manual coordinate entry + clear log
  document.getElementById('btnGPS').addEventListener('click', captureGPS);
  document.getElementById('btnManualGPS').addEventListener('click', () => {
    document.getElementById('manualGpsSection').classList.toggle('hidden');
  });
  document.getElementById('btnApplyManualGPS').addEventListener('click', applyManualGPS);
  document.getElementById('btnClearLog').addEventListener('click', clearLog);
});
