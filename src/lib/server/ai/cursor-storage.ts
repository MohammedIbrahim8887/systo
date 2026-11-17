import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { run } from "../exec";

/** Cursor's Electron safeStorage envelope, following the Sona/Synara reader. */
export function isSealedCursorToken(value: string) {
  return (
    value.startsWith("cursor-safe-storage:") ||
    (/^(v10|v11)/.test(value) && !/^[\x21-\x7e]+$/.test(value))
  );
}
export function decryptCursorToken(value: string, password: string): string | undefined {
  const prefix = "cursor-safe-storage:v1:";
  if (!value.startsWith(prefix) || value.length > 12000) return;
  const encoded = value.slice(prefix.length),
    blob = Buffer.from(encoded, "base64"),
    ciphertext = blob.subarray(3);
  if (
    blob.toString("base64") !== encoded ||
    blob.subarray(0, 3).toString() !== "v10" ||
    !ciphertext.length ||
    ciphertext.length % 16
  )
    return;
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    const result = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return result.length <= 8192 && /^[\x21-\x7e]+$/.test(result) ? result : undefined;
  } catch {
    return;
  } finally {
    key.fill(0);
  }
}
export async function unsealCursorToken(value: string): Promise<string | undefined> {
  if (
    process.platform !== "darwin" ||
    !value.startsWith("cursor-safe-storage:v1:") ||
    value.length > 12000
  )
    return;
  const result = await run(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Cursor Safe Storage", "-a", "Cursor", "-w"],
    3000,
  );
  if (result.code !== 0) return;
  return decryptCursorToken(value, result.stdout.trim());
}
