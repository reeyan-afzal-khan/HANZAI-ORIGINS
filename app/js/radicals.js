/* radicals.js — the Characters tab's radical index.
 *
 * Kept the way a dictionary keeps one, and Pleco's in particular, the one
 * most learners know: every radical in one grid in order of its strokes, a
 * numbered key at the head of each count; a radical picked gives its
 * characters in the same grid, under the strokes left once the radical is
 * taken away; a character picked opens. It is how a character is found
 * without being able to type it — which is exactly the position of somebody
 * looking at one they cannot read.
 *
 * The index is built ahead of time (scripts/build-radicals.mjs, into
 * app/data/radicals.js): the radical each of the 3,000 characters is filed
 * under, as it is written — 氵, not 水 — and the strokes left after it.
 *
 * Both views of the tab have it. In the grid, a character picked opens beside
 * the grid when it is in it and the window has the room, and as its entry
 * otherwise. In the tree, a radical picked grows its tree and a character
 * picked is found in it, or grows a tree of its own where it is not one of
 * the radical's; the tree keeps its other two shelves here as well, the
 * sound families and the other parts, as two more pages of the same grid.
 * Everything here is named rx… */

const RX = {
  list: null,          // the radicals in index order: {f, s, en, chars, rest, spelt}
  by: new Map(),       // radical -> its entry
  of: new Map(),       // character -> the radical it is filed under
  page: "radicals",    // in the tree, also "sounds" and "parts"
  pick: "",            // the character last picked from the index
  wired: false,
  deckH: 0,            // the panel's height the page was last sized for
};
const getRadicals = () => loadData("radicals");

async function rxLoad(){
  if(RX.list) return;
  const raw = await getRadicals();
  RX.list = raw.map(([f, s, en, chars, rest, spelt]) => ({f, s, en, chars: [...chars], rest, spelt: [...spelt]}));
  for(const r of RX.list){
    RX.by.set(r.f, r);
    for(const h of r.chars) RX.of.set(h, r.f);
  }
}

/* The radical whose characters are on show, or null for the radicals. */
const rxOpen = () => (S.charRad && RX.by.get(S.charRad)) || null;

/* What the tree grows from for a radical: the radical as written where the
   tree knows it, or the spelling it does know it by (⺼ for 月) — whichever
   has the most built on it. Single strokes grow no tree (tree.js). */
function rxRootOf(f){
  const r = RX.by.get(f);
  if(!r || !CT.g) return "";
  let best = "", most = -1;
  for(const x of [f, ...r.spelt]){
    if(CT_STROKES.has(x) || !(CT.g.kids.has(x) || CT.g.by.has(x))) continue;
    const n = (CT.g.kids.get(x) || []).length;
    if(n > most){ best = x; most = n; }
  }
  return best;
}

/* How many strokes a shelf's part has: its own count where it is a
   character, the index's where it is a radical; 0 where neither says. */
const rxStrokes = p => (CT.g && CT.g.by.get(p) || {}).sc || (RX.by.get(p) || {}).s || 0;

/* ---------------- drawing ---------------- */

const RX_BACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg>`;
const RX_MORE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>`;

