"use client";

import { useState } from "react";
import { registerMediaAction } from "@/app/actions/media";
import type { MediaAsset } from "@/db/schema";

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];

function probe(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const done = (v: { width?: number; height?: number; durationSec?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, durationSec: v.duration || undefined });
      v.onerror = () => done({});
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    }
  });
}

const safe = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(-80) || "file";

export interface UploadProgress {
  name: string;
  percent: number;
  error?: string;
}

/** Uploads files to Vercel Blob (or the local dev store) and registers them in the library. */
export function useUploader({ userId, blob, onUploaded }: { userId: string; blob: boolean; onUploaded: (a: MediaAsset) => void }) {
  const [items, setItems] = useState<UploadProgress[]>([]);
  const update = (name: string, patch: Partial<UploadProgress>) =>
    setItems((list) => list.map((i) => (i.name === name ? { ...i, ...patch } : i)));

  async function uploadOne(file: File) {
    if (!ACCEPT.includes(file.type)) {
      update(file.name, { error: "Only JPG, PNG, WebP, MP4 and MOV files are supported." });
      return;
    }
    try {
      const meta = await probe(file);
      let url: string;
      let pathname: string;
      if (blob) {
        const { upload } = await import("@vercel/blob/client");
        const res = await upload(`${userId}/${safe(file.name)}`, file, {
          access: "public",
          handleUploadUrl: "/api/media/upload",
          multipart: file.size > 50 * 1024 * 1024,
          onUploadProgress: (e) => update(file.name, { percent: Math.round(e.percentage) }),
        });
        url = res.url;
        pathname = res.pathname;
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/media/local", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Upload failed.");
        ({ url, pathname } = json);
      }
      const asset = await registerMediaAction({
        url,
        pathname,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        width: meta.width ?? null,
        height: meta.height ?? null,
        durationSec: meta.durationSec ?? null,
      });
      update(file.name, { percent: 100 });
      onUploaded(asset);
      setTimeout(() => setItems((list) => list.filter((i) => i.name !== file.name)), 800);
    } catch (err) {
      update(file.name, { error: (err as Error).message });
    }
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    setItems((cur) => [...cur, ...list.map((f) => ({ name: f.name, percent: 0 }))]);
    await Promise.all(list.map(uploadOne));
  }

  return { upload, items, dismiss: (name: string) => setItems((l) => l.filter((i) => i.name !== name)) };
}

export const ACCEPT_ATTR = ACCEPT.join(",");
