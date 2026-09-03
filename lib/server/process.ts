import { spawn } from "node:child_process";

export async function runProcess(command: string, args: string[], options?: { captureStdout?: boolean }) {
  return new Promise<Buffer>((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => options?.captureStdout && stdout.push(chunk));
    process.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(Buffer.concat(stderr).toString().trim() || `${command} exited with code ${code}`));
    });
  });
}
