import type { CSSProperties } from "react";
import type { MouthShape, RickyMood } from "../lib/realtime";

type RickyFaceProps = {
  mood: RickyMood;
  mouthShape: MouthShape;
};

export function RickyFace({ mood, mouthShape }: RickyFaceProps) {
  return (
    <div
      className={`face face-${mood}`}
      style={
        {
          "--mouth-open": mouthShape.open.toFixed(3),
          "--mouth-width": mouthShape.width.toFixed(3),
          "--mouth-round": mouthShape.round.toFixed(3),
          "--mouth-teeth": mouthShape.teeth.toFixed(3),
        } as CSSProperties
      }
      aria-label={`Ricky mood: ${mood}`}
    >
      <div className="face-void" aria-hidden="true" />
      <div className="shoulders" aria-hidden="true">
        <span className="shoulder shoulder-left" />
        <span className="shoulder shoulder-right" />
        <span className="shoulder-seam" />
      </div>
      <div className="head" aria-hidden="true">
        <span className="head-rim" />
        <span className="head-gloss" />
        <span className="head-shade" />
      </div>
      <div className="face-glow" aria-hidden="true" />
      <div className="brow-row" aria-hidden="true">
        <span className="brow brow-left" />
        <span className="brow brow-right" />
      </div>
      <div className="eye-row">
        <div className="eye">
          <span className="eye-led" />
          <span className="eye-pupil" />
        </div>
        <div className="eye">
          <span className="eye-led" />
          <span className="eye-pupil" />
        </div>
      </div>
      <div className="mouth-wrap">
        <div className="mouth">
          <div className="mouth-teeth" />
          <div className="mouth-line" />
        </div>
      </div>
    </div>
  );
}
