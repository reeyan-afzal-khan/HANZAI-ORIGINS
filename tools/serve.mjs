/* serve.mjs — a static server for release/web/, with no dependencies.
 *
 * The app is plain files and runs from disk, but a service worker and fetch()
 * both need an http origin, so this exists to give it one. Deliberately not
 * `npx serve`: a dev command that needs the network to start is a dev command
 * that fails on a train.
 *
 *   node tools/serve.mjs [dir] [port]
 */
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

const DIR  = process.argv[2] || "release/web";
const PORT = +(process.argv[3] || 5178);
const dev = process.argv.includes("--dev");

const TYPES = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8", ".wasm":"application/wasm",
  ".css":"text/css; charset=utf-8",   ".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
  ".svg":"image/svg+xml", ".woff2":"font/woff2", ".ico":"image/x-icon",
  ".mp3":"audio/mpeg", ".m4a":"audio/mp4", ".ogg":"audio/ogg",
  ".wav":"audio/wav", ".aac":"audio/aac",
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if(path.endsWith("/")) path += "index.html";
  /* normalize() collapses any ../ before it can climb out of DIR — and on
     Windows it hands back a leading backslash as well, so that is stripped
     too, before anything is matched against the result. */
  const clean = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = join(DIR, clean);

  let info;
  try{ info = statSync(file); }catch{ res.writeHead(404); return res.end("not found"); }
  if(info.isDirectory()){ res.writeHead(404); return res.end("not found"); }

  // Use the worker's existing development mode on the preview origin. It
  // retires any previous release cache and lets edits through immediately.
  if(dev && clean === "sw.js"){
    const worker = readFileSync(file, "utf8").replace(/^const CACHE = "hskker-[0-9a-f]{12}";$/m,
      'const CACHE = "hskker-__BUILD__";');
    res.writeHead(200, {"content-type":TYPES[".js"], "cache-control":"no-store"});
    return res.end(worker);
  }

  res.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "content-length": info.size,
    // The point of running this is to see the current files, not yesterday's.
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`${DIR}/ → http://localhost:${PORT}`));
