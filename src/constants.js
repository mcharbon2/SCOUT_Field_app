export const SCOUT_SERVICE_UUID      = '53434f55-5400-0001-4e45-54574f524b53';
export const SCOUT_TX_CHAR_UUID      = '53434f55-5400-0002-4e45-54574f524b53';
export const SCOUT_RX_CHAR_UUID      = '53434f55-5400-0003-4e45-54574f524b53';
export const SCOUT_DEVINFO_CHAR_UUID = '53434f55-5400-0004-4e45-54574f524b53';

export const SUPABASE_URL      = 'https://zzeefmyvtsrmpeluewhy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6ZWVmbXl2dHNybXBlbHVld2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ3Mzk0NzksImV4cCI6MjA3MDMxNTQ3OX0.AmaA5dvGdxmITTiuC3oHPPB103l8i1WrnY5L0tDr8G4';
export const WIFI_AP_BASE_URL  = 'http://192.168.4.1';

export const CMD_CONFIGURE   = 0x01;
export const CMD_STATUS      = 0x02;
export const CMD_FIRMWARE    = 0x04;
export const CMD_DIAGNOSTIC  = 0x05;
export const CMD_SENSOR_TEST = 0x07;
export const CMD_LORA_TEST   = 0x08;

export const DEVICE_CLASSES = {
  0x01: 'ROVER', 0x02: 'CURIOSITY', 0x03: 'SPIRIT',
  0x10: 'ROVER-BAIT', 0x50: 'INGENUITY',
};
export const DEVICE_MODELS = {
  0x11: 'ROVER-BASIC-WIFI', 0x12: 'ROVER-BASIC-LORA',
  0x13: 'ROVER-TEMP-WIFI',  0x14: 'ROVER-TEMP-LORA',
  0x15: 'ROVER-PRO-WIFI',   0x16: 'ROVER-PRO-LORA',
  0x21: 'ROVER-BAIT-LORA',
  0x31: 'CURIOSITY-WIFI',   0x41: 'SPIRIT-WIFI',
  0x42: 'SPIRIT-LORA',      0x51: 'INGENUITY-LORA',
};
export const SENSOR_TYPES = {
  0x01: 'DHT22', 0x02: 'DS18B20', 0x03: 'BME280', 0x04: 'VEML6075',
  0x10: 'ADXL345', 0x11: 'MPU6050', 0x20: 'OV2640',
  0x30: 'DO Probe', 0x31: 'pH Probe', 0xFE: 'Simulated', 0xFF: 'Unknown',
};
export const TRANSPORT_TYPES = { 0x01: 'WiFi', 0x02: 'LoRa' };
