/* store.js — IndexedDB, hand-rolled.
 *
 * The deck can run to tens of thousands of rows once somebody works through
 * HSK 7–9, which is past what localStorage will hold, so the record lives in
 * IndexedDB. Settings stay in localStorage (core.js) because they are small
 * and wanted synchronously before first paint.
 *
 * Seven stores:
 *   cards     one row per item per study mode, keyed "kind:ref:mode"
 *   reviews   an append-only log, one row per answer
 *   results   one row per finished quiz or exam. Nothing in the app writes
 *             these now; the store stays so an existing record, and a backup
 *             made from it, keeps them
 *   books     one row per shelved text — title, length, reading position
 *   bookdata  the text itself, one row per book, same key
 *   talk      the conversation record: one row per question dealt, with
 *             when, how it went, at what depth, from which deck and to whom
 *   talksess  one row per conversation run
 *
 * A book is split across two stores because the shelf is drawn from every row
 * in `books` on every paint and a novel's text is several megabytes. Keeping
 * them together would mean reading the whole library into memory to list it.
 */

/* One database per profile, named by profile.js — the first profile keeps the
   original name, so an install from before profiles opens exactly the database
   it always did. Isolation by database rather than by a column on every row:
   two decks cannot be mixed by a query that forgot its filter if they were
   never in the same store. */
const DB_NAME = dbName();
const DB_VERSION = 3;
let dbPromise = null;

/* Some contexts refuse IndexedDB outright — a page opened straight from disk,
   a private window with site data blocked. Browsing the syllabus does not need
   a database, so rather than failing the whole app we fall back to a store
   that lives for the tab and say so once. Nothing else in the app can tell the
   difference; it just does not survive a reload. */
let memoryOnly = false;
const memory = {cards: new Map(), reviews: new Map(), results: new Map(),
                books: new Map(), bookdata: new Map(), talk: new Map(), talksess: new Map()};
let memorySeq = 1;
let warned = false;

function goMemory(err){
  if(!memoryOnly){
    memoryOnly = true;
    console.warn("IndexedDB unavailable — progress will not be saved.", err);
  }
  if(!warned && typeof toast === "function"){
    warned = true;
    // The page is still painting when this first fires; queue it behind that.
    setTimeout(() => toast("Progress can't be saved here — open it over http"), 800);
  }
}

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains("cards")){
        const cards = db.createObjectStore("cards", {keyPath: "id"});
        cards.createIndex("due", "due");
        cards.createIndex("lv", "lv");
        cards.createIndex("kindref", ["kind", "ref"]);
      }
      if(!db.objectStoreNames.contains("reviews")){
        const rev = db.createObjectStore("reviews", {keyPath: "id", autoIncrement: true});
        rev.createIndex("at", "at");
      }
      if(!db.objectStoreNames.contains("results")){
        const res = db.createObjectStore("results", {keyPath: "id", autoIncrement: true});
        res.createIndex("at", "at");
      }
      /* Added in version 2. Each createObjectStore is guarded, so an existing
         database gains the two new stores and keeps every card in the old
         three — an upgrade must never be a reason to lose a deck. */
      if(!db.objectStoreNames.contains("books"))
        db.createObjectStore("books", {keyPath: "id"});
      if(!db.objectStoreNames.contains("bookdata"))
        db.createObjectStore("bookdata", {keyPath: "id"});
      /* Version 3: the Talk tab's record. Two logs, both append-only. The
         per-question counts, the per-person "already asked" lists and the
         streak are all derived from the events rather than stored, so there
         is one thing to export and nothing to fall out of step. */
      if(!db.objectStoreNames.contains("talk")){
        const t = db.createObjectStore("talk", {keyPath: "id", autoIncrement: true});
        t.createIndex("at", "at");
        t.createIndex("pid", "pid");
      }
      if(!db.objectStoreNames.contains("talksess")){
        const t = db.createObjectStore("talksess", {keyPath: "id", autoIncrement: true});
        t.createIndex("at", "at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  }).catch(err => {
    goMemory(err);
    return null;
  });
  return dbPromise;
}

function tx(store, mode, run){
  return openDB().then(db => {
    if(!db) return null;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = run(t.objectStore(store));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      if(req && "onsuccess" in req){
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }else{
        t.oncomplete = () => resolve();
      }
    });
  }).catch(err => { goMemory(err); return null; });
}

