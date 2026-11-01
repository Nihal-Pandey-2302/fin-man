import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptic";

const TRIGGER = 64;
const MAX = 110;

/**
 * Pull down at the top of a page to refresh. Installed apps have no browser pull-to-refresh, and new SMS
 * payments arrive while the app is open. Touch only; ignored inside sheets, dialogs and form fields.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let startY: number | null = null;
    let startX = 0;
    let distance = 0;
    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (busy.current || window.scrollY > 0 || target.closest("[role=dialog], [data-vaul-drawer], input, textarea, select")) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      // Mostly sideways (a swipe on a review card) or not a pull from the top: not ours.
      if (dy <= 0 || window.scrollY > 0 || Math.abs(e.touches[0].clientX - startX) > dy) {
        distance = 0;
        setPull(0);
        return;
      }
      distance = Math.min(MAX, dy * 0.5);
      setPull(distance);
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      setPull(0);
      if (distance < TRIGGER) return;
      busy.current = true;
      setRefreshing(true);
      haptic();
      try {
        await onRefresh();
      } finally {
        busy.current = false;
        setRefreshing(false);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh]);

  return { pull, refreshing, ready: pull >= TRIGGER };
}
