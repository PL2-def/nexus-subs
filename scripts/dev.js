import { spawn } from "node:child_process";

const isWin = process.platform === "win32";

const apiProc = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, PORT: "3001" },
  stdio: "inherit"
});

const viteCmd = isWin ? "npx.cmd" : "npx";
const viteProc = spawn(viteCmd, ["vite", "--port", "3000"], {
  env: { ...process.env, VITE_API_TARGET: "http://localhost:3001" },
  stdio: "inherit",
  shell: isWin
});

function shutdown() {
  apiProc.kill();
  viteProc.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
apiProc.on("exit", (code) => {
  if (code && code !== 0) console.error(`[dev] API exited with code ${code}`);
});
viteProc.on("exit", () => {
  apiProc.kill();
  process.exit(0);
});
