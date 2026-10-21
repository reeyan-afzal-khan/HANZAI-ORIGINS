/* core.js — state, palettes, storage and the data layer.
 *
 * Loaded first: everything below it on the page expects $, S, save, toast,
 * the SKINS table and the loaders to exist already. No modules and no build
 * step, so app/ runs from a folder, from file:// and from the APK unchanged. */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* The release this build is. Hard-coded rather than stamped, because app/ has
   to run straight from a folder with no build step — a __VERSION__ placeholder
   would be visible to anyone opening index.html directly. scripts/build.mjs
   asserts it against package.json instead, so the two cannot drift silently. */
const APP_VERSION = "1.28.0";

/* The themes. Each lives as a JSON file in themes/skins/ and reaches the page
   through themes/themes.js, which `npm run themes` writes (with skins.css
   beside it); this is that table. Every skin says whether it is a dark or a
   light ground, because the picker groups on it and "follow the system" needs
   to know which half of the list it may choose from. If the build was never
   run the one palette on bare :root stands in, so the app still opens. */
const THEMES = window.HSKKER_THEMES || {
  skins: [{id:"gruvbox", nm:"Gruvbox", dark:true, bg:"#1D2021", ac:"#FABD2F",
           rp:["#928374","#83A598","#8EC07C","#FABD2F","#FE8019"], r:"13px"}],
  backgrounds: [],
};
const SKINS = THEMES.skins;
const BGS = THEMES.backgrounds;
/* A stored id that no longer exists — a theme since retired — resolves to the
   first of its kind when the caller says which kind it wanted, and to the
   first theme otherwise. */
const skinOf = (id, dark) => SKINS.find(x => x.id === id)
  || (dark === undefined ? SKINS[0] : SKINS.find(x => x.dark === dark) || SKINS[0]);
const bgOf = id => BGS.find(b => b.id === id) || null;

/* ---------------- levels ---------------- */
/* HSK 3.0 runs 1–6 and then a single band covering 7–9. "7" is the id
   everywhere in code and data; "7–9" is what a reader is ever shown. */
const LEVELS = ["1","2","3","4","5","6","7"];
const levelLabel = lv => lv === "7" ? "7–9" : lv;
const bandOf = lv => +lv <= 3 ? 1 : +lv <= 6 ? 2 : 3;
const bandName = lv => ["", "Beginner", "Intermediate", "Advanced"][bandOf(lv)];

/* ---------------- settings ---------------- */
/* Which settings blob this is depends on who is using the app; profile.js
   decided that before this file ran, and returns the pre-profile key for the
   first profile so nothing that already exists has to move. */
