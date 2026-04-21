/**
 * Orchestrator — điều phối flow ingest:
 *   URL → hidden browser capture → download file → upload backend → project_id
 *
 * IPC handlers:
 *   ingest:start (url, opts)  → { jobId }
 *   ingest:cancel (jobId)     → true
 *
 * IPC events (main → renderer):
 *   ingest:progress           { jobId, step, progress, label, detail?, meta? }
 *   ingest:done               { jobId, project_id, title, filename, duration, platform }
 *   ingest:error              { jobId, message }
 */
const path = require("node:path");
const fs = require("node:fs");
const { ipcMain } = require("electron");
const { captureMediaURL } = require("./browser.cjs");
const { downloadToFile, uploadToBackend, tempPath, safeName } = require("./download.cjs");

const jobs = new Map(); // jobId → { canceled: bool }
let nextId = 1;

function register(getMainWindow, getApiBase) {
  ipcMain.handle("ingest:start", async (_event, { url, targetLanguage, sourceLanguage, enableDubbing, enableSubtitle } = {}) => {
    const jobId = `ing_${Date.now()}_${nextId++}`;
    jobs.set(jobId, { canceled: false });
    // Run async, do not block IPC return
    run(jobId, url, { targetLanguage, sourceLanguage, enableDubbing, enableSubtitle }, getMainWindow, getApiBase);
    return { jobId };
  });

  ipcMain.handle("ingest:cancel", (_event, jobId) => {
    const j = jobs.get(jobId);
    if (j) j.canceled = true;
    return true;
  });
}

async function run(jobId, url, opts, getMainWindow, getApiBase) {
  const send = (channel, payload) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const job = jobs.get(jobId);
  const emitProgress = (step, progress, label, detail) =>
    send("ingest:progress", { jobId, step, progress, label, detail });

  let tempFile = null;
  try {
    // 1. Capture
    const cap = await captureMediaURL(url, {
      onProgress: (step, progress, label) => {
        if (job?.canceled) throw new Error("canceled");
        emitProgress(step, progress, label);
      },
    });
    if (job?.canceled) throw new Error("canceled");

    // Emit meta so UI can show thumbnail + title mid-run
    send("ingest:progress", {
      jobId,
      step: "meta",
      progress: 52,
      label: cap.meta?.title || cap.platform,
      detail: cap.meta?.author,
      meta: {
        title: cap.meta?.title,
        author: cap.meta?.author,
        thumbnail: cap.meta?.thumbnail,
        platform: cap.platform,
        duration: cap.meta?.duration,
      },
    });

    // 2. Download
    emitProgress("downloading", 55, "Đang tải video về máy…");
    const baseName = safeName(cap.meta?.title || "video") + ".mp4";
    tempFile = tempPath(baseName);
    await downloadToFile(cap.mediaUrl, cap.headers, tempFile, (p) => {
      if (job?.canceled) throw new Error("canceled");
      emitProgress("downloading", p.progress,
                   "Đang tải video về máy…",
                   `${(p.downloaded/1024/1024).toFixed(1)} / ${(p.total/1024/1024).toFixed(1)} MB`);
    });

    // 3. Upload backend
    if (job?.canceled) throw new Error("canceled");
    emitProgress("uploading", 95, "Đang tạo project…");
    const apiBase = getApiBase();
    const proj = await uploadToBackend(apiBase, tempFile, baseName, {
      targetLanguage: opts.targetLanguage,
      sourceLanguage: opts.sourceLanguage,
      enableDubbing: opts.enableDubbing,
      enableSubtitle: opts.enableSubtitle,
    });

    // 4. Done
    send("ingest:done", {
      jobId,
      project_id: proj.id,
      title: cap.meta?.title || baseName,
      filename: baseName,
      duration: proj.video_duration || cap.meta?.duration,
      platform: cap.platform,
      thumbnail: cap.meta?.thumbnail,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg === "canceled") {
      send("ingest:error", { jobId, message: "Đã huỷ" });
    } else {
      send("ingest:error", { jobId, message: msg });
    }
  } finally {
    jobs.delete(jobId);
    try { if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
  }
}

module.exports = { register };
