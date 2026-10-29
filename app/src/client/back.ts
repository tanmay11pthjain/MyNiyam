"use client";
import { useEffect, useRef, useState } from "react";

// The phone's Back button for screens that are not their own page (tabs, steps, sheets).
// While `active`, one history entry (marked with an id) is kept on top; Back pops it and calls
// `onBack` instead of leaving the page. Closing from the screen itself takes the entry off again.

type Entry = { id: number; fire: () => void };
const stack: Entry[] = [];
let seq = 0;
let listening = false;

function onPop(e: PopStateEvent) {
  // Every entry above the one we landed on has been popped.
  const at = typeof e.state?.__back === "number" ? e.state.__back : 0;
  while (stack.length && stack[stack.length - 1].id > at) stack.pop()!.fire();
}

export function useBack(onBack: (() => void) | undefined, active = !!onBack) {
  const fn = useRef(onBack);
  useEffect(() => { fn.current = onBack; });
  const [gen, setGen] = useState(0);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    if (!listening) { window.addEventListener("popstate", onPop); listening = true; }
    const id = ++seq;
    let pushed = false;
    let popped = false;
    // Deferred, so React's dev double-mount doesn't push two entries.
    const t = window.setTimeout(() => {
      window.history.pushState({ ...window.history.state, __back: id }, "");
      pushed = true;
      stack.push({ id, fire: () => { popped = true; fn.current?.(); setGen((g) => g + 1); } });
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (!pushed || popped) return;
      const i = stack.findIndex((x) => x.id === id);
      if (i >= 0) stack.splice(i, 1);
      // Closed from the screen itself: take our entry off, unless a new page was opened on top of it.
      if (window.history.state?.__back === id) window.history.back();
    };
  }, [active, gen]);
}
