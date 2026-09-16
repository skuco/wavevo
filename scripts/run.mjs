import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [mode = "dev", ...args] = process.argv.slice(2);
const portFlag = args.findIndex(arg => arg === "--port" || arg === "-p");
const port = portFlag >= 0 ? args[portFlag + 1] : args.find(arg => arg.startsWith("--port="))?.split("=")[1] || process.env.PORT || "3000";
// An explicit port prevents Next from silently moving away from the renderer.
const webArgs = [require.resolve("next/dist/bin/next"), mode, ...args];
if (portFlag < 0 && !args.some(arg => arg.startsWith("--port="))) webArgs.push("--port", port);
const env = { ...process.env, PORT: port };
const web = spawn(process.execPath, webArgs, { stdio: "inherit", env });
const worker = spawn(process.execPath, ["--import", "tsx", "scripts/render-worker.ts"], { stdio: "inherit", env });
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  worker.kill("SIGTERM");
  web.kill("SIGTERM");
  const timeout = setTimeout(() => { worker.kill("SIGKILL"); web.kill("SIGKILL"); }, 10000);
  timeout.unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of [web, worker]) {
  child.on("error", error => { console.error(error); stop(1); });
  child.on("exit", code => stop(code ?? 1));
}