/* The whole index, as it stands: called whenever the tab is drawn. */
function paintIndex(){
  const box = $("#cidx");
  if(!box || !RX.list || !CT.g) return;
  rxWire();
  const tree = S.charView === "tree";
  if(!tree) RX.page = "radicals";
  const rad = rxOpen();
  if(S.charRad && !rad) S.charRad = "";
  box.classList.toggle("tall", !!S.charIdxTall);
  box.dataset.page = rad ? "chars" : RX.page;
  /* Drawn again over the same page — a sort changed under it, a card was
     added — the grid stays where it was scrolled to. */
  const showing = `${tree}|${RX.page}|${rad ? rad.f : ""}`, same = box.dataset.showing === showing;
  const kept = same ? $("#cidx-keys").scrollTop : 0;
  box.dataset.showing = showing;

  /* the keys: numbered heads and the keys under them, and the counts the
     head offers to jump to */
  let keys = "", counts = [];
  const head = n => { counts.push(n); return `<span class="rx-n" data-n="${n}" aria-hidden="true">${n}</span>`; };
  if(rad){
    const lv = +S.level;
    let last = -1;
    rad.chars.forEach((h, i) => {
      const c = CT.g.by.get(h);
      if(!c) return;
      if(rad.rest[i] !== last){ last = rad.rest[i]; keys += head(last); }
      const k = ctKnown(h);
      keys += `<button class="rx-k rx-c v${c.lv}${+c.lv > lv ? " up" : ""}${k === 2 ? " mastered" : k ? " met" : ""}" data-rxc="${esc(h)}"
        aria-pressed="${h === rxPicked()}" title="${esc(h)} ${esc(c.p)} · ${esc(ctShort(c.en[0]))} · HSK ${esc(levelLabel(c.lv))}${
        +c.lv > lv ? " · above your level" : ""}">${esc(h)}</button>`;
    });
  }else if(RX.page === "radicals"){
    let last = 0;
    for(const r of RX.list){
      if(r.s !== last){ last = r.s; keys += head(last); }
      keys += `<button class="rx-k" data-rx="${esc(r.f)}" aria-pressed="${rxIsRoot(r.f)}"
        title="${esc(r.f)} ${esc(r.en)} · ${r.s} stroke${r.s === 1 ? "" : "s"} · ${num(r.chars.length)} character${r.chars.length === 1 ? "" : "s"}">${esc(r.f)}</button>`;
    }
  }else{
    /* a shelf of the tree's, in the same order: fewest strokes first */
    const shelf = (ctShelf().find(([id]) => id === RX.page) || [0, 0, []])[2];
    const list = shelf.map(([p, n]) => [p, n, rxStrokes(p)]).sort((a, b) => (a[2] || 99) - (b[2] || 99) || b[1] - a[1]);
    let last = -1;
    for(const [p, n, s] of list){
      if(s !== last){ last = s; keys += s ? head(s) : `<span class="rx-n" aria-hidden="true">·</span>`; }
      const a = ctAbout(p);
      keys += `<button class="rx-k" data-rxroot="${esc(p)}" aria-pressed="${p === CT.root}"
        title="${esc(p)}${a.c ? ` ${esc(a.c.p)}` : ""} ${esc(a.short || "")} · ${num(n)} character${n === 1 ? "" : "s"} built on it">${esc(p)}</button>`;
    }
  }
  const grid = $("#cidx-keys");
  grid.innerHTML = keys || `<p class="rx-none">Nothing here at this level.</p>`;
  grid.scrollTop = kept;
  grid.setAttribute("aria-label", rad ? `The characters filed under ${rad.f}` : RX.page === "radicals" ? "The radicals" : "The tree's starting points");
  /* a new page of keys settles in rather than appearing; a repaint of the
     same one (a card added, a sort changed) does not stir */
  grid.classList.remove("enter");
  if(!same && !REDUCED()){ void grid.offsetWidth; grid.classList.add("enter"); }

  /* the head: what the grid holds — its pages as tabs, or the radical open
     and the way back — then the counts to jump to, and the fold */
  const pl = n => n === 1 ? "" : "s";
  let what;
  if(rad){
    const at = rad.chars.filter(h => +(CT.g.by.get(h) || {}).lv <= +S.level).length;
    what = `<button class="rx-back" data-rxback title="Back to the radicals">${RX_BACK}<span>Radicals</span></button>
      <span class="rx-split" aria-hidden="true"></span>
      <div class="rx-sel"><b class="hz">${esc(rad.f)}</b><span><b>${esc(rad.en)}</b>
        <small>${rad.s} stroke${pl(rad.s)} · ${num(rad.chars.length)} character${pl(rad.chars.length)}${
          at < rad.chars.length ? ` · ${num(at)} up to HSK ${esc(levelLabel(S.level))}` : ""}</small></span></div>`;
  }else if(tree){
    const shelves = new Map(ctShelf().map(([id, , list]) => [id, list.length]));
    what = `<div class="rx-tabs" role="group" aria-label="Start the tree from">${[["radicals", "Radicals", RX.list.length],
      ["sounds", "Sound families", shelves.get("sounds")], ["parts", "Other parts", shelves.get("parts")]]
      .filter(([, , n]) => n).map(([k, nm, n]) => `<button class="rx-tab" data-rxpage="${k}" aria-pressed="${RX.page === k}">${nm}<small>${num(n)}</small></button>`).join("")}</div>`;
  }else{
    what = `<div class="rx-tabs"><span class="rx-tab on">Radical index<small>${num(RX.list.length)}</small></span></div>`;
  }
  const jump = counts.length > 1 ? `<span class="lbl" aria-hidden="true">${rad ? "Strokes left" : "Strokes"}</span>
    <nav class="rx-jump" aria-label="${rad ? "Strokes left" : "Strokes"}">${counts.map(n =>
      `<button data-rxjump="${n}" title="${rad ? `${n} more stroke${pl(n)}` : `${n} stroke${pl(n)}`}">${n}</button>`).join("")}</nav>` : "";
  const tall = `<button class="rx-tall" data-rxtall aria-pressed="${!!S.charIdxTall}" aria-label="More rows" title="More rows">${RX_MORE}</button>`;
  /* drawn as two parts, each left standing where only what is pressed has
     changed — so a tab's rule and the fold's chevron move rather than blink */
  const top = $("#cidx-head");
  if(!top.querySelector(":scope > .rx-what"))
    top.innerHTML = `<div class="rx-what"></div><div class="rx-nav"></div>`;
  paintSwitches(top.querySelector(".rx-what"), what);
  paintSwitches(top.querySelector(".rx-nav"), `${jump}${tall}`);
  /* the fold only where there are rows to fold out, or back in */
  top.querySelector(".rx-tall").hidden = !S.charIdxTall && grid.scrollHeight <= grid.clientHeight + 1;
  rxJumpMark();
  rxSettle();
}

