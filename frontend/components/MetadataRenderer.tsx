"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Detection, InferMetadata } from "@/lib/wsClient";

function drawBox(
  ctx: CanvasRenderingContext2D,
  det: Detection,
  drawX: number,
  drawY: number,
  scaleX: number,
  scaleY: number,
): void {
  const x = drawX + det.x1 * scaleX;
  const y = drawY + det.y1 * scaleY;
  const w = (det.x2 - det.x1) * scaleX;
  const h = (det.y2 - det.y1) * scaleY;

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#dc2626";
  ctx.fillStyle = "rgba(220, 38, 38, 0.92)";
  ctx.font = "13px ui-sans-serif";

  ctx.strokeRect(x, y, w, h);

  const text = `${det.label} ${(det.conf * 100).toFixed(1)}%`;
  const textWidth = ctx.measureText(text).width + 10;
  ctx.fillRect(x, Math.max(0, y - 20), textWidth, 18);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 5, Math.max(12, y - 7));
}

export default function MetadataRenderer({
  videoRef,
  metadata,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  metadata: InferMetadata | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestMetadataRef = useRef<InferMetadata | null>(metadata);
  const stickyDetsRef = useRef<Detection[]>([]);
  const stickyAtRef = useRef<number>(0);
  const drawLoopRef = useRef<number | null>(null);

  useEffect(() => {
    latestMetadataRef.current = metadata;
    if (metadata && metadata.dets.length > 0) {
      stickyDetsRef.current = metadata.dets;
      stickyAtRef.current = performance.now();
    }
  }, [metadata]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const resize = () => {
      const rect = video.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(video);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      observer.disconnect();
      return;
    }

    const draw = () => {
      if (!video || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const metadata = latestMetadataRef.current;
      const sourceWidth = metadata?.frame_width ?? video.videoWidth;
      const sourceHeight = metadata?.frame_height ?? video.videoHeight;

      if (sourceWidth === 0 || sourceHeight === 0) {
        drawLoopRef.current = requestAnimationFrame(draw);
        return;
      }

      const now = performance.now();
      const dets =
        metadata && metadata.dets.length > 0
          ? metadata.dets
          : now - stickyAtRef.current < 600
            ? stickyDetsRef.current
            : [];

      if (dets.length > 0) {
        const canvasAspect = canvas.width / canvas.height;
        const videoAspect = sourceWidth / sourceHeight;

        let drawW = canvas.width;
        let drawH = canvas.height;
        let drawX = 0;
        let drawY = 0;

        if (videoAspect > canvasAspect) {
          drawW = canvas.width;
          drawH = canvas.width / videoAspect;
          drawY = (canvas.height - drawH) / 2;
        } else {
          drawH = canvas.height;
          drawW = canvas.height * videoAspect;
          drawX = (canvas.width - drawW) / 2;
        }

        const scaleX = drawW / sourceWidth;
        const scaleY = drawH / sourceHeight;

        for (const det of dets) {
          drawBox(ctx, det, drawX, drawY, scaleX, scaleY);
        }
      }

      drawLoopRef.current = requestAnimationFrame(draw);
    };

    drawLoopRef.current = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      if (drawLoopRef.current) {
        cancelAnimationFrame(drawLoopRef.current);
        drawLoopRef.current = null;
      }
    };
  }, [videoRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />;
}
