export function logScan(type, msg) {
  const el = document.getElementById('logScan');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  el.innerHTML += `<div class="log-entry ${type}">[${time}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

export function logComm(type, msg) {
  const el = document.getElementById('logComm');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  el.innerHTML += `<div class="log-entry ${type}">[${time}] ${type.toUpperCase()}: ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

export function clearLog() {
  const el = document.getElementById('logComm');
  if (el) el.innerHTML = '';
}
