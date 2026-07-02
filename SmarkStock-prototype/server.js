// SmarkStock demo launcher — serves this folder over http and opens the browser.
// Claude Design prototypes must be served over http:// (double-clicking the .dc.html
// uses file://, which blocks the runtime's hydration fetch and renders empty).
const http = require("http"), fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const root = __dirname;
const types = { ".html":"text/html;charset=utf-8", ".js":"text/javascript", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon", ".json":"application/json" };

function start(port) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/SmarkStock.dc.html";
    const f = path.join(root, p);
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
      res.end(d);
    });
  });
  srv.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port < 8099) start(port + 1);
    else { console.error(err); }
  });
  srv.listen(port, "127.0.0.1", () => {
    const url = "http://127.0.0.1:" + port + "/SmarkStock.dc.html";
    console.log("\n  SmarkStock demo is running:  " + url);
    console.log("  PIN: 1947");
    console.log("  Needs internet (loads React from a CDN). Keep this window open; close it to stop.\n");
    // open default browser (Windows) without a shell string — args passed as an array
    try { execFile("cmd", ["/c", "start", "", url]); } catch (e) {}
  });
}
start(8080);
