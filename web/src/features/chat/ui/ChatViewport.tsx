import { useEffect, useRef, type ReactNode } from "react";

/** Track the visible phone area, including a keyboard that only resizes VisualViewport. */
export function ChatViewport({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 700px)");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mobile.matches) {
          element.style.removeProperty("--chat-visible-height");
          element.style.removeProperty("--chat-visible-top");
          delete element.dataset.keyboard;
          return;
        }
        // Preserve user pinch zoom; do not continually refit the zoomed page.
        if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
        const height = viewport?.height ?? window.innerHeight;
        element.style.setProperty("--chat-visible-height", `${height}px`);
        element.style.setProperty(
          "--chat-visible-top",
          `${viewport?.offsetTop ?? 0}px`,
        );
        element.dataset.keyboard = String(window.innerHeight - height > 100);
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    mobile.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      mobile.removeEventListener("change", update);
    };
  }, []);
  return (
    <div ref={host} className="chat-viewport">
      {children}
    </div>
  );
}
