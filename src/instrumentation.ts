import { sampler } from "./lib/server/sampler";
import { usage } from "./lib/server/usage";

export function register() {
  if (process.platform !== "darwin") return;
  sampler().runInBackground();
  return () => usage().flush();
}
