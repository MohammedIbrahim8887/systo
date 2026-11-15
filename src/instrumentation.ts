import { sampler } from "./lib/server/sampler";
import { warmStartup } from "./lib/server/startup";
import { usage } from "./lib/server/usage";

export function register() {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  sampler().runInBackground();
  warmStartup();
  return () => usage().flush();
}
