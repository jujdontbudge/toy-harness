import { createHash, randomUUID } from "node:crypto";
import { siwcGrantVaultSchema, siwcRegistrationSchema, siwcStoredGrantSchema } from "@toy/contracts";
import type { SiwcCredentialOwner, SiwcGrantVaultV1, SiwcKeychainStore, SiwcRegistration, SiwcStoredGrant } from "@toy/contracts";

const digest = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
const bytes = (vault: SiwcGrantVaultV1): Uint8Array => Buffer.from(JSON.stringify(siwcGrantVaultSchema.parse(vault)));
const same = (left: SiwcRegistration, right: SiwcRegistration): boolean => left.clientId === right.clientId && left.subject === right.subject;

export class SiwcGrantOwner implements SiwcCredentialOwner {
  private selected: { vault: SiwcGrantVaultV1; digest: string } | null = null;
  constructor(private readonly keychain: SiwcKeychainStore) {}
  private async snapshot(): Promise<{ vault: SiwcGrantVaultV1; digest: string }> {
    const stored = await this.keychain.read();
    if (stored !== null) {
      const raw: unknown = JSON.parse(Buffer.from(stored).toString("utf8"));
      return { vault: siwcGrantVaultSchema.parse(raw), digest: digest(stored) };
    }
    const initial = siwcGrantVaultSchema.parse({ schemaVersion: "toy.siwc-grant-vault.v1", hostId: "urn:uuid:" + randomUUID(), registration: null, pendingClientId: null, grant: null });
    const value = bytes(initial);
    if (!await this.keychain.compareAndWrite(null, value)) {
      const concurrent = await this.keychain.read();
      if (concurrent === null) throw new Error("siwc_keychain_conflict");
      const raw: unknown = JSON.parse(Buffer.from(concurrent).toString("utf8"));
      return { vault: siwcGrantVaultSchema.parse(raw), digest: digest(concurrent) };
    }
    const readback = await this.keychain.read();
    if (readback === null || digest(readback) !== digest(value)) throw new Error("siwc_keychain_readback_failed");
    return { vault: initial, digest: digest(value) };
  }
  async load(): Promise<{ hostId: string; registration: SiwcRegistration | null; pendingClientId: string | null }> {
    const selected = await this.snapshot();
    this.selected = selected;
    const { vault } = selected;
    return { hostId: vault.hostId, registration: vault.registration, pendingClientId: vault.pendingClientId };
  }
  private async update(previousDigest: string, vault: SiwcGrantVaultV1): Promise<{ vault: SiwcGrantVaultV1; digest: string }> {
    const value = bytes(vault);
    if (!await this.keychain.compareAndWrite(previousDigest, value)) throw new Error("siwc_keychain_conflict");
    const readback = await this.keychain.read();
    if (readback === null || digest(readback) !== digest(value)) throw new Error("siwc_keychain_readback_failed");
    return { vault, digest: digest(value) };
  }
  async retainClientId(clientId: string): Promise<void> {
    siwcRegistrationSchema.shape.clientId.parse(clientId);
    if (this.selected === null) throw new Error("siwc_authorization_not_started");
    const { vault, digest: previousDigest } = this.selected;
    if (vault.pendingClientId !== null && vault.pendingClientId !== clientId || vault.registration !== null && vault.registration.clientId !== clientId) throw new Error("siwc_registration_changed");
    if (vault.pendingClientId === clientId) return;
    this.selected = await this.update(previousDigest, { ...vault, pendingClientId: clientId });
  }
  async save(input: SiwcStoredGrant): Promise<void> {
    const grant = siwcStoredGrantSchema.parse(input);
    if (this.selected === null) throw new Error("siwc_authorization_not_started");
    const { vault, digest: previousDigest } = this.selected;
    if (grant.hostId !== vault.hostId || vault.pendingClientId !== grant.registration.clientId || vault.registration !== null && !same(vault.registration, grant.registration)) throw new Error("siwc_registration_changed");
    this.selected = await this.update(previousDigest, { ...vault, registration: grant.registration, grant });
  }
  async read(input: SiwcRegistration): Promise<SiwcStoredGrant | null> {
    const registration = siwcRegistrationSchema.parse(input);
    const stored = await this.keychain.read();
    if (stored === null) return null;
    const raw: unknown = JSON.parse(Buffer.from(stored).toString("utf8"));
    const vault = siwcGrantVaultSchema.parse(raw);
    if (vault.registration === null || !same(vault.registration, registration)) return null;
    return vault.grant;
  }
}
