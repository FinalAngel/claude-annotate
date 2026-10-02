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
    // Walk up the process tree (hook → shell → claude) until a session file matches.
    // No match means no annotate session for this tree: do nothing, never guess another session's page.
    let f = null;
    for (let pid = process.ppid, i = 0; pid > 1 && i < 4 && !f; pid = parentOf(pid), i++) {
      const c = path.join(SESSIONS, `${pid}.json`);
      if (fs.existsSync(c)) f = c;
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
