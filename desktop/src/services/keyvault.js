/**
 * keyvault — unified API key storage.
 *
 * Electron: sử dụng safeStorage qua IPC (keys:set/get/list/delete). Key được
 * mã hoá bởi OS Keychain (mac) / DPAPI (win) / libsecret (linux).
 *
 * Web fallback: localStorage (không an toàn — chỉ để dev). Cảnh báo user.
 *
 * Known key IDs (khớp với Settings > Integrations UI):
 *   openai · claude · deepl · gemini · google_cloud
 */

const LS_PREFIX = "voxstudio:apikey:";

function electron() {
  return typeof window !== "undefined" && window.voxstudio?.keys;
}

export async function listKeys() {
  if (electron()) {
    const res = await window.voxstudio.keys.list();
    return { ids: res.ids || {}, encrypted: !!res.encrypted };
  }
  // Web fallback
  const ids = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) ids[k.slice(LS_PREFIX.length)] = true;
    }
  } catch {}
  return { ids, encrypted: false };
}

export async function getKey(id) {
  if (electron()) return window.voxstudio.keys.get(id);
  try { return localStorage.getItem(LS_PREFIX + id) || null; }
  catch { return null; }
}

export async function setKey(id, value) {
  if (electron()) return window.voxstudio.keys.set(id, value);
  try {
    if (value) localStorage.setItem(LS_PREFIX + id, value);
    else localStorage.removeItem(LS_PREFIX + id);
    return true;
  } catch { return false; }
}

export async function deleteKey(id) {
  return setKey(id, "");
}

export function isSecureBackend() {
  return !!electron();
}
