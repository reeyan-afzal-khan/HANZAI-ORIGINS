/* build.mjs — stage the web app for the targets that ship it.
 *
 *   app/  ->  release/web/          a plain folder + zip, for a static host,
 *                                  and the webDir Capacitor copies into the APK
 *   app/  ->  release/pages/        with --pages: the copy GitHub Pages serves
 *                                  (.github/workflows/deploy-pages.yml), no zip
 *
 * The one transform on the way through is stamping sw.js: the cache name is
 * derived from the hash of the files it caches, so shipping new code always
 * retires the old cache instead of leaving a stale mix behind.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync,
         copyFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC  = join(ROOT, "app");
const PAGES = process.argv.includes("--pages");
const WEB  = join(ROOT, "release", PAGES ? "pages" : "web");

/* Three files carry the release number — package.json, app/js/core.js and the
   Android build.gradle — and nothing forces them to agree. This does. A build
   that shipped 1.0.0 in an APK called 4.0.0 would be a real bug and an easy
   one to make, so it fails here instead of at a download link. */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const inApp = /const APP_VERSION = "([^"]+)"/.exec(readFileSync(join(SRC, "js", "core.js"), "utf8"));
if(!inApp) throw new Error("app/js/core.js has no APP_VERSION");
if(inApp[1] !== pkg.version)
  throw new Error(`version drift: package.json ${pkg.version}, app/js/core.js ${inApp[1]}`);

const gradlePath = join(ROOT, "android", "app", "build.gradle");
if(existsSync(gradlePath)){
  const g = /versionName "([^"]+)"/.exec(readFileSync(gradlePath, "utf8"));
  if(g && g[1] !== pkg.version)
    throw new Error(`version drift: package.json ${pkg.version}, build.gradle ${g[1]}`);
}

/* app/ has subdirectories — js/, icons/, data/, data/strokes/ and more — so
   the walk recurses rather than listing one level. Paths come back relative
   to app/ and with forward slashes, so the hash is the same on every platform. */
function walk(dir, base = dir){
  const out = [];
  for(const name of readdirSync(dir)){
    const full = join(dir, name);
    if(statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const files = walk(SRC);
if(!files.includes("data/meta.js"))
  throw new Error("app/data is empty — run `npm run data` first");
if(!files.includes("themes/themes.js"))
  throw new Error("app/themes is empty — run `npm run themes` first");

/* Hash every shipped file by content, not just the code, so an icon swap or a
   regenerated stroke shard also busts the cache. The stroke data used to be
   hashed by name and size instead — reading 4,000 files and 19 MB on every
   build was not worth it — but it is 64 shards now, so the exact answer costs
   nothing and a shard that changed without changing size no longer slips
   through. */
const h = createHash("sha256");
for(const f of files.sort()){
  h.update(f);
  h.update(readFileSync(join(SRC, f)));
}
const stamp = h.digest("hex").slice(0, 12);

const bytes = files.reduce((n, f) => n + statSync(join(SRC, f)).size, 0);
console.log(`HANZAI-ORIGINS ${pkg.version} · build ${stamp} · ${files.length} files · ${(bytes / 1048576).toFixed(1)} MB`);

rmSync(WEB, {recursive: true, force: true});
mkdirSync(WEB, {recursive: true});
for(const f of files){
  if(f === "sw.js") continue;
  const dest = join(WEB, f);
  mkdirSync(dirname(dest), {recursive: true});
  copyFileSync(join(SRC, f), dest);
}
/* Targeted at the CACHE assignment specifically, and asserted: sw.js also
   mentions __BUILD__ in a comment and in the check that tells a working copy
   from a release, and a blind first-match replace would be one edit away from
   stamping the wrong one. */
const swSrc = readFileSync(join(SRC, "sw.js"), "utf8");
const swOut = swSrc.replace(/^const CACHE = "hskker-__BUILD__";$/m,
                            `const CACHE = "hskker-${stamp}";`);
if(swOut === swSrc) throw new Error("sw.js: the CACHE line did not match — nothing was stamped");
writeFileSync(join(WEB, "sw.js"), swOut);
console.log("  ->", relative(ROOT, WEB));

/* A zip of the web build, so the folder can be handed to a static host or
   opened straight from disk. Pages takes the folder itself. */
const zip = join(ROOT, "release", `HANZAI-ORIGINS-web.zip`);
if(!PAGES){
  rmSync(zip, {force: true});
  try{
    if(process.platform === "win32"){
      execFileSync("powershell", ["-NoProfile", "-Command",
        `Compress-Archive -Path '${WEB}\\*' -DestinationPath '${zip}' -Force`], {stdio: "inherit"});
    }else{
      execFileSync("zip", ["-qr", zip, "."], {cwd: WEB, stdio: "inherit"});
    }
    console.log("  ->", relative(ROOT, zip));
  }catch(e){
    console.warn("  (zip skipped:", e.message, ")");
  }
}