/* The character the index shows as picked: the tree's tile where the tree
   is up, else the last one picked here. */
const rxPicked = () => S.charView === "tree" ? (CT.sel || RX.pick) : RX.pick;
/* Whether a radical is the tree's root, as written or as spelt. */
const rxIsRoot = f => S.charView === "tree" && !!CT.root && (f === CT.root || (RX.by.get(f) || {spelt: []}).spelt.includes(CT.root));

/* Only the pressed keys, after the tree's root or its picked tile changed. */
function paintIndexRoot(){
  if(!RX.list) return;
  for(const b of $$("#cidx-keys [data-rx]")) b.setAttribute("aria-pressed", String(rxIsRoot(b.dataset.rx)));
  for(const b of $$("#cidx-keys [data-rxroot]")) b.setAttribute("aria-pressed", String(b.dataset.rxroot === CT.root));
  paintIndexSel();
}
function paintIndexSel(){
  const h = rxPicked();
  for(const b of $$("#cidx-keys [data-rxc]")) b.setAttribute("aria-pressed", String(b.dataset.rxc === h));
}

/* Where a key sits in the grid, from the grid's top, scrolled or not. (Not
   offsetTop: the index is a container for its own queries, which makes it
   the offset parent of the keys but not of the grid.) */
const rxAt = (el, keys) => el.getBoundingClientRect().top - keys.getBoundingClientRect().top + keys.scrollTop;

/* The count at the top of the grid, lit in the head as the grid scrolls. */
function rxJumpMark(){
  const keys = $("#cidx-keys");
  if(!keys) return;
  /* the head of the top row's first count, once its row reaches the edge */
  const edge = keys.scrollTop + 8;
  let cur = null, row = -1;
  for(const n of keys.querySelectorAll(".rx-n[data-n]")){
    const top = rxAt(n, keys);
    if(top > edge) break;
    if(top > row){ row = top; cur = n.dataset.n; }
  }
  const rail = $("#cidx-head .rx-jump");
  if(!rail) return;
  const bs = [...rail.querySelectorAll("[data-rxjump]")], at = bs.findIndex(b => b.dataset.rxjump === cur);
  bs.forEach((b, i) => b.classList.toggle("on", i === at));
  /* the thumb behind the rail follows the count, and the rail keeps it in view */
  rail.classList.toggle("lit", at >= 0);
  if(at >= 0){
    const b = bs[at];
    rail.style.setProperty("--x", `${b.offsetLeft}px`);
    rail.style.setProperty("--w", `${b.offsetWidth}px`);
    if(b.offsetLeft < rail.scrollLeft || b.offsetLeft + b.offsetWidth > rail.scrollLeft + rail.clientWidth)
      rail.scrollLeft = b.offsetLeft - rail.clientWidth / 2;
  }
  rxRailEnds(rail);
}
/* which ends of the rail go on past what shows */
function rxRailEnds(rail){
  rail.classList.toggle("more-l", rail.scrollLeft > 2);
  rail.classList.toggle("more-r", rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2);
}

