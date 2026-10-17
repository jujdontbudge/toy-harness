import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const trustedCheckoutRoot = (): string => {
  let path = import.meta.dirname;
  while (path !== dirname(path)) {
    if (existsSync(join(path, ".git")) && existsSync(join(path, "architecture/modules.json"))) return path;
    path = dirname(path);
  }
  throw new Error("DECLARED_CHECKOUT_UNAVAILABLE");
};

export const trustedToolEnvironment = () => {
  const home = join(trustedCheckoutRoot(), "build/.engineering-home");
  return { PATH: dirname(process.execPath) + ":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: home, LANG: "C", LC_ALL: "C", npm_config_cache: join(home, "cache"), npm_config_userconfig: join(home, "absent.npmrc") };
};
