/* browse.js — the browsing tabs and the entries they open.
 *
 * Characters and grammar share one shape — a search box, filter chips, a
 * list that scrolls inside itself — and each opens into the same detail
 * sheet, as does a word (from a gloss, a character's word list, a Talk card).
 * The stroke-order writer sits with them because a character's entry and
 * the writing card are where it is mounted. */


/* ==================================================================
   STROKE ORDER — animated and quizzed
   ================================================================== */

/* stroke order, animated and quizzed.
 *
 * Stroke data is looked up in ./data/strokes first — populated by
 * `npm run strokes`, which is what makes writing practice work offline and
 * inside the APK — and falls back to a CDN only when that has not been
 * generated, or for a character the syllabus does not cover.
 *
 * The 4,146 characters are bucketed into 64 shard files rather than one file
 * each. Which shard holds a character is its codepoint modulo 64, so no index
 * has to be consulted to know what to ask for; the manifest is only read to
 * find out whether a character is in the set at all, so a miss can skip
 * straight to the CDN instead of pulling 200 KB to discover it is not there.
 *
 * Still script tags rather than fetch, for the same reason as the syllabus
 * data: a script tag loads from file://, fetch does not. */

const STROKE_LOCAL = "./data/strokes";
const STROKE_CDN = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1";
const strokeCache = new Map();

/* One promise per generated file, kept for the life of the page: a shard is
   requested at most once, however many of its characters are practised. The
   resolvers live alongside it only while a file is actually in flight. */
const shardLoads = new Map();
const shardResolvers = new Map();

/* The registry the generated files in app/data/strokes/ hand themselves to.
   A namespace rather than a callback now — a shard registers every character
   it holds in one call, so there is nothing left for HSKSTROKE itself to do. */
const HSKSTROKE = {
  /* char -> hanzi-writer payload, for every shard loaded so far. */
  data: new Map(),
  /* The characters the build generated data for; null until the manifest is in. */
  have: null,
  /* How many buckets the build split them into. Read from the manifest rather
     than hardcoded here, so changing STROKE_SHARDS in scripts/lib/db.mjs and
     regenerating is all it takes — the app follows. */
  shards: 0,

  shard(n, chars){
    for(const ch in chars) HSKSTROKE.data.set(ch, chars[ch]);
    settleStrokeFile(n);
  },

  manifest(m){
    /* Held as a Set rather than the packed string it ships as, so a lookup is
       a hash rather than a scan of 4,000 characters. */
    HSKSTROKE.have = new Set(m.chars);
    HSKSTROKE.shards = m.shards;
    settleStrokeFile("manifest");
  },
};

/* Called by a generated file once it has registered itself, and by onerror
   when there is no such file to register. Either way the wait is over. */
function settleStrokeFile(key){
  const resolve = shardResolvers.get(key);
  if(resolve){ shardResolvers.delete(key); resolve(); return; }
  /* Ran before anything asked for it. Recorded as already done so a later
     request resolves off the cache instead of adding a second tag. */
  if(!shardLoads.has(key)) shardLoads.set(key, Promise.resolve());
}

/* Loads one generated file and settles when it has registered itself. Rejects
   nothing: a missing file resolves too, and the caller decides what an absent
   character means. */
function loadStrokeFile(key, src){
  const inflight = shardLoads.get(key);
  if(inflight) return inflight;

  const p = new Promise(resolve => {
    shardResolvers.set(key, resolve);
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    /* Reached when `npm run strokes` has not been run. Resolving rather than
       rejecting leaves the CDN as the only path, which is what an ungenerated
       build should fall back to. */
    el.onerror = () => settleStrokeFile(key);
    document.head.appendChild(el);
  });
  shardLoads.set(key, p);
  return p;
}

/* Only reached for a character the local shards do not carry. The CDN needs a
   network, so it resolves to null rather than hanging when there is not one. */
function strokesFromCdn(char){
  return fetch(`${STROKE_CDN}/${encodeURIComponent(char)}.json`)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
}

function loadStrokeData(char){
  let hit = strokeCache.get(char);
  if(hit) return hit;

  hit = (async () => {
    if(HSKSTROKE.data.has(char)) return HSKSTROKE.data.get(char);

    if(!HSKSTROKE.have) await loadStrokeFile("manifest", `${STROKE_LOCAL}/manifest.js`);
    // No manifest means nothing was generated; no entry means not in the HSK set.
    if(!HSKSTROKE.have || !HSKSTROKE.have.has(char)) return strokesFromCdn(char);

    const n = char.codePointAt(0) % HSKSTROKE.shards;
    await loadStrokeFile(n, `${STROKE_LOCAL}/${String(n).padStart(2, "0")}.js`);
    return HSKSTROKE.data.get(char) ?? strokesFromCdn(char);
  })();
  strokeCache.set(char, hit);
  return hit;
}

/* The rice-grid a character is practised on: centre lines and diagonals, so
   proportion has something to be judged against. */
function strokeBoxHTML(size, id){
  const g = "var(--line)";
  return `<div class="stroke" style="width:${size}px;height:${size}px">
    <svg class="grid" width="${size}" height="${size}" aria-hidden="true">
      <line x1="${size/2}" y1="0" x2="${size/2}" y2="${size}" stroke="${g}" stroke-dasharray="6 8"/>
      <line x1="0" y1="${size/2}" x2="${size}" y2="${size/2}" stroke="${g}" stroke-dasharray="6 8"/>
      <line x1="0" y1="0" x2="${size}" y2="${size}" stroke="${g}" stroke-dasharray="4 12"/>
      <line x1="${size}" y1="0" x2="0" y2="${size}" stroke="${g}" stroke-dasharray="4 12"/>
    </svg>
    <div class="host" id="${id}"></div>
  </div>`;
}

/* Reads its colours from the live palette, so a writer created under Hazard
   and one created under Sky are each drawn in their own accent. */
function penColours(){
  const cs = getComputedStyle(document.documentElement);
  const tok = n => cs.getPropertyValue(n).trim();
  return {
    strokeColor:  tok("--acc")       || "#FFCE1F",
    radicalColor: tok("--h5")        || "#FF7A18",
    outlineColor: tok("--surface-3") || "#232329",
    drawingColor: tok("--h3")        || "#D9A81C",
  };
}

/* @param opts.mode 'demo' animates the character; 'quiz' makes you write it.
 * @param opts.autoplay  false to mount a demo without starting its animation,
 *   for a card that shows several characters and wants to run them in turn.
 * @param opts.hidden    start with only the outline showing, for a demo that
 *   is waiting its turn. */
