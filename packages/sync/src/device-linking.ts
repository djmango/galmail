import type { DeviceLinking, EncryptedStore, VaultCrypto } from "@galmail/core-api";

interface DeviceRecord {
  deviceId: string;
  name: string;
  createdAt: string;
  wrappedVaultKey: number[];
}

/**
 * Zero-access device linking scaffold.
 * Invite codes exist only to exchange device pubkeys; vault material stays wrapped.
 */
export class LocalDeviceLinking implements DeviceLinking {
  private invites = new Map<
    string,
    { expiresAt: string; createdAt: string }
  >();

  constructor(
    private readonly store: EncryptedStore,
    private readonly crypto: VaultCrypto,
    private readonly vaultKey: Uint8Array,
  ) {}

  async createInvite(): Promise<{ inviteCode: string; expiresAt: string }> {
    const inviteCode = `gm_${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this.invites.set(inviteCode, {
      expiresAt,
      createdAt: new Date().toISOString(),
    });
    return { inviteCode, expiresAt };
  }

  async acceptInvite(
    inviteCode: string,
  ): Promise<{ deviceId: string }> {
    const invite = this.invites.get(inviteCode);
    if (!invite) throw new Error("invalid invite");
    if (Date.parse(invite.expiresAt) < Date.now()) {
      throw new Error("invite expired");
    }
    this.invites.delete(inviteCode);
    const deviceId = `dev_${Math.random().toString(36).slice(2, 10)}`;
    const deviceKey = await this.crypto.generateVaultKey();
    const wrapped = await this.crypto.wrapKey(this.vaultKey, deviceKey);
    const devices = await this.readDevices();
    devices.push({
      deviceId,
      name: "Linked device",
      createdAt: new Date().toISOString(),
      wrappedVaultKey: [...wrapped],
    });
    await this.writeDevices(devices);
    // In production, deviceKey stays on the new device only.
    return { deviceId };
  }

  async listDevices(): Promise<
    Array<{ deviceId: string; name: string; createdAt: string }>
  > {
    const devices = await this.readDevices();
    return devices.map(({ deviceId, name, createdAt }) => ({
      deviceId,
      name,
      createdAt,
    }));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const devices = await this.readDevices();
    await this.writeDevices(devices.filter((d) => d.deviceId !== deviceId));
  }

  private async readDevices(): Promise<DeviceRecord[]> {
    const raw = await this.store.get("sync/devices");
    if (!raw) return [];
    return JSON.parse(new TextDecoder().decode(raw)) as DeviceRecord[];
  }

  private async writeDevices(devices: DeviceRecord[]): Promise<void> {
    await this.store.put(
      "sync/devices",
      new TextEncoder().encode(JSON.stringify(devices)),
    );
  }
}

/** Encrypt settings/vault blob for cross-device sync (ciphertext only server-side). */
export async function sealSettingsBlob(
  crypto: VaultCrypto,
  vaultKey: Uint8Array,
  settings: unknown,
): Promise<Uint8Array> {
  const plain = new TextEncoder().encode(JSON.stringify(settings));
  return crypto.seal(plain, vaultKey);
}

export async function openSettingsBlob(
  crypto: VaultCrypto,
  vaultKey: Uint8Array,
  ciphertext: Uint8Array,
): Promise<unknown> {
  const plain = await crypto.open(ciphertext, vaultKey);
  return JSON.parse(new TextDecoder().decode(plain));
}
