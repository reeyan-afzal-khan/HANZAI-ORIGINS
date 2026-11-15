/* tree.js — the Characters tab as a map: from a radical to the characters
 * built on it, to the characters built on those, to the words they write.
 *
 * Every character is built from parts — 海 from 氵 and 每, 林 from 木 twice,
 * 森 from 木 and 林 — and the syllabus records those parts one step down
 * (charextra's decomposition). Read the other way round, a part is the core
 * of everything built on it, and that is what the map draws, left to right:
 *
 *   Built from   the core's own parts, where it has any (木 is 十 and 八)
 *   Core         the radical or character the map grows from
 *   Tier I       every character built on the core — one card each for a
 *                small family, a card for each HSK level for a big one —
 *                with its recipe on the link: 氵 +每 → 海
 *   Tier II …    a character opened shows what is built on it in turn, and
 *                the words it is written in. A word that uses two characters
 *                on the map (海洋: 海 and 洋) is linked from both, so paths
 *                that start apart meet in the words they make: the map ends
 *                as a mind map of how the family hangs together.
 *
 * A word can be the core too (你好, searched for or picked from a list): the
 * map then shows how it is built, left to right — each character's parts,
 * each character, the word — and after it the longer words it is written in.
 *
 * It is played as a role-playing game's skill tree. Each character is a
 * skill — locked, ready, learned or mastered — and opens once the character
 * it is built on is learned (a component with no entry of its own holds
 * nothing back). A word is a combination: ready once all its characters are
 * learned. The next quest is always named over the map; quests and their XP
 * are quests.js's.
 *
 * Boxes (cards, level groups, word lists) are laid over one SVG of links,
 * all inside a plane the camera moves with a single transform: dragging
 * pans, the wheel or a pinch zooms. When the map changes, boxes glide to
 * their new places and the links follow them. Beside the map on a wide
 * screen, or over it while something is picked on a narrower one, the panel
 * tells about it. Everything here is named ct… or mm… — the app's scripts
 * share one global scope. */

/* Single strokes are parts of nearly everything — 一 is somewhere inside
   1,741 of the 3,000 characters — so a tree grown from one is the whole
   syllabus with no shape to it. They are never offered as a root, and are
   left out of what a character is made of past its own parts. */
const CT_STROKES = new Set([..."一丨丿丶乚亅乙乛"]);
const CT_LOCK = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5"/><rect x="2.5" y="5.5" width="7" height="5" rx="1.3"/></svg>`;
const CT_TICK = `<svg viewBox="0 0 12 12" aria-hidden="true"><path class="tick" d="m2.7 6.3 2.2 2.2 4.4-4.8"/></svg>`;
const CT_STAR = `<svg viewBox="0 0 12 12" aria-hidden="true"><path class="star" d="M6 1.3 7.45 4.2l3.2.47-2.32 2.26.55 3.19L6 8.62 3.12 10.12l.55-3.19L1.35 4.67l3.2-.47z"/></svg>`;

const CT = {
  g: null,               // the graph: by, kids, gloss, form, alias
  root: "",              // the core the map grows from
  word: "",              // where the core is a word: its id, and the map shows how it is built
  trail: [],             // the cores walked through to get here
  tree: null,            // what grows from the core: branches, parent, under, tall, size
  makes: null,           // what the core is made of
  depth: new Map(),      // character -> its tier (the core is 0)
  open: new Set(),       // characters opened on the map: what they build, and their words
  fold: new Map(),       // a level group -> open or folded, where the reader has said
  wall: new Map(),       // character -> how many of its words its list shows, where more than the first few
  sel: "",               // what is picked: a character, or "w:" and a word's id
  hover: "",             // what the pointer rests on
  quest: "",             // the next quest, as last worked out
  seen: null,            // {root, states}: the states last drawn, to tell what has just opened
  lay: null,             // the last layout: boxes, links, columns, extent
  recs: new Map(),       // box key -> its element and where it is drawn now
  cam: {x: 0, y: 0, k: 1},
  held: false,           // whether the camera was last held back at the map's edge
  touched: false,        // moved by hand since the map last placed itself
  deck: new Map(),       // character -> its own card's rank (1 in the deck, 2 mastered)
  met: new Map(),        // character -> the best rank of a deck word written with it
  famWords: new Map(),   // word id -> its card's rank
  words: null,           // character -> the words written with it
  wordById: new Map(),   // word id -> its row in the search index
  shelf: null,           // the roots worth starting from besides the radicals, grouped
  insp: "",              // what the panel was last drawn for
  writer: null,          // the panel's stroke-order writer
  next: "",              // a root asked for from an entry, for the next drawing
  anim: 0, glide: 0, camAnim: 0, mapTimer: 0, size: "", hotLinks: new Set(), mapXform: null,
  wired: false,
};

/* ---------------- the graph ---------------- */

/* Built once from the character list: what each part builds into, the gloss
   of a part that has no entry of its own, and the radicals as the list names
   them and as characters write them — 水 and 氵, 艸 and 艹, 貝 and 贝 — which
   is how a part with no reading can still be said, and how a radical is
   known in a character whose record names only its traditional form. */
