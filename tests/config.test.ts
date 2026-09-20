// R4: heartbeat window (and the other bounds) are deployment-level config,
// changeable without a code change, with a documented default.

import { afterEach, describe, expect, test } from "vitest";
import {
  deviceListPageSize,
  deviceRegistryRequireAdmin,
  heartbeatWindowMs,
  metadataMaxEntries,
  metadataMaxKeyLength,
  metadataMaxValueLength,
} from "../backend/lib/config";

const ENV_KEYS = [
  "DEVICE_HEARTBEAT_WINDOW_MS",
  "DEVICE_METADATA_MAX_ENTRIES",
  "DEVICE_METADATA_MAX_KEY_LENGTH",
  "DEVICE_METADATA_MAX_VALUE_LENGTH",
  "DEVICE_LIST_PAGE_SIZE",
  "DEVICE_REGISTRY_REQUIRE_ADMIN",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("backend/lib/config (R4)", () => {
  test("documented defaults", () => {
    expect(heartbeatWindowMs()).toBe(60_000);
    expect(metadataMaxEntries()).toBe(20);
    expect(metadataMaxKeyLength()).toBe(64);
    expect(metadataMaxValueLength()).toBe(256);
    expect(deviceListPageSize()).toBe(50);
    expect(deviceRegistryRequireAdmin()).toBe(false);
  });

  test("heartbeat window is overridable without a code change", () => {
    process.env.DEVICE_HEARTBEAT_WINDOW_MS = "120000";
    expect(heartbeatWindowMs()).toBe(120_000);
  });

  test("an invalid or empty override falls back to the default", () => {
    process.env.DEVICE_HEARTBEAT_WINDOW_MS = "not-a-number";
    expect(heartbeatWindowMs()).toBe(60_000);
    process.env.DEVICE_HEARTBEAT_WINDOW_MS = "";
    expect(heartbeatWindowMs()).toBe(60_000);
  });

  test("DEVICE_REGISTRY_REQUIRE_ADMIN accepts 'true'/'1'", () => {
    process.env.DEVICE_REGISTRY_REQUIRE_ADMIN = "true";
    expect(deviceRegistryRequireAdmin()).toBe(true);
    process.env.DEVICE_REGISTRY_REQUIRE_ADMIN = "1";
    expect(deviceRegistryRequireAdmin()).toBe(true);
    process.env.DEVICE_REGISTRY_REQUIRE_ADMIN = "false";
    expect(deviceRegistryRequireAdmin()).toBe(false);
  });
});
