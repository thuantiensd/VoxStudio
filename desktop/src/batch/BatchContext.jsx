import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  autoDub, exportVideo, exportDownloadURL, getDubbingProject, cancelAutoDub,
  fetchMe,
} from "../services/api";
import { showError } from "../services/errors";
import { useToast } from "../components/ui/Toast";
import { userStorage } from "../services/userScope";
import { useAuth } from "../auth/AuthContext";

const STORAGE_KEY = "voxstudio:batch:outputFolder";
const QUEUE_KEY = "voxstudio:batch:queue";
const MAX_HISTORY = 50;
const DEFAULT_CONCURRENT = 1;  // fallback khi chưa load được plan

const BatchCtx = createContext(null);

/**
 * BatchProvider — queue xử lý tuần tự nhiều project.
 *   outputFolder: thư mục đích (string, từ folder picker)
 *   queue: [{ projectId, filename, status, startedAt, finishedAt, error }]
 *   current: projectId đang chạy
 *   enqueue(projectIds, filenames): thêm các project vào queue, tự chạy
 *   clear(): xoá queue đã xong
 *
 * Status: "pending" | "running" | "done" | "error"
 */
export function BatchProvider({ children }) {
  const toast = useToast();
  const { isAuthenticated } = useAuth() || {};
  const [outputFolder, setOutputFolderState] = useState(() => {
    try { return userStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  });
  // Dynamic concurrent limit từ plan. Mặc định 1 (free tier) cho tới khi
  // load xong /me. Tránh frontend chạy 2 job song song khi backend chỉ
  // cho phép 1 → bị 429 orphan.
  const [maxConcurrent, setMaxConcurrent] = useState(DEFAULT_CONCURRENT);
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMe().then((me) => {
      const n = me?.plan?.limits?.concurrent_jobs;
      if (Number.isFinite(n) && n >= 1) setMaxConcurrent(n);
    }).catch(() => {});
  }, [isAuthenticated]);
  // Queue từ localStorage — convert "running" đang dở thành "pending" để
  // worker tiếp tục khi app mở lại. Giới hạn MAX_HISTORY mục cũ nhất.
  const [queue, setQueue] = useState(() => {
    try {
      const raw = userStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return (Array.isArray(arr) ? arr : []).map((it) => {
        if (it.status === "running") {
          return { ...it, status: "pending", startedAt: null, progress: 0, step: null };
        }
        return it;
      });
    } catch { return []; }
  });
  const runningSetRef = useRef(new Set());     // projectIds đang chạy
  const abortMapRef = useRef(new Map());       // projectId → AbortController
  const canceledRef = useRef(new Set());       // projectIds đã bị huỷ

  // Persist queue mỗi khi thay đổi (cut về MAX_HISTORY mục gần nhất)
  useEffect(() => {
    try {
      const toSave = queue.slice(-MAX_HISTORY);
      userStorage.setItem(QUEUE_KEY, JSON.stringify(toSave));
    } catch {}
  }, [queue]);

  // Dock/taskbar badge = số job đang chạy
  useEffect(() => {
    const running = queue.filter((q) => q.status === "running").length;
    if (window.voxstudio?.setBadge) {
      window.voxstudio.setBadge(running).catch(() => {});
    }
  }, [queue]);

  const setOutputFolder = (path) => {
    setOutputFolderState(path);
    try { userStorage.setItem(STORAGE_KEY, path || ""); } catch {}
  };

  const enqueue = (items) => {
    // items: [{ projectId, filename }]
    // Nếu projectId đã có trong queue (state error/canceled/done) → reset
    // sang pending thay vì tạo entry mới. Dùng cho flow Retry.
    setQueue((q) => {
      const byId = new Map(q.map((it) => [it.projectId, it]));
      const out = [...q];
      for (const it of items) {
        const existing = byId.get(it.projectId);
        const fresh = {
          projectId: it.projectId,
          filename: it.filename || existing?.filename,
          status: "pending",
          startedAt: null, finishedAt: null,
          progress: 0, step: null, error: null,
          outputPath: null,
        };
        if (existing) {
          // Clear flags từ worker tracking để worker có thể pick lại
          canceledRef.current.delete(it.projectId);
          runningSetRef.current.delete(it.projectId);
          abortMapRef.current.delete(it.projectId);
          const idx = out.indexOf(existing);
          out[idx] = fresh;
        } else {
          out.push(fresh);
        }
      }
      return out;
    });
  };

  const clearDone = () => {
    setQueue((q) => q.filter((it) => it.status !== "done"));
  };

  // Huỷ 1 job: nếu đang chạy → abort fetch, nếu pending → đánh dấu canceled.
  // Done/error không huỷ được (dùng removeItem để xoá khỏi lịch sử).
  const cancelItem = (projectId) => {
    setQueue((q) =>
      q.map((it) => {
        if (it.projectId !== projectId) return it;
        if (it.status === "running" || it.status === "pending") {
          canceledRef.current.add(projectId);
          return { ...it, status: "canceled", finishedAt: Date.now(),
                   step: "Đã huỷ", error: null };
        }
        return it;
      })
    );
    // Báo backend huỷ pipeline → thread pipeline sẽ thoát ở checkpoint
    cancelAutoDub(projectId);
    const controller = abortMapRef.current.get(projectId);
    if (controller) {
      try { controller.abort(); } catch {}
    }
  };

  // Xoá 1 item khỏi lịch sử (cho các trạng thái kết thúc)
  const removeItem = (projectId) => {
    setQueue((q) => q.filter((it) => it.projectId !== projectId));
  };

  // Xoá tất cả item ở 1 hoặc nhiều trạng thái. Dùng cho "Xoá lỗi"/"Xoá xong".
  const clearByStatus = (statuses) => {
    const set = new Set(Array.isArray(statuses) ? statuses : [statuses]);
    setQueue((q) => q.filter((it) => !set.has(it.status)));
  };

  // Worker: mỗi khi queue đổi hoặc limit đổi, start thêm job nếu còn slot.
  // maxConcurrent = plan.limits.concurrent_jobs (free=1, pro=2, studio=5).
  useEffect(() => {
    const running = runningSetRef.current;
    while (running.size < maxConcurrent) {
      const next = queue.find(
        (it) => it.status === "pending" && !running.has(it.projectId)
      );
      if (!next) break;
      runJob(next);
    }
  }, [queue, outputFolder, maxConcurrent]);

  function runJob(next) {
    runningSetRef.current.add(next.projectId);
    const controller = new AbortController();
    abortMapRef.current.set(next.projectId, controller);
    setQueue((q) =>
      q.map((it) =>
        it.projectId === next.projectId
          ? { ...it, status: "running", startedAt: Date.now() }
          : it
      )
    );

    (async () => {
      try {
        await new Promise((resolve, reject) => {
          let settled = false;
          const settle = (fn) => (v) => { if (!settled) { settled = true; fn(v); } };
          const safeResolve = settle(resolve);
          const safeReject = settle(reject);
          autoDub(next.projectId, {
            engine: "google",
            signal: controller.signal,
            onProgress: (d) => {
              // SSE payload: {step, label, progress, detail}
              if (d?.step === "error") {
                safeReject(new Error(d?.label || "Pipeline error"));
                return;
              }
              setQueue((q) =>
                q.map((it) => {
                  if (it.projectId !== next.projectId) return it;
                  // Monotonic — không lùi lại. Nếu backend yield progress
                  // thấp hơn hiện tại (do step mới start), giữ nguyên cho
                  // tới khi bò qua giá trị cũ → bar luôn "đầy dần".
                  const incoming = typeof d?.progress === "number"
                    ? Math.max(0, Math.min(99, d.progress))
                    : (it.progress || 0);
                  const newProg = Math.max(it.progress || 0, incoming);
                  const label = d?.detail
                    ? `${d.label} (${d.detail})`
                    : (d?.label || it.step);
                  return { ...it, progress: newProg, step: label };
                })
              );
            },
            onDone: safeResolve,
            onError: safeReject,
          }).catch(safeReject);
        });

        // Đang export — set progress ~95%
        setQueue((q) =>
          q.map((it) =>
            it.projectId === next.projectId
              ? { ...it, progress: 95, step: "Xuất video MP4" }
              : it
          )
        );

        // Export MP4 + tải về thư mục đã chọn (nếu có)
        await exportVideo(next.projectId, {
          keep_original_audio: true,
          original_audio_volume: 0.3,
        });
        const p = await getDubbingProject(next.projectId);
        const url = exportDownloadURL(next.projectId);

        let savedPath = null;
        if (outputFolder && window.voxstudio?.saveRemoteFileToFolder) {
          try {
            savedPath = await window.voxstudio.saveRemoteFileToFolder({
              url,
              folder: outputFolder,
              filename: safeName(next.filename || `${next.projectId}.mp4`),
            });
          } catch (e) {
            console.warn("saveRemoteFileToFolder failed:", e);
          }
        }

        setQueue((q) =>
          q.map((it) =>
            it.projectId === next.projectId
              ? { ...it, status: "done", finishedAt: Date.now(), progress: 100,
                  step: "Hoàn tất", outputPath: savedPath }
              : it
          )
        );
        // Native notification khi xong
        if (window.voxstudio?.notify) {
          window.voxstudio.notify({
            title: "VoxStudio — xong",
            body: `${next.filename || next.projectId} đã lồng tiếng xong.`,
          }).catch(() => {});
        }
      } catch (e) {
        const wasCanceled = canceledRef.current.has(next.projectId)
          || controller.signal.aborted
          || e?.name === "AbortError";
        canceledRef.current.delete(next.projectId);
        setQueue((q) =>
          q.map((it) =>
            it.projectId === next.projectId
              ? wasCanceled
                ? { ...it, status: "canceled", finishedAt: Date.now(),
                    step: "Đã huỷ", error: null }
                : { ...it, status: "error", finishedAt: Date.now(), error: String(e?.message || e) }
              : it
          )
        );
        if (!wasCanceled) {
          showError(toast, e, { context: "pipeline", filename: next.filename });
          if (window.voxstudio?.notify) {
            window.voxstudio.notify({
              title: "VoxStudio — lỗi",
              body: `${next.filename || next.projectId}: ${String(e?.message || e).slice(0, 120)}`,
            }).catch(() => {});
          }
        }
      } finally {
        runningSetRef.current.delete(next.projectId);
        abortMapRef.current.delete(next.projectId);
      }
    })();
  }

  const value = {
    outputFolder,
    setOutputFolder,
    queue,
    enqueue,
    clearDone,
    clearByStatus,
    cancelItem,
    removeItem,
    maxConcurrent,
  };

  return <BatchCtx.Provider value={value}>{children}</BatchCtx.Provider>;
}

export function useBatch() {
  const ctx = useContext(BatchCtx);
  if (!ctx) throw new Error("useBatch must be used inside <BatchProvider>");
  return ctx;
}

function safeName(name) {
  // Đảm bảo có đuôi .mp4
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.mp4`;
}
