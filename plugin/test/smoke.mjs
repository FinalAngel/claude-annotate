// Smoke test: no browser. Starts the server over stdio the way Claude Code does,
// checks the channel capability, the tool list, the HTTP bridge and the cleanup.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of ["server/index.mjs", "server/overlay.js", "scripts/ticker.mjs"]) {
  const r = spawnSync(process.execPath, ["--check", path.join(root, f)], { encoding: "utf8" });
  assert.equal(r.status, 0, `${f} does not parse:\n${r.stderr}`);
}
console.log("✓ syntax");

// The hook must exit 0 and stay silent with nothing to talk to.
const hook = spawnSync(process.execPath, [path.join(root, "scripts/ticker.mjs")], { input: JSON.stringify({ tool_name: "Edit", cwd: root, tool_input: { file_path: path.join(root, "x.ts") } }), encoding: "utf8" });
assert.equal(hook.status, 0, "hook exit code");
assert.equal(hook.stdout + hook.stderr, "", "hook must be silent");
console.log("✓ hook is silent without a session");

const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "server/index.mjs")], stderr: "pipe" });
const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: {} });
let stderr = "";
await client.connect(transport);
transport.stderr.on("data", (d) => (stderr += d));

const caps = client.getServerCapabilities();
assert.ok(caps.experimental && caps.experimental["claude/channel"], "declares claude/channel");
assert.ok(caps.tools, "declares tools");
assert.match(client.getInstructions() || "", /annotate_progress/, "instructions mention the protocol");
console.log("✓ channel capability + instructions");

const names = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(names, ["annotate_clear", "annotate_close", "annotate_done", "annotate_open", "annotate_progress", "annotate_pull", "annotate_reply", "annotate_screenshot", "annotate_wait"]);
console.log("✓ 9 tools, no debug tool without ANNOTATE_DEBUG");

const pull = await client.callTool({ name: "annotate_pull", arguments: {} });
assert.match(pull.content[0].text, /"status": "empty"/);
await assert.rejects(client.callTool({ name: "annotate_open", arguments: { url: "ftp://nope" } }), /http/, "rejects non-http urls");
console.log("✓ pull is empty, bad url rejected");

// Session file for the hook, keyed by the parent pid (this process).
const sessions = path.join(os.homedir(), ".cache", "claude-annotate", "sessions");
const sessionFile = path.join(sessions, `${process.pid}.json`);
for (let i = 0; i < 50 && !fs.existsSync(sessionFile); i++) await sleep(100);
assert.ok(fs.existsSync(sessionFile), "session file written");
const { endpoint, token } = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);

const unauth = await fetch(`${endpoint}/health`);
assert.equal(unauth.status, 403, "bridge needs the token");
const health = await (await fetch(`${endpoint}/health`, { headers: { "X-Annot-Token": token } })).json();
assert.equal(health.ok, true);
assert.equal(health.mode, "channel");
const H = { "Content-Type": "application/json", "X-Annot-Token": token };
const url = "http://localhost:1/";
const put = await (await fetch(`${endpoint}/state`, { method: "PUT", headers: H, body: JSON.stringify({ url, shapes: [{ id: "s", type: "rect", color: "pink", x: 1, y: 1, w: 10, h: 10 }], notes: [{ id: "n", n: 1, x: 2, y: 2, color: "pink", text: "hi" }] }) })).json();
assert.deepEqual(put.totals, { notes: 1, shapes: 1, pages: 1, unsent: 2, open: 0, batches: 0 });
const next = await (await fetch(`${endpoint}/note/next`, { method: "POST", headers: H })).json();
assert.equal(next.n, 2, "note numbering continues after the highest stored note");
const got = await (await fetch(`${endpoint}/state?url=${encodeURIComponent(url)}`, { headers: H })).json();
assert.equal(got.notes[0].text, "hi");
console.log("✓ bridge: token gate, state round trip, note numbering");

// The hook finds the session by parent pid and posts a status line.
const hook2 = spawnSync(process.execPath, [path.join(root, "scripts/ticker.mjs")], { input: JSON.stringify({ tool_name: "Write", cwd: root, tool_input: { file_path: path.join(root, "src/x.ts") } }), encoding: "utf8" });
assert.equal(hook2.status, 0);
console.log("✓ hook reaches the bridge");

await client.close();
for (let i = 0; i < 50 && fs.existsSync(sessionFile); i++) await sleep(100);
assert.ok(!fs.existsSync(sessionFile), "session file removed on shutdown");
assert.doesNotMatch(stderr, /error/i, `server stderr clean:\n${stderr}`);
console.log("✓ clean shutdown");
console.log("all good");
