import { DEVICE_CLASSES } from '../constants.js';

// Pure device-identity resolution logic — no DOM, no fetch — so it can be
// exercised directly (Node import, unit test, verification script) without
// dragging in the browser-only GPS/toast/log modules that consume it.

/**
 * Mirrors PILOTE_WEB's backend/scout_sim/sim_identity.py masked_form(): a
 * LoRa-relayed device's on-air relay JSON only ever carries its last 3 MAC
 * octets, so scout-ingress registers it in scout_devices under
 * "??:??:??:XX:YY:ZZ", not its full BLE MAC. Same derivation here so the
 * app can find that masked row from the full MAC read over BLE DevInfo.
 */
export function maskedForm(mac) {
  const octets = mac.split(':');
  const last3 = octets.slice(-3);
  return '??:??:??:' + last3.map(o => o.toUpperCase()).join(':');
}

/**
 * Escape 2 fix (verified cross-repo by PILOTE_WEB's
 * backend/scout_sim/verify_identity_resolution.py, exit 2 KNOWN-GAP): a
 * plain full-MAC hardware_id lookup finds 0 rows for a LoRa-relayed ROVER,
 * because scout-ingress only ever sees its masked last-3-octet form — the
 * app used to refuse to record position for exactly the devices a field
 * tech is standing at.
 *
 * Dual-identity nuance (real hardware, not hypothetical): the SAME physical
 * T3 board can carry TWO scout_devices rows — a full-MAC row from a past
 * WiFi-gateway life, and a masked row for its CURRENT LoRa-rover identity.
 * E.g. MAC 90:15:06:D8:43:B8 has both INGENUITY-LORA-001 (full MAC, stale
 * gateway identity) and ROVER-BAIT-LORA-006 (masked ??:??:??:D8:43:B8, the
 * live LoRa-rover identity actually receiving telemetry). So this can't be
 * "try full MAC, fall back to masked" — that would silently bind live GPS
 * to the wrong, stale identity for exactly those dual-identity boards.
 *
 * The lookup order is instead driven by what the connected device SAYS IT
 * IS over BLE (deviceInfo from ble.js/wifi.js getInfo()), not by trying
 * both blindly:
 *
 *   - LoRa-transport ROVER / ROVER-BAIT (model name contains "LORA", or
 *     transport_type reads as LoRa; device class is ROVER or ROVER-BAIT,
 *     never INGENUITY): masked form FIRST, full MAC as fallback (covers a
 *     WiFi-provisioned rover that hasn't gone over LoRa yet, so has no
 *     masked row).
 *   - Everything else (INGENUITY, WiFi transport, unrecognized class):
 *     full MAC only, as before — INGENUITY IS the gateway endpoint and
 *     always registers under its own full MAC.
 *
 * Returns an ordered array of hardware_id candidates to query in turn
 * (first hit wins). Empty array if deviceInfo has no MAC yet.
 */
export function resolveHardwareIdCandidates(deviceInfo) {
  const mac = deviceInfo?.mac;
  if (!mac) return [];

  const classCode = deviceInfo.class_code;
  const modelName = deviceInfo.model_name || '';
  const className = DEVICE_CLASSES[classCode];

  const isIngenuity = classCode === 0x50 || modelName.includes('INGENUITY');
  const isRoverClass =
    !isIngenuity &&
    (className === 'ROVER' || className === 'ROVER-BAIT' || modelName.includes('ROVER'));
  const isLoRaTransport = deviceInfo.transport_type === 0x02 || modelName.includes('LORA');

  if (isRoverClass && isLoRaTransport) {
    return [maskedForm(mac), mac];
  }
  return [mac];
}