const LS = settingsKey();
let S = {
  level:"1",
  script:"simplified", pinyin:true, tones:true,
  skin:"gruvbox", autoTheme:false, skinDark:"gruvbox", skinLight:"gruvbox-light",
  /* The grain over the page ground: a texture id from themes/backgrounds, or
     none, and its strength in percent. */
  bgTex:"", bgTexOp:30,
  /* Content text scale, in percent; `text` is the old three-step control and
     is read once to seed it. */
  text:"m", textScale:100, view:"home",
  /* One level for the whole app: the home ladder, the browsers and the rail
     all read and write S.level. (Each browser used to keep its own, and
     picking HSK 5 on the front page left Words on HSK 1.) */
  /* Whether resting the pointer on a word, or holding a finger on it, opens
     its card without a tap, and after how long. */
  glossDwell:true, glossDwellMs:2000,
  /* The sidebar folded to its icons. Rail only; a phone has no rail. */
  railMin:false,
  /* Which face the Chinese and the English are set in; ids from FONTS. */
  fontZh:"noto-serif", fontEn:"archivo",
  /* The reading surface. Colouring by HSK level is the default because it is
     the thing the reader cannot get anywhere else; pinyin over every word is
     not, because it is a crutch that stops you reading the characters. */
  readTint:"level", readMark:"text", readRuby:false, readDim:false, readSize:21,
  /* How a page turns: "curl" (the leaf swings on its spine), "slide", or
     "none". Swiping is on regardless; this is only how the turn is drawn. */
  readTurn:"curl",
  /* One page or two side by side. Two needs the width; a narrow window
     shows one whatever is set. */
  readSpread:"one",
  /* Which turn to go back to when the animation is switched back on. */
  readTurnStyle:"curl",
  /* The language a selected passage is translated into; where: "auto"
     (Google with a connection, the device without), "google" or "offline";
     and which of the device's translators, "" being the best it has
     ("browser" or "opus" — reader.js MT; both translate into English). */
  readTranslateTo:"en", readTranslator:"auto", readOfflineModel:"",
  /* The track under the page, shown or not. */
  readScrub:true,
  /* Full screen while a book is open: the rail and the masthead go, the
     page takes the window, and where the platform allows it the browser's
     own chrome goes too. Remembered, so a reader who reads that way opens
     the next book that way. */
  readFocus:false,
  /* Fold keys of the panels the reader has collapsed. Stored as a list of the
     closed ones rather than the open ones, so a panel added later opens by
     default instead of being hidden by an old settings blob. */
  folded:[],
  /* The Talk tab. Who the live conversation is with, and everyone it has
     ever been with (a name list; the record keys people by their index in
     it); the questions bookmarked and the topics switched off, by id; how a
     card is shown — both languages, the English first with the Chinese to
     produce, or the Chinese first with the English to check against — with
     the readings over each character or in a line under, and the words
     coloured by level or not; a run's length; and the run in progress, snapshotted so a phone that evicted the
     page mid-conversation comes back to the same card. */
  talkPartner:"", talkPeople:[], talkSaved:[], talkMuted:[],
  talkMode:"both", talkRuby:false, talkTint:true, talkGoal:0,
  talkStudy:false, talkLevelOnly:false, talkRun:null,
  /* Whether things move: "on", "off", or "system" to do as the device asks.
     On by default — see REDUCED. */
  motion:"on",
  /* The Characters tab as the grid of a level or as the tree of what is
     built from what (tree.js); the root that tree last grew from; and how
     far it grows: "all", through every level with the ones above yours
     locked, or "level", only up to yours. */
  charView:"tree", treeRoot:"", treeReach:"all",
  /* The panel beside the tree on a wide screen: shown, or put away. */
  treeInsp:true,
};
try{
  const raw = localStorage.getItem(LS);
  if(raw) Object.assign(S, JSON.parse(raw));
}catch(e){}
/* 1.26.23 translated through Baidu with an app ID and key of the reader's
   own. That is gone; so is anything typed for it, rather than left in the
   record and in every backup made from it. */
/* Before 1.26.26 there was no automatic choice, and Online was the default:
   a record still on it moves to Automatic, once, which goes online exactly
   as before while there is a connection. One that chose the device keeps it. */
if(!S.readTranslatorV){
  if(S.readTranslator !== "offline") S.readTranslator = "auto";
  S.readTranslatorV = 2;
}
if(!["auto", "google", "offline"].includes(S.readTranslator)) S.readTranslator = "auto";
if("baiduAppId" in S || "baiduKey" in S){
  delete S.baiduAppId; delete S.baiduKey;
  try{ localStorage.setItem(LS, JSON.stringify(S)); }catch(e){}
}
/* The tree's first cut kept its reach as a yes-or-no that defaulted to the
   chosen level; it is treeReach now, and grows through every level. */
if("treeAll" in S) delete S.treeAll;
/* Themes come and go; a record that names one that has gone settles on the
   first of the same kind, so a saved light theme stays a light theme. The
   only ids ever shipped that were light are listed, since the record itself
   does not say. */
{
  const wasLight = ["gruvbox-light", "discord-light", "sky", "cinnabar", "sounding", "daylight"];
  const settle = (id, dark) => SKINS.some(x => x.id === id) ? id : skinOf(null, dark).id;
  S.skinDark  = settle(S.skinDark, true);
  S.skinLight = settle(S.skinLight, false);
  S.skin      = settle(S.skin, !wasLight.includes(S.skin));
  if(!bgOf(S.bgTex)) S.bgTex = "";
}