function ctGraph(chars){
  const by = new Map(chars.map(c => [c.h, c]));
  const kids = new Map(), gloss = new Map(), pairs = new Map();
  for(const c of chars){
    for(const p of c.comp){
      if(p.c === c.h) continue;
      if(!kids.has(p.c)) kids.set(p.c, []);
      kids.get(p.c).push(c.h);
      if(p.g && !gloss.has(p.c)) gloss.set(p.c, p.g);
    }
    if(c.r && c.rad && c.r !== c.rad){
      const k = `${c.r}\t${c.rad}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
  }
  /* A pair the sources give once is a slip, and is not taken. Of the full
     forms a written one pairs with, the commonest is the one it is said by. */
  const alias = new Map(), best = new Map();
  for(const [k, n] of pairs){
    if(n < 2) continue;
    const [r, rad] = k.split("\t");
    if(!alias.has(rad)) alias.set(rad, new Set());
    alias.get(rad).add(r);
    if(!by.has(r) && by.has(rad) && (!best.has(r) || best.get(r)[1] < n)) best.set(r, [rad, n]);
  }
  const form = new Map([...best].map(([r, [rad]]) => [r, rad]));
  const rank = h => by.get(h).rank ?? 1e9;
  for(const list of kids.values()) list.sort((a, b) => +by.get(a).lv - +by.get(b).lv || rank(a) - rank(b));
  const names = [...new Set([...by.keys(), ...kids.keys()])];
  const ids = new Map(names.map((name, i) => [name, i]));
  webEngine.begin_graph(names.length);
  for(const [name, children] of kids){
    const ptr = webEngine.input(children.length);
    const buffer = new Uint16Array(webEngine.memory.buffer, ptr, children.length);
    children.forEach((child, i) => { buffer[i] = ids.get(child); });
    webEngine.set_children(ids.get(name));
  }
  return {by, kids, gloss, form, alias, names, ids};
}

/* The level the tree is grown to: the whole standard, or the chosen one. */
/* What grows from a root. Each character is placed once, under the parent of
   its that sits deepest in the tree — the longest way down from the root,
   found in one pass over the descendants in dependency order. */
function ctGrow(root){
  const {by, ids, names} = CT.g;
  const branches = new Map(), parent = new Map(), under = new Map(), tall = new Map();
  under.set(root, 0);
  tall.set(root, 0);
  if(ids.has(root)){
    const length = webEngine.grow_tree(ids.get(root));
    const rows = new Int32Array(webEngine.memory.buffer, webEngine.output(), length);
    for(let i = 0; i < length; i += 4){
      const h = names[rows[i]], p = names[rows[i + 1]];
      under.set(h, rows[i + 2]);
      tall.set(h, rows[i + 3]);
      if(p === undefined) continue;
      parent.set(h, p);
      if(!branches.has(p)) branches.set(p, []);
      branches.get(p).push(h);
    }
  }
  /* Branches in the order a game lists them: what is open to you at your
     level first, the ones above it after; within each, the biggest branches
     on top, then by level and how common the character is. */
  const lv = +S.level, rank = h => by.get(h).rank ?? 1e9;
  const above = h => +by.get(h).lv > lv ? 1 : 0;
  for(const list of branches.values())
    list.sort((a, b) => above(a) - above(b) || under.get(b) - under.get(a) || +by.get(a).lv - +by.get(b).lv || rank(a) - rank(b));
  return {root, branches, parent, under, tall, size: under.get(root)};
}

/* What the root is made of, and what those parts are made of: two tiers
   leftwards, each part once. */
function ctMakings(root){
  const out = new Map(), seen = new Set([root]);
  let tier = [root];
  for(let d = 1; d <= 2 && tier.length; d++){
    const next = [];
    for(const h of tier){
      const c = CT.g.by.get(h);
      if(!c) continue;
      const parts = c.comp.map(p => p.c).filter(p => !seen.has(p) && (d === 1 || !CT_STROKES.has(p)));
      for(const p of parts){ seen.add(p); next.push(p); }
      if(parts.length) out.set(h, parts);
    }
    tier = next;
  }
  return out;
}

/* ---------------- a word as the core ---------------- */

/* A word's row by how it is written — the syllabus's before the everyday. */
function ctWordRow(s){
  if(!CT.wordRows || [...String(s || "")].length < 2) return null;
  if(!CT.wordBySimp) CT.wordBySimp = new Map(CT.wordRows.map(r => [r[1], r]).reverse());
  return CT.wordBySimp.get(s) || null;
}
/* A word as a map: its characters hang from it, each once (谢谢 is 谢
   twice), so they are what the map counts, quests through and rings; none
   is locked — a word is learned a character at a time, in any order. */
function ctWordTree(r){
  const chars = [...new Set(r[1])].filter(ch => CT.g.by.has(ch));
  return {root: r[1], branches: new Map([[r[1], chars]]), parent: new Map(chars.map(ch => [ch, r[1]])),
    under: new Map([[r[1], chars.length]]), tall: new Map(), size: chars.length};
}
/* What each of its characters is made of, a step down. */
function ctWordMakes(r){
  const out = new Map();
  for(const ch of new Set(r[1])){
    const c = CT.g.by.get(ch);
    const parts = c ? c.comp.map(p => p.c).filter(p => p !== ch) : [];
    if(parts.length) out.set(ch, parts);
  }
  return out;
}
/* The longer words a word is written in — 学生 in 大学生 — each once, the
   lower level and then the commoner first. */
function ctWordsWith(s){
  if(!CT.withCache) CT.withCache = new Map();
  if(CT.withCache.has(s)) return CT.withCache.get(s);
  const seen = new Set(), out = [];
  for(const r of CT.wordRows || []) if(r[1] !== s && r[1].includes(s) && !seen.has(r[1])){ seen.add(r[1]); out.push(r); }
  out.sort((a, b) => (+a[4] || 0) - (+b[4] || 0) || (a[5] ?? 1e9) - (b[5] ?? 1e9));
  CT.withCache.set(s, out);
  return out;
}

/* The roots worth starting from at a level besides the radicals, which the
   index has (radicals.js): the sound families, whose characters mostly rhyme
   with them (青 qīng → 请 清 情), and the other parts characters are built
   from (又, 人). A part that gives most of its characters their meaning is a
   radical, and is left to the index. Each the parts the most characters are
   built on directly, commonest first. */
function ctShelf(){
  if(CT.shelf) return CT.shelf;
  const kinds = {radicals: [], sounds: [], parts: []};
  for(const [p, list] of CT.g.kids){
    if(CT_STROKES.has(p)) continue;
    const ks = list;
    if(ks.length < 3) continue;
    let meaning = 0, sound = 0;
    for(const h of ks){
      const r = ctRole(h, p);
      if(r === "meaning") meaning++; else if(r === "sound") sound++;
    }
    const kind = meaning >= ks.length / 2 ? "radicals" : sound >= ks.length * .4 ? "sounds" : "parts";
    kinds[kind].push([p, ks.length]);
  }
  const rank = p => (CT.g.by.get(p) || {}).rank ?? 1e9;
  for(const list of Object.values(kinds)) list.sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]));
  const out = [
    ["sounds", "Sound families", kinds.sounds.slice(0, 40)],
    ["parts", "Other parts", kinds.parts.slice(0, 40)],
  ].filter(s => s[2].length);
  CT.shelf = out;
  return out;
}

/* What is said about a node: its entry where it has one, and for a part
   without, its gloss and the radical it is a form of. */
function ctAbout(h){
  const c = CT.g.by.get(h);
  if(c) return {c, full: "", en: c.en.slice(0, 2).join("; "), short: ctShort(c.en[0])};
  const full = CT.g.form.get(h), fc = full ? CT.g.by.get(full) : null;
  const g = CT.g.gloss.get(h) || (fc ? fc.en[0] : "") || "";
  return {c: null, full: fc ? full : "", fc, en: g, short: ctShort(g)};
}
const ctShort = s => String(s || "").replace(/\([^)]*\)/g, "").split(/[;,]/)[0].trim().slice(0, 24);

/* Which part a character takes its meaning from (its radical, in any of the
   radical's forms) and which, if any, it sounds like. The sound is only
   claimed where the readings rhyme — the same syllable, or the same final of
   two letters or more — in any reading of either: 洗 is xǐ, but also xiǎn,
   which is where 先 xiān comes in. */
function ctRole(h, part){
  const c = CT.g.by.get(h);
  if(!c) return "";
  const forms = CT.g.alias.get(c.rad);
  if(part === c.r || part === c.rad || CT.g.form.get(part) === c.rad || (forms && forms.has(part))) return "meaning";
  const pc = CT.g.by.get(part);
  if(pc && [c.p, ...c.pAlt].some(a => [pc.p, ...pc.pAlt].some(b => ctRhymes(b, a)))) return "sound";
  return "";
}
const ctRoleText = role => role === "meaning" ? "dictionary radical" : role === "sound" ? "similar sound" : "component";
function ctRhymes(a, b){
  const fa = flatPinyin(a), fb = flatPinyin(b);
  if(!fa || !fb) return false;
  if(fa === fb) return true;
  const fin = s => s.replace(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/, "");
  return fin(fa).length >= 2 && fin(fa) === fin(fb);
}

/* What else goes into a character besides the part it hangs from — 女 to 妈
   is 马 — or, where nothing else does, how many times the part goes in (木
   to 林, twice). null where the recipe says nothing: more than two others,
   or bare strokes (事 is 口 and 一, 彐, 亅). */
function ctOthers(h, from){
  const c = CT.g.by.get(h);
  if(!c) return null;
  const others = c.comp.map(p => p.c).filter(p => p !== from && CT.g.form.get(p) !== from);
  if(others.length > 2 || others.some(p => CT_STROKES.has(p))) return null;
  const times = others.length ? 1 : [...String(c.dec || "")].filter(x => x === from).length;
  return {others, times};
}
/* The recipe on a link into a character: "+每", or "×2"; "" for none. */
function ctRecipe(h, from){
  const o = ctOthers(h, from);
  if(!o) return "";
  return o.others.length ? "+" + o.others.join("+") : o.times > 1 ? `×${o.times}` : "";
}

/* ---------------- the game: stars, locks and the next quest ---------------- */

/* The scholar's titles, a level each (quests.js: a level every 150 XP). */
const CT_RANKS = ["Novice", "Apprentice", "Initiate", "Scribe", "Calligrapher", "Scholar", "Sage", "Master", "Grandmaster"];
const ctTitle = rank => CT_RANKS[Math.max(0, Math.min(rank, CT_RANKS.length) - 1)];
const CT_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const ctRoman = d => CT_ROMAN[d] || String(d);
const CT_STATES = {locked: "Locked", ready: "Ready to learn", learned: "Learned", mastered: "Mastered", part: "Component", known: "In your deck"};

/* How far along a character is, in stars: 1 once recognised in a quest or
   met in the deck, 2 once its writing quest is done, 3 once its card (or a
   word written with it) is mastered. */
function ctStars(h){
  if(!CT.g.by.has(h)) return 0;
  if(ctKnown(h) === 2) return 3;
  if(questInfo.written.has(h)) return 2;
  return questInfo.recognised.has(h) || ctKnown(h) > 0 ? 1 : 0;
}
const ctLearned = h => ctStars(h) >= 2;
/* Open once what it is built on is learned; a component with no entry of
   its own has nothing to learn, so it holds nothing back. */
function ctUnlocked(h){
  const p = CT.tree.parent.get(h);
  return p === undefined || !CT.g.by.has(p) || ctLearned(p);
}
function ctState(h){
  if(!CT.g.by.has(h)) return "part";
  const s = ctStars(h);
  return s === 3 ? "mastered" : s === 2 ? "learned" : ctUnlocked(h) ? "ready" : "locked";
}
/* XP still to be had from a character's quest: 10 for recognising it and 20
   for writing it, each the first time only. */
const ctReward = h => (questInfo.recognised.has(h) ? 0 : 10) + (questInfo.written.has(h) ? 0 : 20);
const ctRank = h => (CT.g.by.get(h) || {}).rank ?? 1e9;

/* Every character in the tree: the core where it is one, and all it grows. */
const ctMembers = () => [...(CT.g.by.has(CT.root) ? [CT.root] : []), ...CT.tree.parent.keys()];

/* The quest to take next: the core while it is still to learn; then the open
   skill at the reader's level or below before one above it, the lower level
   first, the commoner character first. "" once every skill is learned. */
function ctNextQuest(){
  if(!CT.tree) return "";
  const lv = +S.level;
  const before = (a, b) => { for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) return a[i] < b[i]; return false; };
  let best = "", key = null;
  for(const h of ctMembers()){
    if(ctState(h) !== "ready") continue;
    const c = CT.g.by.get(h);
    const k = [h === CT.root ? 0 : 1, +c.lv > lv ? 1 : 0, +c.lv, c.rank ?? 1e9, CT.depth.get(h) || 0];
    if(!key || before(k, key)){ best = h; key = k; }
  }
  return best;
}

/* How far through the family the reader is. */
function ctProgress(){
  let total = 0, learned = 0, stars = 0;
  for(const h of ctMembers()){
    total++;
    const s = ctStars(h);
    stars += s;
    if(s >= 2) learned++;
  }
  return {total, learned, stars, pct: total ? Math.round(learned / total * 100) : 0};
}

/* Each character's tier, the core being 0. */
function ctDepths(){
  const d = new Map([[CT.root, 0]]), queue = [CT.root];
  for(let i = 0; i < queue.length; i++)
    for(const k of CT.tree.branches.get(queue[i]) || []) if(!d.has(k)){ d.set(k, d.get(queue[i]) + 1); queue.push(k); }
  return d;
}

/* ---------------- the words ---------------- */

/* The words by each character written in them — what a character goes on to
   make. Rows are [id, simplified, pinyin, gloss, level, frequency]: the
   syllabus's words, then the everyday ones it leaves out (data/extra.js, ids
   X-…). The engine (map.rs) indexes them in one pass, three to four times
   quicker than doing it here; each character's list, lower level first and
   then the commoner word, is read out of it the first time it is asked for. */
function ctWordsIndex(rows){
  CT.wordRows = rows;
  CT.wordById = new Map(rows.map(r => [r[0], r]));
  CT.words = new Map();
  let size = 0;
  for(const r of rows) size += 4 + r[1].length;
  const ptr = webEngine.input(size);
  const buf = new Uint16Array(webEngine.memory.buffer, ptr, size);
  let at = 0;
  for(const r of rows){
    const s = r[1], f = r[5] ?? 1e9;
    buf[at] = s.length; buf[at + 1] = +r[4] || 0; buf[at + 2] = f & 65535; buf[at + 3] = f >>> 16;
    at += 4;
    for(let k = 0; k < s.length; k++) buf[at++] = s.charCodeAt(k);
  }
  webEngine.vocab_build();
}
function ctWordsOf(h){
  if(!CT.words) return [];
  let list = CT.words.get(h);
  if(!list){
    const n = h.length === 1 ? webEngine.vocab_of(h.charCodeAt(0)) : 0;
    const ids = new Uint32Array(webEngine.memory.buffer, webEngine.output(), n);
    list = new Array(n);
    for(let i = 0; i < n; i++) list[i] = CT.wordRows[ids[i]];
    CT.words.set(h, list);
  }
  return list;
}
/* A word the HSK list leaves out (build-extrawords.mjs). */
const ctEveryday = r => r[0].startsWith("X-");
/* The words, once, the first time the map is drawn. */
async function ctLoadWords(){
  if(CT.words) return;
  const [index, extra] = await Promise.all([getSearch(), loadData("extra").catch(() => [])]);
  if(!CT.words) ctWordsIndex(index.concat(extra));
}
/* A word as a combination: in the deck or mastered; ready once every one of
   its characters is learned; locked until then. */
function ctWordState(r){
  const k = CT.famWords.get(r[0]) || 0;
  if(k === 2) return "mastered";
  if(k === 1) return "known";
  return [...new Set(r[1])].every(ch => !CT.g.by.has(ch) || ctLearned(ch)) ? "ready" : "locked";
}

/* ---------------- what is known ---------------- */

/* Read from the deck when the tab is drawn. A character counts as met when it
   has a card of its own or is written in a word that has one — most decks
   are words, and a map that lit up only for character cards would stay
   dark for nearly everybody. */
async function ctLoadKnown(){
  const [fam, index] = await Promise.all([
    typeof familiarity === "function" ? familiarity() : {words: new Map(), chars: new Map()},
    getSearch(),
  ]);
  CT.deck = new Map(fam.chars);
  CT.famWords = new Map(fam.words);
  const met = new Map();
  if(fam.words.size){
    const spelt = CT.wordById.size ? null : new Map(index.map(r => [r[0], r[1]]));
    for(const [id, rank] of fam.words)
      for(const ch of (spelt ? spelt.get(id) : (CT.wordById.get(id) || [0, ""])[1]) || "") if((met.get(ch) || 0) < rank) met.set(ch, rank);
  }
  CT.met = met;
}
const ctKnown = h => Math.max(CT.deck.get(h) || 0, CT.met.get(h) || 0);

/* ---------------- drawing the tab ---------------- */

/* The tab in map form: called by renderChars whenever the tab is drawn or
   its level changes. */
async function renderCharTree(){
  if(typeof questRefresh === "function") await questRefresh(false);
  if(!CT.g) CT.g = ctGraph(C.all || await getChars());
  await Promise.all([ctLoadKnown(), ctLoadWords()]);
  ctWire();
  sizeCharTree();
  const want = CT.next || CT.root || S.treeRoot || "永", asked = !!CT.next;
  CT.next = "";
  const root = CT.g.by.has(want) || CT.g.kids.has(want) || ctWordRow(want) ? want : "口";
  if(root !== CT.root){ ctStart(root, {trail: asked}); return; }
  /* the same core at another level: grown again, its order follows the level */
  CT.tree = CT.word ? ctWordTree(CT.wordById.get(CT.word)) : ctGrow(CT.root);
  CT.depth = ctDepths();
  if(CT.sel && !ctPlaced(CT.sel) && !CT.sel.startsWith("w:")) CT.sel = "";
  ctRefresh();
}
/* Whether a character is somewhere in the tree as grown. */
const ctPlaced = h => h === CT.root || (!!CT.tree && CT.tree.parent.has(h));

/* Everything drawn again from what is known: after a quest, a card added,
   a level changed. What has just opened is shown opening. */
function ctRefresh(ms){
  if(!CT.tree) return;
  ctRender({ms});
  ctPaintHead();
  ctPaintInsp();
}

/* The HUD: the way back and the core; the scholar, ringed by how much of
   this map is learned. */
const ctLearnedLine = p => `${num(p.learned)} of ${num(p.total)} character${p.total === 1 ? "" : "s"} on this map learned · ${num(p.stars)} star${p.stars === 1 ? "" : "s"}`;
function ctPaintHead(){
  const title = $("#ct-title");
  if(!title || !CT.tree) return;
  const a = ctAbout(CT.root), back = CT.trail.length ? CT.trail[CT.trail.length - 1] : "";
  const wr = CT.word ? CT.wordById.get(CT.word) : null;
  title.innerHTML = (back ? `<button class="sk-back" type="button" data-ct="back" data-arg="${CT.trail.length - 1}" title="Back to ${esc(back)} (Backspace)"
        aria-label="Back to ${esc(back)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg></button>` : "")
    /* the cores walked through, in a strip that gives way before the core does */
    + (CT.trail.length ? `<span class="sk-crumbs">${CT.trail.slice(-3).map((h, i, list) =>
      `<button class="sk-crumb hz" type="button" data-ct="back" data-arg="${CT.trail.length - list.length + i}" title="Back to ${esc(h)}">${esc(h)}</button><i aria-hidden="true">›</i>`).join("")}</span>` : "")
    /* the core, pressed: shown on the map and told in the panel */
    + `<button class="sk-title-g hz${wr ? " word" : ""}" type="button" data-ct="pick" data-arg="${esc(CT.root)}" title="Show ${esc(CT.root)} on the map">${esc(CT.root)}</button>`
    + (wr ? `<span class="sk-title-t"><small>Word map</small><b>${esc(ctShort(wr[3]))} <span class="py">${esc(wr[2])}</span></b></span>`
      : `<span class="sk-title-t"><small>${a.c ? "Character map" : "Radical map"}</small><b>${esc(a.short || (a.c ? a.c.p : "component"))}${a.c ? ` <span class="py">${esc(a.c.p)}</span>` : ""}</b></span>`);
  const p = ctProgress();
  ctPaintMe(p, ctLearnedLine(p));
  ctPaintQuest();
}

/* The scholar, at the very start of the Characters tab's strip in both
   views: the level, in a ring that fills as the characters in view are
   learned — this map's on the map, the chosen level's (or all of them)
   over the grid — then the XP and the bar to the next level. The ring's
   first character already shows, however many there are; a tap says how
   many (boot.js). */
function ctPaintMe(p, line){
  const me = $("#sk-me");
  if(!me) return;
  const {xp, rank} = questInfo, into = xp % 150;
  const ring = p.total ? Math.max(p.learned ? 2 : 0, p.learned / p.total * 100).toFixed(1) : 0;
  CT.meLine = line;
  me.innerHTML = `<button class="sk-ring" type="button" style="--p:${ring}" title="${esc(line)}" aria-label="${esc(line)}">
      <span class="sk-rank" aria-hidden="true">${rank}</span></button>
    <span class="sk-me-t" title="Level ${rank} · ${esc(ctTitle(rank))} · ${num(xp)} XP in all, ${150 - into} to level ${rank + 1}"><b>Lv ${rank}<em> · ${esc(ctTitle(rank))}</em></b><small>${num(into)}<em>/150</em> XP</small>
    <span class="sk-bar" role="progressbar" aria-label="XP towards the next level" aria-valuemin="0" aria-valuemax="150" aria-valuenow="${into}"><i style="width:${(into / 150 * 100).toFixed(1)}%"></i></span></span>`;
}
/* Over the grid: the ring is the characters it shows — a level, or all. */
function ctPaintGridMe(list, level){
  if(!CT.g) return;
  const learned = list.filter(c => ctLearned(c.h)).length;
  ctPaintMe({learned, total: list.length},
    `${num(learned)} of ${num(list.length)} ${level === "all" ? "characters" : `HSK ${levelLabel(level)} characters`} learned`);
}

/* The next quest, over the map: what to learn, why, and what it is worth. */
function ctPaintQuest(){
  const box = $("#sk-q-main"), go = $("#quest-open");
  if(!box || !go) return;
  const h = CT.quest;
  if(!h){
    const p = ctProgress();
    box.innerHTML = `<span class="sk-q-done">${CT_STAR}</span><span class="sk-q-text"><small><span>${p.total ? "Map complete" : "Nothing to learn here"}</span></small>
      <b>${p.total ? `All ${num(p.total)} characters learned` : `Nothing in the syllabus is built on ${esc(CT.root)}`}</b></span>`;
    go.hidden = true;
    return;
  }
  const c = CT.g.by.get(h), kids = (CT.tree.branches.get(h) || []).length, started = questInfo.recognised.has(h);
  const why = h === CT.root ? (kids ? `opens ${num(kids)} character${kids === 1 ? "" : "s"}` : "the core")
    : kids ? `opens ${num(kids)} more` : `HSK ${levelLabel(c.lv)}`;
  box.innerHTML = `<button class="sk-q-glyph hz v${c.lv}" type="button" data-ct="pick" data-arg="${esc(h)}" title="Show ${esc(h)} on the map">${esc(h)}</button>
    <span class="sk-q-text"><small><span>Next quest</span><i>${esc(why)}</i><em class="sk-q-xp">+${ctReward(h)} XP</em></small>
      <b>${started ? "Finish" : "Learn"} <span class="hz">${esc(h)}</span> <span class="py">${esc(c.p)}</span><span class="sk-q-en"> · ${esc(ctShort(c.en[0]))}</span></b></span>`;
  go.hidden = false;
  go.textContent = started ? "Continue" : "Begin";
  go.dataset.arg = h;
}

/* The stage sized to what is left of the window, as the lists are. */
function sizeCharTree(){
  const stage = $("#ctstage"), box = $("#ctree");
  if(!stage || !stage.offsetWidth || !window.innerHeight) return;
  const wrap = document.querySelector(".wrap");
  const pad = wrap ? parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0;
  let top = -window.scrollY;
  for(let e = stage; e; e = e.offsetParent) top += e.offsetTop;
  const want = `${Math.max(360, Math.round(window.innerHeight - top - pad))}px`;
  if(stage.style.height !== want) stage.style.height = want;
  if(!box || !CT.lay) return;
  const size = box.clientWidth + "x" + box.clientHeight;
  if(size === CT.size) return;
  /* across a phone's width the map draws tighter, so it is laid out again */
  const relay = CT.size && mmPhone() !== (MM === MM_NARROW);
  CT.size = size;
  if(relay) ctRender({ms: 0});
  if(!CT.touched) mmHome(0); else mmCam();
}

/* The panel sits beside the map where the window has room for both. */
const ctDocked = () => !!window.matchMedia && matchMedia("(min-width:1100px)").matches;

/* ---------------- a new core ---------------- */

/* @param opts.trail  keep the way back: the core left behind goes on the trail
 * @param opts.keepTrail  the trail as it stands (a step back along it) */
function ctStart(root, opts = {}){
  if(opts.trail && CT.root && CT.root !== root){
    CT.trail = CT.trail.filter(h => h !== root);
    CT.trail.push(CT.root);
    if(CT.trail.length > 10) CT.trail.shift();
  }else if(!opts.keepTrail) CT.trail = [];
  const wr = ctWordRow(root);
  CT.root = root;
  CT.word = wr ? wr[0] : "";
  S.treeRoot = root; save();
  CT.tree = wr ? ctWordTree(wr) : ctGrow(root);
  CT.makes = wr ? ctWordMakes(wr) : ctMakings(root);
  CT.depth = ctDepths();
  CT.open = new Set(); CT.fold = new Map(); CT.wall = new Map();
  CT.sel = ""; CT.hover = "";
  for(const r of CT.recs.values()) r.el.remove();
  CT.recs = new Map();
  CT.touched = false;
  ctRender({ms: 0});
  ctPaintHead();
  ctPaintInsp();
  mmHome(0);
  if(typeof paintIndexRoot === "function") paintIndexRoot();
}

/* ---------------- the map's shape ---------------- */

/* The sizes the map is laid out in, in the plane's own pixels: a little
   tighter on a phone, where the core and its first tier should share the
   screen. */
const MM_WIDE = {NODE_W: 184, NODE_H: 64, ROOT_W: 244, ROOT_H: 104, PART_W: 148, PART_H: 56,
  TILE_W: 78, TILE_H: 100, CPAD: 12, CHEAD: 46, FOLD_H: 46, CMIN: 280, COLS: 5,
  WORD_W: 272, WHEAD: 44, WROW: 52, WMORE: 38, WSHOW: 6, WSTEP: 12, GAP_X: 132, GAP_Y: 18, SMALL: 8};
const MM_NARROW = {...MM_WIDE, NODE_W: 168, ROOT_W: 216, ROOT_H: 96, PART_W: 132, COLS: 3, WORD_W: 244, GAP_X: 92, GAP_Y: 14};
const mmPhone = () => { const box = $("#ctree"); return !!box && box.clientWidth > 0 && box.clientWidth < 700; };
let MM = MM_WIDE;
/* A level group stays whole up to this size of family: past it, the levels
   above the reader's next one arrive folded. */
const CT_SMALL = 30;

/* Whether a level group is open: as the reader left it; or else the one the
   next quest is in, every group of a small family, and in a big one the
   levels up to the one after the reader's. */
function mmOpen(fold, list, parent){
  if(CT.fold.has(fold)) return CT.fold.get(fold);
  if(CT.quest && list.includes(CT.quest)) return true;
  const lv = +fold.slice(fold.lastIndexOf(":") + 1);
  return (CT.tree.branches.get(parent) || []).length <= CT_SMALL || lv <= +S.level + 1;
}

/* What a character opened on the map shows to its right: what is built on it
   — a card each for a few, a group for each level for more, with any opened
   in turn pulled out as cards of their own — then the words it writes. */
function mmKids(key){
  const kids = CT.tree.branches.get(key) || [], out = [];
  const card = h => mmBox("node", h, key);
  if(kids.length <= MM.SMALL) for(const h of kids) out.push(card(h));
  else{
    for(const h of kids) if(CT.open.has(h)) out.push(card(h));
    const by = new Map();
    for(const h of kids){
      if(CT.open.has(h)) continue;
      const lv = CT.g.by.get(h).lv;
      if(!by.has(lv)) by.set(lv, []);
      by.get(lv).push(h);
    }
    for(const lv of [...by.keys()].sort((a, b) => +a - +b)){
      const list = by.get(lv).sort((a, b) => ctRank(a) - ctRank(b)), fold = `lv:${key}:${lv}`;
      out.push({type: "cluster", key: `c:${key}:${lv}`, parent: key, lv, list, fold, open: mmOpen(fold, list, key), kids: []});
    }
  }
  /* A radical's map shows every character the radical has: those filed under
     it in the dictionary but not drawn with it — 最 is filed under 曰 and
     drawn with 日 — come after the rest, in a group of their own. */
  if(key === CT.root){
    const filed = mmFiled();
    if(filed.length){
      const fold = `lv:${key}:filed`;
      out.push({type: "cluster", key: `c:${key}:filed`, parent: key, lv: "", list: filed, fold, filed: true,
        open: CT.fold.has(fold) ? CT.fold.get(fold) : true, kids: []});
    }
  }
  if(CT.g.by.has(key) && ctWordsOf(key).length) out.push({type: "words", key: `wb:${key}`, parent: key, owner: key, kids: []});
  return out;
}
/* The radical picked in the index, where the map grows from it (radicals.js). */
function mmRadical(){
  if(typeof RX === "undefined" || !S.charRad || !RX.by.has(S.charRad)) return null;
  return rxRootOf(S.charRad) === CT.root ? RX.by.get(S.charRad) : null;
}
/* Its characters that the map does not otherwise reach. */
function mmFiled(){
  const r = mmRadical();
  if(!r) return [];
  return r.chars.filter(h => h !== CT.root && CT.g.by.has(h) && !CT.tree.parent.has(h))
    .sort((a, b) => +CT.g.by.get(a).lv - +CT.g.by.get(b).lv || ctRank(a) - ctRank(b));
}
function mmBox(type, h, parent){
  return {type, key: h, parent, kids: type === "root" || CT.open.has(h) ? mmKids(h) : []};
}
/* What can be opened on a character: what is built on it, and its words. */
const mmMore = h => (CT.tree.branches.get(h) || []).length + (CT.g.by.has(h) ? ctWordsOf(h).length : 0);

/* The layout: a horizontal tidy tree. Each box's family is stacked in the
   next column and the box sits at its middle — or, for a family taller than
   a screen, at its top, so a big tree reads from the top down. Columns are
   as wide as their widest box. A word is listed once, under the first
   character on the map to write it, and linked from every other character
   on the map that does. */
function mmLayout(){
  MM = mmPhone() ? MM_NARROW : MM_WIDE;
  if(CT.word) return mmWordLayout();
  const root = mmBox("root", CT.root, null), placed = new Set();
  root.depth = 0;
  /* breadth first, so a word goes to the character nearest the core */
  const queue = [root];
  for(let i = 0; i < queue.length; i++){
    const b = queue[i];
    if(b.type === "words"){
      const rows = ctWordsOf(b.owner).filter(r => !placed.has(r[0]));
      b.total = ctWordsOf(b.owner).length;
      b.more = rows.length;
      b.rows = rows.slice(0, CT.wall.get(b.owner) || MM.WSHOW);
      b.empty = !b.rows.length;
      for(const r of b.rows) placed.add(r[0]);
    }
    for(const k of b.kids){ k.depth = b.depth + 1; queue.push(k); }
  }
  /* a list whose every word is already shown elsewhere goes */
  const all = queue.filter(b => !b.empty);
  for(const b of all) b.kids = b.kids.filter(k => !k.empty);
  /* sizes */
  for(const b of all){
    if(b.type === "root"){ b.w = MM.ROOT_W; b.h = MM.ROOT_H; }
    else if(b.type === "node"){ b.w = MM.NODE_W; b.h = MM.NODE_H; }
    else if(b.type === "cluster"){
      b.cols = Math.min(MM.COLS, b.list.length);
      b.w = Math.max(MM.CMIN, MM.CPAD * 2 + b.cols * MM.TILE_W);
      b.h = b.open ? MM.CHEAD + Math.ceil(b.list.length / b.cols) * MM.TILE_H + MM.CPAD : MM.FOLD_H;
    }else{
      b.w = MM.WORD_W;
      b.h = MM.WHEAD + b.rows.length * MM.WROW + (b.more > b.rows.length || b.rows.length > MM.WSHOW ? MM.WMORE : 0) + 6;
    }
  }
  /* Where everything goes: the engine lays the tree out (map.rs), three
     times quicker than doing it here. Breadth first, each box after the one
     it hangs from: [what it hangs from + 1, width, height]. */
  const at = new Map(all.map((b, i) => [b.key, i]));
  const ptr = webEngine.input(all.length * 3);
  const buf = new Uint16Array(webEngine.memory.buffer, ptr, all.length * 3);
  all.forEach((b, i) => { buf[3 * i] = b.parent == null ? 0 : at.get(b.parent) + 1; buf[3 * i + 1] = b.w; buf[3 * i + 2] = b.h; });
  /* the call first: it can grow the engine's memory, which the view must be taken after */
  const len = webEngine.map_layout(MM.GAP_X, MM.GAP_Y, 560);
  const xy = new Int32Array(webEngine.memory.buffer, webEngine.output(), len);
  all.forEach((b, i) => { b.x = xy[2 * i]; b.y = xy[2 * i + 1]; });
  const colX = [];
  for(const b of all) colX[b.depth] = b.x;
  /* what the core is built from, stacked to its left */
  const parts = (CT.makes.get(CT.root) || []).map(p => ({type: "part", key: `p:${p}`, ch: p, depth: -1, w: MM.PART_W, h: MM.PART_H, kids: []}));
  const partsH = parts.reduce((n, p, i) => n + p.h + (i ? MM.GAP_Y : 0), 0);
  let py = root.y + root.h / 2 - partsH / 2;
  for(const p of parts){ p.x = -(MM.PART_W + MM.GAP_X * .72); p.y = py; py += p.h + MM.GAP_Y; all.push(p); }

  const boxes = new Map(all.map(b => [b.key, b]));
  const links = [];
  for(const b of all){
    if(b.type === "part") links.push({a: b.key, b: root.key, kind: "p"});
    else if(b.parent != null) links.push({a: b.parent, b: b.key, kind: b.type === "words" ? "w" : b.type === "cluster" ? "c" : "t",
      pill: b.type === "node" ? ctRecipe(b.key, b.parent) : "", trunk: boxes.get(b.parent).kids.length >= 4});
  }
  /* the words' other characters on the map: where paths meet */
  for(const b of all){
    if(b.type !== "words") continue;
    b.rows.forEach((r, i) => {
      for(const ch of new Set(r[1])){
        const src = boxes.get(ch);
        if(ch !== b.owner && src && (src.type === "node" || src.type === "root")) links.push({a: ch, b: b.key, row: i, kind: "m"});
      }
    });
  }
  /* each column's name, over its top */
  const cols = [];
  const tops = new Map();
  for(const b of all) tops.set(b.depth, Math.min(tops.has(b.depth) ? tops.get(b.depth) : Infinity, b.y));
  for(const [d, y] of tops){
    const words = all.some(b => b.depth === d && b.type === "words"), chars = all.some(b => b.depth === d && (b.type === "node" || b.type === "cluster"));
    const name = d < 0 ? "Built from" : d === 0 ? (CT.g.by.has(CT.root) ? "Core character" : "Radical") : chars ? `Tier ${ctRoman(d)}${words ? " · words" : ""}` : "Words";
    cols.push({d, x: d < 0 ? parts[0].x : colX[d], y: y - 34, name});
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const b of all){ x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return {root, boxes, links, cols, ext: {x0, y0: y0 - 40, x1, y1, w: x1 - x0, h: y1 - y0 + 40}};
}

/* A word's map, left to right the way it is built: each character's parts,
   the character, the word — then the longer words it is written in. Each
   character with its parts is a group of its own, stacked down the map; the
   word sits level with the middle of its characters. */
function mmWordLayout(){
  const r = CT.wordById.get(CT.word), word = CT.root, chars = [...new Set(word)];
  const all = [], links = [];
  const CX = MM.PART_W + Math.round(MM.GAP_X * .72), WX = CX + MM.NODE_W + MM.GAP_X;
  const wide = Math.max(MM.ROOT_W + 24, 196 + [...word].length * 36);
  const root = {type: "root", word: r, key: word, parent: null, depth: 0, kids: [], w: wide, h: MM.ROOT_H, x: WX, y: 0};
  const centres = [];
  let y = 0;
  for(const ch of chars){
    const parts = CT.makes.get(ch) || [];
    const partsH = parts.length ? parts.length * MM.PART_H + (parts.length - 1) * MM.GAP_Y : 0;
    const groupH = Math.max(MM.NODE_H, partsH);
    /* a character with no entry of its own is shown as the part it is */
    const node = CT.g.by.has(ch)
      ? {type: "node", key: ch, parent: word, depth: -1, kids: [], w: MM.NODE_W, h: MM.NODE_H, x: CX, y: y + (groupH - MM.NODE_H) / 2}
      : {type: "part", key: `p:${ch}`, ch, of: "", parent: word, depth: -1, kids: [], w: MM.PART_W, h: MM.PART_H, x: CX, y: y + (groupH - MM.PART_H) / 2};
    all.push(node);
    links.push({a: node.key, b: word, kind: "t"});
    centres.push(node.y + node.h / 2);
    let py = y + (groupH - partsH) / 2;
    for(const p of parts){
      const pb = {type: "part", key: `p:${ch}:${p}`, ch: p, of: ch, parent: node.key, depth: -2, kids: [], w: MM.PART_W, h: MM.PART_H, x: 0, y: py};
      all.push(pb);
      links.push({a: pb.key, b: node.key, kind: "p"});
      py += MM.PART_H + MM.GAP_Y;
    }
    y += groupH + Math.round(MM.GAP_Y * 2.4);
  }
  root.y = Math.round((centres[0] + centres[centres.length - 1]) / 2 - root.h / 2);
  all.push(root);
  const rows = ctWordsWith(word);
  if(rows.length){
    const shown = rows.slice(0, CT.wall.get(word) || MM.WSHOW);
    const wb = {type: "words", key: `wb:${word}`, owner: word, parent: word, depth: 1, kids: [], rows: shown, total: rows.length, more: rows.length,
      w: MM.WORD_W, x: WX + wide + MM.GAP_X, y: Math.round(root.y + root.h / 2 - MM.WHEAD / 2)};
    wb.h = MM.WHEAD + shown.length * MM.WROW + (rows.length > shown.length || shown.length > MM.WSHOW ? MM.WMORE : 0) + 6;
    root.kids.push(wb);
    all.push(wb);
    links.push({a: word, b: wb.key, kind: "w"});
  }
  const boxes = new Map(all.map(b => [b.key, b]));
  const names = {"-2": "Built from", "-1": chars.length === 1 ? "Character" : "Characters", 0: ctEveryday(r) ? "Everyday word" : "Word", 1: "In longer words"};
  const tops = new Map();
  for(const b of all) if(!tops.has(b.depth) || b.y < tops.get(b.depth).y) tops.set(b.depth, b);
  const cols = [...tops].map(([d, b]) => ({d, x: b.x, y: b.y - 34, name: names[d]}));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const b of all){ x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return {root, boxes, links, cols, ext: {x0, y0: y0 - 40, x1, y1, w: x1 - x0, h: y1 - y0 + 40}};
}

/* ---------------- the boxes ---------------- */

const mmStars = n => `<span class="mm-stars" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}">${CT_STAR}</i>`).join("")}</span>`;
const mmLock = `<span class="mm-lock" aria-hidden="true">${CT_LOCK}</span>`;
const mmBang = `<span class="mm-bang" aria-hidden="true">!</span>`;
/* what a character card or tile says when read aloud */
function mmSay(h){
  const a = ctAbout(h), c = a.c, st = ctState(h), p = CT.tree.parent.get(h);
  return `${h}${c ? ` ${c.p}` : ""}, ${a.short || "component"}. ${CT_STATES[st]}${c ? `, HSK ${levelLabel(c.lv)}` : ""}${
    st === "locked" && p ? `. Learn ${p} to open it` : ""}${h === CT.quest ? ". Next quest" : ""}`;
}
/* the knob that opens a character on the map: how much it would show */
function mmKnob(h, cls = "mm-knob"){
  const n = mmMore(h), open = CT.open.has(h);
  if(!n) return "";
  const kids = (CT.tree.branches.get(h) || []).length;
  return `<button class="${cls}${kids ? " has" : ""}" type="button" data-ct="toggle" data-arg="${esc(h)}" aria-expanded="${open}"
    title="${open ? "Fold" : "Show"} what ${esc(h)} builds${kids ? ` (${kids} character${kids === 1 ? "" : "s"})` : ""} and its words">${open ? "−" : kids ? `+${kids}` : "›"}</button>`;
}

/* The word at the core of a word's map. */
function mmWordRootHTML(b){
  const r = b.word, st = ctWordState(r), daily = ctEveryday(r), n = [...r[1]].length, p = ctProgress();
  return {cls: `mm-box mm-root mm-wroot ${st === "known" ? "learned" : st}`,
    html: `<button class="mm-card" type="button" data-k="${esc(b.key)}" aria-label="${esc(`${r[1]} ${r[2]}, ${r[3]}. Built from ${[...new Set(r[1])].join(" and ")}`)}">
      <span class="mm-gem mm-wgem n${Math.min(n, 4)}"><b class="hz">${esc(r[1])}</b></span>
      <span class="mm-txt"><small class="mm-kick">${daily ? "Everyday word" : "Word"}</small><b class="mm-name">${esc(ctShort(r[3]))}</b>
        <span class="mm-sub"><i class="py">${esc(r[2])}</i>${daily ? "" : `<span class="mm-wlv v${esc(r[4])}">HSK ${esc(levelLabel(r[4]))}</span>`}</span>
        <span class="mm-wprog">${num(p.learned)} of ${num(p.total)} learned</span></span></button>`};
}

function mmBoxHTML(b){
  if(b.type === "root" && b.word) return mmWordRootHTML(b);
  if(b.type === "root" || b.type === "node"){
    const h = b.key, a = ctAbout(h), c = a.c, st = ctState(h), root = b.type === "root";
    const p = root ? ctProgress() : null;
    const gem = `<span class="mm-gem">${root ? `<span class="mm-ring" style="--p:${p.pct}" aria-hidden="true"></span>` : ""}<b class="hz">${esc(h)}</b>${
      st === "locked" ? mmLock : ""}${h === CT.quest ? mmBang : ""}</span>`;
    const txt = root
      ? `<span class="mm-txt"><small class="mm-kick">${c ? "Core" : "Radical"}</small><b class="mm-name">${esc(a.short || "component")}</b>
          <span class="mm-sub">${c ? `<i class="py">${esc(c.p)}</i>${mmStars(ctStars(h))}` : `<i>${num(p.total)} characters</i>`}</span></span>`
      : `<span class="mm-txt"><span class="mm-l1"><i class="py">${esc(c.p)}</i>${mmStars(ctStars(h))}</span><span class="mm-l2">${esc(a.short)}</span></span>`;
    return {cls: `mm-box mm-${b.type} ${st}${c ? ` v${c.lv}` : ""}`,
      html: `<button class="mm-card" type="button" data-k="${esc(h)}" aria-label="${esc(mmSay(h))}">${gem}${txt}</button>${root || CT.word ? "" : mmKnob(h)}`};
  }
  if(b.type === "part"){
    const h = b.ch, a = ctAbout(h), of = b.of ?? CT.root, role = ctRole(of, h);
    /* what the part means in the character it is part of (尔 in 你 is "you"), else on its own */
    const g = ((CT.g.by.get(of) || {comp: []}).comp.find(p => p.c === h) || {}).g || a.short;
    return {cls: "mm-box mm-part", html: `<button class="mm-card" type="button" data-ct="grow" data-arg="${esc(h)}" title="Make ${esc(h)} the core of the map">
      <span class="mm-gem"><b class="hz">${esc(h)}</b></span><span class="mm-txt"><b class="mm-name">${esc(ctShort(g) || "component")}</b>
      <small>${role ? ctRoleText(role) : a.c ? esc(a.c.p) : "component"}</small></span></button>`};
  }
  if(b.type === "cluster"){
    const k = b.list.filter(ctLearned).length, mine = +S.level, lv = +b.lv;
    const tag = b.filed ? "the rest of its dictionary family" : lv === mine ? "Your level" : lv < mine ? "Below your level" : lv === mine + 1 ? "Next level" : "Ahead";
    const head = `<button class="mm-chead" type="button" data-ct="fold" data-arg="${esc(b.fold)}" aria-expanded="${b.open}">
      <i class="mm-cdot" aria-hidden="true"></i><b>${b.filed ? `Also filed under <span class="hz">${esc(mmRadical().f)}</span>` : `HSK ${esc(levelLabel(b.lv))}`}</b><span class="mm-ctag">${tag}</span>
      <span class="mm-cn">${k}<small>/${b.list.length}</small></span>
      <svg class="mm-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`;
    const tiles = b.open ? `<div class="mm-tiles" style="grid-template-columns:repeat(${b.cols}, ${MM.TILE_W}px)">${b.list.map(h => {
      const c = CT.g.by.get(h), st = ctState(h), rec = ctRecipe(h, b.parent);
      return `<div class="mm-tw"><button class="mm-tile ${st} v${c.lv}" type="button" data-k="${esc(h)}" aria-label="${esc(mmSay(h))}"
          title="${esc(h)} ${esc(c.p)} · ${esc(ctShort(c.en[0]))}${rec ? ` · ${esc(b.parent)} ${esc(rec)}` : ""}">
        <span class="mm-gem"><b class="hz">${esc(h)}</b><i class="py">${esc(c.p)}</i>${st === "locked" ? mmLock : ""}${h === CT.quest ? mmBang : ""}</span>
        ${mmStars(ctStars(h))}<span class="mm-l2">${esc(ctShort(c.en[0]))}</span></button>${b.filed ? "" : mmKnob(h, "mm-knob mm-tknob")}</div>`;
    }).join("")}</div>` : "";
    return {cls: `mm-box mm-cluster v${b.lv}${b.open ? "" : " shut"}${b.filed ? " filed" : ""}`, html: head + tiles};
  }
  const shared = b.total - b.more;
  const rows = b.rows.map(r => {
    const st = ctWordState(r), daily = ctEveryday(r);
    const mark = st === "mastered" ? CT_STAR : st === "known" ? CT_TICK : st === "locked" ? CT_LOCK : "";
    return `<button class="mm-word ${st}${daily ? " daily" : ""}" type="button" data-k="w:${esc(r[0])}"
        title="${esc(r[1])} ${esc(r[2])} · ${esc(r[3])}${daily ? " · an everyday word, not on the HSK list" : ""}">
      <span class="mm-wmark" aria-hidden="true">${mark}</span><span class="mm-wl1"><b class="hz">${mmCombo(r[1], b.owner)}</b><i class="py">${esc(r[2])}</i></span>
      <span class="mm-wl2">${esc(r[3])}</span>${daily ? `<span class="mm-wlv daily v${esc(r[4])}">Everyday</span>` : `<span class="mm-wlv v${esc(r[4])}">HSK ${esc(levelLabel(r[4]))}</span>`}</button>`;
  }).join("");
  /* a long list opens a dozen at a time, and folds back to its first few */
  const left = b.more - b.rows.length;
  const more = left > 0 ? `<button class="mm-wmore" type="button" data-ct="words" data-arg="${esc(b.owner)}">Show ${num(Math.min(left, MM.WSTEP))} more <small>· ${num(left)} left</small></button>`
    : b.rows.length > MM.WSHOW ? `<button class="mm-wmore" type="button" data-ct="words" data-arg="${esc(b.owner)}">Show fewer</button>` : "";
  return {cls: "mm-box mm-words", html: `<div class="mm-whead"><span class="mm-wkick">Words</span><b class="hz">${esc(b.owner)}</b>
    <span class="mm-wn">${num(b.total)}${shared ? ` · ${num(shared)} shown elsewhere` : ""}</span></div>
    <div class="mm-wrows">${rows}</div>${more}`};
}
/* A word with the character it is listed under picked out: 你好 under 你
   reads as 你 + 好, the combination it is. */
