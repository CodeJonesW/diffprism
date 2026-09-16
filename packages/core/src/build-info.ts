import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  /** True when running from a source checkout rather than an installed package. */
  dev: boolean;
  /** The checkout this build is running from, when it is a dev build. */
  root: string | null;
}

/**
 * Work out whether this is an installed release or a working copy.
 *
 * A linked or locally built CLI reports the same version string as the
 * published one, so `diffprism --version` alone cannot tell you which you are
 * running — and acting on the wrong answer wastes real debugging time.
 *
 * The signal is a `.git` directory beside the package manifest. npm never
 * ships one inside a published tarball, so its presence means a checkout.
 */
export function getBuildInfo(): BuildInfo {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      if (fs.existsSync(path.join(dir, ".git"))) {
        return { dev: true, root: dir };
      }
      // Keep walking: in a monorepo the first manifest found may be a
      // workspace package, with the checkout root further up.
    }
    dir = path.dirname(dir);
  }

  return { dev: false, root: null };
}

/** A version string that admits when it is not a release. */
export function describeVersion(version: string): string {
  const info = getBuildInfo();
  return info.dev ? `${version} (dev build — ${info.root})` : version;
}
