import { Routes, Route, Navigate } from "react-router-dom";
import StudioHub from "../components/studio/StudioHub";
import StudioEditor from "../components/studio/StudioEditor";

/**
 * Studio — hub đa công cụ AI.
 *
 * Routes:
 *   /studio                      → Hub (default tool: dubbing)
 *   /studio/dubbing              → Hub với tool Lồng tiếng active
 *   /studio/dubbing/:projectId   → Editor dự án lồng tiếng cụ thể
 *   /studio/image-gen|…          → Hub với tool tương ứng (hiện "Sắp ra mắt")
 *
 * Legacy: /studio/:projectId (UUID) → redirect về /studio/dubbing/:projectId
 *   để tương thích với link cũ lưu ở download history / batch state.
 */
export default function StudioPage() {
  return (
    <Routes>
      <Route index element={<StudioHub />} />
      <Route path="dubbing" element={<StudioHub />} />
      <Route path="dubbing/:id" element={<StudioEditor />} />
      {/* Các tool khác dẫn vào Hub với toolId */}
      <Route path=":toolId" element={<StudioHub />} />
      {/* Legacy fallback không match được ở trên — đẩy về hub mặc định */}
      <Route path="*" element={<Navigate to="/studio" replace />} />
    </Routes>
  );
}
