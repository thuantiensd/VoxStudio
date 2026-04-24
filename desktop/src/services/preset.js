/**
 * Preset — cấu hình mặc định khi user drop video.
 *
 * Mục đích: user drop video là chạy ngay, không phải config từng cái. Preset
 * tái sử dụng cấu hình lần trước + cho chọn 3 preset mẫu.
 *
 * Scope: per-user (userStorage), không đồng bộ backend (tạm thời).
 */
import { userStorage } from "./userScope";

const KEY_ACTIVE = "voxstudio:studio:activePreset";
const KEY_CUSTOM = "voxstudio:studio:customPreset";

/** 3 preset built-in — user không chọn gì thì dùng "dubbing_vi". */
export const BUILTIN_PRESETS = {
  dubbing_vi: {
    id: "dubbing_vi",
    label: "Lồng tiếng Việt",
    description: "Dịch + giọng nữ miền Bắc + phụ đề",
    targetLanguage: "vietnamese",
    sourceLanguage: "auto",
    voiceId: null,            // auto-pick default
    enableDubbing: true,
    enableSubtitle: true,
    engine: "google",
  },
  subtitle_only: {
    id: "subtitle_only",
    label: "Chỉ phụ đề",
    description: "Không lồng tiếng, chỉ xuất phụ đề song ngữ",
    targetLanguage: "vietnamese",
    sourceLanguage: "auto",
    voiceId: null,
    enableDubbing: false,
    enableSubtitle: true,
    engine: "google",
  },
  dub_clone: {
    id: "dub_clone",
    label: "Lồng tiếng giữ chất giọng",
    description: "Clone giọng gốc + lồng tiếng dịch",
    targetLanguage: "vietnamese",
    sourceLanguage: "auto",
    voiceId: null,
    enableDubbing: true,
    enableSubtitle: true,
    engine: "google",
    cloneFromSource: true,    // handled at pipeline level
  },
};

/** Trả preset đang active. Default: dubbing_vi. */
export function getActivePreset() {
  try {
    const id = userStorage.getItem(KEY_ACTIVE) || "dubbing_vi";
    // Custom preset → merge vào builtin để có label/description
    if (id === "custom") {
      const raw = userStorage.getItem(KEY_CUSTOM);
      if (raw) {
        const custom = JSON.parse(raw);
        return { ...BUILTIN_PRESETS.dubbing_vi, ...custom,
                  id: "custom", label: "Tuỳ chỉnh",
                  description: custom.description || "Cấu hình riêng của bạn" };
      }
    }
    return BUILTIN_PRESETS[id] || BUILTIN_PRESETS.dubbing_vi;
  } catch {
    return BUILTIN_PRESETS.dubbing_vi;
  }
}

export function setActivePreset(id) {
  try { userStorage.setItem(KEY_ACTIVE, id); } catch {}
}

export function saveCustomPreset(data) {
  try {
    userStorage.setItem(KEY_CUSTOM, JSON.stringify(data));
    userStorage.setItem(KEY_ACTIVE, "custom");
  } catch {}
}

/** List preset cho UI picker. */
export function listPresets() {
  const items = Object.values(BUILTIN_PRESETS);
  try {
    const raw = userStorage.getItem(KEY_CUSTOM);
    if (raw) {
      const custom = JSON.parse(raw);
      items.push({
        ...BUILTIN_PRESETS.dubbing_vi, ...custom,
        id: "custom", label: "Tuỳ chỉnh",
        description: custom.description || "Cấu hình riêng của bạn",
      });
    }
  } catch {}
  return items;
}
