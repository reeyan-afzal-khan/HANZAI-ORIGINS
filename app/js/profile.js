/* profile.js — who is using this copy of the app.
 *
 * Loaded before core.js, because it decides which settings blob core.js reads
 * and which database store.js opens. Nothing above it exists yet, so the
 * bootstrap half of this file talks to localStorage directly.
 *
 * There is no server and there is no account. A profile is a separate record
 * on this device: its own deck, its own review log, its own shelf, its own
 * settings and its own theme. Two people sharing a laptop get two profiles;
 * one person keeping a serious deck and a scratch deck gets two profiles.
 *
 * Isolation is by database rather than by a column. Every store in store.js
 * would otherwise need a profile filter on every read, every write and every
 * index — a lot of surface for a bug that silently mixes two people's decks.
 * A second IndexedDB database cannot leak into the first no matter what the
 * query layer does.
 *
 * The first profile deliberately keeps the names the app used before profiles
 * existed — the "hskker" database and the "hskker.v1" settings key — so an
 * install that predates this file migrates by doing nothing at all. There is
 * no upgrade step to get wrong, and no version of this code can lose a deck
 * that was recorded before it shipped.
 */

const P_KEY = "hskker.profiles";
const P_ACTIVE = "hskker.profile";
const P_LEGACY = "1";

/* The avatar colours. Deliberately not the palette's accent: two profiles are
   told apart by their colour, and both would be wearing the same one. */
const P_HUES = ["#FFCE1F", "#63C88C", "#5EA6EE", "#E482C2", "#EC9A5A", "#A98BEE",
                "#4FBEC0", "#E86A55"];

let PROFILES = [];
let ACTIVE = P_LEGACY;

function loadProfiles(){
  try{
    const raw = localStorage.getItem(P_KEY);
    PROFILES = raw ? JSON.parse(raw) : [];
  }catch(e){ PROFILES = []; }
  if(!Array.isArray(PROFILES)) PROFILES = [];

  try{ ACTIVE = localStorage.getItem(P_ACTIVE) || P_LEGACY; }catch(e){ ACTIVE = P_LEGACY; }
  /* A profile that was deleted in another tab, or a storage blob that arrived
     half-written, must not strand the app pointing at nothing. */
  if(PROFILES.length && !PROFILES.some(p => p.id === ACTIVE)) ACTIVE = PROFILES[0].id;
}
loadProfiles();

function saveProfiles(){
  try{
    localStorage.setItem(P_KEY, JSON.stringify(PROFILES));
    localStorage.setItem(P_ACTIVE, ACTIVE);
  }catch(e){ /* private window with storage refused; the session still runs */ }
}

const profileOf = id => PROFILES.find(p => p.id === id) || null;
const activeProfile = () => profileOf(ACTIVE);

/* Where this profile's things live. Both are the pre-profile names for the
   first profile — see the note at the top. */
const dbName = () => ACTIVE === P_LEGACY ? "hskker" : `hskker-${ACTIVE}`;
const settingsKey = () => ACTIVE === P_LEGACY ? "hskker.v1" : `hskker.v1.${ACTIVE}`;

/* Had this device been used before profiles existed? If it had, the person is
   mid-deck and must not be shown a welcome screen; if it had not, they are new
   and can be asked their name.
 *
 * Read once, here, at the top of the first script the page runs. core.js
 * writes that same key on a debounced timer as soon as the theme is painted,
 * so asking the question later is a race — and one that resolves the wrong way
 * often enough to matter: a genuinely new reader would silently get an
 * unnamed profile instead of being asked. */
const HAD_LEGACY = (() => {
  try{ return localStorage.getItem("hskker.v1") !== null; }catch(e){ return false; }
})();
const hasLegacyRecord = () => HAD_LEGACY;

const initialOf = name => {
  const t = String(name || "").trim();
  /* One character, and for a Chinese name that is the surname rather than an
     initial — taking the first letter of 王小明 would give 王 anyway, which is
     the right answer for the wrong reason, so it is stated. */
  return t ? [...t][0].toUpperCase() : "?";
};

