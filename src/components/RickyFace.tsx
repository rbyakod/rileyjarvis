import { useEffect, useRef, type CSSProperties } from "react";
import type { MouthShape, RickyMood } from "../lib/realtime";

type RickyFaceProps = {
  mood: RickyMood;
  mouthShape: MouthShape;
};

export function RickyFace({ mood, mouthShape }: RickyFaceProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilLeftRef = useRef<SVGCircleElement>(null);
  const pupilRightRef = useRef<SVGCircleElement>(null);

  const mouthAlpha = Math.min(1, mouthShape.open * 1.4).toFixed(3);
  const mouthWidth = (0.7 + mouthShape.width * 0.6).toFixed(3);
  const mouthScaleY = (0.5 + mouthShape.open * 1.2).toFixed(3);

  useEffect(() => {
    if (!window.ricky?.onCursorMove) return;

    let pendingPoint: { x: number; y: number } | null = null;
    let rafId = 0;
    let lastPoint: { x: number; y: number } | null = null;
    let lastMoveAt = Date.now();

    const apply = () => {
      rafId = 0;
      const point = pendingPoint;
      if (!point) return;

      const svg = svgRef.current;
      const lPupil = pupilLeftRef.current;
      const rPupil = pupilRightRef.current;
      if (!svg || !lPupil || !rPupil) return;

      const svgRect = svg.getBoundingClientRect();
      if (svgRect.width === 0) return;
      const unitsPerPx = 240 / svgRect.width;

      const viewportX = point.x - window.screenX;
      const viewportY = point.y - window.screenY;

      const moved = !lastPoint || lastPoint.x !== point.x || lastPoint.y !== point.y;
      if (moved) lastMoveAt = Date.now();
      lastPoint = point;

      const idleMs = Date.now() - lastMoveAt;
      const idleFade = idleMs > 2400 ? Math.min(1, (idleMs - 2400) / 800) : 0;

      for (const pupil of [lPupil, rPupil]) {
        const rect = pupil.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = (viewportX - cx) * unitsPerPx;
        let dy = (viewportY - cy) * unitsPerPx;

        const dist = Math.hypot(dx, dy);
        const reach = dist > 0 ? Math.min(1, 5 / Math.max(5, dist)) : 0;
        const maxX = 2.4;
        const maxY = 1.4;
        dx = Math.max(-maxX, Math.min(maxX, dx * reach));
        dy = Math.max(-maxY, Math.min(maxY, dy * reach));

        if (idleFade > 0) {
          pupil.style.animation = idleFade >= 1 ? "" : "ricky-saccade 7s infinite ease-in-out";
          if (idleFade >= 1) {
            pupil.style.transform = "";
            continue;
          }
          pupil.style.transform = `translate(${(dx * (1 - idleFade)).toFixed(2)}px, ${(dy * (1 - idleFade)).toFixed(2)}px)`;
        } else {
          pupil.style.animation = "none";
          pupil.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
        }
      }
    };

    const onMove = (point: { x: number; y: number }) => {
      pendingPoint = point;
      if (!rafId) rafId = requestAnimationFrame(apply);
    };

    const unsubscribe = window.ricky.onCursorMove(onMove);
    return () => {
      unsubscribe();
      if (rafId) cancelAnimationFrame(rafId);
      for (const pupil of [pupilLeftRef.current, pupilRightRef.current]) {
        if (pupil) {
          pupil.style.transform = "";
          pupil.style.animation = "";
        }
      }
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className={`ricky-svg mood-${mood} ${mood === "speaking" ? "speaking" : ""}`}
      viewBox="0 0 240 240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Jarvis mood: ${mood}`}
      style={
        {
          "--mouth-alpha": mouthAlpha,
          "--mouth-width": mouthWidth,
          "--mouth-scale-y": mouthScaleY,
          "--mouth-teeth": mouthShape.teeth.toFixed(3),
          "--mouth-round": mouthShape.round.toFixed(3),
        } as CSSProperties
      }
    >
      <defs>
        <radialGradient id="rickyHead" cx="42%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#3a4258" />
          <stop offset="35%" stopColor="#141826" />
          <stop offset="80%" stopColor="#05070d" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <linearGradient id="rickyShoulder" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0c1020" />
          <stop offset="40%" stopColor="#050810" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
        <pattern id="rickyWeave" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#080b14" />
          <path d="M0 0 L6 0 L6 6" stroke="#171f36" strokeWidth="0.6" fill="none" />
        </pattern>
        <filter id="rickyGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="b1" />
          <feGaussianBlur stdDeviation="5" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse className="face-glow" cx="120" cy="100" rx="86" ry="86" />

      <g className="shoulders">
        <path
          className="shoulder-fill"
          d="M28 200 C 36 168, 70 152, 100 150 L 140 150 C 170 152, 204 168, 212 200 L 212 230 L 28 230 Z"
        />
        <path
          className="shoulder-top"
          d="M28 200 C 36 168, 70 152, 100 150 L 140 150 C 170 152, 204 168, 212 200"
        />
        <path
          className="shoulder-weave"
          d="M28 200 C 36 168, 70 152, 100 150 L 140 150 C 170 152, 204 168, 212 200 L 212 230 L 28 230 Z"
        />
        <line className="shoulder-seam-line" x1="120" y1="150" x2="120" y2="230" />
        <path className="shoulder-collar" d="M86 158 Q 120 148 154 158" />
      </g>

      <g className="head-group">
        <ellipse className="head-fill" cx="120" cy="100" rx="74" ry="78" />
        <ellipse className="head-rim" cx="120" cy="100" rx="74" ry="78" />
        <ellipse className="head-gloss" cx="100" cy="62" rx="42" ry="22" />
        <ellipse className="head-shade" cx="120" cy="150" rx="60" ry="22" />

        <g className="brow-row">
          <path className="brow brow-left" d="M82 78 Q 96 73 110 78" />
          <path className="brow brow-right" d="M130 78 Q 144 73 158 78" />
        </g>

        <g className="eye-row">
          <g className="eye">
            <rect className="eye-led" x="80" y="92" width="28" height="14" rx="2" />
            <circle ref={pupilLeftRef} className="eye-pupil" cx="94" cy="99" r="2.2" />
          </g>
          <g className="eye">
            <rect className="eye-led" x="132" y="92" width="28" height="14" rx="2" />
            <circle ref={pupilRightRef} className="eye-pupil" cx="146" cy="99" r="2.2" />
          </g>
        </g>

        <g className="mouth-wrap">
          <rect className="mouth-fill" x="104" y="140" width="32" height="6" rx="3" />
          <path className="mouth-line" d="M104 143 Q 120 146 136 143" />
          <rect className="mouth-teeth" x="112" y="141" width="16" height="2" rx="1" />
        </g>
      </g>
    </svg>
  );
}
