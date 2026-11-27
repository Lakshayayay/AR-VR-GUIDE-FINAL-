"use client";

import { useEffect, useState } from "react";
import { project, type Placements, type Shape } from "@/lib/annotations";
import { arStats } from "@/lib/ar/stats";

/** Shown over a call page opened with ?debug=ar: the numbers behind hand and drawing behaviour. */
export function ArDebug({ shapes, placements }: { shapes: Shape[]; placements: React.RefObject<Placements> }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const s = arStats;
  const rows = shapes.map((shape) => {
    const placed = placements.current[shape.id];
    const state = !shape.anchor ? "no anchor" : (placed?.state ?? "waiting");
    const onScreen = project(shape, placed?.h).some(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
    return `${shape.id.slice(0, 6)} by ${shape.author} ${shape.tool}: ${state}, ${onScreen ? "on screen" : "OFF screen"}`;
  });
  return (
    <pre aria-label="AR debug" className="pointer-events-none absolute left-2 top-24 z-20 max-w-[90%] overflow-hidden rounded-md bg-black/75 p-2 font-sans text-[11px] leading-tight text-white tabular-nums">
      {[
        `tracker  ${s.trackFps}/s  ${s.trackMs.toFixed(0)} ms  ${s.trackSize}px`,
        `hands    ${s.handFps}/s  ${s.handMs.toFixed(0)} ms  age ${s.handDelay.toFixed(0)} ms`,
        `gesture  ${s.gesture || "-"} (${s.score.toFixed(2)})  pinch ${s.pinch.toFixed(2)}`,
        `strokes  started ${s.strokesStarted}  ended ${s.strokesEnded}`,
        `drawings ${shapes.length}`,
        ...rows,
      ].join("\n")}
    </pre>
  );
}
