/**
 * keyvault — API key storage, scope theo user hiện tại.
 *
 * Electron: safeStorage qua IPC, partition theo userId → user A không
 * thể đọc key của user B cùng máy.
 *
 * Web fallback: localStorage prefix theo user ID (kém an toàn — chỉ
 * để dev).
 *
 * Known key IDs: openai, claude, deepl, gemini, google_cloud.
 */
import { currentUserId } from "./userScope";

const LS_PREFIX = "voxstudio:apikey:";

function electron() {
  return typeof window !== "undefined" && window.voxstudio?.keys;
}

function lsPrefix() {
  const uid = currentUserId();
  return uid ? `${LS_PREFIX}u/${uid}:` : LS_PREFIX;
}

export async function listKeys() {
  const uid = currentUserId();
  if (electron() && uid) {
    const res = await window.voxstudio.keys.list(uid);
    return { ids: res.ids || {}, encrypted: !!res.encrypted };
  }
  // Web fallback — scan localStorage với prefix hiện tại
  const ids = {};
  const pfx = lsPrefix();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pfx)) ids[k.slice(pfx.length)] = true;
    }
  } catch {}
  return { ids, encrypted: false };
}

export async function getKey(id) {
  const uid = currentUserId();
  if (electron() && uid) return window.voxstudio.keys.get(uid, id);
  try { return localStorage.getItem(lsPrefix() + id) || null; }
  catch { return null; }
}

export async function setKey(id, value) {
  const uid = currentUserId();
  if (electron() && uid) return window.voxstudio.keys.set(uid, id, value);
  try {
    if (value) localStorage.setItem(lsPrefix() + id, value);
    else localStorage.removeItem(lsPrefix() + id);
    return true;
  } catch { return false; }
}

export async function deleteKey(id) {
  return setKey(id, "");
}

export function isSecureBackend() {
  return !!electron();
}

/** Xoá toàn bộ key của user — gọi khi logout. */
export async function clearCurrentUser() {
  const uid = currentUserId();
  if (!uid) return;
  if (electron()) {
    await window.voxstudio.keys.clearUser(uid);
  } else {
    const pfx = lsPrefix();
    try {
      const toDel = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pfx)) toDel.push(k);
      }
      toDel.forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}
