/* Service worker.
 *
 * One build at a time. The page, its scripts and its stylesheets all come out
 * of this worker's own cache, which holds the build the worker shipped with:
 * filled in one go on install, and never topped up with a newer copy of
 * anything. So the page and the code that runs it are always the same build,
 * online or off.
 *
 * The worker before this one fetched the page from the network and served the
 * scripts from its cache. After a deploy that was the new page on the old
 * build's code — a page that crashed on its first line that looked for
 * something the new page no longer had, until the new worker took over and
 * reloaded it. index.html still heals a page put together like that (heal(),
 * in its <head>), since that worker is still installed out there.
 *
 * A new build is found the way the browser finds any worker update: it checks
 * sw.js on every launch. The new worker fills its cache, takes over, drops the
 * old build's cache and reloads the open pages, each of which is then the new
 * build throughout.
 *
 * The syllabus data and the stroke shards never change within a build, so
 * those are cache-first and filled on demand rather than up front: precaching
 * 12.5 MB of stroke data on install would make the first launch unusable.
 */
const CACHE = "hskker-__BUILD__";
/* scripts/build.mjs replaces __BUILD__ with a hash of everything it ships.
   Running from app/ directly, that substitution has not happened — so the
   cache name would be the same string for every edit, and the worker would
   serve last week's code forever. Unstamped means "this is the working copy":
   stay out of the way entirely and let every request go to the network. */
const STAMPED = !CACHE.includes("__BUILD__");
const SHELL = "./index.html";
const CODE = ["./index.html", "./styles.css", "./js/profile.js", "./js/core.js", "./js/store.js",
              "./js/study.js", "./js/browse.js", "./js/tree.js", "./js/radicals.js", "./js/home.js", "./js/epub.js",
              "./js/segment.js", "./js/reader.js", "./js/talk.js", "./js/settings.js",
              "./js/boot.js", "./js/native.js", "./vendor/hanzi-writer.min.js",
              "./themes/skins.css", "./themes/themes.js"];
const ASSETS = CODE.concat(["./manifest.webmanifest", "./icons/icon-192.png",
                            "./icons/icon-512.png", "./icons/icon-maskable.png",
                            "./icons/favicon.ico", "./icons/favicon-16.png",
                            "./icons/favicon-32.png", "./icons/apple-touch-icon.png",
                            "./data/meta.js",
                            /* The two faces the app carries: small enough to
                               take at install, so a face picked offline is
                               there rather than falling through. */
                            "./fonts/hskker-kai.woff2", "./fonts/hskker-fangsong.woff2"]);

/* What the worker fetches for itself goes to the server, not to the browser's
   HTTP cache: "no-cache" asks whether the copy held is current, a 304 with no
   body when it is. A static host lets copies be kept for minutes — GitHub
   Pages sends max-age=600 — so for ten minutes after a deploy the HTTP cache
   still hands back the build before, and a new worker filling its cache from
   there filed the old build's code under the new build's name: the mix the
   stamp exists to prevent. */
const FRESH = {cache: "no-cache"};

self.addEventListener("install", e => {
  if(!STAMPED){ self.skipWaiting(); return; }
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(a => new Request(a, FRESH))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  const taken = caches.keys().then(ks => {
    /* Only this app's own build caches; anything else in the same storage
       is not ours to clear. (The offline translator lives in IndexedDB,
       "hskker-mt", out of the way of all of this — see reader.js MT.) */
    const ours = ks.filter(k => k.startsWith("hskker-"));
    const upgraded = ours.some(k => k !== CACHE);
    // Unstamped, CACHE matches nothing, so this clears all of ours.
    return Promise.all(ours.filter(k => k !== CACHE || !STAMPED).map(k => caches.delete(k)))
      .then(() => self.clients.claim())
      .then(() => upgraded && STAMPED);
  });
  e.waitUntil(taken);
  /* Was there a build before this one? Its pages are still open on its code,
     and once this worker has taken over, whatever they load next would come
     from this build. Reload them so each is one build. A first install has
     nothing to replace and is left alone.
     The reload stays out of waitUntil. Once claimed, a page's requests come
     to this worker, and a worker holds every fetch until it has finished
     activating — which it does when waitUntil settles. A reload inside it
     waited on a fetch that waited on it: the page hung, on every deploy,
     until the browser gave up on the worker minutes later. */
  taken.then(reload => reload ? self.clients.matchAll({type: "window"}) : [])
    .then(cs => Promise.all(cs.map(c => c.navigate(c.url).catch(() => {}))));
});

/* The syllabus and the stroke shards are .js too, so "is this ours" is asked
   about them first — otherwise a data file would be taken for code. Stroke
   shards live under data/strokes/, so one prefix covers both. */
const isData = url => url.origin === self.location.origin
  && url.pathname.includes("/data/");

/* Is this one of our own code files? Compared by path, so the ?v= the build
   puts on each one does not change the answer. */
function isCode(url){
  if(url.origin !== self.location.origin || isData(url)) return false;
  const path = url.pathname;
  return CODE.some(c => path.endsWith(c.slice(1))) || path.endsWith("/");
}

/* This build's copy of a request: from this worker's own cache and no other.
   caches.match() with no cache named searches every cache the site has, and
   while the next build is installing, that includes its cache, half filled.
   Our own files are matched by path alone, since ?v= only tells the HTTP
   cache which build a file is; another site's query is part of what it is. */
function mine(req, url){
  return caches.open(CACHE).then(c => c.match(req, {ignoreSearch: url.origin === self.location.origin}));
}

function put(req, res){
  if(res && res.ok){
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET" || !STAMPED) return;

  let url;
  try{ url = new URL(req.url); }catch(_){ return; }
  /* Other sites' requests go straight to the network, untouched — Google
     Translate, and the offline translator's download, which is stored in
     IndexedDB — except Google Fonts, which are kept below. */
  if(url.origin !== self.location.origin && !url.hostname.startsWith("fonts.g")) return;

  /* The page: this build's. The network only when the cache has lost it, and
     then not kept: a page from the server may be a later build than the
     scripts in here. Anything else opened in a tab — an icon, a data file —
     is itself, from the network first. */
  if(req.mode === "navigate"){
    const page = url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
    e.respondWith(page ? mine(new Request(SHELL), url).then(hit => hit || fetch(req, FRESH))
                       : fetch(req).catch(() => mine(req, url)));
    return;
  }

  // Our own code: this build's copy, put there on install.
  if(isCode(url)){
    e.respondWith(mine(req, url).then(hit => hit || fetch(req, FRESH)));
    return;
  }

  // Syllabus data and stroke files: immutable within a build, cached on use.
  if(isData(url)){
    e.respondWith(mine(req, url).then(hit =>
      hit || fetch(req, FRESH).then(res => put(req, res))));
    return;
  }

  // Icons and fonts: cache first, they are immutable.
  e.respondWith(
    mine(req, url).then(hit => hit || fetch(req).then(res => {
      if(res && res.ok && (req.url.startsWith(self.registration.scope) ||
                           req.url.includes("fonts.g"))) put(req, res);
      return res;
    }))
  );
});
