/* Service worker.
 *
 * App code is stale-while-revalidate: the cached copy is served straight away
 * (launch stays instant and offline still works), a fresh copy is fetched in
 * the background, and the next launch runs it. Cache-first on code would be
 * worse than stale — it can pair last week's core.js with this week's
 * reader.js and break the app outright, and the lookup ignores query strings
 * so a ?v= buster does not get you out of it either.
 *
 * The syllabus data and the stroke shards never change within a build, so
 * those are cache-first and filled on demand rather than up front: precaching
 * 12.5 MB of stroke data on install would make the first launch unusable.
 *
 * CACHE is stamped by scripts/build.mjs, so a real deploy drops the old cache
 * outright.
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
  /* Was there a build before this one? Its pages are still open on the old
     code — the page itself is fetched network-first, the scripts and the
     stylesheet cache-first, so a launch that found this update is showing
     the new page on the previous build's code until this worker takes
     over. Once it has, reload those pages so each is one build. Done from
     here rather than from the page because the page that needs it is the
     old one. A first install has nothing to replace and is left alone.
     The reload stays out of waitUntil. Once claimed, a page's requests come
     to this worker, and a worker holds every fetch until it has finished
     activating — which it does when waitUntil settles. A reload inside it
     waited on a fetch that waited on it: the page hung, on every deploy,
     until the browser gave up on the worker minutes later. */
  taken.then(reload => reload ? self.clients.matchAll({type: "window"}) : [])
    .then(cs => Promise.all(cs.map(c => c.navigate(c.url).catch(() => {}))));
});

/* The syllabus and the stroke shards are .js too, so "is this ours" is asked
   about them first — otherwise a data file would fall into the
   stale-while-revalidate path meant for code and be re-fetched every launch.
   Stroke shards live under data/strokes/, so one prefix covers both. */
const isData = url => url.origin === self.location.origin
  && url.pathname.includes("/data/");

/* Is this one of our own code files? Compared by path so a ?v= or a #hash does
   not change the answer. */
function isCode(url){
  if(url.origin !== self.location.origin || isData(url)) return false;
  const path = url.pathname;
  return CODE.some(c => path.endsWith(c.slice(1))) || path.endsWith("/");
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

  // Navigations: network first, so a reload always gets the current page.
  if(req.mode === "navigate" || req.destination === "document"){
    e.respondWith(fetch(req, FRESH).then(res => put(req, res)).catch(() =>
      caches.match(req, {ignoreSearch:true}).then(hit => hit || caches.match(SHELL))));
    return;
  }

  // Our own code: serve the cached copy now, refresh it for next time.
  if(isCode(url)){
    e.respondWith(caches.match(req, {ignoreSearch:true}).then(hit => {
      const net = fetch(req, FRESH).then(res => put(req, res)).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Syllabus data and stroke files: immutable within a build, cached on use.
  if(isData(url)){
    e.respondWith(caches.match(req).then(hit =>
      hit || fetch(req, FRESH).then(res => put(req, res))));
    return;
  }

  // Icons and fonts: cache first, they are immutable.
  e.respondWith(
    caches.match(req, {ignoreSearch:true}).then(hit => hit || fetch(req).then(res => {
      if(res && res.ok && (req.url.startsWith(self.registration.scope) ||
                           req.url.includes("fonts.g"))) put(req, res);
      return res;
    }).catch(() => hit))
  );
});