function mountWriter(hostId, char, opts = {}){
  const host = document.getElementById(hostId);
  if(!host || !window.HanziWriter) return null;
  host.innerHTML = "";
  const size = opts.size || host.parentElement.offsetWidth || 240;
  let mistakes = 0;

  const writer = HanziWriter.create(host, char, {
    width: size, height: size, padding: 8,
    showCharacter: opts.mode === "demo" && !opts.hidden,
    showOutline: opts.outline !== false,
    drawingWidth: 22,
    strokeAnimationSpeed: 1.1,
    delayBetweenStrokes: 180,
    ...penColours(),
    charDataLoader: (c, onLoad, onError) => {
      loadStrokeData(c).then(data => {
        if(data) onLoad(data);
        else{
          host.insertAdjacentHTML("afterend",
            `<div class="miss">No stroke data for this character offline.</div>`);
          onError && onError(new Error("no stroke data"));
        }
      });
    },
  });

  const quiz = () => {
    mistakes = 0;
    writer.quiz({
      onMistake: () => { mistakes++; },
      onComplete: () => opts.onComplete && opts.onComplete(mistakes),
    });
  };

  if(opts.mode === "demo"){ if(opts.autoplay !== false) writer.animateCharacter(); }
  else quiz();

  return {
    writer,
    animate: (o) => writer.animateCharacter(o),
    quiz,
    clear: () => writer.hideCharacter(),
  };
}


/* ==================================================================
   THE LEVEL, AND A WORD
   ================================================================== */

/* One word in detail — the entry the gloss card, a character's word list and
   the Talk tab open. The words are searched through those, and the Home
   screen's word of the day; there is no list of 11,092 to page through. */

/* The level, changed from anywhere: saved once, and the rail repainted so
   the name beside it agrees with every tab. */
function setLevel(lv){
  if(!LEVELS.includes(lv)) return;
  S.level = lv; save();
  if(typeof renderRail === "function") safely("repaint the rail", renderRail);
}

/* The switch of levels over a list: "HSK" once, then a button a level. A
   tab that has nothing at some level can leave it out. */
/* counts: how much each level holds, in its title — a level with nothing
   is shown quieter, still there to be picked. */
function levelChips(hostId, current, onPick, levels = LEVELS, counts = null){
  $(hostId).innerHTML = `<span class="lbl" aria-hidden="true">HSK</span>` + levels.map(lv => {
    const n = counts ? counts[lv] || 0 : null;
    return `<button class="fchip${n === 0 ? " none" : ""}" data-lv="${lv}" aria-pressed="${lv === current}"
      aria-label="HSK ${levelLabel(lv)}" title="HSK ${levelLabel(lv)}${n === 0 ? ": nothing yet" : n ? `: ${num(n)}` : ""}">${levelLabel(lv)}</button>`;
  }).join("");
  $(hostId).onclick = e => {
    const b = e.target.closest("button[data-lv]");
    if(b) onPick(b.dataset.lv);
  };
}

