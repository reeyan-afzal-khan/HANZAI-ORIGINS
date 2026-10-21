/* tree.js — the Characters tab drawn as a tree.
 *
 * Every character is built from parts — 林 from 木 twice, 森 from 木 and 林,
 * 妈 from 女 and 马 — and the syllabus records those parts one step down
 * (charextra's decomposition). Read the other way round, a part is the root
 * of everything built on it: 木 grows 林, 林 grows 森. This view draws that as
 * a skill tree on an open canvas: the root on the left, what it builds into
 * branching off to the right a tier at a time, and what the root is itself
 * made of off to its left. A branch is opened like a game's, any node can be
 * the start of a tree of its own, and the trail of roots leads back.
 *
 * The tree grows through every level by default, and the characters above
 * the reader's own are drawn locked, as a game shows the skills still to
 * come: a radical's family is wide but rarely deep within one level, and the
 * tiers are what make it a tree. Grown only to the chosen level, a character
 * above it stays in as the bridge to one within it. A character appears once
 * in a tree, under the parent that puts it deepest — 森 hangs from 林 rather
 * than from 木 — which is what gives the tree its tiers.
 *
 * A family of a handful is drawn as branches, each with its own link. A
 * bigger one — 氵 has 161 — is drawn in groups, one a level, stacked under
 * each other: a card named with its level and how many it holds, its tiles
 * in rows under the name. The levels up to the reader's own and the next
 * one arrive open, the ones further up folded to their names. A character
 * whose own branch is opened leaves its group for a row above the groups,
 * with its branches beside it.
 *
 * Nodes are buttons laid over one SVG of links, all inside a plane the camera
 * moves with a single transform: dragging pans, the wheel or a pinch zooms.
 * Positions are tweened in script and the links redrawn from them on every
 * frame, so a branch opening slides the rest of the tree aside rather than
 * making it jump. Under the plane, each tier is a band; over it, a header
 * names the root and the tiers and carries the tools, and a map in the
 * corner shows the whole tree and where the view is on it. Beside the canvas
 * a panel tells about the tile picked — or, with none, the root. Everything
 * here is named ct… — the app's scripts share one global scope. */

/* The sizes the layout works in, in the plane's own pixels. */
const CT_SLOT = 68;               // a character's tile
const CT_CELLT = 60;              // a tile in a group, a size down
const CT_ROOT = 104;              // the root's
const CT_PART = 58;               // a part with no entry of its own (氵, 扌)
const CT_ROW = 108;               // a branch's pitch, top to bottom: the tile, its meaning, and air
/* A tier's pitch, left to right: room for a link's curve and the tag on
   it; closer on a phone, where the root and the tiers either side of it
   should all be on the screen at once. */
const CT_COL_WIDE = 244, CT_COL_NARROW = 178;
let CT_COL = CT_COL_WIDE;
/* A family of more than CT_ROWS goes in groups, one a level. */
const CT_ROWS = 6;
const CT_GCELL = 88;              // a group's cell, across
const CT_GCELL_H = 102;           // and down: the tile, its meaning under it, and air
const CT_GHEAD = 42;              // a group's name strip
const CT_GPAD = 12;               // the group's margin round its tiles
const CT_GGAP = 12;               // under a group, before the next one
const CT_GCOLS_NARROW = 3;        // a group's row on a phone; wider, as many as the canvas has room for
const CT_DOT = 26;                // the canvas's dot grid
const CT_HEAD = 52;               // the header strip over the canvas
/* How far the view may draw back, and close in: at a third of the size the
   shape of a big family still shows, and past it the map in the corner is
   the overview. */
const CT_ZMIN = .35, CT_ZMAX = 2.4;
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
  root: "",              // what the tree grows from
  trail: [],             // the roots walked through to get here
  open: new Set(),       // nodes whose branches are out
  gopen: new Map(),      // group -> open or folded, where the reader has said
  gall: "",              // "open" or "shut": every group, by the header's tools; "" by level
  gnext: true,           // the next level's groups open by default: the tree has the room (ctAutoOpen)
  sel: "",               // the node picked
  hover: "",             // the node under the pointer
  kin: "",               // the part whose family is lit, from a tag under the pointer
  tree: null,            // what grows from the root, at this level
  makes: null,           // what the root is made of
  lay: null,             // the last layout: nodes, links and tiers
  recs: new Map(),       // key -> the node's element and its motion
  wires: new Map(),      // link id -> its path and tag
  cam: {x: 0, y: 0, k: 1},
  touched: false,        // moved by hand since the tree last fitted itself
  deck: new Map(),       // character -> its own card's rank (1 in the deck, 2 mastered)
  met: new Map(),        // character -> the best rank of a deck word written with it
  shelf: new Map(),      // level -> the roots worth starting from, grouped
  reach: new Map(),      // level -> character -> leads to something within the level
  head: {l: 0, r: 1e9},  // the header's free stretch, between the title and the tools
  wide: 0, high: 0,      // the canvas's size when it was last sized
  reachK: "",            // the small targets' reach as last set (--ct-reach)
  map: null,             // how the map is scaled onto the tree
  insp: "",              // what the panel was last drawn for
  next: "",              // a root asked for from an entry, for the next drawing
  writer: null,          // the panel's stroke-order writer
  raf: 0, timer: 0, camRaf: 0, camTimer: 0, glide: 0, idle: 0, mapRaf: 0, mapTimer: 0,
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
  return {by, kids, gloss, form, alias};
}

/* The level the tree is grown to: the whole standard, or the chosen one. */
const ctLevel = () => S.treeReach === "level" ? +S.level : 7;
const ctWithin = h => { const c = CT.g.by.get(h); return !!c && +c.lv <= ctLevel(); };

/* Whether a character leads, a step or several on, to one within the level —
   the reason to keep a character above it in the tree, as the bridge. */
function ctReaches(h){
  const lv = ctLevel();
  let memo = CT.reach.get(lv);
  if(!memo) CT.reach.set(lv, memo = new Map());
  const walk = (x, stack) => {
    if(memo.has(x)) return memo.get(x);
    if(stack.has(x)) return false;
    stack.add(x);
    let any = false;
    for(const k of CT.g.kids.get(x) || []) if(ctWithin(k) || walk(k, stack)){ any = true; break; }
    stack.delete(x);
    memo.set(x, any);
    return any;
  };
  return walk(h, new Set());
}

/* What grows from a root. Each character is placed once, under the parent of
   its that sits deepest in the tree — the longest way down from the root,
   found in one pass over the descendants in dependency order. */