const rows = store => [...memory[store].values()];

/* ---- the stores read whole on every paint, kept in memory ----
 *
 * The shelf is read in full by the home screen (three times over), and the
 * deck by every book and conversation opened (to colour the words you know)
 * — and the deck runs to tens of thousands of rows. Read from the database
 * each time, that is the whole table copied out of IndexedDB again and
 * again: a pause you can feel on a phone every time you come back to Home.
 * So the first full read of each is kept, and every write through this
 * file — put, add, delete, clear, the restore of a backup — is made to the
 * copy as well. A write that lands while a full read is still under way
 * would be missing from that read, so such a read is used but not kept (the
 * generation count below). */
const CACHED = new Set(["cards", "results", "books"]);
const cache = new Map();          // store → Map(id → row)
const cacheGen = new Map();       // store → writes so far
const touched = store => {
  if(!CACHED.has(store)) return null;
  cacheGen.set(store, (cacheGen.get(store) || 0) + 1);
  return cache.get(store) || null;
};

async function dbAll(store){
  if(memoryOnly) return rows(store);
  const kept = cache.get(store);
  if(kept) return [...kept.values()];
  const gen = cacheGen.get(store) || 0;
  const out = await tx(store, "readonly", s => s.getAll());
  if(out == null) return rows(store);
  if(CACHED.has(store) && (cacheGen.get(store) || 0) === gen) cache.set(store, new Map(out.map(r => [r.id, r])));
  return out.slice();
}
async function dbPut(store, val){
  const kept = touched(store);
  if(!memoryOnly && await tx(store, "readwrite", s => s.put(val)) !== null){ if(kept) kept.set(val.id, val); return; }
  memory[store].set(val.id, val);
}
async function dbAdd(store, val){
  const kept = touched(store);
  if(!memoryOnly){
    const key = await tx(store, "readwrite", s => s.add(val));
    if(key !== null){ if(kept) kept.set(key, {...val, id: key}); return; }
  }
  memory[store].set(memorySeq, {...val, id: memorySeq});
  memorySeq++;
}
async function dbGet(store, key){
  if(!memoryOnly){
    const out = await tx(store, "readonly", s => s.get(key));
    if(out !== null && out !== undefined) return out;
    /* A miss and a database that refused the read are both `null` from tx(),
       so a genuine miss falls through to the memory map and finds nothing
       there either — which is the same answer. */
  }
  return memory[store].get(key);
}
async function dbDelete(store, key){
  memory[store].delete(key);
  const kept = touched(store);
  if(kept) kept.delete(key);
  if(!memoryOnly) await tx(store, "readwrite", s => s.delete(key));
}
async function dbClear(store){
  memory[store].clear();
  const kept = touched(store);
  if(kept) kept.clear();
  if(!memoryOnly) await tx(store, "readwrite", s => s.clear());
}
async function dbPutMany(store, vals){
  if(!vals.length) return;
  const kept = touched(store);
  if(!memoryOnly && await tx(store, "readwrite", s => { for(const v of vals) s.put(v); }) !== null){
    if(kept) for(const v of vals) kept.set(v.id, v);
    return;
  }
  for(const v of vals) memory[store].set(v.id, v);
}

/* How many cards there are of one kind in one mode. The key says both
   ("kind:ref:mode"), so the count is taken from the keys alone: the home
   screen wants the number at every launch, and reading the deck itself to
   get it is thousands of rows copied out of the database first. */
async function countCards(kind, mode){
  const test = id => id.startsWith(kind + ":") && id.endsWith(":" + mode);
  const kept = cache.get("cards");
  if(kept) return [...kept.keys()].filter(test).length;
  if(!memoryOnly){
    const keys = await tx("cards", "readonly", s => s.getAllKeys(IDBKeyRange.bound(kind + ":", kind + ":\uffff")));
    if(keys != null) return keys.filter(test).length;
  }
  return rows("cards").filter(c => test(c.id)).length;
}

/* Every card for one item, across all its study modes. */
async function cardsFor(kind, ref){
  if(!memoryOnly){
    const out = await tx("cards", "readonly",
      s => s.index("kindref").getAll([kind, String(ref)]));
    if(out !== null) return out;
  }
  return rows("cards").filter(c => c.kind === kind && c.ref === String(ref));
}