let saveTimer = 0;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try{ localStorage.setItem(LS, JSON.stringify(S)); }catch(e){}
  }, 120);
}

/* ---------------- small helpers ---------------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = n => Number(n ?? 0).toLocaleString();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HANZI = /[㐀-鿿豈-﫿]/;
const hasHanzi = s => HANZI.test(String(s || ""));

function shuffle(a){
  const out = [...a];
  for(let i = out.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/* n items drawn without replacement. Used everywhere a quiz needs distractors. */
function sample(arr, n){
  if(arr.length <= n) return shuffle(arr);
  const out = [], used = new Set();
  while(out.length < n && used.size < arr.length){
    const i = Math.floor(Math.random() * arr.length);
    if(used.has(i)) continue;
    used.add(i); out.push(arr[i]);
  }
  return out;
}

let toastTimer = 0;
function toast(msg){
  let el = $("#toast");
  if(!el){
    el = document.createElement("div");
    el.id = "toast"; el.className = "toast";
    el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}

/* ---------------- pinyin ---------------- */
const TONE_MARK = {"̄":1, "́":2, "̌":3, "̀":4};

/* Tone number 1–5 for one syllable, read off its combining diacritic. */
function toneOf(syllable){
  const m = String(syllable).normalize("NFD").match(/[̀-̏]/);
  return m ? (TONE_MARK[m[0]] || 5) : 5;
}
/* Tone marks stripped, so a search for "hao" matches "hǎo" and "hào". */
function toneless(pinyin){
  return String(pinyin || "").normalize("NFD")
    .replace(/[̀-̏]/g, "")
    .replace(/ü/g, "v")
    .toLowerCase();
}
const flatPinyin = p => toneless(p).replace(/[\s'·-]/g, "");

/* Pinyin marked up one syllable at a time, so each can take its tone colour.
   A word's syllables are written together — "àihào" — so each word is cut
   at its seams first (segment.js knows them once the lexicon is loaded) and
   coloured syllable by syllable; failing that, the word takes one colour.
   With tone colouring off it is still split — the spans carry no class. */
function pinyinHTML(text){
  if(!text) return "";
  const tone = s => S.tones ? `<span class="t${toneOf(s)}">${esc(s)}</span>` : esc(s);
  return String(text).split(/(\s+|·)/).map(part => {
    if(!part.trim() || part === "·") return esc(part);
    /* Trailing punctuation stays outside the coloured span. */
    const m = /^(.*?)([^\p{L}\p{M}]*)$/su.exec(part);
    const word = m[1], tail = m[2];
    const parts = typeof syllablesOf === "function" ? syllablesOf(word) : null;
    return (parts && parts.length > 1 ? parts.map(tone).join("") : tone(word)) + esc(tail);
  }).join("");
}

/* The script the reader asked for. Both forms are shown only where they differ,
   which is the only case where showing both tells them anything. */
function hanziOf(simplified, traditional){
  if(S.script === "traditional" && traditional) return traditional;
  if(S.script === "both" && traditional && traditional !== simplified)
    return `${simplified} · ${traditional}`;
  return simplified;
}

/* ---------------- the data layer ---------------- */
/* The syllabus is loaded with <script> tags rather than fetch().
 *
 * fetch() cannot read a sibling file when the page itself came from file:// —
 * every browser treats that as a cross-origin request and blocks it — and this
 * app has to work when somebody double-clicks index.html. A script tag has no
 * such restriction, so the same code path serves file://, http and the Android
 * WebView, with no protocol sniffing and no second copy of the data.
 *
 * Each generated file calls HSKDATA with its own name, which settles the
 * promise the loader is holding for it. */
const dataCache = new Map();
const pendingData = new Map();

/* Called by the generated files in app/data/. */
function HSKDATA(name, payload){
  const waiting = pendingData.get(name);
  if(waiting){ pendingData.delete(name); waiting(payload); }
  else dataCache.set(name, Promise.resolve(payload));   // arrived before it was asked for
}

/* One in-flight promise per file, so twelve views asking for the same level
   during one paint produce one tag. */
function loadData(name){
  let hit = dataCache.get(name);
  if(hit) return hit;

  hit = new Promise((resolve, reject) => {
    pendingData.set(name, resolve);
    const el = document.createElement("script");
    el.src = `./data/${name}.js`;
    el.async = false;
    /* A script tag reports only that it failed, never why, so the message says
       what to do rather than guessing at a cause. */
    el.onerror = () => {
      pendingData.delete(name);
      dataCache.delete(name);
      reject(new Error(`Could not load data/${name}.js — run \`npm run data\` to generate it.`));
    };
    document.head.appendChild(el);
  });
  dataCache.set(name, hit);
  return hit;
}

const getMeta    = ()   => loadData("meta");
const getVocab   = lv   => loadData(`vocab/${lv}`);
const getChars   = ()   => loadData("chars");
const getGrammar = ()   => loadData("grammar");
/* [id, simplified, pinyin, first gloss, level, frequency] for all 11,092 words. */
const getSearch  = ()   => loadData("search");

/* Example sentences for a level's words, from the grammar points
   (scripts/build-examples.mjs): simplified -> [[zh, pinyin, en, source]]. */
const getExamples = lv => loadData(`examples/${lv}`).catch(() => ({}));

async function findWord(id){
  const lv = id.startsWith("L7") ? "7" : id[1];
  return (await getVocab(lv)).find(w => w.id === id);
}
async function findChar(h){ return (await getChars()).find(c => c.h === h); }
async function findGrammar(id){ return (await getGrammar()).find(g => g.id === +id); }

/* Words containing a character, nearest level and commonest first.
   Read off the search index rather than the seven vocabulary files: this runs
   every time a character is opened, and the index carries everything the list
   shows for a quarter of the bytes. */
async function wordsWithChar(h, limit = 24){
  return (await getSearch())
    .filter(row => row[1].includes(h))
    .sort((a, b) => +a[4] - +b[4] || (a[5] ?? 1e9) - (b[5] ?? 1e9))
    .slice(0, limit)
    .map(([id, s, p, en, lv]) => ({id, s, t: s, p, en: [en], lv}));
}

/* ---------------- palettes ---------------- */
const prefersDark = () => !window.matchMedia
  || window.matchMedia("(prefers-color-scheme: dark)").matches;

/* Paint a palette. Called for a tap on the picker and again whenever the
   system flips, so it only ever writes the attribute and the chrome colour —
   which half of the picker the choice came from is decided by the caller. */
function paintSkin(id){
  const sk = skinOf(id);
  S.skin = sk.id;
  document.documentElement.dataset.skin = sk.id;
  /* The categorical chart palette has a light and a dark stepping, and which
     one applies depends on the skin's ground rather than on the OS. */
  const wasMode = document.documentElement.dataset.mode;
  document.documentElement.dataset.mode = sk.dark ? "dark" : "light";
  if(wasMode !== document.documentElement.dataset.mode && typeof renderTextures === "function" && $("#texes")) renderTextures();
  else if(wasMode !== document.documentElement.dataset.mode && typeof applyTexture === "function") applyTexture();
  const name = $("#skinname");
  if(name) name.textContent = sk.nm + (S.autoTheme ? " · auto" : "");
  $$("#skins .skin").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === sk.id));
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute("content", sk.bg);
  if(window.hskkerNativeTheme) window.hskkerNativeTheme(sk);
}

/* A tap on the picker. With "follow the system" on it stores the choice into
   the light or the dark slot depending on the skin's own ground, so picking
   Gruvbox in the dark and Gruvbox Light in the daytime sets up the pair in
   the obvious way rather than needing two separate controls. */
function applySkin(id){
  const sk = skinOf(id);
  if(sk.dark) S.skinDark = sk.id; else S.skinLight = sk.id;
  if(S.autoTheme && sk.dark !== prefersDark()){
    // The pick belongs to the half of the day that is not on right now.
    // Painting it would be a lie the next system flip undoes, so bank it
    // and say where it went.
    syncSystemSkin();
    toast(sk.nm + " saved as your " + (sk.dark ? "dark" : "light") + " theme");
    return;
  }
  paintSkin(sk.id);
  save();
}
/* The system said light or dark. Only meaningful with autoTheme on. */
function syncSystemSkin(){
  if(!S.autoTheme) return;
  paintSkin(prefersDark() ? S.skinDark : S.skinLight);
  save();
}
function renderSkins(){
  const group = (label, list) => `<div class="skingroup"><span class="lbl">${label}</span>
    <div class="skins">${list.map(sk => `
      <button class="skin" data-k="${sk.id}" aria-pressed="${sk.id === S.skin}">
        <span class="prev" style="background:${sk.bg}">
          ${sk.rp.map((c,i) => `<i style="background:${c};height:${5+i*4}px"></i>`).join("")}
          <span class="dot" style="background:${sk.ac}"></span>
        </span>
        <span class="nm">${esc(sk.nm)}</span>
      </button>`).join("")}</div></div>`;
  $("#skins").innerHTML =
      group("Dark",  SKINS.filter(s => s.dark))
    + group("Light", SKINS.filter(s => !s.dark));
}

/* ---------------- background texture ---------------- */
/* The chosen grain is dressed onto #tex — one fixed sheet over the whole
   window — as an ordinary background image, and its url, tile size and
   strength go onto the root as well for the dialogs, which live above it (see
   "background texture" in styles.css). The stylesheet turns the grain light
   under a dark theme, so a theme change recolours it and nothing here has to
   know which theme is on. */
const texStrength = () => clamp(+S.bgTexOp || 30, 5, 80);
/* The tile is shown at the screen's own pixels — one texel per device pixel,
   so it is as fine on a phone as on a monitor — which in CSS pixels is the
   tile divided by the density. */
const texTile = bg => {
  const d = clamp(window.devicePixelRatio || 1, 1, 3);
  return {w: `${(bg.w / d).toFixed(1)}px`, h: `${(bg.h / d).toFixed(1)}px`};
};
/* The grain's file for the ground it lies on: dark grain on a light theme,
   pale grain on a dark one. */
const texFile = bg => document.documentElement.dataset.mode === "dark" && bg.fileLight ? bg.fileLight : bg.file;
function applyTexture(){
  const bg = bgOf(S.bgTex), root = document.documentElement, sheet = $("#tex");
  if(bg){
    const t = texTile(bg), file = texFile(bg);
    root.dataset.tex = bg.id;
    root.style.setProperty("--tex", `url(${file})`);
    root.style.setProperty("--tex-w", t.w);
    root.style.setProperty("--tex-h", t.h);
    root.style.setProperty("--tex-op", (texStrength() / 100).toFixed(2));
    if(sheet){ sheet.style.backgroundImage = `url(${file})`; sheet.style.backgroundSize = `${t.w} ${t.h}`; }
  }else{
    delete root.dataset.tex;
    for(const k of ["--tex", "--tex-w", "--tex-h", "--tex-op"]) root.style.removeProperty(k);
    if(sheet) sheet.style.backgroundImage = "";
  }
  $$("#texes .tex").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === (bg ? bg.id : "")));
  const lbl = $("#lbl-tex"); if(lbl) lbl.textContent = `${texStrength()}%`;
  const row = $("#tex-row"); if(row) row.classList.toggle("dim", !bg);
}
function renderTextures(){
  const host = $("#texes");
  if(!host) return;
  const chip = (id, nm, file) => `
      <button class="tex" data-k="${id}" aria-pressed="${id === (S.bgTex || "")}">
        <span class="swatch">${file ? `<i style="background-image:url(${file})"></i>` : ""}</span>
        <span class="nm">${esc(nm)}</span>
      </button>`;
  host.innerHTML = chip("", "None", "") + BGS.map(b => chip(b.id, b.nm, texFile(b))).join("");
  const r = $("#r-tex"); if(r) r.value = texStrength();
  applyTexture();
}

