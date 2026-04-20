import { Routes, Route } from "react-router-dom";
import StudioHome from "../components/studio/StudioHome";
import StudioEditor from "../components/studio/StudioEditor";

/**
 * STT Studio v2 — router nội bộ.
 *   /studio          → Home (upload + lịch sử)
 *   /studio/:id      → Editor (tab Lồng tiếng / Nâng cao)
 *
 * Bản cũ /dubbing vẫn sống song song cho tới khi chốt bỏ.
 */
export default function StudioPage() {
  return (
    <Routes>
      <Route index element={<StudioHome />} />
      <Route path=":id" element={<StudioEditor />} />
    </Routes>
  );
}
