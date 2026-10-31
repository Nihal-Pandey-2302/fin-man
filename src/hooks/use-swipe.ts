import { useRef, useState, type PointerEvent } from "react";

type Options = { onRight?: () => void; onLeft?: () => void; threshold?: number };

/**
 * Horizontal swipe on a card without blocking vertical scrolling: the gesture locks to an axis after
 * a few pixels, and only horizontal drags are captured. Pair with `touch-action: pan-y` on the element.
 */
export function useSwipe({ onRight, onLeft, threshold = 90 }: Options) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  const latest = useRef(0);

  const reset = () => {
    start.current = null;
    axis.current = null;
    latest.current = 0;
    setDx(0);
  };

  return {
    dx,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        axis.current = null;
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        if (!start.current) return;
        const ddx = e.clientX - start.current.x;
        const ddy = e.clientY - start.current.y;
        if (!axis.current) {
          if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy) * 1.3) {
            axis.current = "x";
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (Math.abs(ddy) > 10) {
            start.current = null;
            return;
          }
        }
        if (axis.current === "x") {
          // Resist past the threshold so it feels anchored.
          const limited = Math.sign(ddx) * Math.min(Math.abs(ddx), threshold + (Math.abs(ddx) - threshold) * 0.25);
          latest.current = ddx;
          setDx(Math.abs(ddx) > threshold ? limited : ddx);
        }
      },
      onPointerUp() {
        if (axis.current === "x") {
          if (latest.current > threshold) onRight?.();
          else if (latest.current < -threshold) onLeft?.();
        }
        reset();
      },
      onPointerCancel: reset,
    },
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dx ? "none" : "transform 200ms ease",
      touchAction: "pan-y" as const,
    },
  };
}
