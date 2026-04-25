import { Routes, Route, Navigate } from "react-router-dom";
import StudioHub from "../components/studio/StudioHub";

/**
 * Studio — hub đa công cụ AI.
 * Chỉ còn 1 mode duy nhất: Batch (lồng tiếng nhiều video, cấu hình 1 lần).
 */
export default function StudioPage() {
  return (
    <Routes>
      <Route index element={<StudioHub />} />
      <Route path=":toolId" element={<StudioHub />} />
      <Route path="*" element={<Navigate to="/studio" replace />} />
    </Routes>
  );
}
