/* Refresh the release identifiers of the static site in place. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
execFileSync(process.execPath, [join(ROOT, "tools/build-rust.mjs"), "--check"], {stdio:"inherit"});
const WEB  = join(ROOT, "release", "web");

/* Three files carry the release number — package.json, release/web/js/core.js and the
   Android build.gradle — and nothing forces them to agree. This does. A build
   that shipped 1.0.0 in an APK called 4.0.0 would be a real bug and an easy
   one to make, so it fails here instead of at a download link. */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const inApp = /const APP_VERSION = "([^"]+)"/.exec(readFileSync(join(WEB, "js", "core.js"), "utf8"));
if(!inApp) throw new Error("release/web/js/core.js has no APP_VERSION");
if(inApp[1] !== pkg.version)
  throw new Error(`version drift: package.json ${pkg.version}, release/web/js/core.js ${inApp[1]}`);

const gradlePath = join(ROOT, "release", "android", "app", "build.gradle");
if(existsSync(gradlePath)){
  const g = /versionName "([^"]+)"/.exec(readFileSync(gradlePath, "utf8"));
  if(g && g[1] !== pkg.version)
    throw new Error(`version drift: package.json ${pkg.version}, build.gradle ${g[1]}`);
}

/* release/web/ has subdirectories — js/, icons/, data/, data/strokes/ and more — so
   the walk recurses rather than listing one level. Paths come back relative
   to release/web/ and with forward slashes, so the hash is the same on every platform. */
function walk(dir, base = dir){
  const out = [];
  for(const name of readdirSync(dir)){
    const full = join(dir, name);
    if(statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const files = walk(WEB);
if(!files.includes("data/meta.js"))
  throw new Error("release/web/data is empty — run `npm run data` first");
if(!files.includes("themes/themes.js"))
  throw new Error("release/web/themes is empty — run `npm run themes` first");

// Normalize just the generated fields before hashing, so repeated builds
// produce the same identifier and edits to any shipped asset invalidate it.
const fields = {
  "index.html": /^var PAGE_BUILD = "(?:__BUILD__|[0-9a-f]{12})";$/gm,
  "sw.js": /^const CACHE = "hskker-(?:__BUILD__|[0-9a-f]{12})";$/gm,
  "js/core.js": /^const APP_BUILD = "(?:__BUILD__|[0-9a-f]{12})";$/gm,
};
const localAsset = /(<script src|<link rel="stylesheet" href)="(\.\/[^"?:]+\.(?:js|css))(?:\?v=[0-9a-f]{12})?"/g;
const originals = new Map();
function stamp(file, source, version){
  const field = fields[file];
  if((source.match(field) || []).length !== 1) throw Error("Missing or ambiguous build field in " + file);
  let result = source.replace(field, line => line.replace(/__BUILD__|[0-9a-f]{12}/, version));
  if(file === "index.html"){
    const matches = result.match(localAsset) || [];
    if(matches.length < 10 || matches.length !== (result.match(/<script src="\.\/|<link rel="stylesheet" href="\.\//g) || []).length)
      throw Error("Cannot version every local script and stylesheet in index.html");
    result = result.replace(localAsset, (_, tag, url) => `${tag}="${url}${version === "__BUILD__" ? "" : "?v=" + version}"`);
  }
  return result;
}
const hash = createHash("sha256");
for(const file of files.sort()){
  const bytes = readFileSync(join(WEB,file));
  hash.update(file);
  if(Object.hasOwn(fields,file)){
    const source = bytes.toString("utf8");
    originals.set(file,source);
    hash.update(stamp(file,source,"__BUILD__"));
  } else hash.update(bytes);
}
const version = hash.digest("hex").slice(0,12);
// Publish the worker last, after all assets for its new cache are ready.
for(const file of ["js/core.js","index.html","sw.js"]){
  const source = originals.get(file);
  const output = stamp(file,source,version);
  if(output === source) continue;
  const target = join(WEB,file);
  const temporary = target + "." + process.pid + ".tmp";
  try {
    writeFileSync(temporary,output);
    renameSync(temporary,target);
  } finally { rmSync(temporary,{force:true}); }
}
console.log(`HANZAI-ORIGINS ${pkg.version} · build ${version} · ${files.length} files in release/web`);