/* ---------------- one word ---------------- */
async function openWord(id){
  const w = await findWord(id);
  if(!w) return;
  const [chars, meta, cards] = await Promise.all([
    getChars(), getMeta(), cardsFor("word", w.id),
  ]);
  const byChar = new Map(chars.map(c => [c.h, c]));
  const parts = [...w.s].map(c => byChar.get(c)).filter(Boolean);
  const inDeck = cards.length > 0;

  openDetail(`
    <div class="headword">
      <div>
        <div class="hw">${esc(hanziOf(w.s, w.t))}</div>
        <div class="hwp py">${pinyinHTML(w.p)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px">
        ${lvChip(w.lv)}
      </div>
    </div>

    <div class="facts">
      ${w.pos.map(p => `<span class="chip">${esc(meta.pos[p] || p)}</span>`).join("")}
      ${w.f ? `<span class="chip">frequency #${num(w.f)}</span>` : ""}
      ${w.cl.length ? `<span class="chip">measure word ${esc(w.cl.join("、"))}</span>` : ""}
      ${w.alt ? `<span class="chip">also ${esc(w.alt.join("、"))}</span>` : ""}
    </div>

    <ol class="defs">${w.en.map((m, i) =>
      `<li><span class="n">${i + 1}</span><span>${esc(m)}</span></li>`).join("")}</ol>

    ${parts.length ? `<span class="lbl" style="display:block;margin-top:4px">Characters</span>
      <div class="rows">${parts.map(c => `
        <button class="erow" data-open="char:${esc(c.h)}">
          <span class="eh">${esc(c.h)}</span>
          <span class="ep py">${pinyinHTML(c.p)}</span>
          <span class="ee">${esc(c.en.slice(0, 2).join("; "))}</span>
          <span class="ex">${lvChip(c.lv)}</span>
        </button>`).join("")}</div>` : ""}

    <div class="acts">
      <button class="${inDeck ? "no" : "go"}" data-deck="word:${esc(w.id)}:${w.lv}">
        ${inDeck ? `In your deck · remove` : "Add to review deck"}</button>
      <button class="no" data-close>Close</button>
    </div>`);
}


/* ==================================================================
   CHARACTERS, and the writing card
   ================================================================== */

/* the 3,000 characters, and one character in detail. */

const C = {level:"1", query:"", sort:"syllabus", limit:300, all:null, status:"all", sel:"",
           shown:[], writer:null, panelKey:""};
/* From this width the character picked opens in a panel beside the grid, as
   Grammar's point does beside its list; below it a cell opens the entry. */
const cWide = () => !!window.matchMedia && matchMedia("(min-width:1100px)").matches;

/* Three orders worth having, each with the headings it divides the grid by.
   Syllabus order is how the standard lists a level and how the review queue
   introduces it: alphabetical by reading, so it is headed by letter. (A few
   characters the standard files under another of their readings are put
   under the letter of the reading shown.) Frequency order is how a reader
   would choose what to learn first — the commonest character in the
   language is rank 1, and within a level the spread is wide — headed by how
   common. Fewest strokes first is the order of a dictionary's radical index. */
const cLetter = c => (flatPinyin(c.p)[0] || "#").toUpperCase();
const BANDS = [[100, "The 100 commonest"], [300, "Ranks 101–300"], [600, "Ranks 301–600"], [1000, "Ranks 601–1,000"],
               [2000, "Ranks 1,001–2,000"], [3000, "Ranks 2,001–3,000"], [Infinity, "Rarer"]];
const SORTS = {
  syllabus:  {nm: "Syllabus", long: "Syllabus order: by reading, A to Z",
              cmp: (a, b) => cLetter(a).localeCompare(cLetter(b)), sec: cLetter},
  frequency: {nm: "Frequency", long: "Commonest first",
              cmp: (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9), sec: c => BANDS.find(([n]) => (c.rank ?? 1e9) <= n)[1]},
  strokes:   {nm: "Strokes", long: "Fewest strokes first",
              cmp: (a, b) => (a.sc ?? 99) - (b.sc ?? 99) || (a.rank ?? 1e9) - (b.rank ?? 1e9),
              sec: c => c.sc ? `${c.sc} stroke${c.sc === 1 ? "" : "s"}` : "Strokes not known"},
};
/* How far you are with a character: not started; learning — in the deck, or
   written in a word that is; mastered. The grid shows one at a time. */
const CSTATUS = [["all", "All"], ["new", "Not started"], ["learning", "Learning"], ["mastered", "Mastered"]];
const cStatus = h => { const k = ctKnown(h); return k === 2 ? "mastered" : k ? "learning" : "new"; };

async function renderChars(){
  C.level = S.level;
  $$("#cview button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cv === S.charView)));
  levelChips("#clevels", C.level, lv => {
    setLevel(lv); C.limit = 300; renderChars();
  });
  $("#csort").innerHTML = `<span class="lbl">Sort</span><span class="segtrack">${Object.entries(SORTS).map(([k, v]) =>
    `<button class="fchip" data-s="${k}" aria-pressed="${C.sort === k}" title="${esc(v.long)}">${esc(v.nm)}</button>`).join("")}</span>`;
  /* The tree's reach, where the grid has its order: through every level with
     the ones above yours drawn locked, or only up to the level. */
  const level = S.treeReach === "level";
  $("#creach").innerHTML = `<span class="lbl">Grow</span><span class="segtrack">
    <button class="fchip" data-reach="all" aria-pressed="${!level}" title="Through every level, the ones above yours drawn locked">Every level</button>
    <button class="fchip" data-reach="level" aria-pressed="${level}" title="Only as far as your level">Up to HSK ${levelLabel(C.level)}</button></span>`;
  if(!C.all) C.all = await getChars();
  /* what you have met, for the header's count and the grid's marks; the
     graph, for what the panel says each part does */
  if(!CT.g) CT.g = ctGraph(C.all);
  await ctLoadKnown();
  paintChars();
  if(S.charView === "tree") await renderCharTree();
}

/* The characters a search finds: by the character itself, by a reading typed
   with or without its tones, or by a word of the meaning. */
function charsMatching(query){
  const q = String(query || "").trim().toLowerCase(), qp = flatPinyin(q);
  if(!q || !C.all) return [];
  return C.all.filter(c =>
    c.h === q || c.t === q ||
    flatPinyin(c.p).startsWith(qp) ||
    c.pAlt.some(p => flatPinyin(p).startsWith(qp)) ||
    c.en.some(e => e.toLowerCase().includes(q)));
}

/* The page's header: what the view is, and how far into the level you are —
   how many of its characters you have met and mastered, and the share met on
   a ring. The level's, whatever the search, since the level is what you are
   working through. */
function paintCharsHead(found = null){
  if(!C.all) return;
  const q = C.query.trim(), tree = S.charView === "tree", L = levelLabel(C.level);
  const lv = C.all.filter(c => c.lv === C.level);
  const met = lv.filter(c => ctKnown(c.h) > 0).length, mastered = lv.filter(c => ctKnown(c.h) === 2).length;
  const share = lv.length ? met / lv.length : 0;
  $("#csub").innerHTML = tree
    ? `How characters grow from the parts they are built on: pick a family below, or search for any character.`
    : q ? (found ? `<b>${num(found)}</b> character${found === 1 ? "" : "s"} match “${esc(q)}”, across every level.` : `No character matches “${esc(q)}”.`)
    : `Stroke order, readings and how each one is built, for the 3,000 characters of the standard.`;
  $("#cstats").innerHTML = `
    <div class="ph-ring" title="${Math.round(share * 100)}% of HSK ${esc(L)} met">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="ph-ring-t" cx="20" cy="20" r="16.5"/>${share
        ? `<circle class="ph-ring-f" cx="20" cy="20" r="16.5" pathLength="100" stroke-dasharray="${(share * 100).toFixed(1)} 100"/>` : ""}</svg>
      <b>${Math.round(share * 100)}<small>%</small></b>
    </div>
    <div class="ph-stat"><b>${num(lv.length)}</b><span>HSK ${esc(L)} characters</span></div>
    <div class="ph-stat"><b>${num(met)}</b><span>Met</span></div>
    <div class="ph-stat"><b>${num(mastered)}</b><span>Mastered</span></div>`;
}

function paintChars(){
  const q = C.query.trim().toLowerCase();
  const tree = S.charView === "tree";
  $("#v-chars").classList.toggle("treeview", tree);
  $("#cstage").classList.toggle("hidden", tree);
  $("#ctstage").classList.toggle("hidden", !tree);
  $("#croots").classList.toggle("hidden", !tree);
  $("#creach").classList.toggle("hidden", !tree);
  $("#cgridbar").classList.toggle("hidden", tree);
  /* The tree keeps its level while a search runs: the level is what it grows to. */
  $("#clevels").classList.toggle("hidden", !!q && !tree);
  if(tree){
    paintCharsHead();
    paintCharTree();
    return;
  }

  const base = q ? charsMatching(q) : C.all.filter(c => c.lv === C.level);
  paintCharsHead(base.length);

  /* The tabs over the grid, each with how many it holds. A tab left empty by
     a new level or search hands back to All. */
  const counts = {all: base.length, new: 0, learning: 0, mastered: 0};
  for(const c of base) counts[cStatus(c.h)]++;
  if(C.status !== "all" && !counts[C.status]) C.status = "all";
  $("#cstatus").innerHTML = CSTATUS.map(([k, nm]) => `<button class="ptab" data-status="${k}" aria-pressed="${C.status === k}"${
    k !== "all" && !counts[k] ? " disabled" : ""}>${nm}<small>${num(counts[k])}</small></button>`).join("");

  /* A search spans the levels, so it is headed by level, in the order picked
     within each. */
  const cmp = SORTS[C.sort].cmp;
  const list = (C.status === "all" ? base : base.filter(c => cStatus(c.h) === C.status))
    .slice().sort(q ? (a, b) => (+a.lv - +b.lv) || cmp(a, b) : cmp);
  const sec = q ? c => `HSK ${levelLabel(c.lv)}` : SORTS[C.sort].sec;
  const total = new Map();
  for(const c of list){ const k = sec(c); total.set(k, (total.get(k) || 0) + 1); }

  const shown = list.slice(0, C.limit);
  C.shown = shown.map(c => c.h);
  /* On a wide screen something is always open beside the grid: the
     character picked, while it is in the grid, or else the first. */
  if(cWide() && shown.length && !C.shown.includes(C.sel)) C.sel = shown[0].h;
  let last = null, html = "";
  for(const c of shown){
    const k = sec(c);
    if(k !== last){
      html += `<div class="csec"><b>${esc(k)}</b><i aria-hidden="true"></i><small>${num(total.get(k))}</small></div>`;
      last = k;
    }
    html += cCellHTML(c, q);
  }
  $("#cgrid").innerHTML = shown.length ? html
    : `<div class="empty" style="grid-column:1/-1">${q ? "No characters match that." : "None here yet."}</div>`;

  const more = list.length > C.limit;
  $("#cmore").classList.toggle("hidden", !more);
  if(more) $("#cmore").textContent = `Show more (${num(list.length - C.limit)} left)`;
  settleList("#clist", `${C.level}|${C.query}|${C.sort}|${C.status}`);
  paintCharPanel();
}

/* A cell: the character, its reading and the first of its senses; a tick
   once it is met, a star once mastered; in a search, which spans the
   levels, its level on a plate in the level's colour; in frequency order,
   its rank. */
function cCellHTML(c, q){
  const k = ctKnown(c.h);
  return `<button class="cell v${c.lv}${k === 2 ? " mastered" : k ? " met" : ""}${cWide() && C.sel === c.h ? " on" : ""}" data-csel="${esc(c.h)}"
    title="${esc(c.h)} ${esc(c.p)} — ${esc(c.en.slice(0, 2).join("; "))}${c.rank ? ` · frequency #${c.rank}` : ""}">
    ${!q && C.sort === "frequency" && c.rank ? `<span class="cr">#${c.rank}</span>` : ""}
    ${q ? `<span class="clv">${esc(levelLabel(c.lv))}</span>` : ""}
    ${k ? `<span class="cst">${k === 2 ? CT_STAR : CT_TICK}</span>` : ""}
    <span class="ch">${esc(c.h)}</span>
    <span class="cp">${esc(c.p)}</span>
    <span class="ce">${esc(ctShort(c.en[0]))}</span>
  </button>`;
}

/* A cell picked. On a wide screen it opens beside the grid, and picked a
   second time, or with Enter, opens the full entry; on a narrow one it
   opens the entry straight away. */
function cPick(h){
  if(!cWide() || C.sel === h){ safely("open that entry", () => openChar(h)); return; }
  C.sel = h;
  for(const el of $$("#cgrid .cell.on")) el.classList.remove("on");
  const cell = [...$$("#cgrid .cell")].find(el => el.dataset.csel === h);
  if(cell){
    cell.classList.add("on");
    cell.scrollIntoView({block: "nearest", behavior: REDUCED() ? "auto" : "smooth"});
  }
  paintCharPanel();
}

/* The arrows across the grid: left and right through the order, up and down
   to the cell nearest above or below, across a heading if there is one. */
function cMove(key){
  const cells = [...$$("#cgrid .cell")];
  if(!cells.length) return;
  const i = cells.findIndex(el => el.dataset.csel === C.sel);
  if(i < 0){ cPick(cells[0].dataset.csel); return; }
  let j = i;
  if(key === "ArrowRight") j = Math.min(cells.length - 1, i + 1);
  else if(key === "ArrowLeft") j = Math.max(0, i - 1);
  else{
    const down = key === "ArrowDown", r = cells[i].getBoundingClientRect(), cx = r.left + r.width / 2;
    let best = -1, bestRow = Infinity, bestDx = Infinity;
    cells.forEach((el, n) => {
      const b = el.getBoundingClientRect();
      const row = down ? b.top - r.bottom : r.top - b.bottom;
      if(row < -2) return;
      const dx = Math.abs(b.left + b.width / 2 - cx);
      if(row < bestRow - 2 || (Math.abs(row - bestRow) <= 2 && dx < bestDx)){ best = n; bestRow = row; bestDx = dx; }
    });
    if(best >= 0) j = best;
  }
  if(j === i) return;
  cPick(cells[j].dataset.csel);
  /* the focus goes with the pick, so Enter — a press of the cell focused —
     opens the entry of the one picked */
  cells[j].focus({preventScroll: true});
}

/* The character picked, beside the grid: the same panel the tree has — its
   strokes, reading and senses, what it is built from and what it builds
   into, the words it is in — and the way to its entry, the deck and its
   tree. Drawn again only when there is something new to say. */
function paintCharPanel(){
  const el = $("#cpanel");
  if(!el) return;
  const c = C.sel && CT.g ? CT.g.by.get(C.sel) : null;
  const on = cWide() && S.charView !== "tree" && !!c && C.shown.includes(C.sel);
  el.hidden = !on;
  $("#cstage").classList.toggle("with-panel", on);
  if(!on){ el.innerHTML = ""; C.writer = null; C.panelKey = ""; return; }
  const key = [c.h, ctKnown(c.h), CT.deck.get(c.h) || 0, S.level, C.shown.indexOf(c.h), C.shown.length, C.query].join("|");
  if(C.panelKey === key) return;
  C.panelKey = key;
  el.innerHTML = cPanelHTML(c);
  el.querySelector(".ct-i-scroll").scrollTop = 0;
  C.writer = mountWriter("cp-host", c.h, {mode: "demo", size: 104, autoplay: false});
  wordsWithChar(c.h, 6).then(words => {
    const box = $("#cp-words");
    if(!box || C.panelKey !== key) return;
    box.innerHTML = words.length ? words.map(w => `
      <button class="ct-i-word" data-open="word:${esc(w.id)}">
        <span class="hz">${esc(w.s)}</span><span class="py">${pinyinHTML(w.p)}</span>
        <span class="ct-i-wen">${esc(w.en[0] || "")}</span>${lvChip(w.lv)}</button>`).join("")
      : `<p class="ct-i-none">Not written in any word of the syllabus on its own.</p>`;
  });
}

function cPanelHTML(c){
  const known = ctKnown(c.h), inDeck = (CT.deck.get(c.h) || 0) > 0;
  const status = known === 2 ? `<span class="ct-chip mastered">${CT_STAR}Mastered</span>`
    : inDeck ? `<span class="ct-chip met">${CT_TICK}In your deck</span>`
    : known ? `<span class="ct-chip met">${CT_TICK}In your words</span>`
    : +c.lv > +S.level ? `<span class="ct-chip lock">${CT_LOCK}Above your level</span>` : "";
  const at = C.shown.indexOf(c.h), q = C.query.trim();
  const ops = [...String(c.dec || "")].filter(x => IDS[x]);
  const built = c.comp.length ? `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>How it is built</span>${ops.length ? `<small>${esc(IDS[ops[0]])}</small>` : ""}</h4>
      <div class="ct-i-parts">${c.comp.map(p => {
        const role = ctRole(c.h, p.c), pa = ctAbout(p.c), open = CT.g.by.has(p.c) && p.c !== c.h;
        return `<button class="ct-i-part${role ? ` ${role}` : ""}" ${open ? `data-open="char:${esc(p.c)}" title="Open ${esc(p.c)}"`
          : `data-grow="${esc(p.c)}" title="What is built on ${esc(p.c)}, in the tree"`}>
          <b class="hz">${esc(p.c)}</b><span><em>${esc(p.g || pa.short || "component")}</em>${role ? `<small>gives the ${role}</small>`
            : pa.c ? `<small class="py">${esc(pa.c.p)}</small>` : ""}</span></button>`;
      }).join(`<i class="ct-i-plus">+</i>`)}</div></section>` : "";
  const kids = (CT.g.kids.get(c.h) || []).map(h => CT.g.by.get(h)).filter(Boolean).sort((a, b) => +a.lv - +b.lv);
  const family = kids.length ? `<section class="ct-i-sec">
      <h4 class="ct-i-h"><span>Builds into</span><small>${num(kids.length)} in the syllabus</small></h4>
      <div class="ct-i-kids">${kids.slice(0, 21).map(k => `<button class="ct-i-kid hz v${k.lv}${ctKnown(k.h) ? " met" : ""}" data-open="char:${esc(k.h)}"
        title="${esc(k.h)} ${esc(k.p)} · ${esc(ctShort(k.en[0]))} · HSK ${esc(levelLabel(k.lv))}">${esc(k.h)}</button>`).join("")}${
        kids.length > 21 ? `<button class="ct-i-more" data-grow="${esc(c.h)}" title="All of them, in the tree">+${num(kids.length - 21)}</button>` : ""}</div>
    </section>` : "";
  const facts = [c.sc ? `<span><b>${c.sc}</b> strokes</span>` : "", c.rank ? `<span>frequency <b>#${num(c.rank)}</b></span>` : "",
    c.rad ? `<span>radical <b class="hz">${esc(c.rad)}</b></span>` : "", c.inWords ? `<span>in <b>${num(c.inWords)}</b> words</span>` : ""].filter(Boolean).join("");
  return `
    <div class="ct-i-scroll">
      <div class="ct-i-kicker">${q ? `Match ${num(at + 1)} of ${num(C.shown.length)}` : `HSK ${esc(levelLabel(c.lv))} · ${num(at + 1)} of ${num(C.shown.length)}`}</div>
      <div class="ct-i-hero">
        <div class="ct-i-glyph">
          <svg class="ct-i-grid" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0v100M0 50h100M0 0l100 100M100 0 0 100"/></svg>
          <div class="ct-i-host" id="cp-host"></div>
          <button class="ct-i-play" data-cp="strokes" title="Play the strokes" aria-label="Play the stroke order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button>
        </div>
        <div class="ct-i-id">
          <span class="ct-i-read py">${pinyinHTML(c.p)}</span>
          ${c.pAlt.length ? `<small class="ct-i-alt">also <span class="py">${pinyinHTML(c.pAlt.join(", "))}</span></small>` : ""}
          <div class="ct-i-chips">${lvChip(c.lv)}${status}</div>
        </div>
      </div>
      <p class="ct-i-en">${esc(c.en.slice(0, 3).join("; "))}</p>
      ${facts ? `<div class="ct-i-facts">${facts}</div>` : ""}
      ${built}
      ${family}
      <section class="ct-i-sec"><h4 class="ct-i-h"><span>In words</span></h4><div class="ct-i-words" id="cp-words"><span class="ct-i-none">…</span></div></section>
    </div>
    <div class="ct-i-acts">
      <button class="btn sm" data-open="char:${esc(c.h)}" title="Everything about ${esc(c.h)} (Enter)">Open entry</button>
      <button class="ghost sm${inDeck ? " on" : ""}" data-deck="char:${esc(c.h)}:${c.lv}">${inDeck ? `${CT_TICK}In deck` : "Add to deck"}</button>
      <button class="ghost sm cp-tree" data-grow="${esc(c.h)}" aria-label="Explore in the tree" title="Its family, and what it is made of, in the tree"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="9.5" width="5" height="5" rx="1.4"/><rect x="16.5" y="3" width="5" height="5" rx="1.4"/><rect x="16.5" y="9.5" width="5" height="5" rx="1.4"/><rect x="16.5" y="16" width="5" height="5" rx="1.4"/><path d="M7.5 12h9M10.5 12c0-4.5 2-6.5 6-6.5M10.5 12c0 4.5 2 6.5 6 6.5"/></svg></button>
    </div>`;
}

