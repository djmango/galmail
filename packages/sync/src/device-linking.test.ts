import { describe, expect, it } from "bun:test";
import {
  DevVaultCrypto,
  MemoryEncryptedStore,
} from "@galmail/browser-adapters";
import {
  LocalDeviceLinking,
  openSettingsBlob,
  sealSettingsBlob,
} from "./device-linking.js";

describe("device linking + settings vault", () => {
  it("creates and accepts invites", async () => {
    const store = new MemoryEncryptedStore();
    const crypto = new DevVaultCrypto();
    const vaultKey = await crypto.generateVaultKey();
    const linking = new LocalDeviceLinking(store, crypto, vaultKey);
    const { inviteCode } = await linking.createInvite();
    const { deviceId } = await linking.acceptInvite(inviteCode);
    const devices = await linking.listDevices();
    expect(devices.some((d) => d.deviceId === deviceId)).toBe(true);
    await linking.revokeDevice(deviceId);
    expect(await linking.listDevices()).toHaveLength(0);
  });

  it("seals settings for zero-access sync", async () => {
    const crypto = new DevVaultCrypto();
    const key = await crypto.generateVaultKey();
    const sealed = await sealSettingsBlob(crypto, key, { theme: "system" });
    const opened = await openSettingsBlob(crypto, key, sealed);
    expect(opened).toEqual({ theme: "system" });
  });
});