function mmCombo(word, owner){
  const at = [...owner].length > 1 ? word.indexOf(owner) : -1;
  if(at >= 0) return `${esc(word.slice(0, at))}<i class="mm-own">${esc(owner)}</i>${esc(word.slice(at + owner.length))}`;
  return [...word].map(ch => ch === owner ? `<i class="mm-own">${esc(ch)}</i>` : esc(ch)).join("");
}

/* ---------------- drawing the map ---------------- */

/* Lays the map out and draws it: new boxes grow out of the box they come
   from, the others glide to their new places, and the camera holds still
   whatever was pressed (opts.anchor). */
function ctRender(opts = {}){
  const plane = $("#ct-plane");
  if(!plane || !CT.tree) return;
  CT.quest = ctNextQuest();
  const states = new Map(ctMembers().map(h => [h, ctState(h)]));
  const before = CT.seen && CT.seen.root === CT.root ? CT.seen.states : null;
  CT.seen = {root: CT.root, states};
  const opened = before ? [...states].filter(([h, s]) => s === "ready" && before.get(h) === "locked").map(([h]) => h) : [];
  const rose = before ? [...states].filter(([h, s]) => (s === "learned" || s === "mastered") && before.get(h) !== s).map(([h]) => h) : [];

  /* where the anchor is on screen now, to keep it there */
  const anchor = opts.anchor && mmItemBox(opts.anchor);
  const lay = mmLayout();
  CT.lay = lay;
  const host = $("#mm-boxes"), next = new Map();
  const reduced = REDUCED(), ms = opts.ms ?? (reduced ? 0 : 420);
  for(const b of lay.boxes.values()){
    const {cls, html} = mmBoxHTML(b);
    let r = CT.recs.get(b.key);
    if(!r){
      const el = document.createElement("div");
      el.dataset.box = b.key;
      host.appendChild(el);
      /* a new box grows out of the one it comes from */
      const from = b.parent != null && CT.recs.get(b.parent);
      r = {el, key: b.key, x: from ? from.x + (from.w || 0) - b.w * .5 : b.x, y: from ? from.y + (from.h || 0) / 2 - b.h / 2 : b.y, cls: "", html: "", born: true};
      if(ms) el.style.opacity = "0";
    }
    if(r.cls !== cls){ r.el.className = cls; r.cls = cls; }
    if(r.html !== html){ r.el.innerHTML = html; r.html = html; }
    r.el.style.width = b.w + "px"; r.el.style.height = b.h + "px";
    r.w = b.w; r.h = b.h; r.tx = b.x; r.ty = b.y; r.b = b;
    next.set(b.key, r);
  }
  for(const [k, r] of CT.recs) if(!next.has(k)){
    r.el.classList.add("gone");
    if(ms) setTimeout(() => r.el.remove(), 220); else r.el.remove();
  }
  CT.recs = next;
  mmPaintCols();
  /* the camera follows the anchor */
  let cam = null;
  if(anchor){
    const now = mmItemBox(opts.anchor, true);
    if(now){
      const k = CT.cam.k;
      cam = {x: CT.cam.x + (anchor.x - now.x) * k, y: CT.cam.y + (anchor.y - now.y) * k, k};
      if(opts.reveal) cam = mmReveal(opts.anchor, cam);
    }
  }
  mmTween(ms, cam);
  mmMarkKin();
  if(!reduced && !($("#quest") && $("#quest").open)){
    requestAnimationFrame(() => {
      for(const h of opened) mmItemEl(h)?.classList.add("opened-now");
      for(const h of rose) mmItemEl(h)?.classList.add("learned-now");
    });
  }
  if(opened.length && !($("#quest") && $("#quest").open))
    toast(`Unlocked ${opened.length} new character${opened.length === 1 ? "" : "s"}: ${opened.slice(0, 8).join(" ")}${opened.length > 8 ? " …" : ""}`);
}