function newProfile(name, hue){
  const id = PROFILES.length ? `p${Date.now().toString(36)}` : P_LEGACY;
  const p = {
    id,
    name: String(name || "").trim().slice(0, 40) || "Untitled",
    hue: hue || P_HUES[PROFILES.length % P_HUES.length],
    created: Date.now(),
    lastSeen: Date.now(),
    examDate: "",
    note: "",
    lock: null,
  };
  PROFILES.push(p);
  return p;
}

/* Called once at start-up. An install from before profiles gets a record for
   the deck it already has; a genuinely fresh one gets nothing yet, so boot.js
   knows to ask. */
function ensureProfile(){
  if(PROFILES.length) return activeProfile();
  if(!hasLegacyRecord()) return null;
  const p = newProfile("You");
  ACTIVE = p.id;
  saveProfiles();
  return p;
}

function touchProfile(){
  const p = activeProfile();
  if(!p) return;
  p.lastSeen = Date.now();
  saveProfiles();
}

/* Switching reloads the page rather than swapping the state in place.
 *
 * The alternative is to close the database, drop every cached promise in the
 * data layer, reset the eight view modules' module-level state and repaint —
 * which is a list nobody keeps correct as the app grows, and the failure mode
 * is one profile showing another's cards. A reload is a hundred milliseconds
 * and cannot get it wrong. */
function switchProfile(id){
  if(!profileOf(id)) return;
  ACTIVE = id;
  saveProfiles();
  location.reload();
}

/* Deleting a profile takes its database and its settings with it — otherwise
   "delete" leaves the deck on disk and only forgets where it was. */
async function deleteProfile(id){
  const p = profileOf(id);
  if(!p) return;
  const db = id === P_LEGACY ? "hskker" : `hskker-${id}`;
  const key = id === P_LEGACY ? "hskker.v1" : `hskker.v1.${id}`;
  try{ localStorage.removeItem(key); }catch(e){}
  try{
    await new Promise(res => {
      const req = indexedDB.deleteDatabase(db);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    });
  }catch(e){}
  PROFILES = PROFILES.filter(x => x.id !== id);
  if(ACTIVE === id) ACTIVE = PROFILES[0] ? PROFILES[0].id : P_LEGACY;
  saveProfiles();
}

/* ---------------- the passcode ---------------- */

/* What this is, and what it is not.
 *
 * The passcode is verified against a PBKDF2 hash, so the passcode itself is
 * not sitting in storage in readable form and cannot be read back off the
 * device. That is the whole of what it does. It is a lock on the door of the
 * app, not encryption: the deck, the review log and the shelf are in IndexedDB
 * in the clear, and anybody holding the unlocked device who opens a developer
 * console can read them without ever meeting this screen.
 *
 * It is offered because "keep my flatmate out of my profile" is a real thing
 * to want and this genuinely does it. It is described in those terms in the
 * interface too, because a lock that is believed to be stronger than it is
 * does more harm than no lock at all.
 *
 * Where WebCrypto is missing the feature is withdrawn rather than replaced
 * with something homemade — a hand-rolled hash here would be worse than
 * honestly having no passcode. */
const canLock = () => !!(typeof crypto !== "undefined" && crypto.subtle
  && typeof crypto.subtle.deriveBits === "function" && typeof TextEncoder === "function");

const P_ITER = 210000;

const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));

async function derivePass(pass, saltHex, iterations){
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(String(pass)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256"}, key, 256);
  return toHex(new Uint8Array(bits));
}

async function setPasscode(pass){
  const p = activeProfile();
  if(!p || !canLock()) return false;
  if(!pass){ p.lock = null; saveProfiles(); return true; }
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  p.lock = {salt, iter: P_ITER, hash: await derivePass(pass, salt, P_ITER)};
  saveProfiles();
  return true;
}

async function checkPasscode(id, pass){
  const p = profileOf(id);
  if(!p || !p.lock) return true;
  try{
    const got = await derivePass(pass, p.lock.salt, p.lock.iter || P_ITER);
    /* Compared in constant time. The margin it buys over a local attacker is
       slim, but writing the version that leaks is a choice and this is not. */
    const want = p.lock.hash;
    if(got.length !== want.length) return false;
    let diff = 0;
    for(let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  }catch(e){ return false; }
}

const isLocked = () => !!(activeProfile() && activeProfile().lock);
