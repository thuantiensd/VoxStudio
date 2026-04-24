import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader, { Page, PageContent } from "../ui/PageHeader";
import { useToast } from "../ui/Toast";
import { useBatch } from "../../batch/BatchContext";
import { createDubbingProject } from "../../services/api";
import { showError } from "../../services/errors";
import DropZone from "./DropZone";
import ProjectGrid from "./ProjectGrid";

/**
 * StudioDubbingHome — trang chính lồng tiếng video.
 *
 * Flow mới:
 *   1. Drop video vào DropZone (preset đã active sẵn)
 *   2. Auto-create project trên backend + auto-enqueue pipeline
 *   3. Card hiện ngay trong Grid, progress realtime
 *   4. User tiếp tục drop video khác (parallel upload) hoặc click card để
 *      mở drawer xem chi tiết
 *
 * Không bắt user config trước khi upload. Không điều hướng đi đâu sau khi
 * drop. Tất cả trên 1 trang.
 */
export default function StudioDubbingHome() {
  const toast = useToast();
  const navigate = useNavigate();
  const { queue, enqueue } = useBatch();
  const [busy, setBusy] = useState(false);

  async function handleFiles(files, preset) {
    if (busy) return;
    setBusy(true);
    const created = [];
    const errors = [];

    // Tạo project song song — nhanh hơn tuần tự. Mỗi file 1 request.
    await Promise.all(
      files.map(async (f) => {
        try {
          let fileObj = f;
          if (f.isLocalPath) {
            // Từ Quét thư mục → đọc buffer qua Electron IPC rồi wrap thành File
            if (!window.voxstudio?.readFileAsBuffer) {
              throw new Error("Ứng dụng chưa sẵn sàng");
            }
            const buf = await window.voxstudio.readFileAsBuffer(f.path);
            const blob = new Blob([buf], { type: guessMime(f.name) });
            fileObj = new File([blob], f.name, { type: blob.type });
          }
          const proj = await createDubbingProject(
            fileObj,
            preset.targetLanguage,
            preset.voiceId || undefined,
            preset.sourceLanguage || "auto",
            preset.enableDubbing,
            preset.enableSubtitle,
          );
          created.push({ projectId: proj.id, filename: f.name });
        } catch (e) {
          errors.push(`${f.name}: ${e?.message || e}`);
        }
      })
    );

    setBusy(false);

    if (errors.length) {
      toast.warn(`${errors.length}/${files.length} video không tạo được dự án.`);
      console.warn("[studio] create project errors:", errors);
    }

    if (created.length) {
      // Enqueue ngay → BatchContext worker sẽ start pipeline
      enqueue(created);
      toast.success(
        created.length === 1
          ? "Đã bắt đầu xử lý video"
          : `Đã bắt đầu xử lý ${created.length} video`,
      );
    }
  }

  function openProject(item) {
    // Done + có outputPath → mở file native. Khác → vào editor để xem detail.
    if (item.status === "done" && item.outputPath) {
      window.voxstudio?.openFileInApp?.(item.outputPath)
        .catch((err) => showError(toast, err, { context: "open file" }));
      return;
    }
    // Running / pending / error → navigate tới editor để xem progress/sửa
    navigate(`/studio/dubbing/${item.projectId}`);
  }

  function retryProject(item) {
    // Re-enqueue job cũ — BatchContext chấp nhận đưa lại job vào pending
    enqueue([{ projectId: item.projectId, filename: item.filename }]);
    toast.info("Đã thêm lại vào hàng đợi xử lý.");
  }

  return (
    <Page>
      <PageHeader
        title="Lồng tiếng video"
        subtitle="Thả video vào — tự động dịch, lồng tiếng, xuất video kèm phụ đề"
      />
      <PageContent maxWidth={1100}>
        <DropZone onFilesAccepted={handleFiles} />
        <ProjectGrid
          queue={queue}
          onOpen={openProject}
          onRetry={retryProject}
        />
      </PageContent>
    </Page>
  );
}

function guessMime(name) {
  const ext = name.toLowerCase().split(".").pop();
  return {
    mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
    avi: "video/x-msvideo", webm: "video/webm",
  }[ext] || "video/mp4";
}