/* The element a character or word is drawn as: its card, or its tile in a
   level group, or its row in a word list. */
function mmItemEl(key){
  return $("#mm-boxes").querySelector(`[data-k="${CSS.escape(key)}"]`);
}
/* Where an item is in the plane — as drawn now, or (target) once the boxes
   have settled. */
function mmItemBox(key, target){
  const el = mmItemEl(key);
  if(!el) return null;
  const host = el.closest("[data-box]"), r = host && CT.recs.get(host.dataset.box);
  if(!r) return null;
  const x = target ? r.tx : r.x, y = target ? r.ty : r.y;
  let ox = 0, oy = 0;
  for(let e = el; e && e !== host; e = e.offsetParent){ ox += e.offsetLeft; oy += e.offsetTop; }
  return {x: x + ox, y: y + oy, w: el.offsetWidth, h: el.offsetHeight};
}

/* The camera moved so that what was just opened shows, as far as it can
   without losing the thing opened off the left edge. */
function mmReveal(key, cam){
  const box = $("#ctree"), b = CT.lay.boxes.get(key);
  if(!box || !b || !b.kids.length) return cam;
  let right = 0;
  const walk = x => { right = Math.max(right, x.x + x.w); for(const k of x.kids) walk(k); };
  walk(b);
  const W = box.clientWidth - (ctDocked() ? 0 : 0), k = cam.k;
  const over = cam.x + right * k - (W - 48);
  if(over > 0) cam.x -= Math.min(over, cam.x + b.x * k - 24);
  return cam;
}

