// MeshCore Companion Protocol transport — Sprint F0 (stub)
// Spec: SCOUT_FIELDTECH_MESHCORE_INTEGRATION.md
//
// Implements the same interface as BleTransport/WifiHttpTransport, plus
// meshConfig() which wraps MeshCore's radio/mesh layer.
//
// When implementing:
//   1. Vendor meshcore.js (MIT) from docs.meshcore.io, or `npm install` it.
//   2. connect():  APP_START (0x01) then DEVICE_QUERY (0x16) over BLE.
//   3. meshConfig(): SET_RADIO (freq/SF/BW/CR) + SET_CHANNEL (0x20).
//   4. F1 decision: dual-channel vs dual-firmware-window for SCOUT app config.
//
//  BLOCKING GATE before SET_RADIO (Sprint F2): resolve the
//  SF7/0x12 vs SF10/0x53 fleet radio-param discrepancy first, or
//  provisioned nodes will be deaf to the fleet.

import { logComm } from '../ui/log.js';

const NOT_IMPL = 'MeshCore transport not yet implemented — Sprint F0';

export default class MeshCoreTransport {
  constructor() {
    this.type = 'mesh';
  }

  async connect()       { throw new Error(NOT_IMPL); }
  async getInfo()       { throw new Error(NOT_IMPL); }
  async configure()     { throw new Error(NOT_IMPL); }
  async getStatus()     { throw new Error(NOT_IMPL); }
  async sensorTest()    { throw new Error(NOT_IMPL); }
  async loraTest()      { throw new Error('LoRa test N/A on mesh — use meshConfig() link check'); }
  async getDiagnostic() { throw new Error(NOT_IMPL); }
  async meshConfig()    { throw new Error(NOT_IMPL); }

  disconnect()    { logComm('info', 'MeshCore transport disconnected'); }
  getDeviceName() { return 'MESH-DEVICE'; }
}
