#!/usr/bin/env node
// PostToolUse hook: tells the page which file Claude just edited. Best effort,
// silent on every failure, never blocks the tool.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SESSIONS = path.join(os.homedir(), ".cache", "claude-annotate", "sessions");
const parentOf = (pid) => { try { return Number(execSync(`ps -o ppid= -p ${pid}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch { return 0; } };

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  try {
    const j = JSON.parse(input || "{}");
    const file = j.tool_input?.file_path || j.tool_input?.notebook_path;
    if (!file) return;
    const pids = [process.ppid, parentOf(process.ppid), parentOf(parentOf(process.ppid))].filter(Boolean);
    let f = pids.map((p) => path.join(SESSIONS, `${p}.json`)).find((p) => fs.existsSync(p));
    if (!f) {
      const all = fs.readdirSync(SESSIONS).map((n) => path.join(SESSIONS, n)).filter((p) => p.endsWith(".json"));
      all.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      f = all[0];
    }
    if (!f) return;
    const { endpoint, token } = JSON.parse(fs.readFileSync(f, "utf8"));
    const cwd = j.cwd || process.cwd();
    const rel = path.isAbsolute(file) ? path.relative(cwd, file) : file;
    const verb = j.tool_name === "Write" ? "wrote" : "edited";
    await fetch(`${endpoint}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annot-Token": token },
      body: JSON.stringify({ text: `${verb} ${rel}` }),
      signal: AbortSignal.timeout(800),
    });
  } catch { /* silent */ }
});
