/**
 * Download URLs — point to the public releases-only GitHub repo.
 * Main `VoxStudio` repo stays private; only build artifacts are published
 * to `voxstudio-releases` (public).
 *
 * Update LATEST_VERSION + sizes when shipping a new release.
 */

const RELEASES_REPO = "thuantiensd/voxstudio-releases";
const RELEASES_BASE = `https://github.com/${RELEASES_REPO}/releases`;

export const LATEST_VERSION = "0.2.1";
export const RELEASED_AT = "2026-04-26";

export const DOWNLOADS = {
  macArm: {
    label: "macOS (Apple Silicon)",
    filename: "VoxStudio-arm64.dmg",
    size: "196 MB",
    available: true,
  },
  macIntel: {
    label: "macOS (Intel)",
    filename: "VoxStudio-x64.dmg",
    size: "—",
    available: false,
  },
  windows: {
    label: "Windows",
    filename: "VoxStudio-Setup.exe",
    size: "—",
    available: false,
  },
  linux: {
    label: "Linux (AppImage)",
    filename: "VoxStudio.AppImage",
    size: "—",
    available: false,
  },
} as const;

export type DownloadKey = keyof typeof DOWNLOADS;

export function downloadUrl(key: DownloadKey): string {
  return `${RELEASES_BASE}/latest/download/${DOWNLOADS[key].filename}`;
}

export const PRIMARY_DOWNLOAD: DownloadKey = "macArm";
export const PRIMARY_DOWNLOAD_URL = downloadUrl(PRIMARY_DOWNLOAD);
export const RELEASES_PAGE_URL = RELEASES_BASE;
