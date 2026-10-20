"use client";
import { useEffect, useRef, useState } from "react";
import { joinCodeFromScan } from "@/lib/join-code";

// Camera QR scanner. Uses the browser's BarcodeDetector where it exists (Chrome on Android) and
// otherwise loads jsQR on demand. Stops the camera as soon as a join code is read or it unmounts.

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export default function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; });
  const [state, setState] = useState<"starting" | "scanning" | "denied" | "unavailable" | "not_ours">("starting");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setState("unavailable"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (e) {
        setState((e as DOMException).name === "NotAllowedError" ? "denied" : "unavailable");
        return;
      }
      if (stopped || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setState("scanning");

      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector: Detector | null = BD ? new BD({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (stopped || !video.current) return;
        const v = video.current;
        let text: string | null = null;
        if (v.readyState >= 2) {
          if (detector) {
            const found = await detector.detect(v).catch(() => []);
            text = found[0]?.rawValue ?? null;
          } else if (jsQR && ctx) {
            const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * 480) || 480;
            canvas.width = w; canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
        }
        if (text) {
          const code = joinCodeFromScan(text);
          if (code) { stop(); onCodeRef.current(code); return; }
          setState("not_ours");
        }
        raf = window.setTimeout(() => void tick(), 200) as unknown as number;
      };
      void tick();
    }

    function stop() {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    }

    void start();
    return stop;
  }, []);

  if (state === "denied" || state === "unavailable") {
    return (
      <div className="notice" role="alert">
        <b>{state === "denied" ? "Camera is blocked" : "Camera not available here"}</b>
        <span>
          {state === "denied" ? "Allow the camera for this site in your browser settings, or " : ""}
          open your phone&apos;s camera app and point it at the QR code. It will open MyNiyam for you.
        </span>
        <span lang="hi">फ़ोन का कैमरा ऐप खोलकर QR कोड की तरफ़ रखें।</span>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={video} playsInline muted aria-label="Camera view" />
        <div className="frame-box" aria-hidden="true" />
      </div>
      <p className="msg" role="status" aria-live="polite">
        {state === "starting" && "Starting the camera…"}
        {state === "scanning" && "Hold steady. The code is read by itself."}
        {state === "not_ours" && "That QR code isn't a MyNiyam pathshala code."}
      </p>
    </div>
  );
}
