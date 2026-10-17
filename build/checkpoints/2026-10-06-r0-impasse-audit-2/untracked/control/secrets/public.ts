import type { SiwcBrowserOpener, SiwcKeychainLauncherV1 } from "@toy/contracts";
import { SiwcAuthorization } from "./authorization.js";
import { createMacOsSiwcKeychain } from "./keychain.js";
import { SiwcGrantOwner } from "./siwc-owner.js";

export { SiwcAuthorization, siwcAuthorizationHttp } from "./authorization.js";
export { SiwcGrantOwner } from "./siwc-owner.js";
export { createMacOsSiwcKeychain } from "./keychain.js";
export const createSiwcAuthorization = (binding: SiwcKeychainLauncherV1, openBrowser: SiwcBrowserOpener): SiwcAuthorization => new SiwcAuthorization(new SiwcGrantOwner(createMacOsSiwcKeychain(binding)), openBrowser);
