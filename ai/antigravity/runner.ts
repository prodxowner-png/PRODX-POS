import { spawn } from "node:child_process";

export interface AntigravityRunOptions {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
}

export interface AntigravityRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runAntigravity({
  prompt,
  cwd,
  timeoutMs = 45 * 60_000,
}: AntigravityRunOptions): Promise<AntigravityRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "agy",
      ["-p", prompt, "--mode", "accept-edits", "--output-format", "json"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Antigravity execution timed out"));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}