/* ---------------- one character ---------------- */
async function openChar(h){
  const [c, words, cards, index, all] = await Promise.all([
    findChar(h), wordsWithChar(h, 18), cardsFor("char", h), getSearch(), getChars(),
  ]);
  if(!c) return;
  const inDeck = cards.length > 0;
  const mastered = cards.some(x => x.mode === "recognize" && isMastered(x));
  /* A combination that is itself a syllabus word opens its entry. */
  const wordId = new Map();
  for(const [id, s] of index) if(!wordId.has(s)) wordId.set(s, id);

  // Components that are themselves HSK characters are worth opening; the rest
  // are radicals and fragments that have no entry of their own, and open the
  // tree of what is built on them instead.
  const known = new Set(all.map(x => x.h));
  /* Which part gives the meaning and which the sound, and what is built on
     the character — read off the tree's graph, built here if the tree has
     not been drawn yet. */
  if(!CT.g) CT.g = ctGraph(all);
  const family = (CT.g.kids.get(c.h) || []).map(k => CT.g.by.get(k)).filter(Boolean);
  /* The traditional form, where it differs — the first where the list gives
     more than one — drawn in the box by the same switch the app's script
     setting uses, and opened in that script when the setting says so. */
  const trad = c.t && c.t !== c.h ? String(c.t).split(/[/|]/)[0].trim() : "";
  const startTrad = !!trad && S.script === "traditional";

  openDetail(`
    <div class="char-sheet">
    <div class="char-side">
      <div style="text-align:center">
        ${strokeBoxHTML(228, "dhost")}
        <div class="act-row" style="justify-content:center;margin-top:11px">
          <button class="ghost" id="d-animate">Animate</button>
          <button class="ghost" id="d-quiz">Practise</button>
          <button class="ghost" id="d-clear">Clear</button>
        </div>
        ${trad ? `<div class="seg script-seg" id="d-script" role="group" aria-label="Script">
          <button data-script="s" aria-pressed="${!startTrad}"><span class="hz">${esc(c.h)}</span> Simplified</button>
          <button data-script="t" aria-pressed="${startTrad}"><span class="hz">${esc(trad)}</span> Traditional</button>
        </div>` : ""}
        <div style="margin-top:13px">
          <span class="read py" style="font-size:17px">${pinyinHTML(c.p)}</span>
        </div>
        ${c.pAlt.length ? `<p class="pmeta" style="margin:4px 0 0">also read
          <span class="py">${pinyinHTML(c.pAlt.join(", "))}</span></p>` : ""}
        <p style="margin:7px 0 0;font-size:15px;line-height:1.5">${esc(c.en.slice(0, 3).join("; "))}</p>
      </div>

      <div class="facts" style="justify-content:center">
        ${lvChip(c.lv)}
        ${mastered ? `<span class="chip sens4 cstat">${CT_STAR}Mastered</span>` : inDeck ? `<span class="chip sens4 cstat">${CT_TICK}In your deck</span>` : ""}
      </div>

      <div class="cfacts">
        ${c.rank ? `<div class="cfact"><b>${num(c.rank)}</b><span>Frequency</span></div>` : ""}
        ${c.sc ? `<div class="cfact"><b>${c.sc}</b><span>Strokes</span></div>` : ""}
        ${c.rad ? `<div class="cfact"><b class="hz">${esc(c.rad)}</b><span>Radical${c.radn ? ` ${c.radn}` : ""}</span></div>` : ""}
        ${c.inWords ? `<div class="cfact"><b>${c.inWords}</b><span>HSK words</span></div>` : ""}
      </div>
    </div>

    <div class="char-more">
      ${c.comp.length || c.ety ? `
        <span class="lbl sheet-h">Built from</span>
        ${c.comp.length ? `<div class="parts">${c.comp.map(part => {
          const openable = known.has(part.c) && part.c !== c.h, role = ctRole(c.h, part.c);
          return `<button class="part${role ? ` ${role}` : ""}" ${openable ? `data-open="char:${esc(part.c)}"`
            : `data-grow="${esc(part.c)}" title="What is built on ${esc(part.c)}, in the tree"`}>
            <span class="pg">${esc(part.c)}</span>
            <span class="pt"><b>${esc(part.g || "component")}</b>
            <small>${role ? `gives the ${role}` : openable ? "HSK character" : "component"}</small></span>
          </button>`;
        }).join("")}</div>` : ""}
        ${c.dec ? structureHTML(c.dec) : ""}
        ${c.ety ? `<p class="ety">${esc(c.ety)}</p>` : ""}` : ""}

      ${c.ex.length ? `<span class="lbl sheet-h" style="margin-top:4px">Common combinations
          <span class="sheet-h-note">· the ones in the syllabus open</span></span>
        <div class="combos">${c.ex.map(e => wordId.has(e)
          ? `<button class="combo hz" data-open="word:${esc(wordId.get(e))}" title="Open the entry">${esc(e)}</button>`
          : `<span class="combo hz plain">${esc(e)}</span>`).join("")}</div>` : ""}

      ${family.length ? `<span class="lbl sheet-h" style="margin-top:4px">Built on <b class="hz">${esc(c.h)}</b>
          <span class="sheet-h-note">· ${num(family.length)} in the syllabus</span></span>
        <div class="cfam">${family.slice(0, 28).map(k => `<button class="cfam-k hz v${k.lv}" data-open="char:${esc(k.h)}"
          title="${esc(k.h)} ${esc(k.p)} · ${esc(ctShort(k.en[0]))} · HSK ${esc(levelLabel(k.lv))}">${esc(k.h)}</button>`).join("")}${
          family.length > 28 ? `<button class="cfam-more" data-grow="${esc(c.h)}">+${num(family.length - 28)} in the tree</button>` : ""}</div>` : ""}

      ${words.length ? `<span class="lbl sheet-h" style="margin-top:4px">HSK words using <b class="hz">${esc(c.h)}</b></span>
        <div class="rows char-words">${words.map(w => `
          <button class="erow" data-open="word:${esc(w.id)}">
            <span class="eh">${esc(w.s)}</span>
            <span class="ep py">${pinyinHTML(w.p)}</span>
            <span class="ee">${esc(w.en[0] || "")}</span>
            <span class="ex">${lvChip(w.lv)}</span>
          </button>`).join("")}</div>` : ""}
    </div>
    </div>

    <div class="acts">
      <button class="${inDeck ? "no" : "go"}" data-deck="char:${esc(c.h)}:${c.lv}">
        ${inDeck ? "In your deck · remove" : "Add to review deck"}</button>
      <button class="no" data-grow="${esc(c.h)}" title="Its family, and what it is made of, in the tree">Explore in the tree</button>
      <button class="no" data-close>Close</button>
    </div>`, {sheet: "char"});

  let w = mountWriter("dhost", startTrad ? trad : c.h, {mode: "demo", size: 228});
  const wire = () => { if(!w) return; $("#d-animate").onclick = w.animate; $("#d-quiz").onclick = w.quiz; $("#d-clear").onclick = w.clear; };
  wire();
  const seg = $("#d-script");
  if(seg) seg.onclick = e => {
    const b = e.target.closest("button[data-script]");
    if(!b || b.getAttribute("aria-pressed") === "true") return;
    seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $$("#dhost ~ .miss").forEach(m => m.remove());
    w = mountWriter("dhost", b.dataset.script === "t" ? trad : c.h, {mode: "demo", size: 228});
    wire();
  };
}