/* ---------------- typefaces ---------------- */
/* The faces on offer. Two kinds: ones Google Fonts serves, fetched on demand
   the first time they are chosen (and cached by the browser thereafter — the
   app runs offline and a missing web font simply falls through the stack),
   and ones the device itself carries. KaiTi is the second kind: every Windows
   and macOS has a Kai face under one name or another, and the stack names
   each of them in turn; a device without one shows the default face instead.

   The English stacks end without a generic family on purpose: in the page
   they are always followed by the Chinese stack (see --font-text in the CSS),
   and a generic in between would catch every hanzi first.

   @field stack  the CSS font-family value
   @field gf     the Google Fonts family query, where there is one */
const FONTS = {
  zh: [
    {id:"noto-serif", name:"Noto Serif SC", note:"Song · 宋体 · the default",
     stack:'"Noto Serif SC",serif', gf:"Noto+Serif+SC:wght@400;500;600"},
    /* "HSKKER Kai" is a KaiTi the app carries, the same on every device;
       "HSKKER FangSong" is the device's own face where it has one and a face
       shipped with the app where it does not — see the @font-face rules at
       the top of styles.css. `face` is what applyFonts() asks the browser to
       load, so a file that cannot be had is reported rather than silent. */
    {id:"kaiti", name:"KaiTi", note:"Kai · 楷体", face:"HSKKER Kai",
     stack:'"HSKKER Kai",KaiTi,"Kaiti SC","Kaiti TC",STKaiti,"楷体","Noto Serif SC",serif'},
    {id:"noto-sans", name:"Noto Sans SC", note:"Hei · 黑体",
     stack:'"Noto Sans SC",system-ui,sans-serif', gf:"Noto+Sans+SC:wght@400;500;700"},
    {id:"fangsong", name:"FangSong", note:"仿宋 · yours, or 朱雀仿宋", face:"HSKKER FangSong",
     stack:'"HSKKER FangSong",FangSong,"FangSong_GB2312",STFangsong,"仿宋","AR PL UMing CN","Noto Serif SC",serif'},
    {id:"xiaowei", name:"ZCOOL XiaoWei", note:"站酷小薇 · display serif",
     stack:'"ZCOOL XiaoWei","Noto Serif SC",serif', gf:"ZCOOL+XiaoWei"},
    {id:"mashanzheng", name:"Ma Shan Zheng", note:"马善政 · brush",
     stack:'"Ma Shan Zheng","Noto Serif SC",serif', gf:"Ma+Shan+Zheng"},
    {id:"system", name:"System", note:"whatever the device uses",
     stack:'system-ui,-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif'},
  ],
  en: [
    {id:"archivo", name:"Archivo", note:"the default",
     stack:'Archivo,system-ui,-apple-system,"Segoe UI"', gf:"Archivo:ital,wght@0,400;0,500;0,600;0,700;1,400"},
    {id:"inter", name:"Inter", note:"neutral sans",
     stack:'Inter,system-ui', gf:"Inter:wght@400;500;600;700"},
    {id:"source-sans", name:"Source Sans 3", note:"humanist sans",
     stack:'"Source Sans 3",system-ui', gf:"Source+Sans+3:wght@400;500;600;700"},
    {id:"plex", name:"IBM Plex Sans", note:"grotesque sans",
     stack:'"IBM Plex Sans",system-ui', gf:"IBM+Plex+Sans:wght@400;500;600;700"},
    {id:"literata", name:"Literata", note:"reading serif",
     stack:'Literata,Georgia', gf:"Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700"},
    {id:"georgia", name:"Georgia", note:"serif · from your device",
     stack:'Georgia,"Times New Roman"'},
    {id:"system", name:"System", note:"whatever the device uses",
     stack:'system-ui,-apple-system,"Segoe UI",Roboto'},
  ],
};
const fontById = (kind, id) => FONTS[kind].find(f => f.id === id) || FONTS[kind][0];