/* Every box from where it is drawn to where it belongs, the links redrawn
   from them on every frame; the camera too, where it moves with them. */
function mmTween(ms, cam){
  cancelAnimationFrame(CT.anim);
  const recs = [...CT.recs.values()];
  const from = recs.map(r => [r.x, r.y]), c0 = {...CT.cam};
  const step = t => {
    const p = ms ? Math.min(1, t / ms) : 1, e = 1 - Math.pow(1 - p, 3);
    recs.forEach((r, i) => {
      r.x = from[i][0] + (r.tx - from[i][0]) * e;
      r.y = from[i][1] + (r.ty - from[i][1]) * e;
      r.el.style.transform = `translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)`;
      if(r.born){ r.el.style.opacity = String(Math.min(1, p * 1.6)); if(p === 1){ r.born = false; r.el.style.opacity = ""; } }
    });
    if(cam){
      CT.cam.x = c0.x + (cam.x - c0.x) * e; CT.cam.y = c0.y + (cam.y - c0.y) * e; CT.cam.k = c0.k + (cam.k - c0.k) * e;
      mmCam();
    }
    mmLinks();
    if(p < 1) return true;
    mmMapSoon();
    return false;
  };
  if(!ms){ step(0); return; }
  const start = performance.now();
  const frame = now => { if(step(now - start)) CT.anim = requestAnimationFrame(frame); };
  CT.anim = requestAnimationFrame(frame);
}

/* The links, from the boxes as they are drawn now: from the right of what a
   thing comes from into the left of it — into a level group or a word list
   at its name — with the recipe on it just short of a character. A box with
   a few things after it fans out in curves; one with more runs a trunk down
   beside them and branches off it with rounded corners, so the links do not
   pile up at its edge. Where a word meets another of its characters the
   link is dashed. What is lit is drawn last, over the rest. */
function mmLinks(){
  const svg = $("#mm-links"), lay = CT.lay;
  if(!svg || !lay) return;
  const hot = CT.hotLinks || new Set();
  const f = n => n.toFixed(1);
  let paths = "", lit = "", dots = "", pills = "";
  for(const l of lay.links){
    const A = CT.recs.get(l.a), B = CT.recs.get(l.b);
    if(!A || !B) continue;
    const back = l.kind === "m" && A.x + A.w / 2 > B.x + B.w / 2;
    const ax = back ? A.x : A.x + A.w, ay = A.y + A.h / 2;
    const by = B.y + (l.kind === "c" ? MM.CHEAD / 2 : l.kind === "w" ? MM.WHEAD / 2
      : l.kind === "m" ? MM.WHEAD + l.row * MM.WROW + MM.WROW / 2 : B.h / 2);
    const bx = back ? B.x + B.w : B.x, on = hot.has(l);
    let d, seg;
    if(l.trunk && Math.abs(by - ay) > 1){
      const mx = ax + Math.min(56, (bx - ax) * .4), s = by > ay ? 1 : -1;
      const r = Math.min(14, Math.abs(by - ay) / 2, (bx - mx) / 2);
      d = `M${f(ax)} ${f(ay)}H${f(mx - r)}Q${f(mx)} ${f(ay)} ${f(mx)} ${f(ay + s * r)}V${f(by - s * r)}Q${f(mx)} ${f(by)} ${f(mx + r)} ${f(by)}H${f(bx)}`;
      seg = mx + r;
    }else{
      const dx = Math.max(36, Math.abs(bx - ax) * .5) * (back ? -1 : 1);
      d = `M${f(ax)} ${f(ay)}C${f(ax + dx)} ${f(ay)} ${f(bx - dx)} ${f(by)} ${f(bx)} ${f(by)}`;
      seg = ax + (bx - ax) * .5;
    }
    const path = `<path class="mm-link ${l.kind}${on ? " hot" : ""}${l.kind === "t" && ctState(l.b) === "locked" ? " locked" : ""}" d="${d}"/>`;
    if(on) lit += path; else paths += path;
    if(l.kind !== "m" && l.kind !== "p") dots += `<circle class="mm-dot${on ? " hot" : ""}" cx="${f(bx)}" cy="${f(by)}" r="3.5"/>`;
    if(l.pill){
      /* on the last straight stretch, short of the character */
      const w = 16 + [...l.pill].length * 13, x = Math.max((seg + bx) / 2, bx - 24 - w / 2);
      pills += `<g class="mm-pill${on ? " hot" : ""}" transform="translate(${f(x)} ${f(by)})"><rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="11"/><text y="4.5">${esc(l.pill)}</text></g>`;
    }
  }
  svg.innerHTML = paths + lit + dots + pills;
}

/* Each column's name over its top. */
function mmPaintCols(){
  const host = $("#mm-cols");
  if(!host || !CT.lay) return;
  host.innerHTML = CT.lay.cols.map(c => `<span class="mm-col" style="transform:translate(${c.x}px,${c.y}px)">${esc(c.name)}</span>`).join("");
}

/* What is picked or under the pointer, and the way back to the core from
   it, lit: the boxes on the way, the links between them; for a word, every
   character on the map it is written with. */
function mmMarkKin(){
  const board = $("#mm-boxes");
  if(!board || !CT.lay) return;
  const focus = CT.hover || CT.sel, lit = new Set(), kin = new Set(), hot = new Set();
  if(focus){
    if(focus.startsWith("w:")){
      const r = CT.wordById.get(focus.slice(2));
      if(r) for(const ch of new Set(r[1])) kin.add(ch);
      const host = mmItemEl(focus)?.closest("[data-box]")?.dataset.box;
      for(const l of CT.lay.links) if(l.b === host && (l.kind === "w" || (l.kind === "m" && kin.has(l.a)))) hot.add(l);
      let k = host && CT.lay.boxes.get(host);
      for(let up = k && k.parent; up != null; up = CT.lay.boxes.get(up)?.parent) lit.add(up);
    }else{
      /* the way to the core: the character, the group it sits in, its parents */
      let key = focus;
      const into = new Set([focus]);
      while(key != null){
        const b = CT.lay.boxes.get(key);
        const holder = b ? key : [...CT.lay.boxes.values()].find(x => x.type === "cluster" && x.list.includes(key))?.key;
        if(holder) into.add(holder);
        const p = CT.tree.parent.get(key);
        if(p === undefined) break;
        lit.add(p); into.add(p);
        key = p;
      }
      if(CT.word) for(const b of CT.lay.boxes.values()) if(b.type === "part" && (b.of === focus || focus === CT.root)) into.add(b.key);
      if(CT.word && focus === CT.root) for(const k of CT.tree.branches.get(focus) || []) into.add(k);
      for(const l of CT.lay.links) if(l.kind !== "m" && into.has(l.a) && into.has(l.b)) hot.add(l);
      for(const k of CT.tree.branches.get(focus) || []) kin.add(k);
    }
  }
  CT.hotLinks = hot;
  for(const el of board.querySelectorAll("[data-k]")){
    const k = el.dataset.k;
    el.classList.toggle("sel", k === CT.sel);
    el.classList.toggle("hov", k === CT.hover && k !== CT.sel);
    el.classList.toggle("lit", lit.has(k));
    el.classList.toggle("kin", kin.has(k));
    el.setAttribute("aria-pressed", String(k === CT.sel));
  }
  mmLinks();
}

/* ---------------- the camera ---------------- */

const CT_ZMIN = .28, CT_ZMAX = 1.8;
/* The room kept round the map, in screen pixels: about an eighth of the
   view at each side and corner (56–140px across, 48–120px down), and below
   the next quest's card at the top — so the map has space to breathe, but
   not so much that it can be lost in empty canvas. */
function mmEdges(){
  const box = $("#ctree"), W = box ? box.clientWidth : 0, H = box ? box.clientHeight : 0;
  return {mx: clamp(Math.round(W * .12), 56, 140), my: clamp(Math.round(H * .12), 48, 120),
    top: Math.round(Math.min(mmTop(), H * .4)) + 16};
}
/* The view kept on the map: a map wider (or taller) than the window pans
   until its edge is that room in from the window's, and no further; one
   that fits stays whole in view. Every move of the camera — a drag, the
   wheel, a pinch, a glide, the small map, a step shown — comes through
   here. Returns whether it had to hold the view back. */
function mmClamp(){
  const box = $("#ctree"), e = CT.lay && CT.lay.ext;
  if(!box || !e || !box.clientWidth) return false;
  const {x, y, k} = CT.cam, W = box.clientWidth, H = box.clientHeight, {mx, my, top} = mmEdges();
  const ax = mx - e.x0 * k, bx = W - mx - e.x1 * k;
  const ay = top - e.y0 * k, by = H - my - e.y1 * k;
  CT.cam.x = clamp(x, Math.min(ax, bx), Math.max(ax, bx));
  CT.cam.y = clamp(y, Math.min(ay, by), Math.max(ay, by));
  return CT.cam.x !== x || CT.cam.y !== y;
}
function mmCam(){
  const plane = $("#ct-plane"), box = $("#ctree");
  if(!plane) return;
  CT.held = mmClamp();
  const {x, y, k} = CT.cam;
  plane.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
  box.style.backgroundPosition = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  /* the dots spread out as the view draws back, rather than crowding */
  const dot = 24 * k * (k < .5 ? 2 : 1);
  box.style.backgroundSize = `${dot.toFixed(2)}px ${dot.toFixed(2)}px`;
  box.classList.toggle("far", k < .55);
  mmMapSoon();
}
/* Where the view rests: the whole map where it reads at that size; else the
   core and the start of its first tier, at a size that reads. */
function mmHome(ms = 420){
  const box = $("#ctree"), lay = CT.lay;
  if(!box || !lay || !box.clientWidth) return;
  const W = box.clientWidth, H = box.clientHeight, top = mmTop(), e = lay.ext;
  const fit = Math.min((W - 64) / e.w, (H - top - 40) / e.h, 1);
  let cam;
  if(fit >= (mmPhone() ? .62 : .72)) cam = {k: fit, x: (W - e.w * fit) / 2 - e.x0 * fit, y: top + (H - top - e.h * fit) / 2 - e.y0 * fit};
  else{
    /* too big to read whole: from its top left — what the core is built
       from, the core, and the start of its first tier */
    const phone = mmPhone(), k = phone ? .74 : 1;
    /* on a phone the core comes first, its first tier showing at the edge,
       and what it is built from a swipe away to the left */
    cam = {k, x: phone && !CT.word ? 10 - lay.root.x * k : 32 - e.x0 * k, y: top + 12 - e.y0 * k};
  }
  mmCamTo(cam, ms);
}
/* the room the next quest takes over the map's top */
const mmTop = () => { const q = $("#sk-quest"); return q && q.offsetParent ? q.offsetTop + q.offsetHeight + 8 : 16; };
function mmFit(ms = 420){
  const box = $("#ctree"), e = CT.lay && CT.lay.ext;
  if(!box || !e) return;
  const W = box.clientWidth, H = box.clientHeight, top = mmTop();
  const k = clamp(Math.min((W - 64) / e.w, (H - top - 40) / e.h), CT_ZMIN, 1.2);
  mmCamTo({k, x: (W - e.w * k) / 2 - e.x0 * k, y: top + (H - top - e.h * k) / 2 - e.y0 * k}, ms);
}
function mmCamTo(to, ms = 420){
  cancelAnimationFrame(CT.camAnim);
  if(!ms || REDUCED()){ Object.assign(CT.cam, to); mmCam(); return; }
  const c0 = {...CT.cam}, start = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
    CT.cam.x = c0.x + (to.x - c0.x) * e; CT.cam.y = c0.y + (to.y - c0.y) * e; CT.cam.k = c0.k + (to.k - c0.k) * e;
    mmCam();
    if(p < 1) CT.camAnim = requestAnimationFrame(frame);
  };
  CT.camAnim = requestAnimationFrame(frame);
}
function mmStopCam(){ cancelAnimationFrame(CT.camAnim); cancelAnimationFrame(CT.glide); }
function mmZoomAt(px, py, k){
  k = clamp(k, CT_ZMIN, CT_ZMAX);
  const wx = (px - CT.cam.x) / CT.cam.k, wy = (py - CT.cam.y) / CT.cam.k;
  CT.cam.k = k; CT.cam.x = px - wx * k; CT.cam.y = py - wy * k;
  mmCam();
}
function mmZoomBy(f){
  const box = $("#ctree");
  CT.touched = true;
  const k = clamp(CT.cam.k * f, CT_ZMIN, CT_ZMAX), px = box.clientWidth / 2, py = box.clientHeight / 2;
  const wx = (px - CT.cam.x) / CT.cam.k, wy = (py - CT.cam.y) / CT.cam.k;
  mmCamTo({k, x: px - wx * k, y: py - wy * k}, 220);
}
/* An item brought into view, centred where it is off the screen. */
function mmShow(key, ms = 420){
  const box = $("#ctree"), it = mmItemBox(key, true);
  if(!box || !it) return;
  const {x, y, k} = CT.cam, W = box.clientWidth, top = mmTop();
  /* over a phone's map the panel takes the lower half: shown above it */
  let H = box.clientHeight;
  const insp = $("#ct-insp");
  if(insp && !insp.hidden && !ctDocked()){
    const cut = insp.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if(cut > top + 60 && cut < H) H = cut + 70;
  }
  const sx = x + it.x * k, sy = y + it.y * k, sw = it.w * k, sh = it.h * k;
  if(sx >= 24 && sy >= top && sx + sw <= W - 24 && sy + sh <= H - 70) return;
  mmCamTo({k, x: W / 2 - (it.x + it.w / 2) * k, y: top + (H - top) / 2 - (it.y + it.h / 2) * k}, ms);
}