/* The ideographic description of how a character is put together — ⿰女子,
   ⿻刀二 — read out: the operator named in words, the pieces at a size they
   can be seen at. A nested description (⿱⿰…) is read as its outermost
   arrangement. */
const IDS = {
  "⿰": "left and right", "⿱": "top and bottom", "⿲": "three across", "⿳": "three down",
  "⿴": "one around another", "⿵": "one over another", "⿶": "one under another", "⿷": "one beside another",
  "⿸": "one over the top-left", "⿹": "one over the top-right", "⿺": "one under the bottom-left",
  "⿻": "one over the other", "⿼": "one around the right", "⿽": "one around the bottom",
  "⿾": "mirrored", "⿿": "turned",
};
function structureHTML(dec){
  const chars = [...String(dec)];
  const ops = chars.filter(ch => IDS[ch]);
  const parts = chars.filter(ch => !IDS[ch]);
  if(!parts.length) return "";
  const how = ops.length ? IDS[ops[0]] : "";
  return `<div class="structure" title="${esc(dec)}">
    <span class="st-lbl">Structure</span>
    ${ops.length ? `<span class="st-op hz" aria-hidden="true">${esc(ops[0])}</span>` : ""}
    <span class="st-parts hz">${parts.map(p => `<i>${esc(p)}</i>`).join("<em>+</em>")}</span>
    ${how ? `<span class="st-how">${esc(how)}</span>` : ""}
  </div>`;
}