/* One stylesheet link per Google family, added the first time it is wanted
   and never twice. Offline the request fails quietly and the stack's next
   face carries the text. */
function loadWebFont(f){
  if(!f.gf || document.getElementById(`gf-${f.id}`)) return;
  /* The default faces are already on the page's own font link; asking for
     them again is a second request for the same file on every launch. */
  if(document.querySelector(`link[rel="stylesheet"][href*="family=${f.gf.split(":")[0]}"]`)) return;
  const link = document.createElement("link");
  link.id = `gf-${f.id}`;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
  document.head.appendChild(link);
}

/* A face the app carries is asked for outright, so that if its file cannot
   be loaded — a broken install, a blocked fetch — the reader is told, rather
   than left looking at the fallback and wondering whether the setting took. */
let faceWarned = "";
function checkFace(f){
  if(!f.face || !document.fonts || !document.fonts.load) return;
  document.fonts.load(`16px "${f.face}"`).then(list => {
    if(!list.length) throw new Error("no face");
    faceWarned = "";
  }).catch(() => {
    if(faceWarned === f.id || S.fontZh !== f.id) return;
    faceWarned = f.id;
    toast(`${f.name} could not be loaded — the text stays in the default face`);
  });
}

function applyFonts(){
  const zh = fontById("zh", S.fontZh), en = fontById("en", S.fontEn);
  S.fontZh = zh.id; S.fontEn = en.id;
  loadWebFont(zh); loadWebFont(en);
  checkFace(zh);
  document.documentElement.style.setProperty("--font-zh", zh.stack);
  document.documentElement.style.setProperty("--font-ui", en.stack);
  $$("#font-zh .fontcard").forEach(b => b.setAttribute("aria-pressed", b.dataset.font === zh.id));
  $$("#font-en .fontcard").forEach(b => b.setAttribute("aria-pressed", b.dataset.font === en.id));
}

