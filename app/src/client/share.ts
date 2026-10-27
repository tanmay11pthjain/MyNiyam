"use client";

// Share cards: a square picture (streak, badge or goal) for WhatsApp status, made on the phone.
// It carries the pathshala's name and join code, so whoever sees it can join. Nothing is uploaded.

export type CardText = { big: string; line: string; sub?: string; sangh: string; code: string };

const SIZE = 1080;

function draw(t: CardText): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext("2d")!;
  // Chandan ground, a kesar glow, the diya and the words.
  g.fillStyle = "#FAF1E6"; g.fillRect(0, 0, SIZE, SIZE);
  const glow = g.createRadialGradient(SIZE / 2, 420, 40, SIZE / 2, 420, 460);
  glow.addColorStop(0, "rgba(240,157,39,.35)"); glow.addColorStop(1, "rgba(240,157,39,0)");
  g.fillStyle = glow; g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = "#F09D27";
  g.beginPath(); g.moveTo(540, 150); g.bezierCurveTo(600, 220, 620, 270, 620, 310); g.bezierCurveTo(620, 360, 585, 390, 540, 390);
  g.bezierCurveTo(495, 390, 460, 360, 460, 310); g.bezierCurveTo(460, 270, 480, 220, 540, 150); g.fill();
  g.fillStyle = "#1C2F5E";
  g.beginPath(); g.moveTo(380, 420); g.lineTo(700, 420); g.bezierCurveTo(690, 490, 620, 530, 540, 530); g.bezierCurveTo(460, 530, 390, 490, 380, 420); g.fill();

  g.textAlign = "center";
  g.fillStyle = "#1C2F5E";
  g.font = "800 150px 'Baloo 2', system-ui, sans-serif";
  g.fillText(t.big, SIZE / 2, 700, SIZE - 120);
  g.font = "700 60px 'Baloo 2', system-ui, sans-serif";
  g.fillText(t.line, SIZE / 2, 790, SIZE - 120);
  if (t.sub) { g.fillStyle = "#56607F"; g.font = "500 44px Mukta, system-ui, sans-serif"; g.fillText(t.sub, SIZE / 2, 860, SIZE - 120); }
  g.fillStyle = "#B5620A"; g.font = "700 40px 'Baloo 2', system-ui, sans-serif";
  g.fillText(t.sangh, SIZE / 2, 960, SIZE - 120);
  g.fillStyle = "#56607F"; g.font = "500 34px Mukta, system-ui, sans-serif";
  g.fillText(`Join with code ${t.code} on MyNiyam`, SIZE / 2, 1015, SIZE - 120);
  return c;
}

/**
 * Opens the phone's share sheet with the card (WhatsApp, status, ...). Where sharing a picture isn't
 * possible (most computers), the picture is downloaded instead. Returns what happened.
 */
export async function shareCard(t: CardText): Promise<"shared" | "downloaded" | "cancelled"> {
  const canvas = draw(t);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) return "cancelled";
  const file = new File([blob], "myniyam.png", { type: "image/png" });
  const text = `${t.line} · ${t.sangh}. Join with code ${t.code}: ${location.origin}/join?code=${t.code}`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch {
      return "cancelled"; // closed the share sheet
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "myniyam.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}
