// End-to-end QR test with a camera: Chromium gets a fake camera that shows the pathshala's poster
// QR code (the same link the poster prints), and the join screen must read it and find the pathshala.
// It runs the real scanner code (BarcodeDetector or jsQR) on real video frames.
//
//   node scripts/qr-camera-test.mjs [baseUrl] [joinCode]     (default http://localhost:3100 HEER01)
//
// Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`), or set
// PLAYWRIGHT_MODULE to an installed copy. The app must be running with that join code in its database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";

const base = process.argv[2] ?? "http://localhost:3100";
const code = process.argv[3] ?? "HEER01";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

// A Y4M video (what Chromium's fake camera plays): the QR code, black on white, centred in 640x480.
function qrVideo(text, file) {
  const W = 640, H = 480;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size, quiet = 4, scale = Math.floor(400 / (n + 2 * quiet));
  const side = (n + 2 * quiet) * scale, x0 = (W - side) >> 1, y0 = (H - side) >> 1;
  const y = Buffer.alloc(W * H, 235); // light grey background, like paper under a lamp
  for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) {
    const mr = Math.floor(r / scale) - quiet, mc = Math.floor(c / scale) - quiet;
    const dark = mr >= 0 && mc >= 0 && mr < n && mc < n && qr.modules.get(mr, mc);
    y[(y0 + r) * W + x0 + c] = dark ? 16 : 255;
  }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, uv, uv]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}

const link = `${base.replace(/\/$/, "")}/j/${code}`;
const video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qr-")), "poster.y4m");
qrVideo(link, video);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"] });
const page = await ctx.newPage();
let ok = false;
try {
  await page.goto(`${base}/join`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /scan/i }).first().click();
  // The scanner reads the code, looks it up and moves on to the pathshala's card.
  const r = await page.waitForResponse((res) => res.url().includes("/api/sanghs/by-code"), { timeout: 20_000 });
  const body = await r.json();
  ok = r.ok() && !!body.sangh;
  console.log(ok ? `PASS: the camera read ${link} and found "${body.sangh.name}"` : `FAIL: lookup answered ${r.status()}`);
} catch (e) {
  console.log(`FAIL: ${(e).message.split("\n")[0]}`);
  await page.screenshot({ path: "qr-camera-test-failed.png" });
  console.log("Screenshot: qr-camera-test-failed.png");
}
await browser.close();
process.exit(ok ? 0 : 1);