async function deleteCardsFor(kind, ref){
  for(const c of rows("cards")){
    if(c.kind === kind && c.ref === String(ref)) memory.cards.delete(c.id);
  }
  const kept = touched("cards");
  if(kept) for(const c of [...kept.values()]) if(c.kind === kind && c.ref === String(ref)) kept.delete(c.id);
  if(memoryOnly) return;
  const db = await openDB();
  if(!db) return;
  return new Promise((resolve, reject) => {
    const t = db.transaction("cards", "readwrite");
    const req = t.objectStore("cards").index("kindref").openCursor([kind, String(ref)]);
    req.onsuccess = () => {
      const cur = req.result;
      if(cur){ cur.delete(); cur.continue(); }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }).catch(err => { goMemory(err); });
}

/* Reviews logged at or after a timestamp — how "today" and the streak are counted. */
async function reviewsSince(from){
  if(!memoryOnly){
    const out = await tx("reviews", "readonly",
      s => s.index("at").getAll(IDBKeyRange.lowerBound(from)));
    if(out !== null) return out;
  }
  return rows("reviews").filter(r => r.at >= from);
}

/* ---------------- backup ---------------- */
/* Everything the reader has produced, so progress can move between the web
   app and the APK. Settings ride along: they are cheap and people expect
   their palette to travel with their deck. */
async function exportAll(){
  const [cards, reviews, results, books, bookdata, talk, talksess] = await Promise.all([
    dbAll("cards"), dbAll("reviews"), dbAll("results"),
    dbAll("books"), dbAll("bookdata"), dbAll("talk"), dbAll("talksess"),
  ]);
  /* The shelf rides along with the deck. It makes the file much larger — a
     novel is megabytes of text — but a backup that restores your reviews and
     loses your library is not a backup of your reading. */
  /* Whose record this is, for the person looking at a folder of backups a year
     later. Identity only: the passcode hash is deliberately not written out —
     it protects nothing once it has left the device, and a credential in a
     file people email to themselves is a credential in the wrong place. */
  const me = typeof activeProfile === "function" ? activeProfile() : null;
  const profile = me
    ? {name: me.name, created: me.created, examDate: me.examDate, note: me.note}
    : null;
  return {app:"hskker", version:3, exported:new Date().toISOString(),
          profile, settings:S, cards, reviews, results, books, bookdata, talk, talksess};
}

async function importAll(payload){
  if(!payload || payload.app !== "hskker") throw new Error("Not a HANZAI-ORIGINS backup file.");
  await Promise.all([dbClear("cards"), dbClear("reviews"), dbClear("results"),
                     dbClear("books"), dbClear("bookdata"), dbClear("talk"), dbClear("talksess")]);
  await dbPutMany("cards", payload.cards || []);
  /* Version 1 files predate the shelf and simply have no books in them. */
  await dbPutMany("books", payload.books || []);
  await dbPutMany("bookdata", payload.bookdata || []);
  // The logs are auto-keyed; dropping the old ids avoids colliding on re-import.
  for(const r of (payload.reviews || [])){ const {id, ...rest} = r; await dbAdd("reviews", rest); }
  for(const r of (payload.results || [])){ const {id, ...rest} = r; await dbAdd("results", rest); }
  /* Version 2 files predate the Talk tab and carry no conversations. */
  for(const r of (payload.talk || [])){ const {id, ...rest} = r; await dbAdd("talk", rest); }
  for(const r of (payload.talksess || [])){ const {id, ...rest} = r; await dbAdd("talksess", rest); }
  if(typeof forgetTalkRecord === "function") forgetTalkRecord();
  if(payload.settings && typeof payload.settings === "object"){
    /* A file from 1.26.23 can carry a Baidu app ID: that service is gone,
       and the ID is not taken in. */
    const {baiduAppId, baiduKey, ...settings} = payload.settings;
    Object.assign(S, settings);
    if(!["auto", "google", "offline"].includes(S.readTranslator)) S.readTranslator = "auto";
    save();
  }
  /* The file's profile block is read but not applied: a backup is restored
     *into* the profile you are standing in, and silently renaming it — or
     worse, re-locking it with a passcode from a file — is not what "import"
     means. */
}

async function resetProgress(){
  await Promise.all([dbClear("cards"), dbClear("reviews"), dbClear("results"),
                     dbClear("talk"), dbClear("talksess")]);
  if(typeof forgetTalkRecord === "function") forgetTalkRecord();
}
