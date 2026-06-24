// Mutable app-level state — single source of truth
export const state = {
  transport: null,    // BleTransport | WifiHttpTransport | MeshCoreTransport | null
  deviceInfo: {},
  capturedGPS: null,
};