/* ---------------- the writing card ---------------- */

/* A word tapped on a page or a Talk card, shown as the characters it is
 * written with: one stroke box per character, side by side, each with its own
 * reading, sense and the same Animate / Practise / Clear the character entry
 * has. The strokes play through in order — first character, then the next —
 * because that is the order the word is written in.
 *
 * Its own dialog rather than the detail sheet, so that it can open over an
 * entry and the entry is still there when it closes.
 *
 * @param opts.nav  whether each character offers its full entry. On from the
 *   reader and Talk; off where the entry would replace what the card opened
 *   over.
 * @param opts.tok  the word's token, for the reading and senses at the top.
 */
async function openWriting(word, opts = {}){
  const chars = [...String(word || "")].filter(c => /\p{Script=Han}/u.test(c));
  if(!chars.length) return;
  const {nav = false, tok = null} = opts;
  const entries = await Promise.all(chars.map(findChar));
  const many = chars.length > 1;
  const size = many ? 196 : 228;

  const section = (c, e, i) => `
    <section class="wr-sec">
      ${strokeBoxHTML(size, `wr-host-${i}`)}
      <div class="act-row wr-acts">
        <button class="ghost" data-wr="animate:${i}">Animate</button>
        <button class="ghost" data-wr="quiz:${i}">Practise</button>
        <button class="ghost" data-wr="clear:${i}">Clear</button>
      </div>
      <div class="wr-read">
        <span class="hz wr-ch">${esc(c)}</span>
        ${e ? `<span class="read py">${pinyinHTML(e.p)}</span>` : ""}
      </div>
      ${e ? `<p class="wr-en">${esc(e.en.slice(0, 2).join("; "))}</p>
        <div class="facts wr-facts">
          ${lvChip(e.lv)}
          ${e.sc ? `<span class="chip">${e.sc} strokes</span>` : ""}
          ${e.rad ? `<span class="chip hz">radical ${esc(e.rad)}</span>` : ""}
        </div>`
        : `<p class="wr-en pmeta">Not one of the 3,000 syllabus characters.</p>`}
      ${nav && e ? `<button class="linky wr-more" data-open="char:${esc(c)}">Full entry</button>` : ""}
    </section>`;

  const dlg = $("#writing");
  dlg.classList.toggle("many", many);
  dlg.classList.remove("closing");
  $("#writing-body").innerHTML = `
    ${many ? `<div class="wr-head">
      <div class="wr-word hz">${esc(chars.join(""))}</div>
      ${tok && tok.p ? `<div class="wr-py py">${pinyinHTML(tok.p)}</div>` : ""}
      ${tok && tok.en && tok.en.length
        ? `<p class="wr-sense">${esc((Array.isArray(tok.en) ? tok.en : [tok.en]).slice(0, 2).join("; "))}</p>` : ""}
      ${tok && tok.lv ? `<div class="facts" style="justify-content:center;margin-top:8px">${lvChip(tok.lv)}</div>` : ""}
    </div>` : ""}
    <div class="wr-grid" style="--n:${Math.min(chars.length, 3)}">
      ${chars.map((c, i) => section(c, entries[i], i)).join("")}
    </div>
    <div class="acts">
      <button class="no" data-wrclose>Close</button>
    </div>`;
  if(!dlg.open) dlg.showModal();
  $("#writing-body").scrollTop = 0;

  const writers = chars.map((c, i) => mountWriter(`wr-host-${i}`, c, {mode: "demo", size, autoplay: false, hidden: i > 0}));
  /* One after another, the way the word is written. A character with no
     stroke data simply passes the turn. */
  const play = i => {
    const w = writers[i];
    if(!w) return;
    w.animate({onComplete: () => { if(i + 1 < writers.length) play(i + 1); }});
  };
  play(0);

  $("#writing-body").onclick = e => {
    const b = e.target.closest("[data-wr]");
    if(!b) return;
    const [what, i] = b.dataset.wr.split(":");
    const w = writers[+i];
    if(w) w[what]();
  };
}
const closeWriting = () => closeDialog($("#writing"));


