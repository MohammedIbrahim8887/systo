/** The app's update state, shared by the desktop shell (which owns the updater) and the UI. */
export type UpdatePhase =
  | "unavailable" // not an installed build (dev server), or no release URL
  | "idle"
  | "checking"
  | "up-to-date"
  | "downloading"
  | "ready" // downloaded; restarting installs it
  | "installing"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  /** The running version, e.g. "0.2.0". */
  version: string;
  /** The newest published version, once a check found one. */
  latest?: string;
  /** Download progress, 0–100. */
  progress?: number;
  error?: string;
  checkedAt?: number;
}
