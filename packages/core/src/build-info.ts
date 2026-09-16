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
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest) && isOwnManifest(manifest)) {
      // Decide it HERE and nowhere else. Walking further up finds unrelated
      // repositories that happen to sit above the install — nvm is itself a
      // git clone with its own package.json, and a version-controlled home
      // directory or dotfiles repo does the same — which made every published
      // release label itself a dev build.
      return fs.existsSync(path.join(dir, ".git"))
        ? { dev: true, root: dir }
        : { dev: false, root: null };
    }
    dir = path.dirname(dir);
  }

  return { dev: false, root: null };
}

/** True when this manifest is diffprism's own, not some package above it. */
function isOwnManifest(manifestPath: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      name?: string;
    };
    return manifest.name === "diffprism";
  } catch {
    return false;
  }
}

/** A version string that admits when it is not a release. */
export function describeVersion(version: string): string {
  const info = getBuildInfo();
  return info.dev ? `${version} (dev build — ${info.root})` : version;
}