/* ---------------- text scale ---------------- */
/* One number, --fs on the root, that every piece of content type is set
   against: the words on a row, a card's headword and senses, a dialogue, a
   question and its options. The interface — labels, chips, buttons — is not
   scaled, so a bigger text setting does not push the controls off a phone.
   The old Small / Default / Large is read once and turned into a percentage. */
function applyTextScale(pct){
  if(pct == null){
    pct = S.textScale || ({s: 88, l: 118}[S.text] ?? 100);
  }
  S.textScale = Math.min(140, Math.max(85, Math.round(pct / 5) * 5));
  document.documentElement.style.setProperty("--fs", String(S.textScale / 100));
  const r = $("#r-text"), l = $("#lbl-text");
  if(r) r.value = S.textScale;
  if(l) l.textContent = `${S.textScale}%`;
  save();
}

/* ---------------- failure handling ---------------- */
/* Anything the reader can set off — opening a card, painting the rail, adding
   to the deck — goes through here. Without it a rejected promise reaches the
   window handler and paints a stack trace over the page, which tells nobody
   anything and hides the app underneath. Sync programming errors still reach
   window.boom; this is for the one thing that legitimately fails at runtime,
   which is data that is not there. */
function safely(what, fn){
  return Promise.resolve()
    .then(fn)
    .catch(err => {
      console.error(`${what} failed:`, err);
      const missing = /Could not load data\//.test(String(err && err.message));
      toast(missing ? "Syllabus data is missing — run npm run data" : `Could not ${what}`);
    });
}