/* ==================================================================
   GRAMMAR
   ================================================================== */

/* the 573-point syllabus, and one point in detail. The list follows the
   standard's own sections — Parts of speech, Phrases, Sentence types — each
   point numbered as the standard numbers it. On a wide screen the point
   picked is open beside the list, which keeps its place, and the arrows step
   through them; on a narrow one a row opens the sheet. */

const G = {level:"1", query:"", all:null, sel:0, deck:new Set(), sec:""};
const gWide = () => !!window.matchMedia && matchMedia("(min-width:1100px)").matches;

async function renderGrammar(){
  G.level = S.level;
  levelChips("#glevels", G.level, lv => { setLevel(lv); renderGrammar(); });
  if(!G.all) G.all = await getGrammar();
  await gLoadDeck();
  paintGrammar();
}
/* Which points are in the deck, for the rows' marks and the point's own. */
async function gLoadDeck(){
  G.deck = new Set((await dbAll("cards")).filter(c => c.kind === "grammar").map(c => +c.ref));
}

/* The points a level holds, or a search finds across every level; and of
   those, the ones on show — all, or one of the standard's sections. */
function gAll(){
  const q = G.query.trim().toLowerCase();
  if(!q) return G.all.filter(g => g.lv === G.level);
  return G.all.filter(g => [g.title, g.summary, g.topic, g.topicZh, g.category, g.categoryZh, g.content]
    .join(" ").toLowerCase().includes(q));
}
function gList(){
  const all = gAll();
  return G.sec ? all.filter(g => g.group === G.sec) : all;
}

/* A title, or a line of an explanation, with its Chinese set in the Chinese
   face: 会 and 能 read as the words they are, not as two more letters. */
const gZh = s => esc(s).replace(/[\p{Script=Han}][\p{Script=Han}…·、／/]*/gu, m => `<span class="hz">${m}</span>`);

function paintGrammar(){
  const q = G.query.trim().toLowerCase();
  const all = gAll();
  $("#glevels").classList.toggle("hidden", !!q);
  paintGrammarHead(all.length);

  /* The standard's sections this level (or search) touches, in its order,
     each a tab with how many points it holds. A tab a new level leaves empty
     hands back to All. */
  const secs = [];
  for(const g of all){
    const s = secs.find(x => x.k === g.group);
    if(s) s.n++; else secs.push({k: g.group, zh: g.groupZh, n: 1});
  }
  if(G.sec && !secs.some(s => s.k === G.sec)) G.sec = "";
  $("#gsecs").innerHTML = secs.length > 1 || G.sec ? `<button class="ptab" data-gsec="" aria-pressed="${!G.sec}">All<small>${num(all.length)}</small></button>`
    + secs.map(s => `<button class="ptab" data-gsec="${esc(s.k)}" aria-pressed="${G.sec === s.k}" title="${esc(s.zh)}">${esc(s.k)}<small>${num(s.n)}</small></button>`).join("") : "";
  const list = G.sec ? all.filter(g => g.group === G.sec) : all;

  /* On a wide screen something is always open beside the list: the point
     picked, while it is in the list, or else the first. */
  if(gWide() && list.length && !list.some(g => g.id === G.sel)) G.sel = list[0].id;

  /* The rows under the standard's headings, a heading for each run of points
     a section holds — or, for a search, which spans the levels, under each
     level. */
  const head = g => q ? `HSK ${levelLabel(g.lv)}` : g.group;
  const runs = [];
  for(const g of list){
    const last = runs[runs.length - 1];
    if(last && last.h === head(g)) last.list.push(g); else runs.push({h: head(g), zh: q ? "" : g.groupZh, list: [g]});
  }
  $("#grows").innerHTML = list.length ? runs.map(r => `
    <div class="gsec"><b>${esc(r.h)}</b>${r.zh ? `<span class="hz">${esc(r.zh)}</span>` : ""}<small>${num(r.list.length)}</small></div>
    ${r.list.map(g => gRowHTML(g, q)).join("")}`).join("")
    : `<div class="empty">Nothing matches that.<br>Try an English keyword such as “complement”, or a Chinese pattern.</div>`;
  settleList("#glist", `${G.level}|${G.query}|${G.sec}`);
  paintGrammarPoint();
}

/* The page's header: what it holds, and how far into the level you are —
   its points, how many are explained, how many are in your deck, and that
   share on a ring. A search says what it found. */
function paintGrammarHead(found){
  const q = G.query.trim(), L = levelLabel(G.level);
  const lv = G.all.filter(g => g.lv === G.level);
  const done = lv.filter(g => g.summary).length, mine = lv.filter(g => G.deck.has(g.id)).length;
  const share = lv.length ? mine / lv.length : 0;
  $("#gsub").innerHTML = q
    ? (found ? `<b>${num(found)}</b> point${found === 1 ? "" : "s"} match “${esc(q)}”, across every level.` : `No point matches “${esc(q)}”.`)
    : done ? `The standard's ${num(G.all.length)} points under its own headings: what each one does, with examples of it in use.`
    : `HSK ${esc(L)}'s points are listed as the standard gives them; their explanations are still to be written.`;
  $("#gstats").innerHTML = `
    <div class="ph-ring" title="${Math.round(share * 100)}% of HSK ${esc(L)} in your deck">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="ph-ring-t" cx="20" cy="20" r="16.5"/>${share
        ? `<circle class="ph-ring-f" cx="20" cy="20" r="16.5" pathLength="100" stroke-dasharray="${(share * 100).toFixed(1)} 100"/>` : ""}</svg>
      <b>${Math.round(share * 100)}<small>%</small></b>
    </div>
    <div class="ph-stat"><b>${num(lv.length)}</b><span>HSK ${esc(L)} points</span></div>
    <div class="ph-stat"><b>${num(done)}</b><span>Explained</span></div>
    <div class="ph-stat"><b>${num(mine)}</b><span>In your deck</span></div>`;
}

/* A row: the point's number, its title, the first line of what it says, its
   category, and a tick once it is in the deck. */
