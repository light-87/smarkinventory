// Redraw a saved VibeView board diagram.  Usage: node redraw.mjs <name> [prod|dev]
// Reads <name>.draw.json (+ optional <name>.place.json) beside this file and posts
// them to the running VibeView control server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
const channel = process.argv[3] || "prod";
if (!name) { console.error("usage: node redraw.mjs <name> [prod|dev]"); process.exit(1); }
const dir = path.dirname(fileURLToPath(import.meta.url));
const rtFile = path.join(os.homedir(), ".vibeview", channel === "dev" ? "runtime-dev.json" : "runtime.json");
const rt = JSON.parse(fs.readFileSync(rtFile, "utf8"));
const draw = JSON.parse(fs.readFileSync(path.join(dir, `${name}.draw.json`), "utf8"));
const placePath = path.join(dir, `${name}.place.json`);
const place = fs.existsSync(placePath) ? JSON.parse(fs.readFileSync(placePath, "utf8")) : { items: [] };
const H = { "Content-Type": "application/json", "x-vibeview-token": rt.token };
const post = (ep, body) => fetch(`http://127.0.0.1:${rt.port}${ep}`, { method: "POST", headers: H, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await post("/board/open", { title: name });
await sleep(1500);
await post("/board/clear", {});
await sleep(600);
await post("/board/draw", draw);
await sleep(600);
if (place.items && place.items.length) await post("/board/place", place);
console.log(`drew "${name}" → ${channel} (port ${rt.port})`);