/* The map of the whole map, in the corner: every box, and the view on it. */
function mmMapSoon(){
  if(CT.mapTimer) return;
  CT.mapTimer = requestAnimationFrame(() => { CT.mapTimer = 0; mmDrawMap(); });
}
function mmDrawMap(){
  const cv = $("#mm-map"), box = $("#ctree"), lay = CT.lay;
  if(!cv || !lay || !cv.offsetWidth) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.offsetWidth, H = cv.offsetHeight;
  if(cv.width !== W * dpr){ cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext("2d"), css = getComputedStyle(box);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  /* The whole room the view can move in — the map and the space kept round
     it (mmEdges) — so the view's frame is always inside the small map, and
     its edges are the map's edges. The map's own ground shaded within it. */
  const e = lay.ext, kk = CT.cam.k, m = mmEdges();
  const X0 = e.x0 - m.mx / kk, X1 = e.x1 + m.mx / kk, Y0 = e.y0 - m.top / kk, Y1 = e.y1 + m.my / kk;
  const s = Math.min((W - 6) / (X1 - X0), (H - 6) / (Y1 - Y0));
  const ox = (W - (X1 - X0) * s) / 2 - X0 * s, oy = (H - (Y1 - Y0) * s) / 2 - Y0 * s;
  CT.mapXform = {s, ox, oy};
  const col = v => css.getPropertyValue(v).trim();
  g.fillStyle = col("--surface-2"); g.globalAlpha = .55;
  g.beginPath();
  if(g.roundRect) g.roundRect(ox + e.x0 * s - 2, oy + e.y0 * s - 2, e.w * s + 4, e.h * s + 4, 3); else g.rect(ox + e.x0 * s - 2, oy + e.y0 * s - 2, e.w * s + 4, e.h * s + 4);
  g.fill();
  g.globalAlpha = 1;
  for(const r of CT.recs.values()){
    const b = r.b;
    g.fillStyle = b.type === "root" ? col("--acc") : b.type === "words" ? col("--line-hot") : b.type === "part" ? col("--line") : col("--line-hot");
    g.globalAlpha = b.type === "cluster" && !b.open ? .5 : .9;
    g.fillRect(ox + r.x * s, oy + r.y * s, Math.max(2, r.w * s), Math.max(2, r.h * s));
  }
  g.globalAlpha = 1;
  const k = CT.cam.k;
  g.strokeStyle = col("--acc"); g.lineWidth = 1.5;
  g.strokeRect(ox + (-CT.cam.x / k) * s, oy + (-CT.cam.y / k) * s, box.clientWidth / k * s, box.clientHeight / k * s);
  /* with the whole map on the screen there is nothing for it to find, and it
     only covers the corner */
  const sx = CT.cam.x + e.x0 * k, sy = CT.cam.y + e.y0 * k;
  cv.classList.toggle("idle", sx >= 0 && sy >= 0 && sx + e.w * k <= box.clientWidth && sy + e.h * k <= box.clientHeight);
}
function mmMapTo(e){
  const cv = $("#mm-map"), m = CT.mapXform;
  if(!cv || !m) return;
  const r = cv.getBoundingClientRect(), box = $("#ctree");
  const wx = (e.clientX - r.left - m.ox) / m.s, wy = (e.clientY - r.top - m.oy) / m.s, k = CT.cam.k;
  CT.cam.x = box.clientWidth / 2 - wx * k; CT.cam.y = box.clientHeight / 2 - wy * k;
  CT.touched = true;
  mmCam();
}

/* ---------------- picking ---------------- */

/* Something picked, or "" for none. */
function ctSelect(key, opts = {}){
  CT.sel = key;
  mmMarkKin();
  ctPaintInsp();
  if(typeof paintIndexRoot === "function") paintIndexRoot();
  if(key && opts.show) mmShow(key);
  if(key && opts.focus) mmItemEl(key)?.focus({preventScroll: true});
}

/* A character named somewhere else — the panel, the next quest, the index —
   brought onto the map: the characters it hangs from opened, its level
   group unfolded, then shown and picked. */
function ctPick(key){
  if(!ctPlaced(key)) return;
  let changed = false;
  for(let p = CT.tree.parent.get(key); p !== undefined && p !== CT.root; p = CT.tree.parent.get(p))
    if(!CT.open.has(p)){ CT.open.add(p); changed = true; }
  const p = CT.tree.parent.get(key);
  if(p !== undefined && !CT.open.has(key) && (CT.tree.branches.get(p) || []).length > MM_WIDE.SMALL){
    const fold = `lv:${p}:${CT.g.by.get(key).lv}`;
    if(CT.fold.get(fold) === false || !mmItemEl(key)){ CT.fold.set(fold, true); changed = true; }
  }
  if(changed) ctRender();
  ctSelect(key, {focus: true});
  setTimeout(() => mmShow(key), changed && !REDUCED() ? 440 : 0);
}

/* The Find box: a character, a word, or a reading. A character on the map
   is brought into view; one that is not becomes the core. A word is shown
   where it is listed — under a character on the map that writes it, or else
   under its first character, which becomes the core — and picked, so the
   panel says what it is built from. Pinyin with or without tones finds the
   word, or else the character, it spells. */
function ctFind(raw){
  const q = String(raw || "").trim();
  if(!q || !CT.wordRows) return;
  let word = null, ch = "";
  if(/^[a-züà-ǜ\s'·-]+$/i.test(q)){
    const want = plainPinyin(q);
    word = CT.wordRows.find(r => plainPinyin(r[2]) === want) || null;
    if(!word){ const c = (C.all || []).find(c => plainPinyin(c.p) === want); if(c) ch = c.h; }
  }else if([...q].length === 1) ch = q;
  else word = ctWordRow(q);
  if(word){ ctFindWord(word); return; }
  /* a radical is its family: 竹 is the bamboo characters, built on ⺮ */
  if(ch && typeof RX !== "undefined" && RX.by.has(ch)){
    const root = rxRootOf(ch);
    if(root && root !== ch && (CT.g.kids.get(root) || []).length > (CT.g.kids.get(ch) || []).length){
      S.charRad = ch; save();
      ctStart(root, {trail: true});
      if(typeof paintIndex === "function") paintIndex();
      return;
    }
  }
  if(ch && (CT.g.by.has(ch) || CT.g.kids.has(ch))){
    if(ctPlaced(ch)) ctPick(ch); else ctStart(ch, {trail: true});
    return;
  }
  toast(`Nothing called “${q}” among the characters and words`);
}
/* The search opened over the header, as wide as the room to its left on
   its own line allows — up to the view switch where that shares the line —
   and folded back to its icon. */
function ctFindOpen(){
  const find = $("#sk-find"), head = $("#ct-head"), ctl = $("#character-controls");
  if(!find || !head) return;
  const r = find.getBoundingClientRect(), h = head.getBoundingClientRect(), c = ctl ? ctl.getBoundingClientRect() : null;
  const sameLine = c && c.bottom > r.top + 4 && c.top < r.bottom - 4;
  const left = sameLine ? c.right + 10 : h.left + parseFloat(getComputedStyle(head).paddingLeft || "12");
  find.style.setProperty("--find-open", `${Math.round(Math.max(r.width, Math.min(340, r.right - left)))}px`);
  find.classList.add("open");
  $("#sk-find-open").setAttribute("aria-expanded", "true");
  const q = $("#sk-find-q");
  q.tabIndex = 0;
  q.focus({preventScroll: true});
}
function ctFindFold(){
  const find = $("#sk-find");
  if(!find || !find.classList.contains("open")) return;
  find.classList.remove("open");
  $("#sk-find-open").setAttribute("aria-expanded", "false");
  $("#sk-find-q").tabIndex = -1;
}

/* A word found: its own map, every character in it broken down. */
function ctFindWord(r){
  if(CT.word === r[0]){ ctSelect(CT.root, {show: true, focus: true}); return; }
  ctStart(r[1], {trail: true});
}

/* A character opened or folded on the map; the camera keeps it where it is. */
function ctToggle(key){
  if(!CT.g.by.has(key) || key === CT.root || CT.word) return;
  const opening = !CT.open.has(key);
  if(opening) CT.open.add(key);
  else for(const h of [key, ...mmBelow(key)]){ CT.open.delete(h); CT.wall.delete(h); }
  ctRender({anchor: key, reveal: opening});
  ctPaintInsp();
}
/* everything under a character in the tree */
function mmBelow(key){
  const out = [], stack = [...(CT.tree.branches.get(key) || [])];
  while(stack.length){ const h = stack.pop(); out.push(h); stack.push(...(CT.tree.branches.get(h) || [])); }
  return out;
}

/* ---------------- the keys ---------------- */

/* The arrows walk the map by where things are — the nearest thing that way;
   Space opens or folds a character; Enter opens its entry; Q starts its
   quest; G makes it the core; + − and 0 zoom and fit; Backspace goes back
   along the trail; Escape puts it down. */
function treeKey(e){
  if(S.view !== "chars" || S.charView !== "tree" || !CT.tree || e.ctrlKey || e.metaKey || e.altKey) return false;
  if(e.target && e.target.closest && e.target.closest("input, select, textarea, dialog, #cidx")) return false;
  const k = e.key, onButton = e.target && e.target.closest && e.target.closest("button");
  const sel = CT.sel, word = sel.startsWith("w:");
  if(k === "/"){ e.preventDefault(); ctFindOpen(); return true; }
  if(k === "+" || k === "="){ e.preventDefault(); mmZoomBy(1.25); return true; }
  if(k === "-" || k === "_"){ e.preventDefault(); mmZoomBy(.8); return true; }
  if(k === "0"){ e.preventDefault(); CT.touched = false; mmFit(); return true; }
  if((k === "g" || k === "G") && sel && sel !== CT.root){
    const r = word ? CT.wordById.get(sel.slice(2)) : null;
    if(word && !r) return false;
    e.preventDefault(); ctStart(r ? r[1] : sel, {trail: true}); return true;
  }
  if((k === "q" || k === "Q") && (sel && !word ? CT.g.by.has(sel) : CT.quest)){ e.preventDefault(); questStart(sel && !word ? sel : CT.quest); return true; }
  if(k === "Backspace" && CT.trail.length){ e.preventDefault(); ctCommand("back", CT.trail.length - 1); return true; }
  if(k === "Escape" && sel){ e.preventDefault(); ctSelect(""); return true; }
  if(k === " " && sel && !word && !onButton){ e.preventDefault(); ctToggle(sel); return true; }
  if(k.startsWith("Arrow")){
    if(onButton && !onButton.closest("#ctree")) return false;
    e.preventDefault(); mmStep(k); return true;
  }
  if(k === "Enter" && sel && !onButton){ e.preventDefault(); ctActivate(sel); return true; }
  return false;
}

/* Something used: a character's entry, a word's entry, or a component's map. */
function ctActivate(key){
  if(key.startsWith("w:")) safely("open that entry", () => openWord(key.slice(2)));
  else if(CT.word && key === CT.root){
    const r = CT.wordById.get(CT.word);
    if(r && !ctEveryday(r)) safely("open that entry", () => openWord(CT.word));
  }
  else if(CT.g.by.has(key)) safely("open that entry", () => openChar(key));
  else ctStart(key, {trail: true});
}

function mmStep(dir){
  const items = [...$("#mm-boxes").querySelectorAll("[data-k]")].map(el => ({k: el.dataset.k, b: mmItemBox(el.dataset.k, true)})).filter(i => i.b);
  if(!items.length) return;
  const cur = items.find(i => i.k === CT.sel);
  if(!cur){ ctSelect(CT.root, {show: true, focus: true}); return; }
  const cx = cur.b.x + cur.b.w / 2, cy = cur.b.y + cur.b.h / 2;
  const [ux, uy] = {ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1]}[dir];
  /* the nearest thing that way — within a cone of the arrow first, so a
     step down does not land on something far off to the side */
  let best = null, score = Infinity, wide = null, wideScore = Infinity;
  for(const i of items){
    if(i === cur) continue;
    const dx = i.b.x + i.b.w / 2 - cx, dy = i.b.y + i.b.h / 2 - cy;
    const along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
    if(along <= 4) continue;
    const s = along + across * 2.2;
    if(across <= along * 1.6){ if(s < score){ score = s; best = i; } }
    else if(s < wideScore){ wideScore = s; wide = i; }
  }
  best = best || wide;
  if(best) ctSelect(best.k, {show: true, focus: true});
}

/* ---------------- the panel ---------------- */

/* What the panel tells about what is picked — with nothing picked, beside
   the map, the core. A character: its strokes ready to play; where the
   reader stands with it — its state, stars and the XP still in it, and what
   it needs or opens; its reading and meaning; how it is built; the words it
   is written in; and its quest. A word: what it means and the characters it
   is built from, each with where the reader stands. */
function ctPaintInsp(){
  const el = $("#ct-insp");
  if(!el || !CT.tree) return;
  const docked = ctDocked();
  const key = CT.sel || (docked ? CT.root : "");
  if(!key){
    el.hidden = true; el.innerHTML = ""; CT.insp = ""; CT.writer = null;
    return;
  }
  const word = key.startsWith("w:") || (!!CT.word && key === CT.root);
  const wid = key.startsWith("w:") ? key.slice(2) : CT.word, wr = word ? CT.wordById.get(wid) : null;
  const stamp = [key, CT.root, S.level, docked, CT.quest, questInfo.xp, CT.open.has(key),
    word ? `${CT.famWords.get(wid) || 0}:${wr ? [...new Set(wr[1])].map(ctStars).join("") : ""}` : `${ctStars(key)}${ctState(key)}${CT.deck.get(key) || 0}`].join("|");
  el.hidden = false;
  if(CT.insp === stamp) return;
  CT.insp = stamp;
  el.innerHTML = word ? mmWordHTML(wid, docked) : ctInspHTML(key, docked);
  el.querySelector(".ct-i-scroll").scrollTop = 0;
  CT.writer = null; // strokes load only when asked to play
  if(!word && CT.g.by.has(key)) wordsWithChar(key, 6).then(words => {
    const box = $("#ct-i-words");
    if(!box || CT.insp !== stamp) return;
    box.innerHTML = words.length ? words.map(w => `
      <button class="ct-i-word" data-open="word:${esc(w.id)}">
        <span class="hz">${esc(w.s)}</span><span class="py">${pinyinHTML(w.p)}</span>
        <span class="ct-i-wen">${esc(w.en[0] || "")}</span>${lvChip(w.lv)}</button>`).join("")
      : `<p class="ct-i-none">Not written in any word of the syllabus on its own.</p>`;
  });
}

const ctCloseX = `<button class="ct-x" data-ct="unsel" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;

/* A word told character by character: what it means, what it says
   literally, and for each character how it is built — its parts and what
   each brings, the way they sit, and the story the dictionary tells of it. */
function mmWordHTML(id, docked){
  const r = CT.wordById.get(id);
  if(!r) return `<div class="ct-i-scroll"><p class="ct-i-none">That word is not in the syllabus.</p></div>`;
  const st = ctWordState(r), chars = [...new Set(r[1])], inDeck = (CT.famWords.get(id) || 0) > 0, daily = ctEveryday(r);
  const need = chars.filter(ch => CT.g.by.has(ch) && !ctLearned(ch)), mapped = CT.word === id;
  const literal = [...r[1]].map(ch => `<span><b class="hz">${esc(ch)}</b>${esc(ctAbout(ch).short || "")}</span>`).join(`<i>+</i>`);
  return `${docked ? "" : ctCloseX}
    <div class="ct-i-scroll">
      <div class="ct-i-kicker">${daily ? "Everyday word · not on the HSK list" : `Word · ${chars.length} character${chars.length === 1 ? "" : "s"}`}</div>
      <div class="mm-i-word"><b class="hz">${esc(r[1])}</b><span class="py">${pinyinHTML(r[2])}</span></div>
      <div class="sk-i-st"><span class="sk-badge ${st === "locked" ? "locked" : st === "ready" ? "ready" : st === "mastered" ? "mastered" : "learned"}">${
        st === "locked" ? CT_LOCK : ""}${st === "ready" ? "Ready" : CT_STATES[st]}</span>${daily
        ? `<span class="ct-chip">HSK ${esc(levelLabel(r[4]))} characters</span>${r[5] ? `<span class="ct-chip">#${num(r[5])} in films and TV</span>` : ""}` : lvChip(r[4])}</div>
      <p class="ct-i-en">${esc(r[3])}</p>
      <p class="mm-i-lit"><small>Literally</small>${literal}</p>
      <section class="ct-i-sec"><h4 class="ct-i-h"><span>Character by character</span><small>${mapped ? "as on the map" : `${chars.length} to learn`}</small></h4>
        <div class="mm-i-break">${chars.map(ch => mmCharBreakdown(ch, r[1])).join("")}</div>
        <p class="ct-i-note">${st === "locked" ? `Learn ${need.map(ch => `<b class="hz">${esc(ch)}</b>`).join(" and ")} to make this combination.`
          : daily ? "Every character in it is learned, so you can read it."
          : st === "ready" ? "Every character in it is learned — add it to your deck to practise the word." : "This word is in your deck."}</p>
        ${daily ? `<p class="ct-i-note">An everyday word the HSK list leaves out, written only with HSK characters. It has no card of its own: its characters do.</p>` : ""}
      </section>
    </div>
    <div class="ct-i-acts">
      ${mapped ? "" : `<button class="btn sm" data-ct="grow" data-arg="${esc(r[1])}" title="Show how ${esc(r[1])} is built, on the map (G)">Map this word</button>`}
      ${daily ? "" : `<button class="${mapped ? "btn" : "ghost"} sm" data-open="word:${esc(id)}">Open the word</button>
      <button class="ghost sm${inDeck ? " on" : ""}" data-deck="word:${esc(id)}:${r[4]}">${inDeck ? `${CT_TICK}In deck` : "Add to deck"}</button>`}
    </div>`;
}
/* One character of a word, broken down: its reading and sense, its parts
   with what each brings to it — the meaning (its radical) or a hint of the
   sound — how they sit together, and the dictionary's story of it. */
function mmCharBreakdown(ch, word){
  const a = ctAbout(ch), c = a.c, times = [...word].filter(x => x === ch).length;
  const head = `<button class="mm-i-bkhead" type="button" ${ctPlaced(ch) ? `data-ct="pick"` : `data-ct="grow"`} data-arg="${esc(ch)}"
      title="${ctPlaced(ch) ? `Show ${esc(ch)} on the map` : `Grow a map from ${esc(ch)}`}">
      <b class="hz">${esc(ch)}</b><span><em>${esc(a.short || "component")}${times > 1 ? ` <small>×${times}</small>` : ""}</em>${c ? `<small class="py">${esc(c.p)}</small>` : ""}</span>
      ${c ? `${lvChip(c.lv)}${mmStars(ctStars(ch))}` : ""}</button>`;
  if(!c) return `<div class="mm-i-bk">${head}<p class="mm-i-why">A component, not a character of its own.</p></div>`;
  const parts = c.comp.filter(p => p.c !== ch);
  const op = [...String(c.dec || "")].find(x => IDS[x]);
  const chips = parts.map(p => {
    const role = ctRole(ch, p.c), pa = ctAbout(p.c);
    return `<button class="ct-i-part${role ? ` ${role}` : ""}" type="button" data-ct="grow" data-arg="${esc(p.c)}" title="Grow the map from ${esc(p.c)}">
      <b class="hz">${esc(p.c)}</b><span><em>${esc(p.g || pa.short || "component")}</em>${role ? `<small>${ctRoleText(role)}</small>` : pa.c ? `<small class="py">${esc(pa.c.p)}</small>` : ""}</span></button>`;
  }).join(`<i class="ct-i-plus">+</i>`);
  /* what each part brings, in a sentence */
  const brings = parts.map(p => {
    const role = ctRole(ch, p.c), g = p.g || ctAbout(p.c).short;
    const pc = CT.g.by.get(p.c);
    return role === "meaning" ? `<b class="hz">${esc(p.c)}</b> gives the meaning${g ? ` (${esc(g)})` : ""}`
      : role === "sound" ? `<b class="hz">${esc(p.c)}</b> hints at the sound${pc ? ` (<span class="py">${esc(pc.p)}</span>)` : ""}`
      : g ? `<b class="hz">${esc(p.c)}</b> is ${esc(g)}` : "";
  }).filter(Boolean);
  /* the dictionary's story, where it names the parts (some say only "speech") */
  const story = c.ety && /\p{Script=Han}/u.test(c.ety) ? c.ety.trim() : "";
  const why = [
    story ? `${esc(story.charAt(0).toUpperCase() + story.slice(1))}.` : "",
    brings.length ? `${brings.join("; ")}.` : "",
    op ? `The parts sit ${esc(IDS[op])}.` : "",
  ].filter(Boolean).join(" ");
  return `<div class="mm-i-bk${ctLearned(ch) ? " done" : ""}">${head}
    ${parts.length ? `<div class="ct-i-parts">${chips}</div>` : ""}
    <p class="mm-i-why">${why || "A single shape — not built from smaller parts."}</p></div>`;
}

function ctInspHTML(key, docked){
  const a = ctAbout(key), c = a.c, t = CT.tree, isRoot = key === t.root;
  const st = ctState(key), stars = ctStars(key), up = t.parent.get(key), kids = t.branches.get(key) || [];
  const inDeck = (CT.deck.get(key) || 0) > 0, reward = c ? ctReward(key) : 0;
  const kicker = isRoot ? (c ? "Core character" : "Radical · a component")
    : CT.word && up === t.root ? `A character of <span class="hz">${esc(t.root)}</span>`
    : ctPlaced(key) ? `Tier ${ctRoman(CT.depth.get(key))} character` : "Filed under this radical";
  const standing = c ? `<div class="sk-i-st">
      <span class="sk-badge ${st}">${st === "locked" ? CT_LOCK : ""}${CT_STATES[st]}</span>${mmStars(stars)}
      ${reward && st !== "locked" ? `<span class="sk-xp">+${reward} XP</span>` : ""}${key === CT.quest ? `<span class="sk-badge next">Next quest</span>` : ""}
    </div>` : "";
  const needs = st === "locked" && up ? `<div class="sk-i-req">
      <button class="sk-i-reqg hz" type="button" data-ct="pick" data-arg="${esc(up)}" title="Show ${esc(up)}">${esc(up)}</button>
      <p><b>Requires <span class="hz">${esc(up)}</span></b> — it is part of <span class="hz">${esc(key)}</span>. Learn it and this character opens.</p>
    </div>` : "";
  const recipe = up !== undefined && !CT.word ? ctRecipe(key, up) : "";
  const ops = c ? [...String(c.dec || "")].filter(x => IDS[x]) : [];
  const built = c && c.comp.length ? `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>How it is built</span>${ops.length ? `<small>${esc(IDS[ops[0]])}</small>` : ""}</h4>
      ${recipe ? `<p class="mm-i-recipe"><b class="hz">${esc(up)}</b><span>${esc(recipe)}</span><i>→</i><b class="hz">${esc(key)}</b></p>` : ""}
      <div class="ct-i-parts">${c.comp.map(p => {
        const role = ctRole(key, p.c), pa = ctAbout(p.c);
        return `<button class="ct-i-part${role ? ` ${role}` : ""}" data-ct="grow" data-arg="${esc(p.c)}" title="Grow the map from ${esc(p.c)}">
          <b class="hz">${esc(p.c)}</b><span><em>${esc(p.g || pa.short || "component")}</em>${role ? `<small>${ctRoleText(role)}</small>` : pa.c ? `<small class="py">${esc(pa.c.p)}</small>` : ""}</span></button>`;
      }).join(`<i class="ct-i-plus">+</i>`)}</div></section>` : "";
  let opens = "";
  if(kids.length){
    const by = new Map();
    for(const h of kids){ const lv = CT.g.by.get(h).lv; by.set(lv, (by.get(lv) || 0) + 1); }
    const lvs = [...by].sort((x, y) => +x[0] - +y[0]);
    const few = kids.slice().sort((x, y) => +CT.g.by.get(x).lv - +CT.g.by.get(y).lv || ctRank(x) - ctRank(y)).slice(0, 24);
    let roles = "";
    if(isRoot){
      let m = 0, s = 0;
      for(const h of kids){ const r = ctRole(h, key); if(r === "meaning") m++; else if(r === "sound") s++; }
      roles = m || s ? `<p class="ct-i-note">${m ? `Dictionary radical in ${num(m)}` : ""}${m && s ? " · " : ""}${s ? `similar pronunciation in ${num(s)}` : ""}.</p>` : "";
    }
    opens = `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>${!c || ctLearned(key) ? "Opens" : "Learning it opens"}</span><small>${num(kids.length)}${isRoot && t.size > kids.length ? ` · ${num(t.size)} on the map` : ""}</small></h4>
      <div class="ct-i-bar" aria-hidden="true">${lvs.map(([lv, k]) => `<i class="v${lv}" style="flex:${k}"></i>`).join("")}</div>
      <div class="ct-i-lvls">${lvs.map(([lv, k]) => `<span class="v${lv}"><i></i>HSK ${esc(levelLabel(lv))} <b>${num(k)}</b></span>`).join("")}</div>
      ${roles}
      <div class="ct-i-kids">${few.map(h => `<button class="ct-i-kid hz v${CT.g.by.get(h).lv}${ctLearned(h) ? " met" : ""}" data-ct="pick" data-arg="${esc(h)}"
        title="${esc(h)} ${esc(CT.g.by.get(h).p)} · ${esc(ctAbout(h).short)}">${esc(h)}</button>`).join("")}${
        kids.length > few.length ? `<span class="ct-i-more">+${num(kids.length - few.length)}</span>` : ""}</div>
    </section>`;
  }
  const facts = c ? [c.sc ? `<span><b>${c.sc}</b> strokes</span>` : "", c.rank ? `<span>frequency <b>#${num(c.rank)}</b></span>` : "",
    c.inWords ? `<span>in <b>${num(c.inWords)}</b> words</span>` : ""].filter(Boolean).join("") : "";
  const questLabel = stars >= 2 ? "Train again" : questInfo.recognised.has(key) ? "Continue quest" : "Begin quest";
  const more = !isRoot && !CT.word && mmMore(key) ? `<button class="ghost sm" data-ct="toggle" data-arg="${esc(key)}">${CT.open.has(key) ? "Fold on map" : "Expand on map"}</button>` : "";
  const acts = c ? (st === "locked" && up
      ? `<button class="btn sm" data-ct="pick" data-arg="${esc(up)}">Go to <span class="hz">${esc(up)}</span></button>
         <button class="ghost sm" data-ct="quest" data-arg="${esc(key)}" title="Practise it before ${esc(up)}">Train anyway</button>`
      : `<button class="btn sm" data-ct="quest" data-arg="${esc(key)}">${questLabel}</button>`)
      + `<button class="ghost sm" data-open="char:${esc(key)}">Full entry</button>
         <button class="ghost sm${inDeck ? " on" : ""}" data-deck="char:${esc(key)}:${c.lv}">${inDeck ? `${CT_TICK}In deck` : "Add to deck"}</button>` : "";
  return `
    ${docked ? "" : ctCloseX}
    <div class="ct-i-scroll">
      <div class="ct-i-kicker">${kicker}</div>
      <div class="ct-i-hero">
        <div class="ct-i-glyph${c ? "" : " comp"}">
          ${c ? `<svg class="ct-i-grid" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0v100M0 50h100M0 0l100 100M100 0 0 100"/></svg>
            <div class="ct-i-host" id="ct-i-host"><span class="hz ct-static-glyph">${esc(key)}</span></div>
            <button class="ct-i-play" data-ct="strokes" title="Play the strokes" aria-label="Play the stroke order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>`
            : `<span class="hz">${esc(key)}</span>`}
        </div>
        <div class="ct-i-id">
          ${c ? `<span class="ct-i-read py">${pinyinHTML(c.p)}</span>${c.pAlt.length ? `<small class="ct-i-alt">also <span class="py">${pinyinHTML(c.pAlt.join(", "))}</span></small>` : ""}`
            : `<span class="ct-i-read">${esc(a.short || "component")}</span>${a.full ? `<small class="ct-i-alt">a form of <b class="hz">${esc(a.full)}</b> <span class="py">${pinyinHTML(a.fc.p)}</span></small>` : `<small class="ct-i-alt">a component, not a character of its own</small>`}`}
          <div class="ct-i-chips">${c ? lvChip(c.lv) : `<span class="ct-chip">Component</span>`}${inDeck ? `<span class="ct-chip met">${CT_TICK}In your deck</span>` : ""}</div>
        </div>
      </div>
      ${standing}
      ${needs}
      ${c ? `<p class="ct-i-en">${esc(c.en.slice(0, 3).join("; "))}</p>` : ""}
      ${facts ? `<div class="ct-i-facts">${facts}</div>` : ""}
      ${built}
      ${c ? characterGuideHTML(c, true) : ""}
      ${opens}
      ${c ? `<section class="ct-i-sec"><h4 class="ct-i-h"><span>In words</span></h4><div class="ct-i-words" id="ct-i-words"><span class="ct-i-none">…</span></div></section>` : ""}
    </div>
    <div class="ct-i-acts">
      ${acts}
      ${more}
      ${!isRoot ? `<button class="ghost sm" data-ct="grow" data-arg="${esc(key)}" title="Make ${esc(key)} the core of the map (G)">Map from <span class="hz">${esc(key)}</span></button>` : ""}
      ${!c && a.full ? `<button class="ghost sm" data-ct="grow" data-arg="${esc(a.full)}">Map from <span class="hz">${esc(a.full)}</span></button>` : ""}
    </div>`;
}

function ctCommand(what, arg){
  if(what === "quest") questStart(arg);
  else if(what === "unsel") ctSelect("");
  else if(what === "grow") ctStart(arg, {trail: true});
  else if(what === "pick") ctPick(arg);
  else if(what === "toggle") ctToggle(arg);
  else if(what === "fold"){
    const b = [...CT.lay.boxes.values()].find(x => x.fold === arg);
    CT.fold.set(arg, !(b ? b.open : false));
    ctRender({anchor: b ? b.key : ""});
  }
  else if(what === "words"){
    /* a dozen more, or back to the first few once every word is out */
    const b = CT.lay.boxes.get(`wb:${arg}`);
    if(b && b.more > b.rows.length) CT.wall.set(arg, b.rows.length + MM.WSTEP);
    else CT.wall.delete(arg);
    ctRender({anchor: arg});
  }
  else if(what === "in") mmZoomBy(1.25);
  else if(what === "out") mmZoomBy(.8);
  else if(what === "fit"){ CT.touched = false; mmFit(); }
  else if(what === "progress") toast(ctLearnedLine(ctProgress()));
  else if(what === "strokes"){
    if(!CT.writer) CT.writer = mountWriter("ct-i-host", CT.sel || CT.root, {mode: "demo", size: 104, autoplay: false});
    if(CT.writer) CT.writer.animate();
  }
  else if(what === "back"){
    const i = +arg, h = CT.trail[i];
    if(h === undefined) return;
    CT.trail = CT.trail.slice(0, i);
    ctStart(h, {keepTrail: true});
  }
}

/* ---------------- the gestures ---------------- */

function ctWire(){
  if(CT.wired) return;
  CT.wired = true;
  const box = $("#ctree");
  const pts = new Map();
  /* a press becomes a drag past a few pixels; the click a drag ends in is
     not a click on what it ended over */
  let pan = null, pinch = null, moved = false, trace = [], dragged = 0;
  const over = el => !!el.closest(".mm-hud");

  box.addEventListener("pointerdown", e => {
    if(e.button > 1 || over(e.target)) return;
    mmStopCam();
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if(pts.size === 1){ pan = {x: e.clientX, y: e.clientY, cx: CT.cam.x, cy: CT.cam.y}; moved = false; trace = []; }
    else if(pts.size === 2){
      const [p, q] = [...pts.values()], b = box.getBoundingClientRect();
      pinch = {d: Math.hypot(p.x - q.x, p.y - q.y) || 1, mx: (p.x + q.x) / 2 - b.left, my: (p.y + q.y) / 2 - b.top, cam: {...CT.cam}};
      moved = true;
      for(const id of pts.keys()) try{ box.setPointerCapture(id); }catch(_){}
    }
  });
  box.addEventListener("pointermove", e => {
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if(pinch && pts.size >= 2){
      const [p, q] = [...pts.values()], b = box.getBoundingClientRect();
      const d = Math.hypot(p.x - q.x, p.y - q.y) || 1, mx = (p.x + q.x) / 2 - b.left, my = (p.y + q.y) / 2 - b.top;
      const k = clamp(pinch.cam.k * d / pinch.d, CT_ZMIN, CT_ZMAX);
      const wx = (pinch.mx - pinch.cam.x) / pinch.cam.k, wy = (pinch.my - pinch.cam.y) / pinch.cam.k;
      CT.cam.k = k; CT.cam.x = mx - wx * k; CT.cam.y = my - wy * k;
      CT.touched = true;
      mmCam();
      return;
    }
    if(!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if(!moved && Math.hypot(dx, dy) < 6) return;
    if(!moved){
      moved = true;
      try{ box.setPointerCapture(e.pointerId); }catch(_){}
      box.classList.add("grabbing");
      if(CT.hover){ CT.hover = ""; mmMarkKin(); }
    }
    CT.cam.x = pan.cx + dx; CT.cam.y = pan.cy + dy;
    CT.touched = true;
    mmCam();
    /* held at the map's edge: the drag goes on from where the view stopped,
       so it comes back the moment the finger does */
    if(CT.held){ pan.cx = CT.cam.x - dx; pan.cy = CT.cam.y - dy; }
    const now = performance.now();
    trace.push({t: now, x: e.clientX, y: e.clientY});
    while(trace.length > 2 && now - trace[0].t > 90) trace.shift();
  });
  const up = e => {
    if(!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if(pinch && pts.size < 2){
      pinch = null;
      const [p] = [...pts.values()];
      if(p) pan = {x: p.x, y: p.y, cx: CT.cam.x, cy: CT.cam.y};
      trace = [];
      return;
    }
    if(pts.size) return;
    box.classList.remove("grabbing");
    pan = null;
    if(moved) dragged = performance.now();
    /* let go mid-swipe: the map carries on and slows */
    const a = trace[0], b = trace[trace.length - 1];
    if(moved && a && b && b.t - a.t > 10 && performance.now() - b.t < 60 && !REDUCED()){
      let vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t), last = performance.now();
      const step = now => {
        const dt = Math.min(40, now - last); last = now;
        CT.cam.x += vx * dt; CT.cam.y += vy * dt;
        mmCam();
        const f = Math.pow(.93, dt / 16); vx *= f; vy *= f;
        if(CT.held){ vx = 0; vy = 0; }
        CT.glide = Math.hypot(vx, vy) > .02 ? requestAnimationFrame(step) : 0;
      };
      CT.glide = requestAnimationFrame(step);
    }
  };
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
  box.addEventListener("lostpointercapture", e => { if(pts.has(e.pointerId) && e.pointerType !== "mouse") up(e); });

  /* a click: a command runs, something on the map is picked; a click that
     ends a drag does nothing. An entry or the deck is the page's to take. */
  box.addEventListener("click", e => {
    if(performance.now() - dragged < 250 && !over(e.target)){ e.preventDefault(); e.stopPropagation(); return; }
    if(e.target.closest("[data-open], [data-deck]")) return;
    const cmd = e.target.closest("[data-ct]");
    if(cmd){ ctCommand(cmd.dataset.ct, cmd.dataset.arg); return; }
    const item = e.target.closest("[data-k]");
    if(item){ ctSelect(item.dataset.k); return; }
    if(!over(e.target) && CT.sel) ctSelect("");
  }, true);
  /* a double click starts a character's quest, or opens a word */
  box.addEventListener("dblclick", e => {
    const item = e.target.closest("[data-k]");
    if(!item || e.target.closest("[data-ct]")) return;
    e.preventDefault();
    const k = item.dataset.k;
    if(k.startsWith("w:")) ctActivate(k);
    else if(CT.g.by.has(k)) questStart(k);
  });
  $("#ct-head").addEventListener("click", e => {
    const cmd = e.target.closest("[data-ct]");
    if(cmd) ctCommand(cmd.dataset.ct, cmd.dataset.arg);
  });
  $("#sk-find").addEventListener("submit", e => {
    e.preventDefault();
    const q = $("#sk-find-q"), v = q.value;
    q.value = "";
    ctFindFold();
    q.blur();
    if(v.trim()) safely("find that", () => ctFind(v));
  });
  $("#sk-find-open").addEventListener("click", () => {
    const open = $("#sk-find").classList.contains("open"), v = $("#sk-find-q").value.trim();
    if(!open) ctFindOpen();
    else if(v) $("#sk-find").requestSubmit();
    else ctFindFold();
  });
  /* it folds away once the reader is done with it, the words typed kept */
  $("#sk-find-q").addEventListener("blur", () => setTimeout(() => {
    if(!$("#sk-find").contains(document.activeElement)) ctFindFold();
  }, 150));
  $("#sk-find-q").addEventListener("keydown", e => {
    if(e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation();
    $("#sk-find-q").value = "";
    ctFindFold();
    $("#sk-find-open").focus();
  });
  /* The search's hint, as much of it as its box has room for: a phone's
     narrower box says "Search a word", or just "Search". */
  const q = $("#sk-find-q"), hints = [q.placeholder, "Search a word", "Search"];
  const pen = document.createElement("canvas").getContext("2d");
  const fitHint = () => {
    const room = q.clientWidth;
    if(!room) return;
    const cs = getComputedStyle(q);
    pen.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const hint = hints.find(h => pen.measureText(h).width <= room) || hints[hints.length - 1];
    if(q.placeholder !== hint) q.placeholder = hint;
  };
  if(window.ResizeObserver) new ResizeObserver(fitHint).observe(q);
  if(document.fonts) document.fonts.ready.then(fitHint);
  /* The panel's own controls: everything in it but an entry or the deck,
     which the page's one click handler takes. */
  $("#ct-insp").addEventListener("click", e => {
    const cmd = e.target.closest("[data-ct]");
    if(cmd) ctCommand(cmd.dataset.ct, cmd.dataset.arg);
  });

  /* The wheel zooms, as a game's map does — a mouse's notched wheel and a
     pinch on a touchpad both. Two fingers sliding on a touchpad pan. */
  box.addEventListener("wheel", e => {
    if(over(e.target)) return;
    e.preventDefault();
    mmStopCam();
    const b = box.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? b.height : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const notched = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 50);
    if(e.ctrlKey) mmZoomAt(px, py, CT.cam.k * Math.exp(-dy * .012));
    else if(notched && !e.shiftKey) mmZoomAt(px, py, CT.cam.k * Math.exp(-dy * .0016));
    else{
      CT.cam.x -= e.shiftKey && !dx ? dy : dx;
      CT.cam.y -= e.shiftKey && !dx ? 0 : dy;
      mmCam();
    }
    CT.touched = true;
  }, {passive: false});

  /* what the pointer rests on, and its way back to the core, lit */
  box.addEventListener("pointerover", e => {
    if(e.pointerType !== "mouse" || pts.size) return;
    const item = e.target.closest("[data-k]");
    if(item && CT.hover !== item.dataset.k){ CT.hover = item.dataset.k; mmMarkKin(); }
  });
  box.addEventListener("pointerout", e => {
    const item = e.target.closest("[data-k]");
    if(item && !item.contains(e.relatedTarget) && CT.hover){ CT.hover = ""; mmMarkKin(); }
  });
  /* a focused card can scroll an overflow:hidden box; the plane is the only
     thing that moves here */
  box.addEventListener("scroll", () => { box.scrollTop = 0; box.scrollLeft = 0; });

  /* The small map: small until it is wanted. A first press only enlarges it
     a little; once it is larger, a press or a drag goes there. Left alone a
     few seconds — or the map pressed anywhere else — it is small again; it
     stays large while the pointer rests on it. */
  const map = $("#mm-map");
  let shrink = 0, resting = false;
  const big = (on, wait = 4000) => {
    map.classList.toggle("big", on);
    clearTimeout(shrink);
    if(on && !resting) shrink = setTimeout(() => big(false), wait);
  };
  map.addEventListener("pointerenter", e => { if(e.pointerType === "mouse"){ resting = true; clearTimeout(shrink); } });
  map.addEventListener("pointerleave", e => { if(e.pointerType === "mouse"){ resting = false; if(map.classList.contains("big")) big(true, 1600); } });
  box.addEventListener("pointerdown", () => { if(map.classList.contains("big")) big(false); });
  /* it is drawn again as it grows and shrinks */
  if(window.ResizeObserver) new ResizeObserver(() => mmMapSoon()).observe(map);
  map.addEventListener("pointerdown", e => {
    e.stopPropagation();
    if(!map.classList.contains("big")){ big(true); return; }
    clearTimeout(shrink);
    mmStopCam();
    try{ map.setPointerCapture(e.pointerId); }catch(_){}
    mmMapTo(e);
    const move = ev => mmMapTo(ev);
    const done = () => { map.removeEventListener("pointermove", move); map.removeEventListener("pointerup", done); map.removeEventListener("pointercancel", done); big(true); };
    map.addEventListener("pointermove", move);
    map.addEventListener("pointerup", done);
    map.addEventListener("pointercancel", done);
  });
  /* a theme picked repaints the small map in it */
  new MutationObserver(() => mmMapSoon()).observe(document.documentElement, {attributes: true, attributeFilter: ["data-skin"]});
  /* the window across the line where the panel docks: it moves */
  if(window.matchMedia){
    const mq = matchMedia("(min-width:1100px)");
    const swap = () => { CT.insp = ""; ctPaintInsp(); };
    if(mq.addEventListener) mq.addEventListener("change", swap);
  }
}

/* A card added or taken out — from the panel, an entry the map or the
   grid opened, or a word sheet opened from that — lights the map, or marks
   the cells, afresh. */
function treeDeckChanged(){
  if(S.view !== "chars") return;
  if(S.charView === "grid") return ctLoadKnown().then(() => paintChars());
  if(!CT.tree) return;
  return ctLoadKnown().then(() => { ctRefresh(); paintIndex(); });
}

/* "Explore in the tree", from an entry: the Characters tab as a map, grown
   from the character or part. */
function treeGrowFrom(h){
  closeDetail();
  CT.next = h;
  S.charView = "tree"; save();
  if(S.view === "chars") safely("grow the map", renderChars);
  else show("chars");
}

/* The grid or the map. */
function setCharView(v){
  S.charView = v === "grid" ? "grid" : "tree";
  save();
  safely("show the characters", renderChars);
}
