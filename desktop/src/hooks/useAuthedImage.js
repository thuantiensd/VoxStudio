/**
 * useAuthedImage — fetch image với JWT Authorization header rồi tạo blob URL.
 *
 * Vì <img src> không tự gửi header → không xài được cho endpoint require auth.
 * Hook này fetch qua fetch API → blob → URL.createObjectURL → set vào <img src>.
 *
 * Usage:
 *   const { src, error } = useAuthedImage(thumbnailURL(projectId));
 *   <img src={src} onError={...} />
 *
 * Auto cleanup blob URL khi component unmount hoặc URL đổi.
 */

import { useEffect, useState, useRef } from "react";

const TOKEN_KEY = "voxstudio:auth";

function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw)?.token || null;
  } catch {
    return null;
  }
}

export default function useAuthedImage(url) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState(null);
  const blobRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    if (!url) {
      setSrc("");
      return;
    }

    const token = getToken();
    if (!token) {
      // Chưa login — không fetch
      setSrc("");
      return;
    }

    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        // Cleanup URL cũ nếu có
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        const blobUrl = URL.createObjectURL(blob);
        blobRef.current = blobUrl;
        setSrc(blobUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e);
        setSrc("");
      });

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [url]);

  return { src, error };
}
