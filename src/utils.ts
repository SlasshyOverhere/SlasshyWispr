export type CaptureMode = "single-tap" | "push-to-talk";

export function captureModeLabel(mode: CaptureMode): string {
  return mode === "push-to-talk" ? "Push-To-Talk" : "Single Tap";
}