const gRowHTML = (g, q) => `
  <button class="grow${gWide() && G.sel === g.id ? " on" : ""}" data-gsel="${g.id}">
    <span class="gno">${g.id}</span>
    <span class="gt">${gZh(g.title)}</span>
    <span class="gs">${gZh(g.summary || g.content || `${g.group} · ${g.category}`)}</span>
    <span class="gx"><span class="gcat">${esc(g.category)}</span>${q ? lvChip(g.lv) : ""}${G.deck.has(g.id) ? `<span class="gdk" title="In your deck">${CT_TICK}</span>` : ""}</span>
  </button>`;

/* The point picked, open beside the list. */
function paintGrammarPoint(){
  const el = $("#gdetail");
  if(!el) return;
  const wide = gWide();
  el.hidden = !wide;
  if(!wide) return;
  const g = G.all.find(x => x.id === G.sel);
  el.innerHTML = g ? grammarHTML(g, {panel: true}) : `<div class="empty">Nothing matches that.</div>`;
  el.scrollTop = 0;
}

/* A point picked from the list, the panel, or by the arrows: open beside
   the list on a wide screen, its row lit and in view; on a narrow one, the
   sheet. */
function gPick(id){
  if(!gWide()){ safely("open that entry", () => openGrammar(id)); return; }
  G.sel = +id;
  for(const r of $$("#grows .grow")) r.classList.toggle("on", +r.dataset.gsel === G.sel);
  const row = $(`#grows .grow[data-gsel="${G.sel}"]`);
  if(row) row.scrollIntoView({block: "nearest", behavior: REDUCED() ? "auto" : "smooth"});
  paintGrammarPoint();
}
function gStep(d){
  const list = gList(), i = list.findIndex(g => g.id === G.sel);
  const next = list[i < 0 ? 0 : i + d];
  if(!next) return;
  gPick(next.id);
  /* the focus goes with the pick, so the row lit is the row a key presses */
  const row = $(`#grows .grow[data-gsel="${next.id}"]`);
  if(row) row.focus({preventScroll: true});
}

/* A card added or taken out: the rows' ticks and the point's button follow. */
function grammarDeckChanged(){
  if(S.view !== "grammar" || !G.all) return;
  return gLoadDeck().then(() => paintGrammar());
}

/* The words of a point's own pattern, to be marked in its examples: the
   Chinese of its title — 会 and 能, 越……越…… — or, where those are not in
   the examples, the forms the standard lists for it, a character or two
   each (上、下、里、外). Longest first, so 这儿 is marked whole before 这. */
function gMarks(g){
  const han = s => String(s || "").match(/\p{Script=Han}+/gu) || [];
  const said = g.examples.map(e => e.zh).join("");
  let marks = han(g.title);
  if(!marks.some(m => said.includes(m))) marks = han(g.content).filter(m => m.length <= 2);
  return [...new Set(marks)].filter(m => said.includes(m)).sort((a, b) => b.length - a.length);
}
function gMarked(zh, marks){
  if(!marks.length) return esc(zh);
  return esc(zh).replace(new RegExp(marks.join("|"), "gu"), m => `<mark>${m}</mark>`);
}

/* A point in full, for the panel beside the list or for the sheet: where it
   sits in the standard, its title and level, the explanation, the examples
   with the pattern marked in each, the standard's own entry, the other
   points of its category, and the deck — with, in the panel, the way to the
   point before and the one after. */
function grammarHTML(g, opts = {}){
  const inDeck = G.deck.has(g.id), marks = gMarks(g);
  const related = G.all.filter(x => x.category === g.category && x.id !== g.id).slice(0, 8);
  const list = opts.panel ? gList() : [], i = list.findIndex(x => x.id === g.id);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 ? list[i + 1] : null;
  const pick = r => opts.panel ? `data-gsel="${r.id}"` : `data-open="grammar:${r.id}"`;
  return `
    <div class="gd">
      <div class="gd-kicker">Point ${g.id} · ${esc(g.group)} › ${esc(g.category)}${
        g.topic && g.topic !== g.category && /[A-Za-z]/.test(g.topic) ? ` › ${esc(g.topic)}` : ""}</div>
      <div class="gd-head">
        <h2 class="gd-title">${gZh(g.title)}</h2>
        <div class="gd-chips">${lvChip(g.lv)}${inDeck ? `<span class="chip sens4 cstat">${CT_TICK}In your deck</span>` : ""}</div>
      </div>

      ${g.summary
        ? `<p class="gd-sum">${gZh(g.summary)}</p>`
        : `<p class="note gd-none">This point is listed in the official syllabus without a written explanation in
            HANZAI-ORIGINS yet. The syllabus entry itself is below.</p>`}

      ${g.examples.length ? `<span class="lbl gd-h">Examples</span>
        <div class="gd-exs">${g.examples.map((ex, n) => `
          <div class="gd-ex">
            <span class="gd-exn" aria-hidden="true">${n + 1}</span>
            <span class="gd-zh hz">${gMarked(ex.zh, marks)}</span>
            <span class="gd-py py">${pinyinHTML(ex.py)}</span>
            <span class="gd-en">${esc(ex.en)}</span>
          </div>`).join("")}</div>` : ""}

      ${g.content ? `<div class="quote">
        <span class="lbl">Official syllabus entry</span>
        <p class="qtext" style="margin:5px 0 0">${esc(g.content)}</p>
        <p class="qsrc">${esc(g.groupZh)} · ${esc(g.categoryZh)}${
          g.topicZh && g.topicZh !== g.categoryZh ? ` · ${esc(g.topicZh)}` : ""}</p>
      </div>` : ""}

      ${related.length ? `<span class="lbl gd-h">Also under ${esc(g.category)}</span>
        <div class="gd-rel">${related.map(r => `<button class="gd-r" ${pick(r)}>
          <span class="gno">${r.id}</span><span class="gd-rt">${gZh(r.title)}</span>${lvChip(r.lv)}</button>`).join("")}</div>` : ""}
    </div>

    <div class="acts gd-acts">
      ${g.summary ? `<button class="${inDeck ? "no" : "go"}" data-deck="grammar:${g.id}:${g.lv}">
        ${inDeck ? "In your deck · remove" : "Add to review deck"}</button>` : ""}
      ${opts.panel ? `<div class="gd-pager">
          <button class="gd-pg" ${prev ? `data-gsel="${prev.id}"` : "disabled"} aria-label="The point before" title="The point before (↑)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg></button>
          <span>${num(i + 1)} of ${num(list.length)}</span>
          <button class="gd-pg" ${next ? `data-gsel="${next.id}"` : "disabled"} aria-label="The next point" title="The next point (↓)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg></button>
        </div>`
        : `<button class="no" data-close>Close</button>`}
    </div>`;
}

/* ---------------- one point, as a sheet ---------------- */
/* From a narrow screen's list, and from wherever else a point is named —
   the reader's word card cites the point an example sentence was written
   for. */
async function openGrammar(id){
  if(!G.all) G.all = await getGrammar();
  const g = G.all.find(x => x.id === +id);
  if(!g) return;
  await gLoadDeck();
  openDetail(grammarHTML(g), {sheet: "gram"});
}