/* ---------------- picking ---------------- */

function rxRadical(f){
  if(!RX.by.has(f)) return;
  S.charRad = f; save();
  RX.pick = "";
  if(S.charView === "tree"){
    const root = rxRootOf(f);
    if(root && root !== CT.root) ctStart(root, {trail: false});
  }
  paintIndex();
  $("#cidx-keys").scrollTop = 0;
}

function rxChar(h){
  RX.pick = h;
  if(S.charView === "tree"){
    if(CT.tree && ctPlaced(h)) ctCommand("pick", h);
    else ctStart(h, {trail: true});
  }else if(cWide() && C.shown.includes(h)) cPick(h);
  else safely("open that entry", () => openChar(h));
  paintIndexSel();
}

/* Back to the radicals, with the one just left in view. */
function rxBack(){
  const was = S.charRad;
  S.charRad = ""; save();
  RX.pick = "";
  paintIndex();
  const keys = $("#cidx-keys"), b = was && keys.querySelector(`[data-rx="${CSS.escape(was)}"]`);
  if(b) keys.scrollTop = Math.max(0, rxAt(b, keys) - keys.clientHeight / 2 + b.offsetHeight / 2);
  rxJumpMark();
}

function rxJump(n){
  const keys = $("#cidx-keys"), at = keys.querySelector(`.rx-n[data-n="${CSS.escape(String(n))}"]`);
  if(!at) return;
  keys.scrollTo({top: rxAt(at, keys), behavior: REDUCED() ? "auto" : "smooth"});
}

/* Every row, or a few: the canvas or the grid under it takes what is left. */
function rxTall(){
  S.charIdxTall = !S.charIdxTall; save();
  paintIndex();
}

function rxWire(){
  if(RX.wired) return;
  RX.wired = true;
  $("#cidx").addEventListener("click", e => {
    const b = e.target.closest("button");
    if(!b) return;
    if(b.dataset.rx) rxRadical(b.dataset.rx);
    else if(b.dataset.rxc) rxChar(b.dataset.rxc);
    else if(b.dataset.rxroot) ctStart(b.dataset.rxroot, {trail: false});
    else if(b.hasAttribute("data-rxback")) rxBack();
    else if(b.dataset.rxjump !== undefined) rxJump(b.dataset.rxjump);
    else if(b.dataset.rxpage){ RX.page = b.dataset.rxpage; S.charRad = ""; save(); paintIndex(); $("#cidx-keys").scrollTop = 0; }
    else if(b.hasAttribute("data-rxtall")) rxTall();
  });
  $("#cidx-keys").addEventListener("scroll", rxJumpMark, {passive: true});
  /* the rail is redrawn with the head, so its scroll is listened for here */
  $("#cidx-head").addEventListener("scroll", e => { if(e.target.matches(".rx-jump")) rxRailEnds(e.target); }, {passive: true, capture: true});
  /* The panel's height decides where the canvas or the grid under it starts.
     paintIndex sizes them again itself when its own rows change; this is for
     everything else that moves it — a narrower window wrapping the head, a
     face arriving late. */
  if(window.ResizeObserver){
    let queued = false;
    new ResizeObserver(() => {
      if(queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; rxSettle(); });
    }).observe($("#cdeck"));
  }
}

/* What is under the panel, sized again — once a height, however often asked. */
function rxSettle(){
  const deck = $("#cdeck"), h = deck ? deck.offsetHeight : 0;
  if(!h || h === RX.deckH) return;
  RX.deckH = h;
  sizeLists();
}
