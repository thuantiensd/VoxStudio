/**
 * userScope — tách biệt localStorage + vault theo user ID.
 *
 * Mỗi user đăng nhập vào máy sẽ có bucket riêng. Đổi tài khoản → load
 * bucket tương ứng, không leak sang nhau.
 *
 * Format key: "voxstudio:u/<userId>:<base>"
 *   Ví dụ:    "voxstudio:u/42:stt:outputFolder"
 *
 * Các key device-level (theme, locale, sidebar collapsed) KHÔNG scope
 * — giữ nguyên tên gốc vì đó là setting theo máy, không theo user.
 */

const AUTH_KEY = "voxstudio:auth";
const PREFIX = "voxstudio:";

/**
 * Đọc user id hiện tại từ auth localStorage. Trả null nếu chưa đăng nhập.
 * Không dùng hook → gọi được ở bất kỳ đâu (cả useState initializer).
 */
export function currentUserId() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const uid = parsed?.user?.id;
    return uid != null ? String(uid) : null;
  } catch {
    return null;
  }
}

/**
 * Chuyển 1 base key thành scoped key theo user hiện tại.
 * Input có thể có hoặc không có prefix 'voxstudio:' — hàm tự normalize.
 * Nếu chưa có user (edge case), fallback dùng key gốc.
 */
function userKey(key) {
  const uid = currentUserId();
  const base = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
  return uid ? `${PREFIX}u/${uid}:${base}` : `${PREFIX}${base}`;
}

/**
 * userStorage — drop-in thay localStorage cho các pref cần scope theo user.
 * API tương thích với localStorage (get/set/remove).
 */
export const userStorage = {
  getItem(key) {
    try { return localStorage.getItem(userKey(key)); }
    catch { return null; }
  },
  setItem(key, value) {
    try { localStorage.setItem(userKey(key), value); }
    catch {}
  },
  removeItem(key) {
    try { localStorage.removeItem(userKey(key)); }
    catch {}
  },
};
