import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function run(file: string, args: string[], timeout = 8000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
      },
    );
  });
}

export async function output(file: string, args: string[], timeout?: number): Promise<string> {
  return (await run(file, args, timeout)).stdout;
}