function ctGrow(root){
  const {kids, by} = CT.g;
  const keep = h => ctWithin(h) || ctReaches(h);
  const seen = new Set([root]), order = [root];
  for(let i = 0; i < order.length; i++)
    for(const k of kids.get(order[i]) || []) if(!seen.has(k) && keep(k)){ seen.add(k); order.push(k); }

  const waiting = new Map(order.map(h => [h, 0]));
  for(const h of order) for(const k of kids.get(h) || []) if(seen.has(k)) waiting.set(k, waiting.get(k) + 1);
  const depth = new Map([[root, 0]]), parent = new Map(), queue = [root];
  while(queue.length){
    const h = queue.shift();
    for(const k of kids.get(h) || []){
      if(!seen.has(k)) continue;
      const d = depth.get(h) + 1;
      if(!(depth.get(k) >= d)){ depth.set(k, d); parent.set(k, h); }
      waiting.set(k, waiting.get(k) - 1);
      if(!waiting.get(k)) queue.push(k);
    }
  }
  const branches = new Map();
  for(const h of order){
    const p = parent.get(h);
    if(p === undefined) continue;
    if(!branches.has(p)) branches.set(p, []);
    branches.get(p).push(h);
  }
  /* how much hangs under each node, and how many tiers it goes down */
  const under = new Map(), tall = new Map();
  const count = h => {
    if(under.has(h)) return under.get(h);
    let n = 0, t = 0;
    for(const k of branches.get(h) || []){ n += 1 + count(k); t = Math.max(t, 1 + tall.get(k)); }
    under.set(h, n);
    tall.set(h, t);
    return n;
  };
  count(root);
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

/* The roots worth starting from at a level, in three shelves: the radicals,
   which give their characters a meaning (口, 扌, 氵); the sound families,
   whose characters mostly rhyme with them (青 qīng → 请 清 情); and the
   other parts characters are built from (艹 aside, 又, 人). Each the parts
   the most characters are built on directly, commonest first. */
function ctShelf(){
  const lv = ctLevel();
  if(CT.shelf.has(lv)) return CT.shelf.get(lv);
  const kinds = {radicals: [], sounds: [], parts: []};
  for(const [p, list] of CT.g.kids){
    if(CT_STROKES.has(p)) continue;
    const ks = list.filter(h => +CT.g.by.get(h).lv <= lv);
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
    ["radicals", "Radicals", kinds.radicals.slice(0, 30)],
    ["sounds", "Sound families", kinds.sounds.slice(0, 20)],
    ["parts", "Other parts", kinds.parts.slice(0, 16)],
  ].filter(s => s[2].length);
  CT.shelf.set(lv, out);
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

/* The tag on a link, as its markup: the other parts, each a button that
   grows the tree from it, or "×2". "" for no tag. */
function ctTag(h, from){
  const o = ctOthers(h, from);
  if(!o) return "";
  if(o.others.length) return o.others.map(p => `<button class="ct-tagp" type="button" data-ct="grow" data-arg="${esc(p)}"
      data-part="${esc(p)}" aria-label="Grow the tree from ${esc(p)}"><i>+</i><b class="hz">${esc(p)}</b></button>`).join("");
  return o.times > 1 ? `<span class="ct-tagx">×${o.times}</span>` : "";
}
/* The same on a tile in a group, which has no link of its own to carry it:
   a small plate on the tile's foot. */
function ctPlate(h, from){
  const o = ctOthers(h, from);
  if(!o) return "";
  if(o.others.length) return `<span class="ct-plate"><i>+</i><b class="hz">${esc(o.others.join(""))}</b></span>`;
  return o.times > 1 ? `<span class="ct-plate"><b>×${o.times}</b></span>` : "";
}

/* ---------------- what is known ---------------- */

/* Read from the deck when the tab is drawn. A character counts as met when it
   has a card of its own or is written in a word that has one — most decks
   are words, and a tree that lit up only for character cards would stay
   dark for nearly everybody. */
async function ctLoadKnown(){
  const [fam, index] = await Promise.all([
    typeof familiarity === "function" ? familiarity() : {words: new Map(), chars: new Map()},
    getSearch(),
  ]);
  CT.deck = new Map(fam.chars);
  const met = new Map();
  if(fam.words.size){
    const spelt = new Map(index.map(r => [r[0], r[1]]));
    for(const [id, rank] of fam.words)
      for(const ch of spelt.get(id) || "") if((met.get(ch) || 0) < rank) met.set(ch, rank);
  }
  CT.met = met;
}
const ctKnown = h => Math.max(CT.deck.get(h) || 0, CT.met.get(h) || 0);

/* ---------------- drawing the tab ---------------- */

/* The tab in tree form: called by renderChars whenever the tab is drawn or
   its level changes. */
async function renderCharTree(){
  if(!CT.g) CT.g = ctGraph(C.all || await getChars());
  await ctLoadKnown();
  ctWire();
  ctDock();
  paintCharTree();
  sizeCharTree();
  /* A first visit starts at 木, the tree, which grows the most legible tree
     there is: 林 and 森, 本 and 体, 果 and 课. One asked for from an entry
     (treeGrowFrom) goes on from the tree there was, with the way back. */
  const want = CT.next || CT.root || S.treeRoot || "木", asked = !!CT.next;
  CT.next = "";
  const first = (ctShelf()[0] || [0, 0, [["口"]]])[2][0][0];
  const root = CT.g.by.has(want) || CT.g.kids.has(want) ? want : first;
  if(root !== CT.root){ ctStart(root, {fresh: !CT.root, trail: asked}); return; }
  /* the same root at another level: grown again, what was open kept open */
  CT.tree = ctGrow(CT.root);
  if(CT.sel && !ctPlaced(CT.sel)) CT.sel = "";
  ctRender();
  if(!CT.touched) ctFit(0);
  ctPaintHead();
  ctPaintInsp();
}
/* Whether a key is somewhere in the tree as grown, open or not. */
const ctPlaced = h => h === CT.root || CT.tree.parent.has(h) || ctMakingsHave(h);
const ctMakingsHave = h => [...(CT.makes || new Map()).values()].some(list => list.includes(h));

/* The bar of roots: the three shelves, or, with a query, what matches it. A
   tile is the part, what it means — or for a sound family how it is read —
   and how many characters are built on it. */
function paintCharTree(){
  if(!CT.g) return;
  const track = $("#ct-track");
  const q = C.query.trim();
  const tile = (h, sub, n) => `<button class="ct-root" data-root="${esc(h)}" aria-pressed="${h === CT.root}"
      title="${esc(h)} ${esc(ctAbout(h).en || "component")}${n ? ` · ${n} character${n === 1 ? "" : "s"} built on it` : ""}">
      <span class="hz">${esc(h)}</span><small>${esc(sub || "")}</small>${n ? `<i>${n}</i>` : ""}</button>`;
  const shelf = (id, name, n, tiles) => `<div class="ct-shelf" data-shelf="${id}">
      <span class="ct-shelf-h"><b>${esc(name)}</b><small>${n}</small></span>${tiles}</div>`;
  if(q){
    const hit = ctMatches(q);
    track.innerHTML = shelf("hits", "Matches", hit.length >= 40 ? "40+" : hit.length, hit.length
      ? hit.map(h => { const a = ctAbout(h); return tile(h, a.c ? a.c.p : a.short, 0); }).join("")
      : `<span class="ct-none-hit">Nothing matches that — try a reading such as “mu”, or a meaning.</span>`);
  }else{
    track.innerHTML = ctShelf().map(([id, name, list]) => shelf(id, name, list.length, list.map(([p, n]) => {
      const a = ctAbout(p);
      return tile(p, id === "sounds" && a.c ? a.c.p : a.short || (a.c ? a.c.p : ""), n);
    }).join(""))).join("");
  }
  track.scrollLeft = 0;
  ctBarReveal();
  ctBarEnds();
}

/* The root's tile scrolled into the bar's view, if it is on the bar. */
function ctBarReveal(){
  const track = $("#ct-track"), on = track && track.querySelector('.ct-root[aria-pressed="true"]');
  if(!on) return;
  const a = on.offsetLeft - 56, b = on.offsetLeft + on.offsetWidth + 56;
  if(a < track.scrollLeft) track.scrollLeft = a;
  else if(b > track.scrollLeft + track.clientWidth) track.scrollLeft = b - track.clientWidth;
}
/* The bar's arrows show only where there is more to scroll to. */
function ctBarEnds(){
  const track = $("#ct-track"), bar = $("#croots");
  if(!track) return;
  bar.classList.toggle("at-start", track.scrollLeft < 4);
  bar.classList.toggle("at-end", track.scrollLeft + track.clientWidth > track.scrollWidth - 4);
}

/* What a search in the tree finds: the characters the grid's search would,
   best first — the character itself, then a reading typed whole (ma: 妈 马
   吗), then one begun, then a whole English word, then any — and a part
   typed as itself (氵, 扌), which has no entry to be found by. */
function ctMatches(q){
  const low = q.toLowerCase(), qp = flatPinyin(low);
  const word = new RegExp(`(^|[^a-z])${low.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
  const reads = c => [c.p, ...c.pAlt].map(flatPinyin);
  const rank = c => c.h === low || c.t === low ? 0
    : reads(c).includes(qp) ? 1
    : reads(c).some(p => p.startsWith(qp)) ? 2
    : c.en.some(e => word.test(e.toLowerCase())) ? 3 : 4;
  const out = charsMatching(q).map((c, i) => [c, rank(c), i])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, 40).map(([c]) => c.h);
  if([...q].length === 1 && CT.g.kids.has(q) && !CT.g.by.has(q)) out.unshift(q);
  return out;
}
/* Enter in the search: the first match grows its tree, and the search clears. */
function treeSearchPick(){
  const first = CT.g && ctMatches(C.query.trim())[0];
  if(!first) return;
  ctStart(first);
  const box = $("#csearch");
  box.value = ""; C.query = "";
  paintCharTree();
  box.blur();
}

/* The header's title: the way back, the trail of roots, then the root
   itself, what it means and how much grows from it. */
function ctPaintHead(){
  const title = $("#ct-title");
  if(!title || !CT.tree) return;
  const a = ctAbout(CT.root), n = CT.tree.size;
  const direct = (CT.tree.branches.get(CT.root) || []).length;
  const reach = S.treeReach === "level" ? ` up to HSK ${esc(levelLabel(S.level))}` : "";
  const back = CT.trail.length ? CT.trail[CT.trail.length - 1] : "";
  title.innerHTML = (back ? `<button class="ct-back" data-ct="back" data-arg="${CT.trail.length - 1}" title="Back to ${esc(back)} (Backspace)"
        aria-label="Back to ${esc(back)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg></button>` : "")
    + CT.trail.map((h, i) =>
      `<button class="ct-crumb hz" data-ct="back" data-arg="${i}" title="Back to ${esc(h)}">${esc(h)}</button><i aria-hidden="true">›</i>`).join("")
    + `<b class="ct-title-g hz">${esc(CT.root)}</b>`
    + `<span class="ct-title-t"><b>${esc(a.short || (a.c ? a.c.p : "component"))}${a.c ? ` <span class="py">${esc(a.c.p)}</span>` : ""}</b>`
    + `<small>${n ? `${num(direct)} built on it · ${num(n)} in its tree${reach}` : `nothing built on it${reach}`}</small></span>`;
  ctPaintTools();
  ctMeasureHead();
  ctPlaceTiers();
}
/* The tools' state: whether every level is open, folded, or as the level
   has it; and whether the panel is beside the canvas. */
function ctPaintTools(){
  for(const b of $$("#ct-zoom [data-ct='expand'], #ct-zoom [data-ct='collapse']"))
    b.setAttribute("aria-pressed", String(CT.gall === (b.dataset.ct === "expand" ? "open" : "shut")));
  const ip = $("#ct-zoom [data-ct='insp']");
  if(ip) ip.setAttribute("aria-pressed", String(S.treeInsp !== false));
  const mx = $("#ct-zoom [data-ct='max']");
  if(mx) mx.setAttribute("aria-pressed", String(document.body.classList.contains("ct-max")));
}
/* Where the tier names may go: between the title and the tools. Measured
   when either changes, never while the camera moves. */
function ctMeasureHead(){
  const title = $("#ct-title"), zoom = $("#ct-zoom");
  if(!title || !zoom || !title.offsetParent) return;
  CT.head = {l: title.offsetLeft + title.offsetWidth + 18, r: zoom.offsetLeft - 18};
}

/* The canvas sized to what is left of the window, as the lists are. On a
   phone the page around it does not scroll, so it takes the rest of the
   screen there too. Full window, it is the window. */
function sizeCharTree(){
  const stage = $("#ctstage"), el = $("#ctree");
  /* not offsetParent: a stage filling the window is fixed, and has none */
  if(!stage || !el || !el.offsetWidth || !window.innerHeight) return;
  const max = document.body.classList.contains("ct-max");
  const wrap = document.querySelector(".wrap");
  const phone = window.innerWidth < 700;
  const pad = wrap ? parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0;
  let top = -window.scrollY;
  for(let e = stage; e; e = e.offsetParent) top += e.offsetTop;
  const want = max ? "" : `${Math.max(phone ? 440 : 400, Math.round(window.innerHeight - top - pad))}px`;
  const wide = el.clientWidth;
  ctBarEnds();
  if(stage.style.height === want && CT.wide === wide && CT.high === el.clientHeight) return;
  stage.style.height = want;
  CT.wide = el.clientWidth;
  CT.high = el.clientHeight;
  ctMeasureHead();
  /* across a phone's width the tiers draw closer, and a group's rows hold
     as many as the width has room for, so the tree is laid out again */
  if(CT.lay) ctRender(0);
  if(CT.lay && !CT.touched) ctFit(0);
  else if(CT.lay) ctCam();
}

/* The panel beside the canvas, where the window has the room and the reader
   has not put it away; elsewhere it is a card over the canvas, up while a
   tile is picked. */
function ctDock(){
  const stage = $("#ctstage");
  if(stage) stage.classList.toggle("dock", S.treeInsp !== false);
}
const ctDocked = () => S.treeInsp !== false && !!window.matchMedia && matchMedia("(min-width:1280px)").matches;

/* ---------------- a new root ---------------- */

/* @param opts.trail  keep the way back: the root left behind goes on the trail
 * @param opts.keepTrail  the trail as it stands (a step back along it)
 * @param opts.fresh  the first tree of the visit: the camera is placed at once,
 *   and the tree unfolds from its root in front of it */
function ctStart(root, opts = {}){
  if(opts.trail && CT.root && CT.root !== root){
    CT.trail = CT.trail.filter(h => h !== root);
    CT.trail.push(CT.root);
    if(CT.trail.length > 10) CT.trail.shift();
  }else if(!opts.keepTrail) CT.trail = [];
  CT.root = root;
  S.treeRoot = root; save();
  CT.tree = ctGrow(root);
  CT.makes = ctMakings(root);
  CT.open = new Set(); CT.gopen = new Map(); CT.gall = "";
  CT.sel = ""; CT.hover = ""; CT.kin = "";
  ctAutoOpen();
  ctRender(520, "", "tier");
  CT.touched = false;
  ctFit(opts.fresh ? 0 : 520);
  ctPaintHead();
  ctPaintInsp();
  for(const b of $$("#ct-track .ct-root")) b.setAttribute("aria-pressed", String(b.dataset.root === root));
  ctBarReveal();
}

/* A tree opens itself on arrival as far as it can while the whole of it
   still fits the canvas at a size it reads at: first its branches, deepest
   first — of the folded characters on show, the one with the most tiers
   under it opens next, one within the reader's level before one above it —
   then the group of the level after the reader's, and the branches that
   brings into view. On a phone, narrower than any tree, only the height is
   held to that. */
function ctAutoOpen(){
  const box = $("#ctree"), t = CT.tree;
  const W = (box && box.clientWidth) || 1200, H = (box && box.clientHeight) || 640, phone = W < 600;
  const reads = () => {
    const e = ctExtent(ctLayout());
    return Math.min(phone ? 9 : (W - 68) / e.w, (H - CT_HEAD - 40) / e.h) >= (phone ? .7 : .8);
  };
  const tried = new Set();
  let opened = 0;
  const branches = () => {
    while(opened < 5){
      let best = null;
      for(const n of ctLayout().nodes.values()){
        if(n.side <= 0 || !n.hidden || tried.has(n.key)) continue;
        const c = CT.g.by.get(n.key);
        const score = t.tall.get(n.key) * 100 + (c && +c.lv <= +S.level ? 40 : 0) - n.depth * 10 - Math.min(9, n.hidden);
        if(!best || score > best.score) best = {key: n.key, score};
      }
      if(!best) break;
      tried.add(best.key);
      CT.open.add(best.key);
      if(!reads()){ CT.open.delete(best.key); continue; }
      opened++;
    }
  };
  /* the tree's tiers before the next level's breadth: a branch is what the
     view is for */
  CT.gnext = false;
  branches();
  CT.gnext = true;
  if(reads()) branches(); else CT.gnext = false;
}

/* ---------------- layout ---------------- */

/* Whether a group is open: as the reader set it, or as every group was set
   from the header, or — by default — when its level is the reader's or
   below it, and the next one up where the tree has the room (ctAutoOpen). */
function ctGroupOpen(key, lv){
  if(CT.gopen.has(key)) return CT.gopen.get(key);
  if(CT.gall) return CT.gall === "open";
  return +lv <= +S.level || (+lv === +S.level + 1 && CT.gnext);
}
const ctGroupKey = (h, lv) => `▦${h}|${lv}`;

/* A horizontal tidy tree, both ways from the root: each node's branches are
   stacked in the band it is given and it sits at their middle. The root is
   at 0,0; a tier is a column CT_COL wide. A family bigger than CT_ROWS goes
   in groups under its branches; a group is placed at the middle of its name
   strip, on its left edge, which is where the link from the parent comes in,
   and its tiles in rows under the name, the first column on the tier's own. */
function ctLayout(){
  const t = CT.tree, nodes = new Map(), links = [];
  const box = $("#ctree");
  const W = (box && box.clientWidth) || 1200, H = (box && box.clientHeight) || 640;
  CT_COL = W < 600 ? CT_COL_NARROW : CT_COL_WIDE;
  const shown = h => h === t.root || CT.open.has(h) ? t.branches.get(h) || [] : [];
  const parts = h => CT.makes.get(h) || [];
  const branchy = k => CT.open.has(k) && (t.branches.get(k) || []).length > 0;
  const gcols = W < 600 ? CT_GCOLS_NARROW : ctGroupCols(W, H, shown(t.root).filter(k => !branchy(k)), shown(t.root).filter(branchy).length);

  /* A family's groups, one a level from the lowest, each laid in rows as
     even as the most a row holds allows — fourteen are two rows of seven, not
     eight and six — and all of one family the same width, so they stack as
     one column of cards. The levels folded are not cards but chips, on one
     shelf under the cards: a folded level costs a chip's width, not a row. */
  const groupsOf = (h, list) => {
    const by = new Map();
    for(const k of list){
      const lv = CT.g.by.get(k).lv;
      if(!by.has(lv)) by.set(lv, []);
      by.get(lv).push(k);
    }
    const all = [...by].sort((a, b) => +a[0] - +b[0]).map(([lv, ks]) => {
      const rows = Math.ceil(ks.length / gcols), cols = Math.ceil(ks.length / rows), key = ctGroupKey(h, lv);
      return {key, kind: "group", lv, list: ks, rows, cols, open: ctGroupOpen(key, lv),
        known: ks.filter(k => ctKnown(k) > 0).length};
    });
    const w = Math.max(W < 600 ? 250 : 330, Math.max(...all.map(g => g.cols)) * CT_GCELL + CT_GPAD * 2);
    const out = all.filter(g => g.open);
    for(const g of out){ g.w = w; g.h = CT_GHEAD + g.rows * CT_GCELL_H + CT_GPAD / 2; }
    const shut = all.filter(g => !g.open);
    if(shut.length){
      /* the shelf's chips wrap where the width runs out: a label's worth and
         then a chip's worth each */
      const lines = Math.ceil((130 + shut.length * 98) / (w - 24));
      out.push({key: `▤${h}`, kind: "fold", lv: "", list: shut.flatMap(g => g.list), shut, w,
        h: lines > 1 ? 10 + lines * 33 : CT_GHEAD});
    }
    return out;
  };

  const side = (dir, kidsOf) => {
    const box = new Map();
    const measure = (h, d = 0) => {
      const list = kidsOf(h);
      const b = {rows: [], groups: [], inner: 0, height: h === t.root ? CT_ROOT + 56 : CT_ROW};
      if(list.length){
        if(dir < 0 || list.length <= CT_ROWS) b.rows = list;
        else{
          b.rows = list.filter(branchy);
          b.groups = groupsOf(h, list.filter(k => !branchy(k)));
        }
        for(const k of b.rows) b.inner += measure(k, d + 1);
        for(const g of b.groups) b.inner += g.h + CT_GGAP;
        b.height = Math.max(b.height, b.inner);
      }
      box.set(h, b);
      return b.height;
    };
    const place = (h, d, top, from) => {
      const b = box.get(h);
      let y = top + b.height / 2;
      if(b.rows.length || b.groups.length){
        const ys = [];
        let cy = top + (b.height - b.inner) / 2;
        for(const k of b.rows){
          place(k, d + 1, cy, h);
          ys.push(nodes.get(k).y);
          cy += box.get(k).height;
        }
        const gx = dir * (d + 1) * CT_COL - CT_GCELL / 2 - CT_GPAD;
        for(const g of b.groups){
          const hy = cy + CT_GHEAD / 2;
          nodes.set(g.key, {key: g.key, kind: g.kind, box: true, x: gx, y: hy, w: g.w, h: g.h, side: dir, depth: d + 1,
            parent: h, of: h, lv: g.lv, list: g.list, open: g.open, known: g.known, shut: g.shut});
          links.push({a: h, b: g.key, group: true, lv: g.lv});
          ys.push(hy);
          if(g.kind === "group") g.list.forEach((k, i) => {
            const col = i % g.cols, row = Math.floor(i / g.cols), kids = t.branches.get(k);
            nodes.set(k, {key: k, kind: "char",
              x: gx + CT_GPAD + CT_GCELL / 2 + col * CT_GCELL,
              y: cy + CT_GHEAD + row * CT_GCELL_H + CT_GCELL_H / 2 - 12,
              side: dir, depth: d + 1, parent: g.key, grid: g.key, of: h,
              hidden: kids ? kids.length : 0, opened: false});
          });
          cy += g.h + CT_GGAP;
        }
        y = (ys[0] + ys[ys.length - 1]) / 2;
      }
      if(h === t.root && dir < 0) return y;
      const kids = dir > 0 ? t.branches.get(h) : null;
      nodes.set(h, {key: h, kind: CT.g.by.has(h) ? "char" : "part",
        x: dir * d * CT_COL, y, side: h === t.root ? 0 : dir, depth: d, parent: from,
        hidden: kids && h !== t.root && !CT.open.has(h) ? kids.length : 0,
        opened: !!kids && h !== t.root && CT.open.has(h)});
      if(from !== undefined) links.push(dir > 0 ? {a: from, b: h} : {a: h, b: from});
      return y;
    };
    measure(t.root);
    return () => place(t.root, 0, 0, undefined);
  };

  const ry = side(1, shown)();
  for(const n of nodes.values()) n.y -= ry;
  const before = new Set(nodes.keys());
  const ly = side(-1, parts)();
  for(const n of nodes.values()) if(!before.has(n.key)) n.y -= ly;
  for(const w of links){
    w.id = `${w.a}>${w.b}`;
    if(w.group){
      /* a group's link is lit as soon as one of its characters is met */
      w.lit = nodes.get(w.b).list.some(k => ctKnown(k) > 0);
      continue;
    }
    const child = nodes.get(w.b), from = nodes.get(w.a);
    w.tag = child && child.side > 0 ? ctTag(w.b, w.a) : "";
    w.lit = ctKnown(w.b) > 0 && (from.kind !== "char" || ctKnown(w.a) > 0 || w.a === t.root);
  }
  /* the tiers there are, left to right, for the bands and their names */
  const tiers = [...new Set([...nodes.values()].map(n => n.side < 0 ? -n.depth : n.depth))].sort((a, b) => a - b);
  return {nodes, links, tiers};
}

/* How many tiles a group's row holds: of four to ten, the number that lets
   the root's family be shown largest on the canvas — wide groups are short
   and narrow ones tall, and the canvas is one shape, which this matches.
   One number for every group in the tree, so they line up. */
function ctGroupCols(W, H, rest, branches){
  if(rest.length <= CT_ROWS) return 7;
  const lvs = new Map();
  for(const k of rest){ const lv = CT.g.by.get(k).lv; lvs.set(lv, (lvs.get(lv) || 0) + 1); }
  /* what lies left of the root: one tier of its parts, or two */
  const parts = CT.makes.get(CT.root) || [];
  const left = !parts.length ? CT_ROOT : parts.some(p => CT.makes.has(p)) ? CT_COL * 2 + CT_SLOT : CT_COL + CT_SLOT;
  const roomW = W - 68, roomH = H - CT_HEAD - 40;
  let best = null;
  for(let c = 4; c <= 10; c++){
    let h = branches * CT_ROW, shut = 0;
    for(const [lv, n] of lvs){
      if(ctGroupOpen(ctGroupKey(CT.root, lv), lv)) h += CT_GHEAD + CT_GGAP + Math.ceil(n / c) * CT_GCELL_H + CT_GPAD / 2;
      else shut++;
    }
    if(shut) h += CT_GHEAD + CT_GGAP;
    const w = left + CT_COL + Math.min(c, rest.length) * CT_GCELL + CT_GPAD * 2 + 40;
    const k = Math.min(roomW / w, roomH / h);
    if(!best || k > best.k + .005) best = {c, k};
  }
  return best.c;
}

/* The box the laid-out tree fills, in plane pixels. */
function ctExtent(lay){
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for(const n of lay.nodes.values()){
    if(n.box){
      const top = n.y - CT_GHEAD / 2;
      x0 = Math.min(x0, n.x - 12); x1 = Math.max(x1, n.x + n.w + 12);
      y0 = Math.min(y0, top - 10); y1 = Math.max(y1, top + n.h + 10);
      continue;
    }
    const half = ctHalf(n);
    x0 = Math.min(x0, n.x - half - (n.side > 0 && !n.grid ? 64 : 12));
    x1 = Math.max(x1, n.x + half + 22);
    y0 = Math.min(y0, n.y - half - 14);
    y1 = Math.max(y1, n.y + half + 28);
  }
  /* room for the note a root with nothing built on it carries */
  if(CT.tree && !(CT.tree.branches.get(CT.root) || []).length) x1 = Math.max(x1, CT_COL + 250);
  return {x0, x1, y0, y1, w: x1 - x0, h: y1 - y0};
}
/* How far a node's edge is from where it is placed — where a link meets it.
   A group is placed at its edge already. */
const ctHalf = n => n.box ? 0 : n.key === CT.root ? CT_ROOT / 2 : n.grid ? CT_CELLT / 2
  : n.kind === "part" ? CT_PART / 2 : CT_SLOT / 2;

/* ---------------- painting ---------------- */

function ctNodeClass(n){
  if(n.kind === "group") return `ct-group v${n.lv}${+n.lv > +S.level ? " lock" : ""}${+n.lv === +S.level ? " now" : ""}`;
  if(n.kind === "fold") return "ct-fold";
  const cls = ["ct-n"], c = CT.g.by.get(n.key);
  if(n.key === CT.root) cls.push("root");
  if(!c) cls.push("ct-comp");
  else{
    cls.push(`v${c.lv}`);
    if(+c.lv > +S.level) cls.push("lock");
    else if(c.lv === S.level) cls.push("now");
    const k = ctKnown(n.key);
    if(k === 2) cls.push("mastered"); else if(k === 1) cls.push("met");
  }
  if(n.side < 0) cls.push("making");
  if(n.grid) cls.push("ct-cell");
  if(n.hidden) cls.push("shut");
  if(n.opened) cls.push("open");
  if(n.key === CT.sel) cls.push("sel");
  return cls.join(" ");
}

/* A tile: the character and its reading, its level on a plate in the
   level's colour in the corner (with a lock above the reader's own), a mark
   on the other corner once it is met — a tick, or a star when mastered —
   its meaning under it, and on its right edge the knob that opens its
   branches: the count folded in it, or a bar when it is open. A tile in a
   group carries on its foot what else goes into it, which a branch carries
   on its link. A part has its gloss where a reading would be. */
function ctNodeHTML(n){
  if(n.kind === "group") return ctGroupHTML(n);
  if(n.kind === "fold") return ctFoldHTML(n);
  const a = ctAbout(n.key), c = a.c;
  const sub = c ? c.p : a.short;
  const known = c ? ctKnown(n.key) : 0;
  return `<span class="ct-g">${esc(n.key)}</span>`
    + (sub ? `<span class="ct-p">${esc(sub)}</span>` : "")
    + (c ? `<span class="ct-lv">${+c.lv > +S.level ? CT_LOCK : ""}${esc(levelLabel(c.lv))}</span>` : "")
    + (known ? `<span class="ct-st">${known === 2 ? CT_STAR : CT_TICK}</span>` : "")
    + (c && a.short ? `<span class="ct-e">${esc(a.short)}</span>` : "")
    + (n.grid ? ctPlate(n.key, n.of) : "")
    + (n.hidden ? `<span class="ct-knob" data-knob title="Open its ${n.hidden} branch${n.hidden === 1 ? "" : "es"}"><i>+</i>${n.hidden}</span>`
      : n.opened ? `<span class="ct-knob on" data-knob title="Fold its branch"></span>` : "");
}

/* A group's name strip: its level in the level's colour, how many it holds,
   how many of those are met, and where it stands against the reader's
   level. The strip is the button that folds it onto the shelf. */
function ctGroupHTML(n){
  const me = +S.level, lv = +n.lv;
  const where = lv === me ? "Your level" : lv === me + 1 ? "Next up" : lv > me ? "Above your level" : "";
  return `<button class="ct-gh" type="button" data-ct="group" data-arg="${esc(n.key)}" aria-expanded="true"
      title="Fold HSK ${esc(levelLabel(n.lv))}">
    <span class="ct-gl">HSK ${esc(levelLabel(n.lv))}</span>
    <span class="ct-gn">${num(n.list.length)}</span>
    ${n.known ? `<span class="ct-gk" title="${n.known} met">${CT_TICK}${num(n.known)}</span>` : ""}
    ${where ? `<span class="ct-gt">${lv > me ? CT_LOCK : ""}${where}</span>` : ""}
    <svg class="ct-gc" viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 10 4.5 4.5 4.5-4.5"/></svg>
  </button>`;
}
/* A family's folded levels, on one shelf under its cards: a chip a level,
   in the level's colour, with how many it holds and how many of those are
   met — each the button that opens its level as a card. */
function ctFoldHTML(n){
  const me = +S.level, above = n.shut.every(g => +g.lv > me);
  return `<span class="ct-fl">${above ? `${CT_LOCK}Above your level` : "Folded"}</span>` + n.shut.map(g =>
    `<button class="ct-fc v${g.lv}" type="button" data-ct="group" data-arg="${esc(g.key)}" aria-expanded="false"
      title="Open HSK ${esc(levelLabel(g.lv))}: ${esc(g.list.slice(0, 10).join(" "))}${g.list.length > 10 ? " …" : ""}"><i></i>HSK ${esc(levelLabel(g.lv))}<b>${num(g.list.length)}</b>${
      g.known ? `<em>${CT_TICK}${num(g.known)}</em>` : ""}</button>`).join("");
}

function ctLabel(n){
  if(n.box) return "";
  const a = ctAbout(n.key), o = n.grid ? ctOthers(n.key, n.of) : null;
  return [n.key, a.c ? a.c.p : "", a.en, a.c ? `HSK ${levelLabel(a.c.lv)}` : "component",
    a.c && +a.c.lv > +S.level ? "above your level" : "",
    o && o.others.length ? `${n.of} and ${o.others.join(" and ")}` : "",
    n.hidden ? `${n.hidden} branches folded` : ""].filter(Boolean).join(", ");
}

/* Lays the tree out and moves every node from where it is to where it now
   goes. A node arriving grows out of the nearest of its elders already on
   the canvas, in its turn: a tree grown afresh unfolds a tier at a time, and
   a branch opened lets its tiles out one after another. One leaving shrinks
   back into the nearest elder that stays.
   @param ms  how long each node's move takes; 0 places everything at once
   @param anchor  a node to hold still on screen while the tree moves round it
   @param by  "tier" to unfold tier by tier; otherwise arrivals go top to bottom */
function ctRender(ms = 420, anchor = "", by = ""){
  const plane = $("#ct-plane");
  if(!plane || !CT.tree) return;
  const lay = ctLayout();
  CT.lay = lay;

  const was = anchor && CT.recs.get(anchor) && !CT.recs.get(anchor).gone ? {...CT.recs.get(anchor).to} : null;
  const arriving = [];

  for(const n of lay.nodes.values()){
    let r = CT.recs.get(n.key);
    const fresh = !r || r.gone;
    if(r) r.delay = 0;
    if(!r){
      /* a group is a card under everything else on the plane, its name strip
         the button; a tile is a button */
      const el = document.createElement(n.box ? "div" : "button");
      if(n.box) plane.insertBefore(el, plane.firstChild);
      else{ el.type = "button"; plane.appendChild(el); }
      el.dataset.k = n.key;
      r = {key: n.key, el};
      CT.recs.set(n.key, r);
    }
    if(r.gone) r.el.classList.remove("gone");
    r.gone = false;
    r.parent = n.parent;
    r.node = n;
    const cls = ctNodeClass(n), html = ctNodeHTML(n);
    if(r.cls !== cls){ r.el.className = cls; r.cls = cls; }
    if(r.html !== html){
      r.el.innerHTML = html; r.html = html;
      if(!n.box) r.el.setAttribute("aria-label", ctLabel(n));
    }
    if(n.box){
      const size = `${n.w}x${n.h}`;
      if(r.size !== size){ r.el.style.width = `${n.w}px`; r.el.style.height = `${n.h}px`; r.size = size; }
    }
    r.to = {x: n.x, y: n.y, s: 1, o: 1};
    if(fresh){
      /* a group fades up where it stands; a tile grows out of its elder */
      const from = n.box ? null : ctElder(n.parent, lay);
      r.cur = from ? {x: from.x, y: from.y, s: .3, o: 0} : {x: n.x, y: n.y, s: n.box ? 1 : .7, o: 0};
      r.delay = 0;
      arriving.push(r);
    }
    r.from = {...r.cur};
  }
  /* Each arrival's turn. By tier: the tier sets the beat and a ripple runs
     down it; otherwise one after another from the top. Capped, so a big
     reveal does not keep the reader waiting. */
  if(ms && arriving.length > 1){
    /* a family of a hundred arriving at once ripples through in the same
       half second as a branch of four */
    const tier = r => Math.abs(r.node.depth), run = new Map(), step = Math.min(34, 560 / arriving.length);
    const order = r => r.node.box ? r.node.y - CT_GHEAD / 2 : r.node.y;
    arriving.sort((a, b) => by === "tier" ? tier(a) - tier(b) || order(a) - order(b) : order(a) - order(b) || a.node.x - b.node.x);
    arriving.forEach((r, i) => {
      const t = tier(r), n = run.get(t) || 0;
      run.set(t, n + 1);
      r.delay = Math.round(by === "tier" ? Math.min(560, t * 110 + n * Math.min(18, step)) : i * step);
    });
  }
  for(const r of arriving) r.pop = !r.node.box;
  for(const r of CT.recs.values()){
    if(lay.nodes.has(r.key)) continue;
    r.from = {...r.cur};
    r.delay = 0;
    if(r.gone) continue;
    r.gone = true;
    /* on its way out: seen, not touched */
    r.el.classList.add("gone");
    /* a group fades where it stands; a tile shrinks back into the nearest
       elder that stays — into the name strip of a group folding round it */
    if(r.node && r.node.box){ r.to = {...r.cur, s: 1, o: 0}; continue; }
    let k = r.parent, to = null;
    for(let i = 0; i < 60 && k !== undefined && !to; i++){
      const n = lay.nodes.get(k);
      if(n) to = n.box ? {x: n.x + 70, y: n.y} : n;
      else{ const up = CT.recs.get(k); k = up && up.parent; }
    }
    r.to = to ? {x: to.x, y: to.y, s: .3, o: 0} : {...r.cur, s: .7, o: 0};
  }

  const links = $("#ct-wires"), tags = $("#ct-tags");
  const live = new Set();
  for(const w of lay.links){
    live.add(w.id);
    let rec = CT.wires.get(w.id);
    if(!rec){
      const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      links.appendChild(el);
      rec = {id: w.id, el, tag: null};
      CT.wires.set(w.id, rec);
    }
    rec.a = w.a; rec.b = w.b; rec.gone = false;
    if(rec.tag) rec.tag.classList.remove("gone");
    const making = lay.nodes.get(w.b).side < 0 || lay.nodes.get(w.a).side < 0;
    const cls = `ct-l${w.group ? ` grp${w.lv ? ` v${w.lv}` : " fold"}` : ""}${w.lit ? " lit" : ""}${making ? " making" : ""}`;
    if(rec.cls !== cls){ rec.el.setAttribute("class", cls); rec.cls = cls; }
    if(w.tag && !rec.tag){
      rec.tag = document.createElement("span");
      rec.tag.className = "ct-tag";
      tags.appendChild(rec.tag);
    }
    if(rec.tag && rec.tagHTML !== (w.tag || "")){
      rec.tag.innerHTML = w.tag || "";
      rec.tag.hidden = !w.tag;
      rec.tagHTML = w.tag || "";
    }
  }
  for(const rec of CT.wires.values()) if(!live.has(rec.id)){ rec.gone = true; if(rec.tag) rec.tag.classList.add("gone"); }

  if(was && lay.nodes.has(anchor)){
    const now = lay.nodes.get(anchor), k = CT.cam.k;
    ctCamTo({x: CT.cam.x - (now.x - was.x) * k, y: CT.cam.y - (now.y - was.y) * k, k}, ms);
  }
  ctPaintNone();
  ctPaintTiers();
  ctTween(ms);
}

/* The tiers' names in the header, one over each band. */
function ctPaintTiers(){
  const row = $("#ct-tiers");
  if(!row || !CT.lay) return;
  const name = d => d === -1 ? "Made of" : d < 0 ? "" : d === 0 ? "Root" : `Tier ${d}`;
  const want = CT.lay.tiers.filter(d => name(d)).map(d => `${d}`).join(",");
  if(row.dataset.tiers !== want){
    row.dataset.tiers = want;
    row.innerHTML = want ? want.split(",").map(d => `<span data-d="${d}">${name(+d)}</span>`).join("") : "";
  }
  ctPlaceTiers();
  ctMarkTier();
}
function ctPlaceTiers(){
  const row = $("#ct-tiers");
  if(!row) return;
  const {x, k} = CT.cam;
  for(const s of row.children){
    const sx = x + +s.dataset.d * CT_COL * k;
    s.style.transform = `translate(${sx.toFixed(1)}px,-50%) translateX(-50%)`;
    s.style.visibility = sx > CT.head.l && sx < CT.head.r ? "" : "hidden";
  }
}

/* The bands under the tiers, every other one tinted, drawn as one gradient
   across the canvas from where the camera has them. */
function ctPaintBands(){
  const bands = $("#ct-bands");
  if(!bands || !CT.lay) return;
  const {x, k} = CT.cam, half = CT_COL / 2 * k, stops = [];
  for(const d of CT.lay.tiers){
    if(!(d & 1)) continue;
    const a = (x + d * CT_COL * k - half).toFixed(1), b = (x + d * CT_COL * k + half).toFixed(1);
    stops.push(`transparent ${a}px`, `var(--ct-band) ${a}px`, `var(--ct-band) ${b}px`, `transparent ${b}px`);
  }
  bands.style.backgroundImage = stops.length ? `linear-gradient(90deg,${stops.join(",")})` : "none";
}

/* A root nothing is built on — 好, 吃 — says so where its branches would
   be, and offers the levels above where there are some there. */
function ctPaintNone(){
  const plane = $("#ct-plane");
  let el = $("#ct-none");
  const empty = CT.tree && !(CT.tree.branches.get(CT.root) || []).length;
  if(!empty){ if(el) el.remove(); return; }
  if(!el){
    el = document.createElement("div");
    el.id = "ct-none";
    el.className = "ct-none";
    plane.appendChild(el);
  }
  const level = S.treeReach === "level";
  const above = level ? (CT.g.kids.get(CT.root) || []).length : 0;
  el.style.transform = `translate(${CT_COL - CT_SLOT / 2}px,0) translateY(-50%)`;
  el.innerHTML = `<p>Nothing in the syllabus ${level ? `up to HSK ${esc(levelLabel(S.level))} ` : ""}is built on
    <b class="hz">${esc(CT.root)}</b>.</p>${above
      ? `<button class="ghost" data-ct="all">Every level · ${num(above)} built on it</button>`
      : `<p class="ct-none-sub">Its parts, to its left, each grow a tree of their own.</p>`}`;
}

/* Where an arriving node starts: the position, as it stands, of the nearest
   of its elders that is already drawn — for a tile in a group, the group's
   name strip, which it comes out of. */
function ctElder(k, lay){
  for(let i = 0; i < 60 && k !== undefined; i++){
    const r = CT.recs.get(k);
    if(r && !r.gone && r.cur) return r.node && r.node.box ? {x: r.cur.x + 70, y: r.cur.y} : r.cur;
    const n = lay.nodes.get(k);
    k = n && n.parent;
  }
  return null;
}

/* ---------------- motion ---------------- */

/* Every node runs on its own clock from t0 — its own delay, then ms — so a
   tree can unfold in turns; the move ends when the last one lands. */
function ctTween(ms){
  cancelAnimationFrame(CT.raf);
  clearTimeout(CT.timer);
  const t0 = performance.now();
  let last = 0;
  for(const r of CT.recs.values()) last = Math.max(last, r.delay || 0);
  const span = ms + last;
  const end = () => {
    cancelAnimationFrame(CT.raf);
    clearTimeout(CT.timer);
    ctFrame(Infinity, ms);
    for(const r of CT.recs.values()){ r.delay = 0; r.pop = false; }
    ctSettle();
    ctMapSoon();
  };
  if(!ms || REDUCED()){ end(); return; }
  /* where everything starts, before anything is painted */
  ctFrame(0, ms);
  const step = now => {
    const t = now - t0;
    ctFrame(t, ms);
    if(t < span) CT.raf = requestAnimationFrame(step);
    else end();
  };
  CT.raf = requestAnimationFrame(step);
  /* a page that is not being drawn runs no frames: it lands regardless */
  CT.timer = setTimeout(end, span + 250);
}

/* One frame, t ms into the move. Position eases out; an arriving tile's
   size overshoots a touch and settles, so it pops out of its branch rather
   than fading up. */
const ctOut = p => 1 - Math.pow(1 - p, 3);
const ctPop = p => 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2);
function ctFrame(t, ms){
  for(const r of CT.recs.values()){
    const f = r.from, to = r.to, c = r.cur;
    const p = t === Infinity || !ms ? 1 : Math.min(1, Math.max(0, (t - (r.delay || 0)) / ms));
    const e = ctOut(p), s = r.pop ? ctPop(p) : e;
    c.x = f.x + (to.x - f.x) * e; c.y = f.y + (to.y - f.y) * e;
    c.s = f.s + (to.s - f.s) * s; c.o = f.o + (to.o - f.o) * Math.min(1, e * 1.6);
    const tf = `translate(${c.x.toFixed(1)}px,${c.y.toFixed(1)}px)${Math.abs(c.s - 1) > .001 ? ` scale(${c.s.toFixed(3)})` : ""}`;
    if(r.tf !== tf){ r.el.style.transform = tf; r.tf = tf; }
    const o = c.o > .999 ? "" : c.o.toFixed(3);
    if(r.op !== o){ r.el.style.opacity = o; r.op = o; }
  }
  ctWires();
}

/* The links, redrawn from where their two ends are now, and each one's tag
   sat on it just short of the tile it leads to. The way to the tile picked
   burns; the way to the tile under the pointer, and its own branches, warm. */
function ctWires(){
  const route = ctRoute(CT.sel);
  const near = ctRoute(CT.hover);
  if(CT.hover) for(const w of CT.wires.values()) if(w.a === CT.hover) near.add(w.id);
  let glow = "";
  for(const w of CT.wires.values()){
    const A = CT.recs.get(w.a), B = CT.recs.get(w.b);
    if(!A || !B) continue;
    const ax = A.cur.x + ctHalf(A.node) * A.cur.s, ay = A.cur.y;
    const bx = B.cur.x - ctHalf(B.node) * B.cur.s, by = B.cur.y;
    const dx = Math.max(26, (bx - ax) * .52);
    const d = `M${ax.toFixed(1)} ${ay.toFixed(1)}C${(ax + dx).toFixed(1)} ${ay.toFixed(1)} ${(bx - dx).toFixed(1)} ${by.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    if(w.d !== d){ w.el.setAttribute("d", d); w.d = d; }
    const o = Math.min(A.cur.o, B.cur.o);
    const os = o > .999 ? "" : o.toFixed(3);
    if(w.op !== os){ w.el.style.opacity = os; if(w.tag) w.tag.style.opacity = os; w.op = os; }
    if(w.tag){
      const tf = `translate(${(bx - 12).toFixed(1)}px,${by.toFixed(1)}px)`;
      if(w.tf !== tf){ w.tag.style.transform = tf; w.tf = tf; }
    }
    const on = route.has(w.id) && !w.gone;
    if(w.on !== on){ w.el.classList.toggle("path", on); if(w.tag) w.tag.classList.toggle("path", on); w.on = on; }
    const warm = !on && near.has(w.id) && !w.gone;
    if(w.warm !== warm){ w.el.classList.toggle("warm", warm); w.warm = warm; }
    if(on) glow += d;
  }
  $("#ct-glow").setAttribute("d", glow);
  $("#ct-flow").setAttribute("d", glow);
}

/* The links between the root and a node — a tile in a group goes by way of
   its group's link. */
function ctRoute(key){
  const out = new Set();
  if(!key || !CT.lay) return out;
  let n = CT.lay.nodes.get(key);
  for(let i = 0; i < 60 && n && n.parent !== undefined; i++){
    out.add(n.side > 0 ? `${n.parent}>${n.key}` : `${n.key}>${n.parent}`);
    n = CT.lay.nodes.get(n.parent);
  }
  return out;
}

/* A move done: what left is taken away. */
function ctSettle(){
  for(const r of [...CT.recs.values()]) if(r.gone){ r.el.remove(); CT.recs.delete(r.key); }
  for(const w of [...CT.wires.values()]) if(w.gone){ w.el.remove(); if(w.tag) w.tag.remove(); CT.wires.delete(w.id); }
}

/* ---------------- the camera ---------------- */

function ctCam(){
  const {x, y, k} = CT.cam, box = $("#ctree");
  $("#ct-plane").style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
  /* The dots are the floor the tree stands over: they move at half the
     tree's pace and grow at the root of its zoom, so the tree reads as
     above them; they thin out by half when zooming out would crowd them. */
  let g = CT_DOT * Math.sqrt(k);
  while(g < 15) g *= 2;
  box.style.backgroundSize = `${g.toFixed(2)}px ${g.toFixed(2)}px`;
  box.style.backgroundPosition = `${(x * .5).toFixed(1)}px ${(y * .5).toFixed(1)}px`;
  box.classList.toggle("far", k < .6);
  /* The small targets — a knob, a tag's part — keep about their size on the
     screen as the view draws back: their reach grows by 1 / k, in steps. */
  const reach = clamp(1 / k, 1, 2.2).toFixed(1);
  if(CT.reachK !== reach){ CT.reachK = reach; box.style.setProperty("--ct-reach", reach); }
  ctPaintBands();
  ctPlaceTiers();
  ctMapSoon();
  ctHideTip();
}

function ctCamTo(to, ms = 420){
  ctStopCam();
  const from = {...CT.cam};
  const land = () => { ctStopCam(); Object.assign(CT.cam, to); ctCam(); };
  if(!ms || REDUCED()){ land(); return; }
  const t0 = performance.now();
  ctMoving();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
    CT.cam.x = from.x + (to.x - from.x) * e;
    CT.cam.y = from.y + (to.y - from.y) * e;
    CT.cam.k = from.k + (to.k - from.k) * e;
    ctCam();
    if(t < 1){ CT.camRaf = requestAnimationFrame(step); ctMoving(); }
    else land();
  };
  CT.camRaf = requestAnimationFrame(step);
  /* a page that is not being drawn runs no frames: the camera lands anyway */
  CT.camTimer = setTimeout(land, ms + 250);
}
/* Whatever the camera was doing on its own stops: a hand has taken it. */
function ctStopCam(){
  cancelAnimationFrame(CT.camRaf);
  cancelAnimationFrame(CT.glide);
  clearTimeout(CT.camTimer);
  CT.camRaf = CT.glide = 0;
}

/* The whole tree in view, at a size it can be read at. One too big for that
   is shown from its root's side: the root a third of the way in, and from
   the top of what it builds into while the root is still in view that way,
   centred on the root where it is not; the map in the corner shows the rest. */
function ctFit(ms = 420){
  const box = $("#ctree");
  if(!box || !CT.lay || !box.clientWidth || !box.clientHeight) return;
  const W = box.clientWidth, H = box.clientHeight;
  const e = ctExtent(CT.lay);
  const padX = 34, top = CT_HEAD + 18, room = H - top - 22;
  let k = Math.min((W - padX * 2) / e.w, room / e.h);
  /* A phone is narrower than any tree: there it keeps a size that can be
     read and leaves the branches running off to the right, to be dragged in. */
  k = clamp(k, W < 520 ? .72 : .66, 1.06);
  let x = (W - (e.x0 + e.x1) * k) / 2;
  let y = top + (room - (e.y0 + e.y1) * k) / 2;
  /* Wider than the canvas: the root a third of the way in — a fifth on a
     phone — so what it builds into is on screen and what it is made of is a
     drag away, but never with the canvas left empty past either end of the
     tree. */
  if(e.w * k > W - padX * 2) x = clamp(W * (W < 520 ? .2 : .3), W - padX - e.x1 * k, padX - e.x0 * k);
  if(e.h * k > room) y = -e.y0 * k < room - CT_ROOT ? top + 6 - e.y0 * k : top + room / 2;
  ctCamTo({x, y, k}, ms);
}

function ctZoomAt(px, py, k){
  k = clamp(k, CT_ZMIN, CT_ZMAX);
  const c = CT.cam, wx = (px - c.x) / c.k, wy = (py - c.y) / c.k;
  c.x = px - wx * k; c.y = py - wy * k; c.k = k;
  ctCam();
}
function ctZoomBy(f){
  const box = $("#ctree");
  const to = clamp(CT.cam.k * f, CT_ZMIN, CT_ZMAX), px = box.clientWidth / 2, py = (box.clientHeight + CT_HEAD) / 2;
  const c = CT.cam, wx = (px - c.x) / c.k, wy = (py - c.y) / c.k;
  CT.touched = true;
  ctCamTo({x: px - wx * to, y: py - wy * to, k: to}, 220);
}

/* The part of the canvas nothing stands over: the panel, where it is a
   card over the canvas rather than beside it, and the map. */
function ctClear(){
  const box = $("#ctree"), W = box.clientWidth, H = box.clientHeight;
  let right = W, low = H - 44;
  const insp = $("#ct-insp");
  if(insp && !insp.hidden && !ctDocked()){
    /* across most of the canvas it is a sheet at its foot; else a card at its side */
    const b = box.getBoundingClientRect(), r = insp.getBoundingClientRect();
    if(r.width > b.width * .7) low = Math.min(low, r.top - b.top - 50);
    else right = Math.min(right, r.left - b.left - 16);
  }
  return {W, H, right, low};
}

/* Bring a node on screen if it is off it, under the header, or under the
   panel or the map. */
function ctReveal(key, ms = 360){
  const box = $("#ctree"), n = CT.lay && CT.lay.nodes.get(key);
  if(!box || !n) return;
  const {x, y, k} = CT.cam, {W, right, low: lowest} = ctClear();
  const sx = x + n.x * k, sy = y + n.y * k, m = 76;
  const map = $("#ct-map");
  let low = lowest;
  if(map && map.offsetParent && sx > map.offsetLeft - 40) low = Math.min(low, map.offsetTop - 50);
  let nx = x, ny = y;
  if(sx < m) nx += m - sx; else if(sx > Math.min(W, right) - m) nx -= sx - (Math.min(W, right) - m);
  if(sy < CT_HEAD + m) ny += CT_HEAD + m - sy; else if(sy > low) ny -= sy - low;
  if(nx !== x || ny !== y) ctCamTo({x: nx, y: ny, k}, ms);
}
/* Bring a group on screen, its name strip first and as much of it under
   that as there is room for. */
function ctRevealGroup(key, ms = 420){
  const n = CT.lay && CT.lay.nodes.get(key);
  if(!n) return;
  const {x, y, k} = CT.cam, {right, low} = ctClear(), m = 24;
  const top = n.y - CT_GHEAD / 2;
  const sx0 = x + n.x * k, sx1 = x + (n.x + n.w) * k, sy0 = y + top * k, sy1 = y + (top + n.h) * k;
  let nx = x, ny = y;
  if(sx1 > right - m) nx -= Math.min(sx1 - (right - m), sx0 - m);
  else if(sx0 < m) nx += m - sx0;
  if(sy1 > low + 30) ny -= Math.min(sy1 - (low + 30), sy0 - (CT_HEAD + m));
  else if(sy0 < CT_HEAD + m) ny += CT_HEAD + m - sy0;
  if(nx !== x || ny !== y) ctCamTo({x: nx, y: ny, k}, ms);
}

/* While the camera moves the plane is its own layer, so a pan is the
   compositor sliding a picture; once it stops the layer goes and the text is
   drawn sharp again at the new size. */
function ctMoving(){
  const box = $("#ctree");
  box.classList.add("moving");
  clearTimeout(CT.idle);
  CT.idle = setTimeout(() => box.classList.remove("moving"), 180);
}

/* ---------------- the map ---------------- */

/* The whole tree in miniature in the corner — every tile a dot in the
   colour it is lit, every group a panel, the view a frame on it. Drawn on
   the next frame after anything moves, at most once a frame. */
function ctMapSoon(){
  if(CT.mapRaf) return;
  /* a frame, or a beat where frames are not running (a hidden page) */
  const draw = () => { if(!CT.mapRaf) return; cancelAnimationFrame(CT.mapRaf); clearTimeout(CT.mapTimer); CT.mapRaf = 0; ctDrawMap(); };
  CT.mapRaf = requestAnimationFrame(draw);
  CT.mapTimer = setTimeout(draw, 120);
}
function ctDrawMap(){
  const panel = $("#ct-map"), cv = $("#ct-mapc"), box = $("#ctree");
  if(!panel || !CT.lay || !box.offsetParent) return;
  /* With the whole tree on screen the map says nothing the canvas does not:
     it folds away to the key, and comes back once some of the tree is off. */
  {
    const e = ctExtent(CT.lay), {x, y, k} = CT.cam;
    const whole = x + e.x0 * k > -4 && x + e.x1 * k < box.clientWidth + 4
      && y + e.y0 * k > CT_HEAD - 4 && y + e.y1 * k < box.clientHeight + 4;
    panel.classList.toggle("whole", whole);
    if(whole || !cv.offsetParent) return;
  }
  const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
  if(cv.width !== Math.round(W * dpr)){ cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const e = ctExtent(CT.lay), pad = 8;
  const s = Math.min((W - pad * 2) / e.w, (H - pad * 2) / e.h);
  const ox = (W - e.w * s) / 2 - e.x0 * s, oy = (H - e.h * s) / 2 - e.y0 * s;
  CT.map = {s, ox, oy};
  const cs = getComputedStyle(document.documentElement), tok = n => cs.getPropertyValue(n).trim();
  const ink = tok("--line-hot"), acc = tok("--acc"), soft = tok("--ink-soft"), muted = tok("--muted");
  g.lineWidth = 1;
  g.strokeStyle = ink;
  g.globalAlpha = .7;
  g.beginPath();
  for(const w of CT.lay.links){
    const a = CT.lay.nodes.get(w.a), b = CT.lay.nodes.get(w.b);
    g.moveTo(ox + a.x * s, oy + a.y * s);
    g.lineTo(ox + b.x * s, oy + b.y * s);
  }
  g.stroke();
  g.globalAlpha = 1;
  /* groups as the panels they are, under their tiles' dots, each edged in
     its level's colour */
  for(const n of CT.lay.nodes.values()){
    if(!n.box) continue;
    g.fillStyle = soft;
    g.globalAlpha = .12;
    g.fillRect(ox + n.x * s, oy + (n.y - CT_GHEAD / 2) * s, n.w * s, n.h * s);
    if(n.lv){
      g.globalAlpha = .9;
      g.fillStyle = tok(`--hsk-${n.lv}`) || soft;
      g.fillRect(ox + n.x * s, oy + (n.y - CT_GHEAD / 2) * s, 2, Math.max(2, n.h * s));
    }
  }
  g.globalAlpha = 1;
  for(const n of CT.lay.nodes.values()){
    if(n.box) continue;
    const c = CT.g.by.get(n.key), known = c ? ctKnown(n.key) : 0;
    const r = n.key === CT.root ? 3.6 : n.grid ? 1.8 : 2.3;
    g.fillStyle = n.key === CT.root || known ? acc : c && +c.lv > +S.level ? muted : soft;
    g.globalAlpha = c && +c.lv > +S.level && !known ? .55 : 1;
    g.beginPath();
    g.arc(ox + n.x * s, oy + n.y * s, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  /* the view: the canvas below the header, in tree pixels */
  const {x, y, k} = CT.cam, BW = box.clientWidth, BH = box.clientHeight;
  const vx = (0 - x) / k, vy = (CT_HEAD - y) / k, vw = BW / k, vh = (BH - CT_HEAD) / k;
  g.strokeStyle = acc;
  g.lineWidth = 1.5;
  g.strokeRect(ox + vx * s, oy + vy * s, vw * s, vh * s);
  g.fillStyle = acc;
  g.globalAlpha = .08;
  g.fillRect(ox + vx * s, oy + vy * s, vw * s, vh * s);
  g.globalAlpha = 1;
}
/* A press or a drag on the map takes the view there. */
function ctMapTo(e){
  const cv = $("#ct-mapc"), box = $("#ctree");
  if(!CT.map) return;
  const r = cv.getBoundingClientRect(), {s, ox, oy} = CT.map;
  const wx = (e.clientX - r.left - ox) / s, wy = (e.clientY - r.top - oy) / s;
  const k = CT.cam.k;
  CT.cam.x = box.clientWidth / 2 - wx * k;
  CT.cam.y = (box.clientHeight + CT_HEAD) / 2 - wy * k;
  CT.touched = true;
  ctCam(); ctMoving();
}

/* ---------------- picking and opening ---------------- */

function ctSelect(key, opts = {}){
  if(key && !(CT.lay && CT.lay.nodes.has(key) && !CT.lay.nodes.get(key).box)) key = "";
  const prev = CT.sel;
  CT.sel = key;
  for(const k of [prev, key]){
    const r = k && CT.recs.get(k);
    if(r && r.node){ const cls = ctNodeClass(r.node); if(r.cls !== cls){ r.el.className = cls; r.cls = cls; } }
  }
  ctWires();
  ctMarkTier();
  ctPaintInsp();
  if(key && opts.focus){ const r = CT.recs.get(key); if(r) r.el.focus({preventScroll: true}); }
  if(key && opts.reveal !== false) ctReveal(key);
}

/* A character's branch opened or folded. Opened, a character in a group
   leaves it for a row of its own; the view keeps it where it was on the
   screen while the tree moves round it. */
function ctToggle(key){
  if(!CT.tree.branches.has(key) || key === CT.root) return;
  if(CT.open.has(key)) CT.open.delete(key); else CT.open.add(key);
  CT.touched = true;
  ctRender(420, key);
  ctPaintInsp();
}

/* A level opened off the shelf, or folded onto it. The shelf holds still
   on the screen while the cards above it grow or go — where there was a
   shelf before and is one after; otherwise the character the family is
   built on does. An opened level is then brought into view. */
function ctGroup(key){
  const m = /^▦(.+)\|(\d)$/u.exec(key || "");
  if(!m || !CT.lay) return;
  const [, h, lv] = m, open = ctGroupOpen(key, lv), shelf = `▤${h}`;
  CT.gopen.set(key, !open);
  CT.touched = true;
  const sel = CT.sel && CT.lay.nodes.get(CT.sel);
  if(open && sel && sel.grid === key) ctSelect("", {reveal: false});
  const anchor = CT.recs.has(shelf) && ctLayout().nodes.has(shelf) ? shelf : h;
  ctRender(380, anchor);
  if(!open) setTimeout(() => ctRevealGroup(key), 420);
  ctPaintInsp();
}

/* Every group open, or every group folded, from the header — or back to
   what the reader's level opens, with the same button pressed again. */
function ctAllGroups(how){
  CT.gall = CT.gall === how ? "" : how;
  CT.gopen = new Map();
  CT.touched = false;
  if(CT.sel && !ctLayout().nodes.has(CT.sel)) CT.sel = "";
  ctRender(460);
  ctFit(520);
  ctPaintTools();
  ctPaintInsp();
}

/* Whatever stands between the root and a character opened, so it is on the
   canvas: its elders' branches, and the group it is in. Whether anything
   had to open. */
function ctEnsure(key){
  const t = CT.tree;
  let changed = false;
  for(let k = key, i = 0; i < 60 && k !== t.root; i++){
    const p = t.parent.get(k);
    if(p === undefined) break;
    if(p !== t.root && !CT.open.has(p)){ CT.open.add(p); changed = true; }
    const sibs = t.branches.get(p) || [];
    if(sibs.length > CT_ROWS && !(CT.open.has(k) && (t.branches.get(k) || []).length)){
      const lv = CT.g.by.get(k).lv, gk = ctGroupKey(p, lv);
      if(!ctGroupOpen(gk, lv)){ CT.gopen.set(gk, true); changed = true; }
    }
    k = p;
  }
  return changed;
}

/* The keys, while the tree is on screen: the arrows walk it — right along a
   branch (opening it first), left back towards the root and past it into
   what the root is made of, up and down among siblings, cell by cell in a
   group — Enter opens the entry, space folds a branch, +, − and 0 zoom, F
   takes the whole window, G grows a tree from the tile picked and Backspace
   goes back along the trail. */
function treeKey(e){
  if(S.view !== "chars" || S.charView !== "tree" || !CT.lay || C.query.trim()) return false;
  const k = e.key, onButton = e.target && e.target.closest && e.target.closest("button");
  if(k === "+" || k === "="){ e.preventDefault(); ctZoomBy(1.25); return true; }
  if(k === "-" || k === "_"){ e.preventDefault(); ctZoomBy(.8); return true; }
  if(k === "0"){ e.preventDefault(); CT.touched = false; ctFit(); return true; }
  if(k === "f" || k === "F"){ e.preventDefault(); ctMax(); return true; }
  if((k === "g" || k === "G") && CT.sel && CT.sel !== CT.root){ e.preventDefault(); ctStart(CT.sel, {trail: true}); return true; }
  if(k === "Backspace" && CT.trail.length){ e.preventDefault(); ctCommand("back", CT.trail.length - 1); return true; }
  if(k === "Escape" && CT.sel){ e.preventDefault(); ctSelect(""); return true; }
  if(k === "Escape" && document.body.classList.contains("ct-max")){ e.preventDefault(); ctMax(false); return true; }
  if(k.startsWith("Arrow")){
    if(onButton && !onButton.closest("#ctree")) return false;
    e.preventDefault(); ctStep(k); return true;
  }
  if((k === "Enter" || k === " ") && CT.sel && !onButton){
    e.preventDefault();
    if(k === " ") ctToggle(CT.sel);
    else ctActivate(CT.sel);
    return true;
  }
  return false;
}

/* A node used: a character opens its entry, a part with no entry grows its
   own tree. */
function ctActivate(key){
  if(CT.g.by.has(key)) safely("open that entry", () => openChar(key));
  else ctStart(key, {trail: true});
}

function ctStep(dir){
  const lay = CT.lay, cur = lay.nodes.get(CT.sel);
  if(!cur){ ctSelect(CT.root, {focus: true}); return; }
  /* a node's own: its branches, and the tiles in its groups */
  const owner = n => n.grid ? lay.nodes.get(n.grid).parent : n.parent;
  const kidsOf = (key, side) => [...lay.nodes.values()]
    .filter(n => !n.box && n.side === side && owner(n) === key).sort((a, b) => a.y - b.y || a.x - b.x);
  const middle = list => list[Math.floor((list.length - 1) / 2)];
  let next = null;
  if(cur.grid){
    /* in a group the arrows go cell by cell; left from its first column goes
       back to the character the group is built on, up and down past its
       edge to the nearest tile above or below — the next group's */
    const mates = [...lay.nodes.values()].filter(n => n.grid === cur.grid);
    const row = mates.filter(n => Math.abs(n.y - cur.y) < 2);
    if(dir === "ArrowRight"){
      next = row.filter(n => n.x > cur.x + 2).sort((a, b) => a.x - b.x)[0];
      if(!next){
        const below = mates.filter(n => n.y > cur.y + 2), top = Math.min(...below.map(n => n.y));
        next = below.filter(n => Math.abs(n.y - top) < 2).sort((a, b) => a.x - b.x)[0];
      }
    }else if(dir === "ArrowLeft") next = row.filter(n => n.x < cur.x - 2).sort((a, b) => b.x - a.x)[0] || lay.nodes.get(owner(cur));
    else{
      const down = dir === "ArrowDown";
      next = mates.filter(n => Math.abs(n.x - cur.x) < 2 && (down ? n.y > cur.y + 2 : n.y < cur.y - 2))
        .sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y))[0];
      if(!next){
        const near = [...lay.nodes.values()].filter(n => !n.box && n.side === cur.side && n.grid !== cur.grid
          && (down ? n.y > cur.y : n.y < cur.y));
        near.sort((a, b) => Math.abs(a.y - cur.y) + Math.abs(a.x - cur.x) * .5 - (Math.abs(b.y - cur.y) + Math.abs(b.x - cur.x) * .5));
        next = near[0];
      }
    }
  }else if(dir === "ArrowRight"){
    if(cur.side < 0) next = lay.nodes.get(cur.parent);
    else if(cur.hidden){ ctToggle(cur.key); return; }
    else next = middle(kidsOf(cur.key, 1));
  }else if(dir === "ArrowLeft"){
    if(cur.side > 0) next = lay.nodes.get(cur.parent);
    else next = middle(kidsOf(cur.key, -1));
  }else{
    const down = dir === "ArrowDown";
    const sibs = cur.parent === undefined ? [] : kidsOf(cur.parent, cur.side);
    const i = sibs.indexOf(cur);
    next = sibs[i + (down ? 1 : -1)];
    if(!next){
      /* the end of a run of siblings: the nearest node above or below in the same tier */
      const col = [...lay.nodes.values()].filter(n => !n.box && n.depth === cur.depth && n.side === cur.side && (down ? n.y > cur.y : n.y < cur.y));
      col.sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y));
      next = col[0];
    }
  }
  if(next) ctSelect(next.key, {focus: true});
}

/* ---------------- the panel ---------------- */

/* What the panel tells about a character: the character large, its strokes
   ready to play; its reading, level and where the reader stands with it; its
   meaning; how it is built, each part marked as the one that gives the
   meaning or the sound and each a way to grow the tree from it; what it
   builds into, level by level; and the words it is written in. With nothing
   picked, beside the canvas, it tells about the root and its family. */
function ctPaintInsp(){
  const el = $("#ct-insp");
  if(!el || !CT.tree) return;
  const docked = ctDocked();
  const key = CT.sel || (docked ? CT.root : "");
  const n = key && CT.lay && CT.lay.nodes.get(key);
  if(!n || n.box){
    el.hidden = true; el.innerHTML = ""; CT.insp = ""; CT.writer = null;
    return;
  }
  /* Drawn again only when there is something new to say: a new tile, the
     deck changed under it, its branch opened or folded, another level. */
  const stamp = [key, CT.root, S.level, S.treeReach, ctKnown(key), CT.deck.get(key) || 0, CT.open.has(key), docked, n.side].join("|");
  el.hidden = false;
  if(CT.insp === stamp) return;
  CT.insp = stamp;
  el.innerHTML = ctInspHTML(key, n, docked);
  el.querySelector(".ct-i-scroll").scrollTop = 0;
  const c = CT.g.by.get(key);
  CT.writer = c && typeof mountWriter === "function"
    ? mountWriter("ct-i-host", key, {mode: "demo", size: 104, autoplay: false}) : null;
  if(c) wordsWithChar(key, 6).then(words => {
    const box = $("#ct-i-words");
    if(!box || CT.insp !== stamp) return;
    box.innerHTML = words.length ? words.map(w => `
      <button class="ct-i-word" data-open="word:${esc(w.id)}">
        <span class="hz">${esc(w.s)}</span><span class="py">${pinyinHTML(w.p)}</span>
        <span class="ct-i-wen">${esc(w.en[0] || "")}</span>${lvChip(w.lv)}</button>`).join("")
      : `<p class="ct-i-none">Not written in any word of the syllabus on its own.</p>`;
  });
}

function ctInspHTML(key, n, docked){
  const a = ctAbout(key), c = a.c, t = CT.tree, isRoot = key === t.root;
  const known = c ? ctKnown(key) : 0, inDeck = (CT.deck.get(key) || 0) > 0;
  const status = !c ? "" : known === 2 ? `<span class="ct-chip mastered">${CT_STAR}Mastered</span>`
    : inDeck ? `<span class="ct-chip met">${CT_TICK}In your deck</span>`
    : known ? `<span class="ct-chip met">${CT_TICK}In your words</span>`
    : +c.lv > +S.level ? `<span class="ct-chip lock">${CT_LOCK}Above your level</span>` : "";
  /* how it is built */
  const ops = c ? [...String(c.dec || "")].filter(x => IDS[x]) : [];
  const built = c && c.comp.length ? `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>How it is built</span>${ops.length ? `<small>${esc(IDS[ops[0]])}</small>` : ""}</h4>
      <div class="ct-i-parts">${c.comp.map(p => {
        const role = ctRole(key, p.c), pa = ctAbout(p.c);
        return `<button class="ct-i-part${role ? ` ${role}` : ""}" data-ct="grow" data-arg="${esc(p.c)}" title="Grow the tree from ${esc(p.c)}">
          <b class="hz">${esc(p.c)}</b><span><em>${esc(p.g || pa.short || "component")}</em>${role ? `<small>gives the ${role}</small>` : pa.c ? `<small class="py">${esc(pa.c.p)}</small>` : ""}</span></button>`;
      }).join(`<i class="ct-i-plus">+</i>`)}</div></section>` : "";
  /* what it builds into: in this tree, or for a part left of the root,
     everything built on it at this level */
  const into = n.side >= 0 ? t.branches.get(key) || [] : (CT.g.kids.get(key) || []).filter(ctWithin);
  let family = "";
  if(into.length){
    const by = new Map();
    for(const h of into){ const lv = CT.g.by.get(h).lv; by.set(lv, (by.get(lv) || 0) + 1); }
    const lvs = [...by].sort((x, y) => +x[0] - +y[0]);
    const met = into.filter(h => ctKnown(h) > 0).length;
    let roles = "";
    if(isRoot){
      let m = 0, s = 0;
      for(const h of into){ const r = ctRole(h, key); if(r === "meaning") m++; else if(r === "sound") s++; }
      roles = m || s ? `<p class="ct-i-note">${m ? `Gives the meaning in ${num(m)}` : ""}${m && s ? " · " : ""}${s ? `the sound in ${num(s)}` : ""}.</p>` : "";
    }
    const few = into.slice().sort((x, y) => +CT.g.by.get(x).lv - +CT.g.by.get(y).lv).slice(0, 24);
    family = `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>Builds into</span><small>${num(into.length)}${isRoot && t.size > into.length ? ` · ${num(t.size)} in its tree` : ""}${met ? ` · ${num(met)} met` : ""}</small></h4>
      <div class="ct-i-bar" aria-hidden="true">${lvs.map(([lv, k]) => `<i class="v${lv}" style="flex:${k}"></i>`).join("")}</div>
      <div class="ct-i-lvls">${lvs.map(([lv, k]) => `<span class="v${lv}"><i></i>HSK ${esc(levelLabel(lv))} <b>${num(k)}</b></span>`).join("")}</div>
      ${roles}
      <div class="ct-i-kids">${few.map(h => `<button class="ct-i-kid hz v${CT.g.by.get(h).lv}${ctKnown(h) ? " met" : ""}" data-ct="${n.side >= 0 ? "pick" : "grow"}" data-arg="${esc(h)}"
        title="${esc(h)} ${esc(CT.g.by.get(h).p)} · ${esc(ctAbout(h).short)}">${esc(h)}</button>`).join("")}${
        into.length > few.length ? `<span class="ct-i-more">+${num(into.length - few.length)}</span>` : ""}</div>
    </section>`;
  }
  const facts = c ? [c.sc ? `<span><b>${c.sc}</b> strokes</span>` : "", c.rank ? `<span>frequency <b>#${num(c.rank)}</b></span>` : "",
    c.inWords ? `<span>in <b>${num(c.inWords)}</b> words</span>` : ""].filter(Boolean).join("") : "";
  return `
    ${docked ? "" : `<button class="ct-x" data-ct="unsel" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`}
    <div class="ct-i-scroll">
      <div class="ct-i-kicker">${isRoot ? "Root of this tree" : n.side < 0 ? `Part of ${esc(t.root)}` : n.grid ? `In HSK ${esc(levelLabel(c.lv))} of ${esc(n.of)}` : "Branch"}</div>
      <div class="ct-i-hero">
        <div class="ct-i-glyph${c ? "" : " comp"}">
          ${c ? `<svg class="ct-i-grid" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0v100M0 50h100M0 0l100 100M100 0 0 100"/></svg>
            <div class="ct-i-host" id="ct-i-host"></div>
            <button class="ct-i-play" data-ct="strokes" title="Play the strokes" aria-label="Play the stroke order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>`
            : `<span class="hz">${esc(key)}</span>`}
        </div>
        <div class="ct-i-id">
          ${c ? `<span class="ct-i-read py">${pinyinHTML(c.p)}</span>${c.pAlt.length ? `<small class="ct-i-alt">also <span class="py">${pinyinHTML(c.pAlt.join(", "))}</span></small>` : ""}`
            : `<span class="ct-i-read">${esc(a.short || "component")}</span>${a.full ? `<small class="ct-i-alt">a form of <b class="hz">${esc(a.full)}</b> <span class="py">${pinyinHTML(a.fc.p)}</span></small>` : `<small class="ct-i-alt">a component, not a character of its own</small>`}`}
          <div class="ct-i-chips">${c ? lvChip(c.lv) : `<span class="ct-chip">Component</span>`}${status}</div>
        </div>
      </div>
      ${c ? `<p class="ct-i-en">${esc(c.en.slice(0, 3).join("; "))}</p>` : ""}
      ${facts ? `<div class="ct-i-facts">${facts}</div>` : ""}
      ${built}
      ${family}
      ${c ? `<section class="ct-i-sec"><h4 class="ct-i-h"><span>In words</span></h4><div class="ct-i-words" id="ct-i-words"><span class="ct-i-none">…</span></div></section>` : ""}
    </div>
    <div class="ct-i-acts">
      ${c ? `<button class="btn sm" data-open="char:${esc(key)}">Open entry</button>
        <button class="ghost sm${inDeck ? " on" : ""}" data-deck="char:${esc(key)}:${c.lv}">${inDeck ? `${CT_TICK}In deck` : "Add to deck"}</button>` : ""}
      ${!isRoot ? `<button class="ghost sm" data-ct="grow" data-arg="${esc(key)}" title="Grow the tree from ${esc(key)} (G)">Grow from <span class="hz">${esc(key)}</span></button>` : ""}
      ${n.side > 0 && !isRoot && (t.branches.get(key) || []).length ? `<button class="ghost sm" data-ct="toggle" data-arg="${esc(key)}">${CT.open.has(key) ? "Fold branch" : "Open branch"}</button>` : ""}
      ${!c && a.full ? `<button class="ghost sm" data-ct="grow" data-arg="${esc(a.full)}">Grow from <span class="hz">${esc(a.full)}</span></button>` : ""}
    </div>`;
}

/* The canvas as the whole window, and back: for a big family, or a phone,
   where the bars above it take room the tree could use. */
function ctMax(on = !document.body.classList.contains("ct-max")){
  document.body.classList.toggle("ct-max", on);
  CT.touched = false;
  ctPaintTools();
  requestAnimationFrame(() => { sizeCharTree(); ctFit(0); ctPaintInsp(); });
}

function ctCommand(what, arg){
  if(what === "in") ctZoomBy(1.25);
  else if(what === "out") ctZoomBy(.8);
  else if(what === "fit"){ CT.touched = false; ctFit(); }
  else if(what === "unsel") ctSelect("");
  else if(what === "grow") ctStart(arg, {trail: true});
  else if(what === "toggle") ctToggle(arg);
  else if(what === "group") ctGroup(arg);
  else if(what === "expand") ctAllGroups("open");
  else if(what === "collapse") ctAllGroups("shut");
  else if(what === "max") ctMax();
  else if(what === "strokes"){ if(CT.writer) CT.writer.animate(); }
  else if(what === "insp"){
    S.treeInsp = S.treeInsp === false; save();
    ctDock(); ctPaintTools();
    CT.insp = "";
    requestAnimationFrame(() => { sizeCharTree(); ctPaintInsp(); if(!CT.touched) ctFit(300); });
  }
  else if(what === "all"){ S.treeReach = "all"; save(); safely("grow the tree", renderChars); }
  else if(what === "pick"){
    /* a character named in the panel: whatever folds it away opens, then
       it is picked */
    if(ctEnsure(arg)) ctRender(420, CT.sel || "");
    ctSelect(arg, {focus: true});
  }
  else if(what === "back"){
    const i = +arg, h = CT.trail[i];
    if(h === undefined) return;
    CT.trail = CT.trail.slice(0, i);
    ctStart(h, {keepTrail: true});
  }
}

/* ---------------- the hover tip ---------------- */

/* The name of what is under the pointer: a tile, with what it is built
   from, or a part on a tag, which says how many of the tiles on the canvas
   it is in and what a click does. */
function ctShowTip(el, part = ""){
  const tip = $("#ct-tip"), box = $("#ctree");
  const key = part || el.dataset.k;
  if(!tip || !key) return;
  const a = ctAbout(key);
  const kin = part ? [...CT.recs.values()].filter(r => !r.gone && r.el.classList.contains("kin")).length : 0;
  const parts = !part && a.c && a.c.comp.length ? a.c.comp.map(p => p.c).join(" + ") : "";
  tip.innerHTML = `<b class="hz">${esc(key)}</b>${a.c ? ` <span class="py">${pinyinHTML(a.c.p)}</span>` : ""}<span>${esc(a.en || "component")}${
    part ? ` · in ${kin} here · click to grow its tree` : ""}</span>${parts ? `<small class="hz">${esc(parts)}</small>` : ""}`;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const x = clamp(r.left + r.width / 2 - b.left, 110, b.width - 110);
  const above = r.top - b.top > CT_HEAD + 54;
  tip.style.transform = `translate(${x.toFixed(0)}px,${(above ? r.top - b.top - 10 : r.bottom - b.top + 10).toFixed(0)}px) translate(-50%,${above ? "-100%" : "0"})`;
}
function ctHideTip(){ const tip = $("#ct-tip"); if(tip && !tip.hidden) tip.hidden = true; }

/* ---------------- taps ---------------- */

/* What a press is on, read when it starts and kept as plain values — the
   element itself can be redrawn under the press — : a command (a tag's
   part, a group's name strip), a tile and whether on its knob, or the bare
   canvas. */
function ctTapOf(el){
  const cmd = el && el.closest && el.closest("[data-ct]");
  if(cmd) return {cmd: cmd.dataset.ct, arg: cmd.dataset.arg};
  const node = el && el.closest && el.closest(".ct-n");
  if(!node || node.classList.contains("gone")) return {bare: true};
  return {key: node.dataset.k, knob: !!el.closest("[data-knob]")};
}
/* A tap used: a command runs; a knob opens or folds its branch; a tile is
   picked, and a second tap on the tile picked uses it; the bare canvas puts
   the tile picked down. */
function ctTap(t){
  if(t.cmd){ ctCommand(t.cmd, t.arg); return; }
  if(!t.key || !(CT.lay && CT.lay.nodes.has(t.key))){ if(CT.sel) ctSelect(""); return; }
  ctHideTip();
  if(t.knob){ ctToggle(t.key); return; }
  if(CT.sel === t.key){ ctActivate(t.key); return; }
  ctSelect(t.key);
}

/* Every tile on the canvas built from a part — and every tag naming it —
   lit while the pointer rests on one of that part's tags: the family it
   belongs to, at a glance. "" puts them out. */
function ctKin(part){
  if(CT.kin === part) return;
  CT.kin = part;
  for(const r of CT.recs.values()){
    const c = !r.gone && CT.g.by.get(r.key);
    r.el.classList.toggle("kin", !!part && (r.key === part || (!!c && c.comp.some(p => p.c === part))));
  }
  for(const b of $$("#ct-tags [data-part]")) b.classList.toggle("kin", !!part && b.dataset.part === part);
}

/* The tile under the pointer: its way to the root warms, and its tier's
   name in the header lights. */
function ctHover(key){
  if(CT.hover === key) return;
  CT.hover = key;
  ctWires();
  ctMarkTier();
}
function ctMarkTier(){
  const n = CT.lay && CT.lay.nodes.get(CT.hover || CT.sel);
  const d = n ? (n.side < 0 ? -n.depth : n.depth) : null;
  for(const s of $$("#ct-tiers span")) s.classList.toggle("on", d !== null && +s.dataset.d === d);
}

/* ---------------- the canvas's gestures ---------------- */

function ctWire(){
  if(CT.wired) return;
  CT.wired = true;
  const box = $("#ctree");
  const pts = new Map();
  /* tap: what a press on the plane began on, used when the press lifts
     without having become a drag. Taken at the press, because the tree
     moves: a tile or knob still sliding into place after the last change, or
     giving under the press, would otherwise take the browser's click
     somewhere else and the press would do nothing. tapped: when the last tap
     was used, so the click the browser sends after it is not used again. */
  let pan = null, pinch = null, moved = false, trace = [], tap = null, tapped = 0;

  box.addEventListener("pointerdown", e => {
    if(e.button > 1 || e.target.closest(".ct-hud, .ct-head")) return;
    ctStopCam();
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if(pts.size === 1){
      pan = {x: e.clientX, y: e.clientY, cx: CT.cam.x, cy: CT.cam.y};
      moved = false; trace = [];
      tap = e.button === 0 ? {id: e.pointerId, ...ctTapOf(e.target)} : null;
    }else if(pts.size === 2){
      tap = null;
      const [p, q] = [...pts.values()], b = box.getBoundingClientRect();
      pinch = {d: Math.hypot(p.x - q.x, p.y - q.y) || 1, mx: (p.x + q.x) / 2 - b.left, my: (p.y + q.y) / 2 - b.top, cam: {...CT.cam}};
      moved = true;
      for(const id of pts.keys()) try{ box.setPointerCapture(id); }catch(err){}
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
      ctCam(); ctMoving();
      return;
    }
    if(!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if(!moved && Math.hypot(dx, dy) < 6) return;
    if(!moved){
      moved = true;
      try{ box.setPointerCapture(e.pointerId); }catch(err){}
      box.classList.add("grabbing");
      ctHover(""); ctKin(""); ctHideTip();
    }
    CT.cam.x = pan.cx + dx; CT.cam.y = pan.cy + dy;
    CT.touched = true;
    ctCam(); ctMoving();
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
    const t = tap;
    tap = null;
    if(t && !moved && t.id === e.pointerId && e.type === "pointerup"){ tapped = performance.now(); ctTap(t); }
    /* let go mid-swipe: the canvas carries on and slows */
    const a = trace[0], b = trace[trace.length - 1];
    if(moved && a && b && b.t - a.t > 10 && performance.now() - b.t < 60 && !REDUCED()){
      let vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t), last = performance.now();
      const step = now => {
        const dt = Math.min(40, now - last); last = now;
        CT.cam.x += vx * dt; CT.cam.y += vy * dt;
        ctCam(); ctMoving();
        const f = Math.pow(.93, dt / 16); vx *= f; vy *= f;
        CT.glide = Math.hypot(vx, vy) > .02 ? requestAnimationFrame(step) : 0;
      };
      CT.glide = requestAnimationFrame(step);
    }
  };
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
  box.addEventListener("lostpointercapture", e => { if(pts.has(e.pointerId) && e.pointerType !== "mouse") up(e); });

  /* The clicks left once taps are taken: the controls over the canvas (the
     header, the map's corner), and a key pressed on a focused tile, tag or
     group, which sends a click with no pointer behind it (detail 0). A
     pointer's click on the plane is a press already used as a tap, or the
     end of a drag. */
  box.addEventListener("click", e => {
    const over = !!e.target.closest(".ct-hud, .ct-head");
    if(!over && (e.detail > 0 || performance.now() - tapped < 500)) return;
    const cmd = e.target.closest("[data-ct]");
    if(cmd){ ctCommand(cmd.dataset.ct, cmd.dataset.arg); return; }
    if(!over) ctTap(ctTapOf(e.target));
  });
  /* The panel's own controls: everything in it but an entry or the deck,
     which the page's one click handler takes. */
  $("#ct-insp").addEventListener("click", e => {
    const cmd = e.target.closest("[data-ct]");
    if(cmd) ctCommand(cmd.dataset.ct, cmd.dataset.arg);
  });

  /* The wheel zooms, as a game's map does — a mouse's notched wheel and a
     pinch on a touchpad both. Two fingers sliding on a touchpad pan. */
  box.addEventListener("wheel", e => {
    e.preventDefault();
    ctStopCam();
    const b = box.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? b.height : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const notched = e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 50);
    if(e.ctrlKey) ctZoomAt(px, py, CT.cam.k * Math.exp(-dy * .012));
    else if(notched && !e.shiftKey) ctZoomAt(px, py, CT.cam.k * Math.exp(-dy * .0016));
    else{
      CT.cam.x -= e.shiftKey && !dx ? dy : dx;
      CT.cam.y -= e.shiftKey && !dx ? 0 : dy;
      ctCam();
    }
    CT.touched = true;
    ctMoving();
  }, {passive: false});

  box.addEventListener("dblclick", e => {
    if(e.target.closest(".ct-n") && !e.target.closest("[data-knob]")) e.preventDefault();
  });

  /* What the pointer rests on: a tag's part lights its whole family, a tile
     warms its way to the root and names itself. */
  box.addEventListener("pointerover", e => {
    if(e.pointerType !== "mouse" || pts.size) return;
    const part = e.target.closest("#ct-tags [data-part]");
    if(part){ ctKin(part.dataset.part); ctShowTip(part, part.dataset.part); return; }
    const node = e.target.closest(".ct-n");
    if(!node) return;
    ctHover(node.dataset.k);
    if(!node.classList.contains("sel")) ctShowTip(node);
  });
  box.addEventListener("pointerout", e => {
    const part = e.target.closest("#ct-tags [data-part]");
    if(part && !part.contains(e.relatedTarget)){ ctKin(""); ctHideTip(); return; }
    const node = e.target.closest(".ct-n");
    if(node && !node.contains(e.relatedTarget)){ ctHover(""); ctHideTip(); }
  });
  /* a focused tile can scroll an overflow:hidden box; the plane is the only
     thing that moves here */
  box.addEventListener("scroll", () => { box.scrollTop = 0; box.scrollLeft = 0; });

  /* the map: press or drag to go there */
  const map = $("#ct-mapc");
  map.addEventListener("pointerdown", e => {
    e.stopPropagation();
    ctStopCam();
    try{ map.setPointerCapture(e.pointerId); }catch(err){}
    ctMapTo(e);
    const move = ev => ctMapTo(ev);
    const done = () => { map.removeEventListener("pointermove", move); map.removeEventListener("pointerup", done); map.removeEventListener("pointercancel", done); };
    map.addEventListener("pointermove", move);
    map.addEventListener("pointerup", done);
    map.addEventListener("pointercancel", done);
  });
  /* a theme picked repaints the map in it */
  new MutationObserver(() => ctMapSoon()).observe(document.documentElement, {attributes: true, attributeFilter: ["data-skin"]});
  /* the window across the line where the panel docks: it moves */
  if(window.matchMedia){
    const mq = matchMedia("(min-width:1280px)");
    const swap = () => { CT.insp = ""; ctPaintInsp(); };
    if(mq.addEventListener) mq.addEventListener("change", swap);
  }

  /* The bar of roots: a tile grows its tree; the arrows, and a mouse's wheel,
     slide it. */
  const bar = $("#croots"), track = $("#ct-track");
  bar.addEventListener("click", e => {
    const nav = e.target.closest("[data-bar]");
    if(nav){ track.scrollBy({left: +nav.dataset.bar * track.clientWidth * .8, behavior: REDUCED() ? "auto" : "smooth"}); return; }
    const b = e.target.closest("button[data-root]");
    if(!b) return;
    const searching = !!C.query.trim();
    ctStart(b.dataset.root, {trail: false});
    if(searching){ const q = $("#csearch"); q.value = ""; C.query = ""; paintCharTree(); }
  });
  track.addEventListener("scroll", ctBarEnds, {passive: true});
  track.addEventListener("wheel", e => {
    if(e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || track.scrollWidth <= track.clientWidth) return;
    e.preventDefault();
    track.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 18 : 1);
  }, {passive: false});
}

/* A card added or taken out — from the panel, an entry the tree or the
   grid opened, or a word sheet opened from that — lights the tiles, or
   marks the cells, afresh. */
function treeDeckChanged(){
  if(S.view !== "chars") return;
  if(S.charView === "grid") return ctLoadKnown().then(() => paintChars());
  if(!CT.tree) return;
  return ctLoadKnown().then(() => { ctRender(0); ctPaintInsp(); paintCharsHead(); });
}

/* "Explore in the tree", from an entry: the Characters tab in tree form,
   grown from the character or part. */
function treeGrowFrom(h){
  closeDetail();
  CT.next = h;
  S.charView = "tree"; save();
  if(S.view === "chars") safely("grow the tree", renderChars);
  else show("chars");
}

/* The grid or the tree. */
function setCharView(v){
  S.charView = v === "grid" ? "grid" : "tree";
  if(S.charView !== "tree") document.body.classList.remove("ct-max");
  save();
  safely("show the characters", renderChars);
}