/* ---------------- the detail sheet ---------------- */
/* Words, characters and grammar points all open into the same dialog rather
   than a route of their own. A detail is something you glance at and dismiss
   mid-task — pushing a whole view would lose the list you were reading. */
/* The browsing tabs — words, characters, grammar — share one shape:
   a search box and filter chips that are wanted at every point in a list of
   hundreds, and the list under them. So the list is the part that scrolls,
   bounded to what is left of the window, and the controls stay put.

   Measured rather than written in CSS because what sits above a list changes:
   chips wrap to two rows on a phone, a help panel opens, a count line grows.
   A hidden view has no layout to measure (offsetParent is null exactly when
   the element or an ancestor is display:none), and writing the same value back
   would be a layout for nothing. Same shape as the reader's sizeReader. */
const SCROLLERS = ["#clist", "#glist"];
function sizeScroller(sel){
  const el = $(sel);
  if(!el || !el.offsetParent || !window.innerHeight) return;
  /* On a phone the masthead, the tab grid, the search and two rows of chips
     already take most of the screen; boxing the list into what is left would
     leave four rows. There the page scrolls as a page, and the list is left
     unbounded. */
  if(window.innerWidth < 700){ if(el.style.height) el.style.height = ""; return; }
  /* the grammar point, or the character, open beside its list is as tall
     as the list */
  const beside = sel === "#glist" ? $("#gdetail") : sel === "#clist" ? $("#cpanel") : null;
  const wrap = document.querySelector(".wrap");
  const pad = wrap ? parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0;
  /* Where the list starts, from the layout rather than the screen: a view
     is measured as it arrives, while its rise-in animation still holds it a
     few pixels low, and a height taken from that would stop the list short
     of the sidebar's foot by the same few pixels. Offsets ignore transforms. */
  let top = -window.scrollY;
  for(let e = el; e; e = e.offsetParent) top += e.offsetTop;
  const height = Math.max(240, Math.round(window.innerHeight - top - pad));
  const want = `${height}px`;
  if(el.style.height !== want) el.style.height = want;
  if(beside && beside.style.height !== want) beside.style.height = want;
}
/* The character tree's canvas is bounded the same way, on a phone too. */
const sizeLists = () => {
  SCROLLERS.forEach(sizeScroller);
  if(typeof sizeCharTree === "function") sizeCharTree();
};

