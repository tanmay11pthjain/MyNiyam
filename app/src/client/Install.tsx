"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui";
import { isIos, isStandalone } from "./Reminders";

// "Add MyNiyam to your Home Screen": a small card on Today until it is installed or dismissed.
// Android (Chrome) gets a one-tap Install button; iPhone gets the two steps, since Safari has no button.

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "mn.install.dismissed";

export function InstallCard() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* private mode */ }
    if (dismissed || isStandalone()) return;
    const t = window.setTimeout(() => { if (isIos()) setShow(true); }, 0);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); setShow(true); };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* fine */ } setShow(false); };

  return (
    <section className="card install" aria-labelledby="inst-h">
      <img src="/brand/apple-touch-icon.png" alt="" width={48} height={48} />
      <div className="grow stack">
        <h2 id="inst-h" className="sec-h">Keep MyNiyam on your home screen</h2>
        {prompt ? (
          <p className="hint">Opens like an app, works without internet, and can remind you.</p>
        ) : (
          <ol className="hint install-steps">
            <li>Tap <b>Share</b> <span aria-hidden="true">(the square with an arrow)</span> at the bottom of Safari.</li>
            <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          </ol>
        )}
        <div className="install-btns">
          {prompt && <Button onClick={async () => { await prompt.prompt(); const c = await prompt.userChoice; if (c.outcome === "accepted") setShow(false); setPrompt(null); }}>Install app</Button>}
          <Button kind="quiet" onClick={dismiss}>Not now</Button>
        </div>
      </div>
    </section>
  );
}