/* A list starts at the top when what it shows has changed — a new level, a
   new search, a different filter — and keeps its place when it has only grown
   by a page. The paint knows nothing about which control fired; it hands over
   a key of its filter state and the list scrolls up when the key is new. */
const listKeys = new Map();
function settleList(sel, key){
  const el = $(sel);
  if(!el) return;
  if(listKeys.get(sel) !== key){ listKeys.set(sel, key); el.scrollTop = 0; }
  sizeScroller(sel);
}

function openDetail(html, opts = {}){
  const dlg = $("#detail");
  const body = $("#detail-body");
  body.innerHTML = html;
  /* A character's sheet: two columns on a wide screen, the stroke box beside
     what is known about it rather than above it. */
  dlg.classList.toggle("char", opts.sheet === "char");
  dlg.classList.toggle("gram", opts.sheet === "gram");
  dlg.classList.remove("closing");
  if(!dlg.open) dlg.showModal();
  /* The body is the scroller, not the dialog — it carries the max-height and
     the overflow. Resetting the dialog left a second entry opened from a
     scrolled first one starting halfway down its own content. */
  body.scrollTop = 0;
  dlg.scrollTop = 0;
  return dlg;
}
/* Dialogs leave the way they arrive. A native close() drops the box in one
   frame, which reads as a glitch next to the fade it opened with; this runs
   the out animation and closes when it lands. Reduced motion closes at once. */
/* Whether to keep still. The app's own setting decides: a phone that has
   had its animations switched off tells every app to keep still — Samsung
   does it for power saving and from its accessibility settings, as well as
   anyone who turns animations off to make the phone feel quicker — and the
   Android app then animated nowhere, where the web app on a computer did.
   So the app animates unless told to here; "Follow device" is there for
   anyone who switched animations off for comfort. */
const REDUCED = () => S.motion === "off"
  || (S.motion === "system" && !!window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
/* The stylesheet's half: every transition and animation goes when the root
   carries .still. Set now, before anything is drawn, and again whenever the
   setting or the device's wish changes. */
function applyMotion(){ document.documentElement.classList.toggle("still", REDUCED()); }
applyMotion();
if(window.matchMedia){
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  if(mq.addEventListener) mq.addEventListener("change", applyMotion);
}
function closeDialog(dlg){
  if(!dlg || !dlg.open) return;
  if(REDUCED() || dlg.classList.contains("closing")){ dlg.classList.remove("closing"); dlg.close(); return; }
  dlg.classList.add("closing");
  let done = false;
  const finish = () => {
    if(done) return; done = true;
    dlg.classList.remove("closing");
    if(dlg.open) dlg.close();
  };
  dlg.addEventListener("animationend", e => { if(e.target === dlg) finish(); }, {once: true});
  setTimeout(finish, 240);
}
const closeDetail = () => closeDialog($("#detail"));

/* A level chip, banded so beginner, intermediate and advanced read apart. */
const lvChip = lv => `<span class="lv b${bandOf(lv)}">HSK ${levelLabel(lv)}</span>`;
