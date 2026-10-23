/* reader.js — reading real Chinese, with the syllabus laid over the top.
 *
 * The rest of the app works through the standard list by list. This view works
 * the other way round: you bring a book, and the standard is used to tell you
 * what is in it — every word cut out, coloured by the HSK level it belongs to,
 * one tap from its reading and its meaning, and one more from your deck.
 *
 * Books live in IndexedDB in two pieces. The library reads the metadata store
 * on every paint; the text itself is a second row fetched only when a book is
 * opened, so a shelf of novels does not have to be in memory to draw a list.
 */

const R = {
  shelf: [],        // library rows, newest first
  book: null,       // the open book's text: {chapters:[...]}
  meta: null,       // the open book's library row
  chapter: 0,
  blocks: [],       // the chapter's blocks
  tokens: [],       // per block, filled in as each block is annotated
  fam: null,        // deck familiarity, refreshed when the deck changes
  cov: null,        // the last coverage run
  scope: "chapter", // what the analysis covered
  io: null,         // the observer that annotates on approach
  sheet: null,      // the token the gloss sheet is showing
};

/* Books are only ever read forwards, so the reading position is a chapter and
   a fraction of the way down it. Saved on a timer rather than on every scroll
   event: this fires continuously while a thumb moves. */
let posTimer = 0;

/* ---------------- the shelf ---------------- */

async function renderRead(){
  /* A sheet left mid-turn by a view change is not part of the page. */
  if(typeof dropLeaf === "function" && TURN.leaf && !TURN.drag) dropLeaf();
  riffleDrop();
  if(R.book) return paintReader();
  R.shelf = (await dbAll("books")).sort((a, b) => b.opened - a.opened);
  paintShelf();
}

function paintShelf(){
  $("#read-library").classList.remove("hidden");
  $("#read-book").classList.add("hidden");
  paintReadHead();

  if(!R.shelf.length){
    $("#booklist").innerHTML = `<div class="empty">
      Nothing on the shelf yet.<br>
      Add an EPUB or a text file, or paste something you want to read.
      <div class="empty-acts">
        <button class="btn" data-shelf-add>Add an EPUB or text file</button>
        <button class="ghost" data-shelf-paste>Paste text</button>
      </div>
    </div>`;
    $("#booklist").querySelector("[data-shelf-add]").onclick = pickBookFile;
    $("#booklist").querySelector("[data-shelf-paste]").onclick = togglePaste;
    $("#read-now").hidden = true;
    return;
  }

  paintNow().catch(() => {});
  const shown = R.shelf;
  /* The shelf is a shelf: each book by its cover, its title and author under
     it and how far through it you are, and at the end of the row a place for
     the next one. */
  $("#booklist").innerHTML = `<div class="shelf">${shown.map(b => {
    const pct = b.chapters ? Math.round((b.chapter + (b.ratio || 0)) / b.chapters * 100) : 0;
    return `<div class="bk">
      <button class="bk-open" data-book="${esc(b.id)}" title="${esc(b.title)} — ${pct ? "continue reading" : "start reading"}">
        ${bookCoverHTML(b)}
        <span class="bk-info">
          <span class="bk-t hz">${esc(b.title)}</span>
          <span class="bk-m">${b.author ? `<span class="hz">${esc(b.author)}</span>` : `${num(b.hanzi)} characters`}</span>
          <span class="bk-track"><i style="width:${pct}%"></i></span>
          <span class="bk-p">${pct ? `${pct}% read` : "Not started"} · ${num(b.chapters)} section${b.chapters === 1 ? "" : "s"}</span>
        </span>
      </button>
      <button class="bk-x" data-unshelf="${esc(b.id)}" aria-label="Remove ${esc(b.title)}" title="Remove from the shelf">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>`;
  }).join("")}
    <div class="bk bk-add">
      <button class="bk-open" data-shelf-add title="Add an EPUB or a text file">
        <span class="bk-cover bk-new"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><small>Add a book</small></span>
        <span class="bk-info"><span class="bk-t">Add a book</span><span class="bk-m">An EPUB or a text file</span></span>
      </button>
      <button class="bk-paste" data-shelf-paste>or paste text</button>
    </div></div>`;
  $("#booklist").querySelector(".bk-add [data-shelf-add]").onclick = pickBookFile;
  $("#booklist").querySelector(".bk-add [data-shelf-paste]").onclick = togglePaste;
}

/* The page's header: what is on the shelf — how many books, how many of
   them under way, and how much reading that is. */
function paintReadHead(){
  const books = R.shelf, going = books.filter(b => b.chapter || b.ratio).length;
  const chars = books.reduce((n, b) => n + (b.hanzi || 0), 0);
  $("#rstats").innerHTML = `
    <div class="ph-stat"><b>${num(books.length)}</b><span>Book${books.length === 1 ? "" : "s"}</span></div>
    <div class="ph-stat"><b>${num(going)}</b><span>Under way</span></div>
    <div class="ph-stat"><b>${chars >= 10000 ? `${num(Math.round(chars / 1000))}k` : num(chars)}</b><span>Characters</span></div>`;
}

/* The two ways onto the shelf, offered on the shelf itself: a file, or text
   pasted into the panel that opens over it. */
const pickBookFile = () => $("#bookfile").click();
function togglePaste(){
  const panel = $("#paste-panel");
  panel.classList.toggle("hidden");
  if(!panel.classList.contains("hidden")){ panel.scrollIntoView({block: "nearest"}); $("#paste-text").focus(); }
}

/* ---------------- a book's cover ---------------- */
/* Every book wears the same cover, in the colours of the theme in use: a
   board in the theme's surface lightly washed with its accent, bound down
   the spine in the accent, and inside a fine double frame everything on one
   centre line — a small rule at the head, the title in the theme's ink, a
   short rule and the author, and the accent seal at the foot carrying the
   title's first character. Its type is sized by the cover, not the window,
   so it keeps its proportions from a shelf thumbnail to the full reading
   window the opening book grows into. One edition, so a shelf reads as a
   set, and a change of theme redresses every book. */
function bookCoverHTML(b, cls = ""){
  const title = String(b.title || "").trim() || "无题";
  const han = [...title].filter(c => /[一-鿿]/.test(c));
  const author = String(b.author || "").replace(/^\s*[\[［(（【][^\]］)）】]*[\]］)）】]\s*/, "").trim();
  return `<span class="bk-cover gen ${cls}">
    <span class="cv-band" aria-hidden="true"></span>
    <span class="cv-frame">
      <span class="cv-orn" aria-hidden="true"></span>
      <span class="cv-mid">
        <span class="cv-t hz${han.length ? "" : " lat"}">${esc(title)}</span>
        ${author ? `<span class="cv-rule" aria-hidden="true"></span><span class="cv-a hz">${esc(author)}</span>` : ""}
      </span>
      <span class="cv-seal hz" aria-hidden="true">${esc(han[0] || title[0])}</span>
    </span>
  </span>`;
}

/* ---------------- the book's pages ---------------- */
/* The book the riffle turns is the whole book, set as the reader sets it —
   its face, size, colours and margins — at the measure of the open book, a
   page to half the text canvas. In a two-page spread that is the reader's
   own measure, and the pages of the section you are in are the reader's own
   columns. Anywhere else a stretch of a section is set out of sight and
   printed from: a few pages' worth of its paragraphs, never the whole of it,
   so a page of any part of the book costs about what a page of this one
   does. */
function bookMeasure(host, halve){
  const cs = getComputedStyle($("#rd-cols"));
  const cw = host.clientWidth, H = host.clientHeight;
  const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
  const inset = padL + padR;
  let colW = R.colW, gap = R.gap;
  if(halve){
    gap = Math.max(inset, Math.round(Math.max(48, cw * 0.05)));
    if((cw - inset - gap) % 2) gap++;
    colW = (cw - inset - gap) / 2;
  }
  return {cw, H, colW, gap, stride: colW + gap, padL, padT, padB, inset};
}
/* the page, out of sight, that a stretch of the book is set on */
function bookSetter(host, m, spread = "one"){
  const ghost = document.createElement("div");
  ghost.className = host.className;
  ghost.dataset.tint = host.dataset.tint; ghost.dataset.mark = host.dataset.mark; ghost.dataset.spread = spread;
  ghost.style.cssText = host.style.cssText;
  Object.assign(ghost.style, {position: "fixed", left: "-100000px", top: "0", width: `${m.cw}px`, height: `${m.H}px`,
    margin: "0", opacity: "0", pointerEvents: "none"});
  const cols = $("#rd-cols").cloneNode(false);
  cols.removeAttribute("id");
  Object.assign(cols.style, {height: `${m.H}px`, width: `${m.cw}px`, columnWidth: `${m.colW}px`, columnGap: `${m.gap}px`, transform: "none"});
  ghost.appendChild(cols);
  document.body.appendChild(ghost);
  const count = () => Math.max(1, Math.round((ghost.scrollWidth - m.inset + m.gap) / m.stride));
  return {ghost, cols, stride: m.stride, colW: m.colW,
    /* sets these paragraphs, and says how many pages they make */
    set(nodes){ cols.replaceChildren(...nodes); return count(); },
    /* the same, from paragraphs already marked up */
    html(s){ cols.innerHTML = s; return count(); }};
}
/* Paragraphs [b0, b1) of section k, marked as the reader marks them: the
   reader's own, copied, in the section it has open; elsewhere marked now. */
function bookBlocks(k, b0, b1){
  if(k === R.chapter){
    const live = $("#rd-cols").children, out = [];
    for(let b = b0; b < b1 && b < live.length; b++){
      const c = live[b].cloneNode(true);
      c.classList.remove("sel");
      c.querySelectorAll(".sel").forEach(el => el.classList.remove("sel"));
      out.push(c);
    }
    return out;
  }
  const opts = readOpts();
  const tpl = document.createElement("template");
  tpl.innerHTML = R.book.chapters[k].blocks.slice(b0, b1).map((b, n) => blockHTML(b, b0 + n, segment(b.text), opts)).join("");
  return [...tpl.content.children];
}
/* A paragraph cut at a character: what runs on from it — without the first
   line's indent, where the cut falls mid-paragraph, as a page that starts
   there does — or what came before it. */
function cutBlock(el, t, i, from){
  const n = el && textNodeAt(el, t);
  if(!n) return;
  const r = document.createRange();
  if(from){ r.setStart(el, 0); r.setEnd(n, Math.min(i, n.length)); }
  else{ r.setStart(n, Math.min(i, n.length)); r.setEnd(el, el.childNodes.length); }
  const had = r.toString().trim().length > 0;
  r.deleteContents();
  if(from && had) el.style.textIndent = "0";
}
/* the first character shown on the reader's page, as where it sits in the
   chapter: the block, the run of text in it, and the place in that run */
function firstOnPage(live, host){
  const hr = host.getBoundingClientRect(), range = document.createRange();
  const blocks = live.children;
  for(let b = 0; b < blocks.length; b++){
    let on = false;
    for(const q of blocks[b].getClientRects()) if(q.right > hr.left + 1 && q.left < hr.right - 1){ on = true; break; }
    if(!on) continue;
    const walk = document.createTreeWalker(blocks[b], NodeFilter.SHOW_TEXT);
    for(let n = walk.nextNode(), t = 0; n; n = walk.nextNode(), t++){
      if(n.parentElement && n.parentElement.closest("rt")) continue;
      for(let i = 0; i < n.length; i++){
        if(/\s/.test(n.nodeValue[i])) continue;
        range.setStart(n, i); range.setEnd(n, i + 1);
        const q = range.getBoundingClientRect();
        if(q.width && q.left + q.width / 2 > hr.left && q.left + q.width / 2 < hr.right) return {b, t, i};
      }
    }
  }
  return null;
}
function textNodeAt(el, t){
  if(!el) return null;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = walk.nextNode();
  for(let k = 0; n && k < t; k++) n = walk.nextNode();
  return n;
}

/* A page of the book's print: every character of one column of the laid-
   out chapter, drawn where the reader draws it — the same line, the same
   place on it — in its own face, size and colour, onto a transparent sheet
   the size of the book's page. A page of text as a few hundred live words
   on every strip of every leaf was what made the riffle heavy; as a picture
   it costs the leaves nothing to carry. The layout is only read, never
   changed, so every measurement is of a page already laid out. */
function paintPrint(src, c, side, W, H, scale = 1){
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * scale)); cv.height = Math.max(1, Math.round(H * scale));
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);
  const cols = src.cols, cr = cols.getBoundingClientRect(), cs = getComputedStyle(cols);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const x0 = cr.left + padL + c * src.stride, x1 = x0 + src.colW;
  /* a left-hand page sets its column at the canvas's own margin; a right-hand
     one a column and a gutter over, less the half of the canvas it leaves off */
  const dx = padL + (side === "r" ? src.stride - W : 0) - x0, dy = -cr.top;
  const range = document.createRange(), styles = new Map();
  const spacing = "letterSpacing" in ctx;
  /* A run of text's look — face, colour, how strongly it shows — is the same
     for every word of one kind in one kind of paragraph, so it is looked up
     once per kind (a chain of tags and classes) rather than once per word:
     reading computed style is the costly part of printing a page. Opacity
     is carried down the chain, so a faded word prints faded. */
  const styleOf = (el, blk) => {
    let key = blk.tagName;
    for(let e = el; e && e !== blk; e = e.parentElement) key += "|" + e.tagName + "." + e.className;
    let st = styles.get(key);
    if(st) return st;
    const k = getComputedStyle(el);
    let alpha = 1;
    for(let e = el; e && e !== blk.parentElement; e = e.parentElement){
      const o = parseFloat(getComputedStyle(e).opacity);
      if(!isNaN(o)) alpha *= o;
    }
    st = {font: `${k.fontStyle} ${k.fontWeight} ${k.fontSize} ${k.fontFamily}`, color: k.color, alpha,
      spacing: k.letterSpacing === "normal" ? "0px" : k.letterSpacing, inline: k.display === "inline"};
    ctx.font = st.font;
    st.ascent = ctx.measureText("国").fontBoundingBoxAscent || parseFloat(k.fontSize) * 0.88;
    styles.set(key, st);
    return st;
  };
  for(const blk of cols.children){
    let on = false;
    for(const q of blk.getClientRects()) if(q.right > x0 && q.left < x1){ on = true; break; }
    if(!on) continue;
    const walk = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    for(let n = walk.nextNode(); n; n = walk.nextNode()){
      const text = n.nodeValue;
      if(!text || !text.trim()) continue;
      const el = n.parentElement;
      /* what is not drawn has no box (display: none) or is see-through by
         its own choice; visibility is left alone, since the page being
         printed may be one kept out of sight while the book opens */
      const st = styleOf(el, blk);
      if(!st.alpha) continue;
      ctx.font = st.font; ctx.fillStyle = st.color; ctx.globalAlpha = st.alpha;
      if(spacing) ctx.letterSpacing = st.spacing;
      /* A word is kept whole on its line (nowrap), so it is one box, set as
         the canvas sets it with the same face and spacing: one measurement
         and one stroke of print, rather than one per character. */
      if(spacing && st.inline && el !== blk && el.childNodes.length === 1 && !/\s/.test(text)){
        const rects = el.getClientRects();
        if(rects.length === 1){
          const q = rects[0], mid = q.left + q.width / 2;
          if(mid >= x0 && mid <= x1) ctx.fillText(text, q.left + dx, q.top + dy + st.ascent);
          continue;
        }
      }
      for(let i = 0; i < text.length; i++){
        const code = text.charCodeAt(i), len = code >= 0xD800 && code <= 0xDBFF ? 2 : 1;
        const ch = text.substr(i, len);
        if(len === 1 && /\s/.test(ch)){ continue; }
        range.setStart(n, i); range.setEnd(n, i + len);
        i += len - 1;
        const q = range.getBoundingClientRect();
        if(!q.width || !q.height) continue;
        const mid = q.left + q.width / 2;
        if(mid < x0 || mid > x1) continue;
        ctx.fillText(ch, q.left + dx, q.top + dy + st.ascent);
      }
    }
  }
  return cv;
}

/* The paper a page is printed on: the colour of the reader's own canvas, so
   the book opens onto the very page it becomes, darkening a little into the
   gutter at the spine and touched at the fore-edge. */
function paintSheet(ctx, side, W, H, paper){
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  const spine = side === "r" ? 0 : W, dir = side === "r" ? 1 : -1;
  const g = ctx.createLinearGradient(spine, 0, spine + dir * W * 0.14, 0);
  g.addColorStop(0, "rgba(0,0,0,.13)"); g.addColorStop(.35, "rgba(0,0,0,.04)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const edge = side === "r" ? W : 0;
  const e = ctx.createLinearGradient(edge, 0, edge - dir * 10, 0);
  e.addColorStop(0, "rgba(0,0,0,.06)"); e.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = e; ctx.fillRect(0, 0, W, H);
}
/* A page as it is bound: its paper, the print on the other side of the leaf
   showing through faintly, mirrored, as it does through thin book paper, its
   own print over both, and its number at the foot, under the middle of its
   column. */
function bindPage(ink, through, side, W, H, scale, paper, folio = null){
  const cv = document.createElement("canvas");
  cv.width = ink ? ink.width : Math.max(1, Math.round(W * scale));
  cv.height = ink ? ink.height : Math.max(1, Math.round(H * scale));
  const ctx = cv.getContext("2d");
  ctx.save(); ctx.scale(cv.width / W, cv.height / H); paintSheet(ctx, side, W, H, paper); ctx.restore();
  if(through){
    ctx.save(); ctx.globalAlpha = .055;
    ctx.translate(cv.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(through, 0, 0, cv.width, cv.height);
    ctx.restore();
  }
  if(ink) ctx.drawImage(ink, 0, 0);
  if(folio){
    ctx.save(); ctx.scale(cv.width / W, cv.height / H);
    ctx.font = folio.font; ctx.fillStyle = folio.color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(folio.n), side === "r" ? folio.xr : folio.xl, folio.y);
    ctx.restore();
  }
  return cv;
}
/* the colour the reader's page is set on: its own background, or the first
   one behind it that is not see-through */
function paperOf(el){
  for(let e = el; e; e = e.parentElement){
    const c = getComputedStyle(e).backgroundColor;
    if(c && c !== "transparent" && !/,\s*0\)$|\/\s*0\)$/.test(c)) return c;
  }
  return getComputedStyle(document.documentElement).backgroundColor || "#fff";
}
/* the title page, set as the reader would set it: the book's name in its
   Chinese face, a rule, the author small under it, all on the page's paper */
function paintTitle(W, H, scale, paper, title, author){
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * scale)); cv.height = Math.max(1, Math.round(H * scale));
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);
  paintSheet(ctx, "r", W, H, paper);
  const css = getComputedStyle(document.documentElement);
  const v = k => css.getPropertyValue(k).trim();
  const ink = getComputedStyle($("#rd-prose")).color || v("--ink"), acc = v("--acc") || ink, muted = v("--muted") || ink;
  const zh = v("--font-zh") || "serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let size = Math.max(18, Math.min(56, W * 0.085));
  ctx.font = `700 ${size}px ${zh}`;
  while(size > 14 && ctx.measureText(title).width > W * 0.72){ size -= 2; ctx.font = `700 ${size}px ${zh}`; }
  const cy = H * 0.42;
  ctx.fillStyle = acc; ctx.globalAlpha = .6;
  ctx.fillRect(W / 2 - W * 0.11, cy - size * 1.6, W * 0.22, 1);
  ctx.fillRect(W / 2 - W * 0.11, cy - size * 1.6 + 4, W * 0.22, 1);
  ctx.globalAlpha = 1; ctx.fillStyle = ink;
  ctx.fillText(title, W / 2, cy);
  if(author){
    ctx.fillStyle = acc; ctx.globalAlpha = .7;
    ctx.fillRect(W / 2 - W * 0.09, cy + size * 1.05, W * 0.18, 1);
    ctx.globalAlpha = 1; ctx.fillStyle = muted;
    ctx.font = `${Math.max(10, Math.round(size * 0.34))}px ${zh}`;
    ctx.fillText(author, W / 2, cy + size * 1.7);
  }
  return cv;
}
/* the back of the title page: a line or two of small print at its foot */
function paintColophon(W, H, scale, paper){
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * scale)); cv.height = Math.max(1, Math.round(H * scale));
  const ctx = cv.getContext("2d");
  ctx.scale(scale, scale);
  paintSheet(ctx, "l", W, H, paper);
  ctx.fillStyle = "rgba(0,0,0,.12)";
  for(let k = 0; k < 3; k++) ctx.fillRect(W * 0.14, H * 0.82 + k * 9, W * (k === 2 ? 0.38 : 0.6), 2);
  return cv;
}

/* ---------------- the flick ---------------- */
/* The leaves of the opening book turn the way the reader's own pages do.
 * Each is the page turn's fold (see "turning the page" below) — a corner
 * lifted and carried across, the page cut along the fold by rotated boxes
 * and its back laid over the far side — played quickly, one after another,
 * over a flat copy of the open book, a few in the air at once.
 *
 * Every page is a picture printed beforehand, and it is moved rather than
 * drawn again: off the pile on the right into the leaf that lifts it, and
 * out of the leaf onto the pile on the left as it lands. So there is no
 * copy of a page under the fold as the page turn has: the pile under a
 * lifting leaf already shows the next page. A frame is a few transforms for
 * each leaf in the air and nothing else — the compositor's work alone, as a
 * page turn is. The riffle before this drew every leaf on a canvas, curved,
 * lit and shadowed in 3D, every frame; however it was drawn, that is work a
 * page turn never asks for, and it could not keep pace everywhere. */
function makeFlicker(W, H, single){
  /* the open book: one page to the canvas on a phone, its spine at the
     left edge; two, the spine down the middle, where there is room */
  const hostW = single ? W : 2 * W, pageW = W;
  const D = Math.hypot(hostW, H), SZ = Math.ceil(2.2 * D), Lh = D * 1.2;
  /* A leaf goes over forward, off the right-hand page onto the left — on a
     single page, over its left edge — or back the other way, as the
     reader's own turn does: off the left-hand page onto the right, or
     peeled from a single page's left edge over its right one. */
  const geo = dir => {
    const pageX = dir > 0 && !single ? W : 0, spineX = dir > 0 ? pageX : pageX + pageW;
    return {dir, pageX, spineX, versoLeft: 2 * spineX - (pageX + pageW),
      P0: {x: dir > 0 ? pageX + pageW : pageX, y: H}, A: {x: spineX, y: H}, A2: {x: spineX, y: 0}};
  };
  const FWD = geo(1), BACK = geo(-1);
  const px = v => `${v}px`;
  const el = (cls, style) => { const d = document.createElement("div"); d.className = cls; if(style) Object.assign(d.style, style); return d; };
  const root = el("fk", {width: px(hostW), height: px(H)});
  const left = el("fk-page fk-sheet", {left: px(FWD.versoLeft), width: px(pageW), height: px(H)});
  const right = el("fk-page fk-sheet", {left: px(FWD.pageX), width: px(pageW), height: px(H)});
  /* The parts of the leaves still lying where they lifted from, the latest
     lifted lowest; then the backs, the latest to land on top. */
  const fronts = el("fk-layer"), backs = el("fk-layer");
  root.append(left, right, fronts, backs);
  const lay = (box, page) => { if(!page) box.replaceChildren(); else if(page.parentNode !== box) box.replaceChildren(page); };
  const strip = cls => { const s = el(`rd-shade ${cls}`); s.style.width = px(2 * Lh); return s; };
  let hU = 0, hF = 0;
  /* the corner kept where paper could reach: no further from either corner
     at the spine than the page is long */
  const reach = (g, c) => {
    for(const a of [g.A, g.A2]){
      const max = Math.hypot(g.P0.x - a.x, g.P0.y - a.y), dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy);
      if(len > max){ const k = max / len; c = {x: a.x + dx * k, y: a.y + dy * k}; }
    }
    return c;
  };
  /* the pile a leaf going `dir` comes off, and the one it lands on — a
     single page's leaves land off the page, on nothing */
  const from = dir => dir > 0 || single ? right : left;
  const to = dir => dir > 0 ? left : single ? null : right;
  return {
    root, left, right, lay, from, to,
    /* A leaf lifts: its page taken off the pile into the part of the leaf
       still lying down, its back into the part folded over. */
    lift(front, back, dir = 1){
      const g = dir > 0 ? FWD : BACK;
      const page = el("fk-page", {left: px(g.pageX), width: px(pageW), height: px(H)});
      const shU = strip("under");
      const fCut = el("rd-cut", {width: px(SZ), height: px(SZ)}), fIn = el("rd-in");
      const hold = el("fk-page fk-sheet", {left: px(g.pageX), width: px(pageW), height: px(H)});
      if(front) hold.appendChild(front);
      fIn.appendChild(hold); fCut.appendChild(fIn); page.append(shU, fCut);
      const flap = el("fk-layer");
      const bCut = el("rd-cut", {width: px(SZ), height: px(SZ)}), bIn = el("rd-in");
      const verso = el("rd-verso", {left: px(g.versoLeft), width: px(pageW), height: px(H)});
      const shF = strip("flap");
      if(back) verso.appendChild(back);
      verso.append(el("rd-paper"), shF);
      bIn.appendChild(verso); bCut.appendChild(bIn); flap.appendChild(bCut);
      fronts.prepend(page); backs.append(flap);
      if(!hU){ hU = shU.offsetHeight || 240; hF = shF.offsetHeight || 200; }
      return {g, page, flap, fCut, fIn, bCut, bIn, shU, shF, back};
    },
    /* the leaf with its corner a fraction p of the way over: transforms only */
    turn(leaf, p){
      const {g} = leaf, {P0, pageX, spineX, versoLeft} = g;
      const c = reach(g, {x: P0.x - g.dir * 2 * pageW * p, y: H - H * 0.18 * Math.sin(p * Math.PI)});
      let dx = c.x - P0.x, dy = c.y - P0.y, len = Math.hypot(dx, dy);
      if(len < 0.5){ dx = -0.5 * g.dir; dy = 0; len = 0.5; }
      const n = {x: dx / len, y: dy / len}, M = {x: (P0.x + c.x) / 2, y: (P0.y + c.y) / 2};
      const cut = cutFor(M, n, 1, SZ);
      leaf.fCut.style.transform = AFF.css(AFF.mul(AFF.T(-pageX, 0), cut));
      leaf.fIn.style.transform = AFF.css(AFF.inv(cut));
      const a = 1 - 2 * n.x * n.x, b = -2 * n.x * n.y, d = 1 - 2 * n.y * n.y;
      const Rf = [a, b, b, d, M.x - (a * M.x + b * M.y), M.y - (b * M.x + d * M.y)];
      const Ms = [-1, 0, 0, 1, 2 * spineX, 0];
      leaf.bCut.style.transform = AFF.css(cut);
      leaf.bIn.style.transform = AFF.css(AFF.mul(AFF.mul(AFF.inv(cut), Rf), Ms));
      /* the fold's own light shadow, strongest as the leaf stands highest */
      const up = 0.3 + 0.7 * Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
      leaf.shU.style.transform = `translate(${(M.x - pageX - Lh).toFixed(2)}px, ${(M.y - hU / 2).toFixed(2)}px) rotate(${(Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(3)}deg)`;
      leaf.shU.style.opacity = (0.8 * up).toFixed(3);
      leaf.shF.style.transform = `translate(${((2 * spineX - M.x) - versoLeft - Lh).toFixed(2)}px, ${(M.y - hF / 2).toFixed(2)}px) rotate(${(Math.atan2(n.x, n.y) * 180 / Math.PI).toFixed(3)}deg)`;
      leaf.shF.style.opacity = (0.8 * up).toFixed(3);
    },
    /* landed: its back laid on the pile it came down on */
    land(leaf){
      const pile = to(leaf.g.dir);
      if(pile) lay(pile, leaf.back);
      leaf.page.remove(); leaf.flap.remove();
    },
  };
}

/* ---------------- opening a book, as a book opens ---------------- */
/* A book opened from the shelf is handled as a book, and it opens onto the
   reader's own page. The cover lifts off the shelf as the page behind it
   dims, and the reader is laid out, unseen, underneath. Then the book flies
   to the right half of the text canvas — the very rectangle the text will
   be read in — turning a little as it comes; its cover swings open on the
   spine over the left half, onto an endpaper and the title page; and the
   leaves turn over, as page turns do, to where you left off — two for a
   book barely begun, up to ten for one nearly finished, each a little
   quicker the more there are. They are the book's own pages, in the reader's face, size and
   colours: from its first page on through its sections, numbered, to the
   passage you stopped at. The last open spread,
   which fills the canvas exactly, dissolves into the page itself. The
   stages overlap, so the motion is one gesture rather than a sequence; two
   seconds or so, a little more deep into a book. Only transforms and
   opacity move. A click skips to the book; with reduced motion, or without
   a cover to lift, the book simply opens. */
const LEAVES_MIN = 2, LEAVES_MAX = 10;
async function openBookFrom(id, fromCover){
  /* one book opens at a time: a second tap while the first is opening is
     the same wish, not another book */
  if(openBookFrom.busy) return;
  const r = fromCover && fromCover.getBoundingClientRect();
  if(!r || !r.width || REDUCED()) return openBook(id);
  openBookFrom.busy = true;
  const meta = (R.shelf || []).find(x => x.id === id) || {};
  /* An animation waits on frames, and a page that is not being drawn — a tab
     in the background — gets none; a cap on every wait means the book is
     never left hanging over the page. */
  const within = (p, ms) => Promise.race([p, new Promise(ok => setTimeout(ok, ms))]);
  const played = [];
  let skipped = false;
  const run = (el, frames, opts) => {
    const an = el.animate(frames, {fill: "both", ...opts});
    played.push(an);
    if(skipped) an.finish();
    return an;
  };
  const skip = () => { skipped = true; played.forEach(an => { try{ an.finish(); }catch(_){} }); };

  /* the veil over the content column (the sidebar does not change), or over
     the whole window where reading takes the whole window */
  const veil = document.createElement("div");
  veil.className = "bkx-veil";
  if(window.innerWidth >= 900 && !S.readFocus) veil.style.left = `${Math.max(0, $("#main").getBoundingClientRect().left - 12)}px`;
  const lift = document.createElement("div");
  lift.className = "bkx-lift";
  lift.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  lift.innerHTML = fromCover.outerHTML;
  lift.firstElementChild.style.visibility = "";
  document.body.classList.add("bk-opening");
  document.body.append(veil, lift);
  fromCover.style.visibility = "hidden";
  veil.addEventListener("click", skip);
  lift.addEventListener("click", skip);
  run(veil, [{opacity: 0}, {opacity: 1}], {duration: 240, easing: "ease-out"});
  /* The cover comes up off the shelf, and then keeps drifting gently toward
     you for as long as the book takes to make ready — its section laid out,
     every page it will turn printed and handed to the GPU. The lift is a
     transform on a plain box, the compositor's alone, so it stays smooth
     however hard the page is working underneath; and when the book sets off
     it sets off from wherever the drift has got to. */
  const lifted = run(lift, [
    {transform: "none", easing: "cubic-bezier(.2,.8,.2,1)"},
    {transform: "translateY(-6px) scale(1.04)", offset: .16, easing: "cubic-bezier(.25,.1,.25,1)"},
    {transform: "translateY(-13px) scale(1.085)"}], {duration: 1500});

  let stage = null, shown = null, ghost = null, overlay = null;
  const cleanup = [];
  try{
    /* Everything the book needs is made ready first, while the cover
       hovers: its text loaded, its section laid out (unseen, under the
       veil), every page the riffle will turn printed and handed to the GPU.
       Then the book flies, opens and riffles with the page doing nothing
       but draw it — nothing laid out, printed or saved between its frames.
       Doing that work during the flight is what made the riffle stutter. */
    if(!(await loadBook(id))) return;
    paintReader(R.meta.ratio || 0);
    const canvas = $("#rd-prose");
    const t = canvas && R.book && R.meta && R.meta.id === id ? canvas.getBoundingClientRect() : null;
    if(!t || !t.width || !t.height){
      await within(Promise.all([run(lift, [{opacity: 1}, {opacity: 0}], {duration: 200}).finished,
        run(veil, [{opacity: 1}, {opacity: 0}], {duration: 200}).finished]), 400);
      return;
    }

    /* The book. Where the canvas is wide enough for two pages, a page is
       half of it and the spine lands on its middle. Where it is not — a
       phone — the reader shows one page, and so does the book: a page is the
       whole canvas and the spine its left edge, so the page you land on is
       the reader's own, line for line, and the leaves go over past the edge
       of the screen, as an e-reader's do. Two half pages of a phone hold
       lines of five or six characters, and less of the page than the
       reader shows. */
    const single = R.per !== 2 && canvas.clientWidth < 720;
    const cw = t.width, W = single ? cw : cw / 2, H = t.height;
    const paper = paperOf(canvas);
    const dpr = window.devicePixelRatio || 1;
    const LO = Math.min(dpr, 1.25), HI = Math.min(dpr, 2);
    const title = String(meta.title || R.meta.title || "").trim();
    const author = String(meta.author || R.meta.author || "").replace(/^\s*[\[［(（【][^\]］)）】]*[\]］)）】]\s*/, "").trim();

    /* the leaves start turning once the cover has opened flat */
    const MOVE = 380, OPEN_AT = 340, OPEN = 640, LEAF_AT = OPEN_AT + OPEN + 20, FADE = 400;
    /* the title page, which shows as the cover opens, first of all */
    const titlePage = paintTitle(W, H, Math.min(dpr, 1.5), paper, title, author);
    const colophon = paintColophon(W, H, Math.min(dpr, 1.25), paper);

    /* The book as pages, without setting it: every section's length in
       characters over what a page holds gives each section its pages and
       every page its number. What a page holds is the reader's own count
       where the section open has pages enough to tell, and otherwise the
       page's lines times what a line holds. */
    const m = bookMeasure(canvas, R.per !== 2 && !single);
    /* the reader's own columns are the book's pages: a spread's, or a single page's */
    const exact = R.per === 2 || single;
    const chapters = R.book.chapters, cur = R.chapter, live = $("#rd-cols");
    const lens = chapters.map(ch => ch.blocks.reduce((n, x) => n + x.text.length, 0));
    const ls = getComputedStyle(live);
    const fs = parseFloat(ls.fontSize) || 21, lh = parseFloat(ls.lineHeight) || fs * 2.05;
    const lines = Math.max(1, Math.floor((m.H - m.padT - m.padB) / lh));
    const counted = exact ? (R.cols >= 3 ? lens[cur] / (R.cols - 0.5) : 0)
      : (R.pages >= 3 ? lens[cur] / (R.pages - 0.5) * m.colW / Math.max(1, R.colW) : 0);
    const cpp = counted || Math.max(40, Math.floor(m.colW / (fs * 1.02)) * lines * 0.85);
    const pc = lens.map((n, k) => k === cur && exact ? R.cols : Math.max(1, Math.ceil(n / cpp)));
    const first = [];
    pc.reduce((n, p, k) => { first[k] = n + 1; return n + p; }, 0);
    const perPage = k => lens[k] / pc[k] || cpp;
    const place = f => {
      let k = 0;
      while(k + 1 < chapters.length && first[k + 1] <= f) k++;
      return {k, j: Math.max(0, Math.min(pc[k] - 1, f - first[k]))};
    };
    /* The left-hand page of the spread you land on: in a spread the reader's
       own; on a single page the one before the reader's; on a wide canvas
       showing one page, the book's page that starts where the reader's does. */
    const at = exact ? null : firstOnPage(live, canvas);
    let F = first[cur] + (R.per === 2 ? 2 * R.page : R.page - 1);
    if(!exact){
      let before = at ? at.i : 0;
      for(let x = 0; at && x < at.b; x++) before += chapters[cur].blocks[x].text.length;
      F = first[cur] + Math.min(pc[cur] - 1, Math.floor(before / perPage(cur)));
    }

    /* how far into the book: the whole sections behind you and the part of
       this one, over all of them — and never more leaves than there are
       pages before yours to put on them */
    const through = chapters.length ? Math.min(1, (R.chapter + (R.meta.ratio || 0)) / chapters.length) : 0;
    const LEAVES = Math.max(LEAVES_MIN, Math.min(Math.round(LEAVES_MIN + through * (LEAVES_MAX - LEAVES_MIN)),
      2 + Math.floor((F - 2) / 2)));
    /* The leaves between the title page and the last one run through the
       book from its first page towards yours, closer together as they near
       it, each on a section's opening where one falls near: a heading going
       by is how a riffled book shows how far it has come. Their pages are
       numbered, and the numbers climb as the leaves go over. */
    const n = LEAVES - 2, E = F - 3, fronts = [];
    const packed = () => { for(let i = 0; i < n; i++) fronts[i] = F - 1 - 2 * (n - i); };
    if(n > 0){
      if(E - 1 < 2 * (n - 1)) packed();
      else{
        const room = (E - 1) / Math.max(1, n - 1);
        for(let i = 0; i < n; i++){
          const f = 1 + Math.round((E - 1) * Math.pow(n === 1 ? 0 : i / (n - 1), 0.8));
          let best = null;
          for(const s0 of first) if(s0 <= E && Math.abs(s0 - f) <= room / 2 && (best === null || Math.abs(s0 - f) < Math.abs(best - f))) best = s0;
          fronts.push(best ?? f);
        }
        for(let i = 1; i < n; i++) fronts[i] = Math.max(fronts[i], fronts[i - 1] + 2);
        for(let i = n - 1; i >= 0; i--) fronts[i] = Math.min(fronts[i], i === n - 1 ? E : fronts[i + 1] - 2);
        if(fronts[0] < 1) packed();
      }
    }

    /* The pages are printed from the reader's own layout where it has them
       and from stretches set out of sight elsewhere, each printed once and
       bound on paper the colour of the reader's canvas. */
    const setter = bookSetter(canvas, m);
    ghost = setter.ghost;
    const liveSrc = {cols: live, stride: R.colW + R.gap, colW: R.colW};
    const ink = (src, c, side, scale) => paintPrint(src, c, side, W, H, scale);
    const css = getComputedStyle(document.documentElement);
    const folioFont = `${Math.max(9, Math.min(11, Math.round(m.padB * 0.55)))}px ${ls.fontFamily}`;
    const folioInk = css.getPropertyValue("--muted").trim() || ls.color;
    const folio = f => f >= 1 ? {n: f, font: folioFont, color: folioInk, y: H - m.padB / 2,
      xl: m.padL + m.colW / 2, xr: m.padL + m.stride - W + m.colW / 2} : null;
    const bind = (ink, through, side, scale, f = 0) => bindPage(ink, through, side, W, H, scale, paper, folio(f));
    /* a stretch of section k from about its page j: from the paragraph
       before, so that a page starts where the text runs on, as pages do,
       to three pages or so on; `from` is the page of it to print first */
    const setAt = (k, j) => {
      const blocks = chapters[k].blocks;
      let b0 = 0;
      if(j > 0){
        let acc = 0, x = 0;
        while(x < blocks.length - 1 && acc + blocks[x].text.length <= j * perPage(k)) acc += blocks[x++].text.length;
        b0 = Math.max(0, x - 1);
      }
      let b1 = b0;
      for(let acc = 0; b1 < blocks.length && acc < 3.2 * perPage(k); b1++) acc += blocks[b1].text.length;
      const total = setter.set(bookBlocks(k, b0, b1));
      return {total, from: j > 0 && total >= 3 ? 1 : 0};
    };
    /* the end of section k, for its last page */
    const setEnd = k => {
      const blocks = chapters[k].blocks;
      let b0 = blocks.length;
      for(let acc = 0; b0 > 0 && acc < 2.2 * perPage(k);) acc += blocks[--b0].text.length;
      return setter.set(bookBlocks(k, b0, blocks.length));
    };

    /* A few pages over, never a flurry: each leaf has most of its turn to
       itself before the next lifts, so at most two or three are ever in the
       air and their pages do not pile up over one another. */
    const FLICK = LEAVES <= 4 ? 420 : 330;
    const STEP = LEAVES <= 4 ? 200 : Math.max(130, Math.round(200 * Math.sqrt(4 / LEAVES)));
    /* The leaves come off the thumb unevenly, as they do: a little slower as
       the riffle starts and as it comes to your page, quickest between. Each
       takes the same time over, so none catches the one ahead; no two are
       quite alike in how supple they are, as paper is not. */
    const RUN = (LEAVES - 1) * STEP;
    const leaves = Array.from({length: LEAVES}, (_, i) => {
      const x = LEAVES > 1 ? i / (LEAVES - 1) : 0;
      return {start: LEAF_AT + Math.round(RUN * (x + 0.3 * Math.sin(2 * Math.PI * x) / (2 * Math.PI))), dur: FLICK,
        bend: 0.95 * (0.94 + ((i * 37) % 10) / 80), seed: i * 2.3, front: null, back: null};
    });
    const block = {img: null};
    let SPAN = leaves[LEAVES - 1].start + FLICK + 1;
    const last = leaves[LEAVES - 1];
    leaves[0].front = titlePage;
    leaves[0].back = colophon;

    /* The printing is a queue of small steps in the order the pages will be
       wanted: first the spread you land on and the leaf before it, since a
       skip or a tab in the background goes straight there, then the leaves
       from the first. While the book is in the air its motion is the
       compositor's, and the steps run back to back; once the leaves turn,
       a few milliseconds' worth after each frame, and if a leaf is ever
       about to show before it is printed, it is printed there and then. */
    const work = [];
    work.push({key: 0, it: (function*(){
      let lb = null, rb = null, pre = null, back = 0;
      if(exact){
        /* the reader's own pages: the left-hand one, the right, and the one
           before; before a section's first page, the end of the last one */
        const c = R.per === 2 ? 2 * R.page : R.page - 1;
        if(c >= 0){ lb = ink(liveSrc, c, "l", HI); yield; }
        rb = c + 1 < R.cols ? ink(liveSrc, c + 1, "r", HI) : null; yield;
        if(c >= 1) pre = ink(liveSrc, c - 1, "r", LO);
        else back = c === 0 ? 1 : 2;
      }else{
        /* This section from the reader's first character on, set at the
           book's measure, so the book opens on the very words the page
           does; and the page before, from what comes before them. */
        const blocks = chapters[cur].blocks, bf = at ? at.b : 0;
        let b1 = bf + 1;
        for(let a2 = 0; b1 < blocks.length && a2 < 3.2 * perPage(cur); b1++) a2 += blocks[b1].text.length;
        const on = bookBlocks(cur, bf, b1);
        if(at) cutBlock(on[0], at.t, at.i, true);
        const total = setter.set(on); yield;
        lb = ink(setter, 0, "l", HI); yield;
        rb = total > 1 ? ink(setter, 1, "r", HI) : null; yield;
        let b0 = bf, acc = at ? at.i : 0;
        while(b0 > 0 && acc < 1.4 * perPage(cur)) acc += blocks[--b0].text.length;
        if(b0 < bf || (at && (at.t > 0 || at.i > 0))){
          const before = bookBlocks(cur, b0, bf + 1);
          if(at) cutBlock(before[before.length - 1], at.t, at.i, false);
          const tb = setter.set(before); yield;
          pre = ink(setter, tb - 1, "r", LO);
        }else back = 1;
      }
      /* at a section's first page the pages before are the last of the one
         before it; at the book's first, blanks */
      if(back && cur > 0){
        yield;
        const total = setEnd(cur - 1); yield;
        if(back === 1) pre = ink(setter, total - 1, "r", LO);
        else{ lb = ink(setter, total - 1, "l", HI); yield; if(total > 1) pre = ink(setter, total - 2, "r", LO); }
      }
      last.front = bind(pre, lb, "r", LO, pre ? F - 1 : 0);
      last.back = bind(lb, null, "l", HI, lb ? F : 0);
      block.img = bind(rb, null, "r", HI, rb ? F + 1 : 0);
    })()});
    fronts.forEach((f, i) => {
      const lf = leaves[i + 1];
      work.push({key: i + 1, it: (function*(){
        const {k, j} = place(f);
        let a = null, b = null;
        if(k === cur && exact){
          a = ink(liveSrc, j, "r", LO); yield;
          b = j + 1 < R.cols ? ink(liveSrc, j + 1, "l", LO) : null;
        }else{
          const {total, from} = setAt(k, j); yield;
          a = ink(setter, from, "r", LO); yield;
          /* a section that ends on this leaf leaves its back blank */
          b = from + 1 < total ? ink(setter, from + 1, "l", LO) : null;
        }
        lf.front = bind(a, b, "r", LO, f);
        lf.back = bind(b, a, "l", LO, b ? f + 1 : 0);
      })()});
    });
    const step = () => { const w = work[0]; if(w && w.it.next().done) work.shift(); };
    const pump = ms => { const end = performance.now() + ms; while(work.length && performance.now() < end) step(); };
    /* everything the leaves up to leaf `key` show, now */
    const ready = key => { while(work.length && work[0].key <= key) step(); };

    stage = document.createElement("div");
    stage.className = "bkx";
    /* Built now, before the pages are printed, and drawn (invisibly — its
       layer is kept) while they are: so the book's first frame in the air
       costs no painting. */
    stage.style.cssText = `width:${W}px;height:${H}px;--page-bg:${paper};opacity:0`;
    stage.innerHTML = `<div class="bkx-book">
        <div class="bkx-block" style="transform:translateZ(-1px)"></div>
        <div class="bkx-edge"></div>
        <div class="bkx-cover" style="transform:translateZ(.6px)">${fromCover.outerHTML}<span class="bkx-face back bkx-endpaper"></span></div>
      </div>`;
    const book = stage.firstElementChild;
    const titleCopy = document.createElement("canvas");
    titleCopy.width = titlePage.width; titleCopy.height = titlePage.height;
    titleCopy.getContext("2d").drawImage(titlePage, 0, 0);
    book.querySelector(".bkx-block").appendChild(titleCopy);
    stage.querySelector(".bkx-cover > .bk-cover").style.visibility = "";
    stage.addEventListener("click", skip);
    document.body.append(stage);
    /* The open book, flat, where the flying one comes to rest — made now and
       drawn invisibly, so that when the cover lands it takes over in a frame
       with nothing to paint, and the leaves turn on it. */
    const flick = makeFlicker(W, H, single);
    overlay = document.createElement("div");
    overlay.className = "fk-over";
    overlay.style.cssText = `left:${t.left}px;top:${t.top}px;width:${cw}px;height:${H}px`;
    overlay.appendChild(flick.root);
    overlay.addEventListener("click", skip);
    document.body.append(overlay);

    /* The printing, all of it, now: a slice at a time with the page given
       back between slices (so a tap can still skip), while the cover
       drifts. What is left when a skip comes is only the spread you land
       on. */
    const nextTask = () => new Promise(ok => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); ok(); }; c.port2.postMessage(0); });
    while(work.length && !skipped){ pump(24); await nextTask(); }
    if(skipped) ready(0);

    /* The book sets off from where the drifting cover is. */
    lifted.pause();
    const lr = lift.getBoundingClientRect();
    flick.lay(flick.right, leaves[0].front);

    /* every part of the book keeps time from the moment it set off */
    const t0 = document.timeline.currentTime ?? performance.now();
    const now = () => (document.timeline.currentTime ?? performance.now()) - t0;
    const at0 = an => { if(!skipped) try{ an.startTime = t0; }catch(_){} return an; };
    run(lift, [{opacity: 1}, {opacity: 0}], {duration: 140, easing: "linear"});
    at0(run(stage, [{opacity: 0}, {opacity: 1}], {duration: 100, easing: "linear"}));
    at0(run(stage, [{transform: `translate(${lr.left}px,${lr.top}px) scale(${lr.width / W},${lr.height / H})`},
                    {transform: `translate(${t.left + (single ? 0 : W)}px,${t.top}px) scale(1,1)`}],
        {duration: MOVE, easing: "cubic-bezier(.3,.75,.2,1)"}));
    at0(run(book, [{transform: "rotateX(0deg) rotateY(0deg)", easing: "cubic-bezier(.3,.6,.4,1)"},
                   {transform: "rotateX(6deg) rotateY(-16deg)", offset: .36, easing: "cubic-bezier(.45,0,.3,1)"},
                   {transform: "rotateX(0deg) rotateY(0deg)"}],
        {duration: OPEN_AT + OPEN}));
    /* the cover is board, and turns stiff */
    at0(run(stage.querySelector(".bkx-cover"), [{transform: "rotateY(0deg) translateZ(.6px)"}, {transform: "rotateY(-180deg) translateZ(.6px)"}],
        {duration: OPEN, delay: OPEN_AT, easing: "cubic-bezier(.55,.06,.25,1)"}));
    /* the flat book takes over from the flying one as it comes to rest */
    at0(run(overlay, [{opacity: 0}, {opacity: 1}], {duration: 60, delay: OPEN_AT + OPEN - 40, easing: "linear"}));


    let waiting = false;
    const chan = new MessageChannel();
    chan.port1.onmessage = () => {
      if(!work.length) return;
      const air = now() < LEAF_AT - 60;
      if(!air && !waiting) return;
      pump(12);
      if(work.length && air) chan.port2.postMessage(0);
    };
    cleanup.push(() => { chan.port1.onmessage = null; chan.port1.close(); });
    chan.port2.postMessage(0);

    /* The riffle runs on the frame clock from here to its end, drawing the
       leaves where they are — nothing moves on it until they turn, so it is
       drawn once until then. A skip, or a page that is not being drawn, goes
       straight to the last spread. */
    /* A leaf does not lift before the page it uncovers is printed. If the
       printing has fallen behind — a slow phone — that leaf waits, and the
       ones after it with it, while any already in the air go on over: the
       riffle takes a breath rather than a frame stopping to print a page. */
    let raf = 0, finish;
    const done = new Promise(ok => { finish = ok; });
    const printed = key => !work.length || work[0].key > key;
    /* each leaf: waiting on the pile, in the air, or landed */
    const air = leaves.map(() => null), landed = leaves.map(() => false);
    const ease = x => 0.2 * x + 0.8 * (0.5 - 0.5 * Math.cos(Math.PI * x));
    /* The flying book, put away once the flat one covers it wholly — its
       right-hand page from the start, its left once the first leaf has
       landed on the endpaper. Left under it, its title page showed through
       as a faint watermark while the flat book dissolved into the reader. */
    const retire = () => { if(stage) stage.style.visibility = "hidden"; };
    /* the book as it is when every leaf is over: the spread you open onto */
    const settle = () => {
      air.forEach((a, i) => { if(a && !landed[i]){ a.page.remove(); a.flap.remove(); } });
      flick.lay(flick.left, last.back);
      flick.lay(flick.right, block.img);
      landed.fill(true);
      retire();
    };
    const tick = () => {
      const el = now();
      if(skipped){ ready(0); settle(); finish(); return; }
      waiting = false;
      for(let k = 0; k < leaves.length; k++){
        const lf = leaves[k];
        if(lf.start > el + 40) break;
        if(lf.start <= el) continue;
        if(!printed(k + 1)){
          const d = el + 40 - lf.start + 17;
          for(let j = k; j < leaves.length; j++) leaves[j].start += d;
          SPAN += d;
          waiting = true;
        }
        break;
      }
      for(let i = 0; i < leaves.length; i++){
        const lf = leaves[i];
        if(landed[i]) continue;
        if(!air[i]){
          if(el < lf.start) break;
          /* it lifts: its page off the pile, and the next one showing there */
          air[i] = flick.lift(lf.front, lf.back);
          flick.lay(flick.right, i + 1 < leaves.length ? leaves[i + 1].front : block.img);
        }
        const x = Math.min(1, (el - lf.start) / lf.dur);
        if(x >= 1){ flick.land(air[i]); landed[i] = true; if(i === 0) retire(); }
        else flick.turn(air[i], ease(x));
      }
      if(landed[leaves.length - 1]){ finish(); return; }
      if(work.length) chan.port2.postMessage(0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanup.push(() => cancelAnimationFrame(raf));

    /* the end of the riffle, or — for a page that is not being drawn — its
       time; a riffle that waited for its pages ends later */
    while(!(await within(done.then(() => true), Math.max(60, SPAN - now() + 700)))){
      if(document.hidden || now() > SPAN + 700) break;
    }
    cancelAnimationFrame(raf);
    ready(0);
    work.length = 0;
    settle();
    ghost.remove(); ghost = null;

    /* The open spread fills the canvas; it dissolves into the page itself,
       which has been drawn and waiting under it the whole time, so the page
       costs nothing to show. */
    shown = $("#read-book").animate([{opacity: 0}, {opacity: 1}], {duration: FADE, easing: "ease-out", fill: "both"});
    played.push(shown);
    if(skipped) shown.finish();
    run(overlay, [{opacity: 1}, {opacity: 0}], {duration: FADE, easing: "ease-in"});
    await within(run(veil, [{opacity: 1}, {opacity: 0}], {duration: FADE, easing: "ease-in"}).finished, FADE + 300);
  }finally{
    if(stage) stage.remove();
    if(overlay) overlay.remove();
    if(ghost) ghost.remove();
    cleanup.forEach(f => { try{ f(); }catch(_){} });
    lift.remove(); veil.remove();
    /* however the waits ended, the page is left fully shown */
    document.body.classList.remove("bk-opening");
    if(shown) shown.cancel();
    fromCover.style.visibility = "";
    openBookFrom.busy = false;
  }
}

/* ---------------- now reading ---------------- */
/* The book last opened, as a reader would want it summed up: where you are
   in it, how much is left and roughly how long that is, what is coming
   next, and what the whole book is made of by level — against the level
   you are working at, so the number that matters is the share of it you
   have been taught. The level mix and the size of each section take a
   pass over the whole text, so they are worked out once per book and kept
   on its shelf row; the rest is arithmetic on what the row already holds.
   The text itself is fetched only to read the section titles. */
const READ_PACE = 150;   // characters a minute — a learner reading, not skimming

async function paintNow(){
  const panel = $("#read-now"), body = $("#read-now-body");
  if(!panel || !body) return;
  const b = R.shelf[0];
  if(!b){ panel.hidden = true; return; }
  panel.hidden = false;
  const pct = b.chapters ? clamp((b.chapter + (b.ratio || 0)) / b.chapters, 0, 1) : 0;

  /* What can be said at once, so the panel is never blank. */
  body.innerHTML = nowHTML(b, null, pct);

  /* The text is a few megabytes; fetched once per book, not per visit. */
  const data = await bookData(b.id);
  if(!data || R.shelf[0] !== b) return;
  if(!b.stats || b.stats.v !== 1){
    if(paintNow.busy === b.id) return;
    paintNow.busy = b.id;
    await lexicon();
    /* A novel is a few hundred thousand tokens. They are read a slice at a
       time, with the page given back between slices, so the app never
       stops answering while a long book is read through. */
    const sizes = [], tokens = [];
    let slice = performance.now();
    for(const ch of data.chapters){
      sizes.push(hanziCount(ch.blocks.map(x => x.text).join("")));
      for(const blk of ch.blocks){
        for(const t of segment(blk.text)) tokens.push(t);
        if(performance.now() - slice > 12){ await new Promise(r => setTimeout(r, 0)); slice = performance.now(); }
      }
    }
    paintNow.busy = null;
    if(R.shelf[0] !== b) return;
    const cov = coverage(tokens, null);
    b.stats = {v: 1, sizes, running: cov.running, types: cov.types, byLevel: cov.byLevel, typesByLevel: cov.typesByLevel};
    await dbPut("books", b);
  }
  if(R.shelf[0] !== b || $("#read-book").offsetParent) return;
  body.innerHTML = nowHTML(b, data, pct);
}

/* How long ago, in words a reader would use. */
function agoText(ts){
  if(!ts) return "";
  const d = Date.now() - ts, m = Math.round(d / 60000), h = Math.round(d / 3600000), days = Math.round(d / 86400000);
  if(m < 2) return "just now";
  if(m < 60) return `${m} min ago`;
  if(h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  if(days === 1) return "yesterday";
  if(days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {day: "numeric", month: "short"});
}
function spanText(mins){
  if(mins < 1) return "under a minute";
  if(mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function nowHTML(b, data, pct){
  const st = b.stats && b.stats.v === 1 ? b.stats : null;
  const chapters = data ? data.chapters : null;
  const here = chapters ? chapters[Math.min(b.chapter, chapters.length - 1)] : null;
  const next = chapters ? chapters[b.chapter + 1] : null;

  /* Characters read: whole sections behind you, plus the part of this one. */
  let read = Math.round(b.hanzi * pct);
  if(st){
    read = 0;
    st.sizes.forEach((n, i) => { if(i < b.chapter) read += n; else if(i === b.chapter) read += Math.round(n * (b.ratio || 0)); });
  }
  const left = Math.max(0, b.hanzi - read);
  const mins = left / READ_PACE;

  /* The mix, and the share of it at or below the level being worked at. */
  let mix = "";
  if(st && st.running){
    const share = lv => st.byLevel[lv] / st.running;
    const mine = LEVELS.filter(lv => +lv <= +S.level).reduce((a, lv) => a + st.byLevel[lv], 0) / st.running;
    const inHSK = 1 - st.byLevel.x / st.running;
    mix = `
      <div class="mixbar" role="img" aria-label="Share of the book's words by HSK level">
        ${LEVELS.map(lv => `<i style="width:${(share(lv) * 100).toFixed(2)}%;background:var(--hsk-${lv})"></i>`).join("")}
        <i style="width:${(st.byLevel.x / st.running * 100).toFixed(2)}%;background:var(--hsk-x)"></i>
      </div>
      <div class="hsk-legend mixkeys">
        ${LEVELS.filter(lv => share(lv) >= 0.005).map(lv =>
          `<span class="hsk-key k${lv}"><i></i>HSK ${levelLabel(lv)} <b>${Math.round(share(lv) * 100)}%</b></span>`).join("")}
        <span class="hsk-key kx"><i></i>Beyond HSK <b>${Math.round(st.byLevel.x / st.running * 100)}%</b></span>
      </div>
      <p class="pmeta now-note">${Math.round(mine * 100)}% of the running words are HSK ${levelLabel(S.level)} or below —
        your level — and ${Math.round(inHSK * 100)}% are in the standard at all;
        ${num(st.types)} distinct words in ${num(st.running)}.</p>`;
  }else{
    mix = `<p class="pmeta now-note now-wait">Reading through the book for its level mix…</p>`;
  }

  /* The book's sections as a strip, each as wide as it is long: the ones
     behind you filled, the one you are in filled as far as you have read,
     the rest waiting. Without the sizes yet, a single bar. */
  const track = st && st.sizes && st.sizes.length === b.chapters
    ? `<span class="now-map" role="img" aria-label="Sections read">${st.sizes.map((n, i) => {
        const done = i < b.chapter ? 1 : i === b.chapter ? (b.ratio || 0) : 0;
        const title = chapters && chapters[i] ? chapters[i].title : `Section ${i + 1}`;
        return `<i style="flex-grow:${Math.max(1, n)}" class="${i === b.chapter ? "now" : ""}" title="${esc(title)}"><b style="width:${(done * 100).toFixed(1)}%"></b></i>`;
      }).join("")}</span>`
    : `<span class="bk-track now-track"><i style="width:${Math.round(pct * 100)}%"></i></span>`;

  return `<div class="now-grid">
    <button class="now-cover" data-book="${esc(b.id)}" title="${pct ? "Continue reading" : "Start reading"}">${bookCoverHTML(b, "lg")}</button>
    <div class="now-main">
    <div class="now-head">
      <div class="now-id">
        <div class="now-t hz">${esc(b.title)}</div>
        <div class="now-m">${b.author ? `<span class="hz">${esc(b.author)}</span> · ` : ""}${num(b.hanzi)} characters ·
          ${num(b.chapters)} section${b.chapters === 1 ? "" : "s"} · opened ${agoText(b.opened)}</div>
      </div>
      <button class="btn sm" data-book="${esc(b.id)}">${pct ? "Continue reading" : "Start reading"}</button>
    </div>
    <div class="now-where">
      <span class="lbl">Section ${b.chapter + 1} of ${num(b.chapters)}</span>
      ${here ? `<span class="now-ch hz">${esc(here.title)}</span>` : ""}
    </div>
    ${track}
    <div class="kpis now-kpis">
      ${kpi(`${Math.round(pct * 100)}<small>%</small>`, "Read", `${num(read)} characters so far`)}
      ${kpi(num(left), "Left", `character${left === 1 ? "" : "s"} to the end`)}
      ${kpi(`≈ ${spanText(mins)}`, "To finish", `at ${READ_PACE} characters a minute`)}
    </div>
    <div class="now-foot">
    ${next ? `<p class="pmeta now-next"><span class="lbl">Up next</span> <span class="hz">${esc(next.title)}</span></p>` : ""}
    ${mix}
    </div>
    </div>
  </div>`;
}

/* ---------------- taking a book in ---------------- */

/* One row of metadata and one row of text, written together. Splitting them is
   what keeps the shelf cheap: the metadata row is a few hundred bytes and the
   text row can be several megabytes. */
/* ---------------- sections of a readable size ----------------
 *
 * A section is laid out whole — every word of it in columns — so a section
 * of eighty thousand characters, which a book with few chapter breaks will
 * have, is sixty thousand elements to lay out every time it is opened and
 * every time anything above it moves. The book's own chapters are kept as
 * they come, but any over SECTION_MAX characters is cut into equal parts at
 * paragraph breaks, titled with the chapter's name and the part: a section
 * then opens in a moment on any device, whatever the book. Books shelved
 * before this are cut on opening, the place kept. */
const SECTION_MAX = 12000;
/* how many parts a chapter of `len` characters is cut into: none under half
   as long again as a section, since a chapter just over the size is not
   worth halving */
const sectionParts = len => len > SECTION_MAX * 1.5 ? Math.ceil(len / SECTION_MAX) : 1;
function sectionChapters(chapters){
  const out = [];
  for(const ch of chapters){
    const len = ch.blocks.reduce((n, b) => n + b.text.length, 0);
    const parts = sectionParts(len);
    if(parts === 1){ out.push(ch); continue; }
    const each = len / parts;
    let blocks = [], acc = 0, k = 0;
    const cut = () => { out.push({...ch, title: `${ch.title} (${k + 1}/${parts})`, blocks}); blocks = []; k++; };
    for(const b of ch.blocks){
      blocks.push(b); acc += b.text.length;
      if(k < parts - 1 && acc >= each * (k + 1)) cut();
    }
    if(blocks.length) cut();
  }
  return out;
}
/* A place in the uncut book → the same place in the cut one. */
function sectionPlace(chapters, chapter, ratio){
  let at = 0;
  for(let c = 0; c < chapter && c < chapters.length; c++){
    const len = chapters[c].blocks.reduce((n, b) => n + b.text.length, 0);
    at += sectionParts(len);
  }
  const ch = chapters[chapter];
  if(!ch) return {chapter: 0, ratio: 0};
  const lens = sectionChapters([ch]).map(x => x.blocks.reduce((n, b) => n + b.text.length, 0));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let x = clamp(ratio || 0, 0, 1) * total, k = 0;
  while(k < lens.length - 1 && x >= lens[k]){ x -= lens[k]; k++; }
  return {chapter: at + k, ratio: lens[k] ? clamp(x / lens[k], 0, 1) : 0};
}

/* The open book's text, kept in memory: it is a few megabytes, read from
   the database once rather than again for each view that wants it. */
const BOOK = {id: null, data: null};
async function bookData(id){
  if(BOOK.id === id && BOOK.data) return BOOK.data;
  const data = await dbGet("bookdata", id);
  if(data){ BOOK.id = id; BOOK.data = data; }
  return data;
}

async function shelveBook(book){
  const id = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const chapters = sectionChapters(book.chapters);
  const meta = {
    id, title: book.title, author: book.author, lang: book.lang,
    hanzi: book.hanzi, chapters: chapters.length, sectioned: 1,
    added: Date.now(), opened: Date.now(), chapter: 0, ratio: 0,
  };
  await dbPut("books", meta);
  await dbPut("bookdata", {id, chapters});
  return meta;
}

async function importBook(file){
  toast("Reading the file…");
  const book = await parseBook(file);
  if(!book.hanzi){
    toast("No Chinese found in that file");
    return;
  }
  const meta = await shelveBook(book);
  R.shelf = [meta, ...R.shelf];
  toast(`Added ${meta.title}`);
  await openBook(meta.id);
}

async function importPasted(text, title){
  const book = parseText(text, title || "");
  if(!book.hanzi) throw new Error("There is no Chinese in that text.");
  const meta = await shelveBook(book);
  R.shelf = [meta, ...R.shelf];
  await openBook(meta.id);
}

async function unshelve(id){
  const row = R.shelf.find(b => b.id === id);
  if(!confirm(`Remove “${row ? row.title : "this text"}” from the shelf? Your deck is not touched.`)) return;
  await dbDelete("books", id);
  await dbDelete("bookdata", id);
  if(BOOK.id === id){ BOOK.id = null; BOOK.data = null; }
  R.shelf = R.shelf.filter(b => b.id !== id);
  paintShelf();
  toast("Removed from the shelf");
}

/* ---------------- opening one ---------------- */

async function openBook(id){
  if(await loadBook(id)) paintReader(R.meta.ratio || 0);
}
/* The book made the one open — its text, its place, what you know of its
   words — without laying anything out. */
async function loadBook(id){
  const [meta, body] = await Promise.all([dbGet("books", id), bookData(id)]);
  if(!meta || !body){ toast("That text could not be opened"); return false; }
  /* A book shelved before sections were cut to size: cut it now, once, and
     carry the place across. Its reading of the whole book is redone. */
  if(!meta.sectioned){
    const cut = sectionChapters(body.chapters);
    if(cut.length !== body.chapters.length){
      const at = sectionPlace(body.chapters, meta.chapter || 0, meta.ratio || 0);
      meta.chapter = at.chapter; meta.ratio = at.ratio;
      body.chapters = cut;
      meta.stats = null;
      await dbPut("bookdata", body);
    }
    meta.chapters = body.chapters.length;
    meta.sectioned = 1;
    const row = (R.shelf || []).find(b => b.id === id);
    if(row) Object.assign(row, {chapter: meta.chapter, ratio: meta.ratio, chapters: meta.chapters, sectioned: 1, stats: meta.stats});
  }

  await lexicon();
  R.meta = meta;
  R.book = body;
  PREP.sections.clear(); PREP.stamp++;
  R.chapter = Math.min(meta.chapter || 0, body.chapters.length - 1);
  R.fam = await familiarity();
  R.cov = null;

  meta.opened = Date.now();
  await dbPut("books", meta);
  return true;
}

function closeBook(){
  riffleDrop();
  clearSelection();
  if(typeof dropLeaf === "function" && TURN.leaf) dropLeaf();
  clearTimeout(WARM.timer); dropWarm();
  document.body.classList.remove("reading");
  if(R.io){ R.io.disconnect(); R.io = null; }
  if(posTimer) writePosition();
  R.book = null; R.meta = null; R.blocks = []; R.tokens = [];
  /* Full screen is the book's, and ends with it: the masthead and the tabs
     come back, and so does the window. Asked while the book was still held,
     this found it open and kept the shelf full screen with no way off it. */
  S.readFocus = false; save();
  applyReadFocus();
  PREP.sections.clear(); clearTimeout(PREP.timer);
  closeGloss();
  renderRead();
}
/* Closing a book, as a book closes rather than as a screen is swapped: the
   page steps back and fades, then the shelf rises in where it was — two
   short fades the compositor runs, where the reader used to vanish in one
   frame and the shelf land in the next. The shelf is drawn before it rises,
   so the rise is not repainted on the way. A page not being drawn (a tab in
   the background) closes at once. */
async function closeBookGently(){
  const book = $("#read-book"), lib = $("#read-library");
  if(!R.book || REDUCED() || !book || !book.offsetParent || closeBookGently.busy){ if(!closeBookGently.busy) closeBook(); return; }
  closeBookGently.busy = true;
  try{
    const out = book.animate([{opacity: 1, transform: "none"}, {opacity: 0, transform: "scale(.985)"}],
      {duration: 170, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards"});
    await Promise.race([out.finished, new Promise(ok => setTimeout(ok, 260))]);
    /* the masthead and the tabs a phone or full screen put away while reading
       come back with the shelf rather than a frame before it */
    const chrome = [...document.querySelectorAll(".mast, .rail")].filter(el => !el.getClientRects().length);
    const panel = document.body.classList.contains("immersive") && document.querySelector(".wrap");
    lib.style.opacity = "0";
    chrome.forEach(el => { el.style.opacity = "0"; });
    closeBook();
    out.cancel();
    await Promise.race([new Promise(ok => requestAnimationFrame(() => ok())), new Promise(ok => setTimeout(ok, 60))]);
    lib.style.opacity = "";
    chrome.forEach(el => { el.style.opacity = ""; });
    const rise = {duration: 240, easing: "cubic-bezier(.2,.8,.2,1)"};
    const inn = [lib.animate([{opacity: 0, transform: "translateY(8px)"}, {opacity: 1, transform: "none"}], rise)];
    chrome.forEach(el => inn.push(el.animate([{opacity: 0}, {opacity: 1}], rise)));
    if(panel) inn.push(panel.animate([{opacity: 0}, {opacity: 1}], {...rise, pseudoElement: "::before"}));
    setTimeout(() => inn.forEach(an => { if(an.playState !== "finished") an.cancel(); }), 460);
  }finally{
    lib.style.opacity = "";
    document.querySelectorAll(".mast, .rail").forEach(el => { el.style.opacity = ""; });
    closeBookGently.busy = false;
  }
}

/* ---------------- the reading surface ---------------- */

/* The reader's frame, shown and sized, with no section in it yet: the page
   is the size it will be before a word is laid out, which is what lets a
   book opening from the shelf set off for it at once. */
function showReader(){
  $("#read-library").classList.add("hidden");
  $("#read-book").classList.remove("hidden");
  /* On a phone the masthead and the tab row cost a third of the screen, and a
     bounded reading column cannot afford them. On a wide screen the rail is
     beside the content and costs nothing, so it stays. */
  document.body.classList.add("reading");
  applyReadFocus();
  const ch = R.book.chapters[R.chapter];
  $("#rd-title").textContent = R.meta.title;
  $("#rd-chapter").textContent = `${R.chapter + 1} / ${R.book.chapters.length} · ${ch.title}`;
  clearSelection();
  paintReaderControls();
  /* what was laid out for another section is not measured again */
  R.pages = 0;
  $("#rd-cols").textContent = "";
  sizeReader();
}

function paintReader(restoreRatio){
  showReader();
  const ch = R.book.chapters[R.chapter];
  R.blocks = ch.blocks;

  /* Every block is annotated before the chapter is paginated: a page is cut
     where the flow says, and the flow must not change under the reader as
     paragraphs are reached — a plain paragraph that grows pinyin later would
     move every page after it. The marked-up section is made once and kept
     (prepSection), and its neighbours are made ready while you read. */
  const prep = prepSection(R.chapter);
  R.tokens = prep.tokens;
  $("#rd-cols").innerHTML = prep.html;

  R.pages = 0;
  sizeReader();
  paginate(restoreRatio || 0);
  schedulePrep();
}

/* ---------------- pages ---------------- */
/* The chapter is set in columns exactly the height of the page, so the text
   breaks into pages the way a typesetter's would — mid-paragraph where it
   must — and a page is one column (or two, in the spread) slid into view.
 *
 * Re-run whenever the page changes shape: a resize, a panel opening above,
 * the text size, pinyin on or off, the spread toggled. The place is kept as a
 * fraction of the way through the chapter, which is also what is remembered
 * for next time. */
function spreadOn(){
  return S.readSpread === "two" && $("#rd-prose").clientWidth >= 720;
}

/* The place is page / (pages − 1): 0 the first page, 1 the last — the same
   measure as the remembered place, the track and the shelf's progress. Read
   back as page / pages, a place saved past the middle of a section reopened
   a page on. */
const placeOfPage = (page, pages) => pages > 1 ? clamp(page / (pages - 1), 0, 1) : 0;
const pageOfPlace = (place, pages) => pages > 1 ? clamp(Math.round(place * (pages - 1)), 0, pages - 1) : 0;

function paginate(ratio){
  const host = $("#rd-prose"), cols = $("#rd-cols");
  if(!R.book || !host.offsetParent) return;
  const keep = ratio != null ? ratio : placeOfPage(R.page, R.pages);
  const W = host.clientWidth, H = host.clientHeight;
  /* A page with no room — a window minimised, a screen mid-rotation — has
     no columns to cut; cutting anyway divides by nothing and leaves the
     page count NaN until the next real layout. */
  if(W < 40 || H < 40) return;
  const cs = getComputedStyle(cols);
  /* Columns are cut from the content box: the container's own side padding
     comes off first, or the two columns of a spread come out one pixel too
     wide to fit and the browser quietly lays one. */
  const inset = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const two = spreadOn();
  /* The gap between columns is never less than the two side margins put
     together: the columns either side of the page then start beyond the
     canvas, and nothing of them shows in its margins. With no gap, the edge
     of the previous column sat in the left margin and the start of the next
     in the right one. */
  let gap = Math.max(inset, two ? Math.round(Math.max(48, W * 0.05)) : 0);
  /* column-width is a hint: the engine lays as many columns as fit and then
     stretches them to fill the row, so two columns cut from an odd width
     each come out half a pixel wider than asked — and the page slides by
     the width that was asked for, so every page landed a pixel further
     off. The gutter takes the odd pixel instead. */
  if(two && (W - inset - gap) % 2) gap++;
  const colW = two ? (W - inset - gap) / 2 : W - inset;
  R.per = two ? 2 : 1; R.colW = colW; R.gap = gap;
  host.dataset.spread = two ? "two" : "one";
  Object.assign(cols.style, {height: `${H}px`, width: `${W}px`, columnWidth: `${colW}px`, columnGap: `${gap}px`, transform: "none"});
  const stride = colW + gap;
  const total = Math.max(1, Math.round((host.scrollWidth - inset + gap) / stride));
  R.cols = total;
  R.pages = Math.max(1, Math.ceil(total / R.per));
  R.page = pageOfPlace(keep, R.pages);
  /* A ratio of 1 means "the end", which is the last page, not one past it. */
  if(keep >= 0.999) R.page = R.pages - 1;
  applyPage();
}

function applyPage(){
  const cols = $("#rd-cols");
  cols.style.transform = `translateX(${-R.page * R.per * (R.colW + R.gap)}px)`;
  /* Any sheet made ready was for the page that was here; make new ones once
     this one has settled. */
  if(WARM.key !== warmKey()) dropWarm();
  scheduleWarm();
  rememberPosition();
  /* The header, the buttons and the track wait while a page is turning.
     Any change to them has the browser lay the whole reading column out
     again — the section's thousands of words — and in the middle of a turn
     that is a frame lost; once the page has landed it is not seen. */
  if(TURN.busy){ R.chromeLate = true; return; }
  paintPageChrome();
}
function paintPageChrome(){
  R.chromeLate = false;
  if(!R.book) return;
  const ch = R.book.chapters[R.chapter];
  $("#rd-chapter").textContent = `${R.chapter + 1} / ${R.book.chapters.length} · ${ch.title}`
    + (R.pages > 1 ? ` · page ${R.page + 1} of ${R.pages}` : "");
  $("#rd-prev").disabled = R.chapter === 0 && R.page === 0;
  $("#rd-next").disabled = R.chapter >= R.book.chapters.length - 1 && R.page >= R.pages - 1;
  $("#rd-spread-btn").setAttribute("aria-pressed", String(S.readSpread === "two"));
  $("#rd-spread-btn").classList.toggle("on", S.readSpread === "two");
  paintScrub();
}

/* ---------------- the scrubber ---------------- */
/* One track for the whole book. Each section takes a stretch of it in
   proportion to its length where that is known (the shelf's stats), or an
   equal share where it is not; within a section the thumb moves by page.
   Dragging inside the section on screen turns pages as the thumb goes;
   dragging into another section shows where you would land and goes there
   when the thumb is let go — a section is laid out fresh, which is not
   something to do on every pixel of a drag. */
const SCRUB_MAX = 10000;

function scrubWeights(){
  const n = R.book.chapters.length;
  const sizes = R.meta && R.meta.stats && R.meta.stats.v === 1 && R.meta.stats.sizes;
  const w = sizes && sizes.length === n ? sizes.map(x => Math.max(1, x)) : new Array(n).fill(1);
  const cum = [0];
  for(const x of w) cum.push(cum[cum.length - 1] + x);
  return {w, cum, total: cum[n]};
}
/* Section c, a fraction f of the way through it → the track's value. */
function scrubValue(c, f){
  const {w, cum, total} = scrubWeights();
  return Math.round((cum[c] + f * w[c]) / total * SCRUB_MAX);
}
/* The track's value → the section and the fraction of it. */
function scrubPlace(v){
  const {w, cum, total} = scrubWeights();
  const x = clamp(v / SCRUB_MAX, 0, 1) * total;
  let c = 0;
  while(c < w.length - 1 && x >= cum[c + 1]) c++;
  return {c, f: clamp((x - cum[c]) / w[c], 0, 1)};
}

/* The sections, marked along the track: a tick where each begins, and a
   band under the one on screen. Drawn once per book (or once its stats
   arrive and the stretches change), since the ticks do not move with the
   page. A book in hundreds of sections keeps the ticks readable by drawing
   every nth. */
function paintScrubMarks(){
  const track = $(".rd-track");
  if(!track || !R.book) return;
  const {cum, total, w} = scrubWeights();
  const key = `${R.meta.id}:${w.length}:${total}:${R.chapter}`;
  if(track.dataset.marks === key) return;
  track.dataset.marks = key;
  track.querySelectorAll(".rd-mark, .rd-here").forEach(m => m.remove());
  const n = w.length;
  const every = Math.max(1, Math.ceil(n / 60));
  const frag = document.createDocumentFragment();
  for(let c = 1; c < n; c++){
    if(c % every) continue;
    const m = document.createElement("i");
    m.className = "rd-mark";
    m.style.left = `${(cum[c] / total * 100).toFixed(3)}%`;
    frag.appendChild(m);
  }
  const here = document.createElement("i");
  here.className = "rd-here";
  here.style.left = `${(cum[R.chapter] / total * 100).toFixed(3)}%`;
  here.style.width = `${(w[R.chapter] / total * 100).toFixed(3)}%`;
  frag.appendChild(here);
  track.insertBefore(frag, track.querySelector("input"));
}

function paintScrub(){
  const el = $("#rd-scrub");
  if(!el || !R.book || SCRUB.dragging) return;
  paintScrubMarks();
  const f = R.pages > 1 ? R.page / (R.pages - 1) : 0;
  const v = scrubValue(R.chapter, f);
  el.value = v;
  $("#rd-scrub-fill").style.width = `${v / SCRUB_MAX * 100}%`;
  $("#rd-scrub-l").textContent = R.pages > 1 ? `Page ${R.page + 1} of ${R.pages}` : "One page";
  $("#rd-scrub-r").textContent = `${Math.round(v / SCRUB_MAX * 100)}%`;
}

const SCRUB = {dragging: false, at: null};
function bindScrub(){
  const el = $("#rd-scrub"), tip = $("#rd-scrub-tip"), fill = $("#rd-scrub-fill");
  if(!el) return;
  const showTip = (c, f, pages) => {
    const title = R.book.chapters[c].title;
    tip.textContent = `${c + 1} / ${R.book.chapters.length} · ${title}` +
      (pages ? ` · page ${Math.round(f * (pages - 1)) + 1} of ${pages}` : ` · ${Math.round(f * 100)}%`);
    tip.hidden = false;
    /* The tip rides over the thumb, kept inside the track. */
    const pct = el.value / SCRUB_MAX;
    tip.style.left = `${pct * 100}%`;
    tip.style.setProperty("--shift", `${-pct * 100}%`);
  };
  el.addEventListener("input", () => {
    if(!R.book || (TURN.busy && !RIF.st)) return;
    /* the book is being laid out at another section: it lands first */
    if(RIF.st && RIF.st.moving) return;
    SCRUB.dragging = true;
    let v = +el.value;
    /* The thumb snaps: to the start of a section when it comes within reach
       of one, and within the section on screen to the page it will show —
       the track has no positions between pages, so the thumb should not
       rest on one. The reach is a share of the track, so it is the same
       width under the finger whatever the book's length. */
    const {cum, total, w} = scrubWeights();
    const reach = SCRUB_MAX * 0.012;
    let {c, f} = scrubPlace(v);
    for(let k = 1; k < w.length; k++){
      const b = cum[k] / total * SCRUB_MAX;
      if(Math.abs(v - b) <= reach){ v = Math.round(b); c = k; f = 0; break; }
    }
    if(c === R.chapter && R.pages > 1){
      f = Math.round(f * (R.pages - 1)) / (R.pages - 1);
      v = scrubValue(c, f);
    }
    if(+el.value !== v) el.value = v;
    fill.style.width = `${v / SCRUB_MAX * 100}%`;
    $("#rd-scrub-r").textContent = `${Math.round(v / SCRUB_MAX * 100)}%`;
    SCRUB.at = {c, f};
    /* The leaves riffle after the thumb (riffleBegin): the page itself is
       left alone until the thumb is let go. */
    const st = riffleOK() ? riffleBegin() : null;
    if(st){
      riffleAim(st, c, f);
      if(c === R.chapter){
        const page = clamp(Math.round(f * (R.pages - 1)), 0, R.pages - 1);
        $("#rd-scrub-l").textContent = R.pages > 1 ? `Page ${page + 1} of ${R.pages}` : "One page";
        showTip(c, f, R.pages);
      }else showTip(c, f, 0);
      return;
    }
    if(c === R.chapter){
      /* This section: the pages turn under the thumb. */
      const page = clamp(Math.round(f * (R.pages - 1)), 0, R.pages - 1);
      if(page !== R.page){ clearSelection(); closeGloss(); R.page = page; SCRUB.dragging = false; applyPage(); SCRUB.dragging = true; }
      $("#rd-scrub-l").textContent = R.pages > 1 ? `Page ${R.page + 1} of ${R.pages}` : "One page";
      showTip(c, f, R.pages);
    }else{
      showTip(c, f, 0);
    }
  });
  const settle = () => {
    const st = RIF.st;
    /* a press on the thumb that never moved it: the book made ready for it
       is put away */
    if(!SCRUB.dragging){ if(st && !st.ending) riffleRelease(st, null); return; }
    SCRUB.dragging = false;
    tip.hidden = true;
    const at = SCRUB.at; SCRUB.at = null;
    if(st){ riffleRelease(st, at); return; }
    if(!at || !R.book) return;
    if(at.c !== R.chapter) safely("open that section", () => moveChapter(at.c - R.chapter, {ratio: at.f}));
    else paintScrub();
  };
  /* The book is made ready as the thumb is pressed, before it moves: the
     page open and those either side printed, so the first leaf lifts with
     the first move. */
  el.addEventListener("pointerdown", () => { if(riffleOK() && !TURN.busy) riffleBegin(); });
  el.addEventListener("change", settle);
  el.addEventListener("pointerup", settle);
  el.addEventListener("pointercancel", settle);
  el.addEventListener("keyup", settle);
  el.addEventListener("blur", settle);
}

/* ---------------- riffling to the thumb ---------------- */
/* Dragging the page track riffles the book to the page under the thumb as
 * it goes: the opening book's leaves (makeFlicker) — the page turn's own
 * fold — turned over a flat copy of the open page, on the frame clock. A
 * slow drag turns a leaf as the thumb reaches each page; a fast one, or a
 * jump, sends a few over at once, each carrying a bigger handful of pages
 * the further there is to go, and slows to a page a leaf as it arrives.
 *
 * Every page is a picture (paintPrint), printed a few milliseconds at a
 * time between frames, and a leaf waits for its page rather than a frame
 * for the printing. The section open is printed from the reader's own
 * columns. Another is set out of sight (bookSetter): whole where it is
 * short, which is the reader's page exactly, or a few pages about the
 * place in a long one. Let go, and the book lands — in this section on the
 * page itself, put under the leaves by then; in another, the section is
 * laid out under the book while it lies still, and where the page showing
 * was only near the place, a last leaf goes over onto it. Then the copy
 * fades into the page. While leaves are in the air, nothing is put into
 * the page or taken out of it (riffleBegin says why). With the page turn
 * off, or motion reduced, the thumb moves the page as it always did. */
const RIF = {st: null, book: null, lens: null};
const RIF_AIR = 3, RIF_WHOLE = 3000;
const rifEase = x => 0.2 * x + 0.8 * (0.5 - 0.5 * Math.cos(Math.PI * x));
const rifSame = (a, b) => a.k === b.k && a.j === b.j;

function riffleOK(){ return S.readTurn !== "none" && !REDUCED() && !document.hidden; }

/* every section's length, once per book */
function riffleLens(){
  if(RIF.book !== R.book){ RIF.book = R.book; RIF.lens = R.book.chapters.map(ch => ch.blocks.reduce((n, x) => n + x.text.length, 0)); }
  return RIF.lens;
}

function riffleBegin(){
  if(RIF.st) return RIF.st;
  const host = $("#rd-prose"), live = $("#rd-cols");
  if(!R.book || !host || !host.offsetParent || TURN.busy || openBookFrom.busy || !R.pages) return null;
  const r = host.getBoundingClientRect();
  if(r.width < 40 || r.height < 40) return null;
  const stage = host.parentElement, pr = stage.getBoundingClientRect();
  const two = R.per === 2, cw = r.width, H = r.height, W = two ? cw / 2 : cw;
  TURN.busy = true;
  clearSelection(); closeGloss();
  const dpr = window.devicePixelRatio || 1, hi = Math.min(dpr, 2), lo = Math.min(dpr, 1.25);
  const sheet = s => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(W * s)); c.height = Math.max(1, Math.round(H * s)); return c; };
  /* The open page, flat, laid exactly over the reader's — drawn from here
     on, shown as the first leaf lifts — with the spread's spine as the page
     draws it. Everything the riffle will show is made now, once: a canvas
     on each pile, and the leaves that go over, each with a canvas for its
     page and one for its back, lying hidden. A leaf going over is pages
     drawn into canvases and a leaf shown; one landing, a page drawn and a
     leaf hidden. Nothing is put into the page or taken out of it while the
     book moves: any change to the page's make-up has the browser lay the
     reader's whole section out again — a few milliseconds here, many on a
     tablet — which is a stumble in the leaf lifting or landing just then. */
  const flick = makeFlicker(W, H, !two);
  if(two){ const g = document.createElement("div"); g.className = "fk-gutter"; flick.root.insertBefore(g, flick.root.children[2]); }
  const piles = {left: sheet(hi), right: sheet(hi)};
  flick.left.appendChild(piles.left); flick.right.appendChild(piles.right);
  const slots = Array.from({length: RIF_AIR}, () => ({front: sheet(hi), back: sheet(lo), leaf: null, busy: false, backPrint: null}));
  const box = document.createElement("div");
  box.className = "rd-riffle";
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = `left:${r.left - pr.left}px;top:${r.top - pr.top}px;width:${cw}px;height:${H}px`;
  box.appendChild(flick.root);
  leafLayer(stage).appendChild(box);
  /* what a spread holds, to count the pages of a section not yet set: the
     reader's own count where this section has pages enough to tell, the
     lines of the page times what a line holds where not */
  const lens = riffleLens(), m = bookMeasure(host, false);
  let cpv = R.cols >= 3 ? lens[R.chapter] / ((R.cols - 0.5) / R.per) : 0;
  if(!cpv){
    const ls = getComputedStyle(live), fs = parseFloat(ls.fontSize) || 21, lh = parseFloat(ls.lineHeight) || fs * 2.05;
    cpv = R.per * Math.max(40, Math.floor(m.colW / (fs * 1.02)) * Math.max(1, Math.floor((m.H - m.padT - m.padB) / lh)) * 0.85);
  }
  const st = RIF.st = {
    flick, box, host, two, W, H, m, cpv, lens, piles, slots, poolDir: 0, n: 0,
    live: {cols: live, stride: R.colW + R.gap, colW: R.colW},
    hi, lo,
    /* the section open, and the sections whose pages are known exactly */
    cur: R.chapter, pv: new Map([[R.chapter, R.pages]]), whole: new Set([R.chapter]),
    /* the spread showing, and where the thumb is (or, landed, the page) */
    at: {k: R.chapter, j: R.page}, atExact: true,
    aim: {c: R.chapter, f: R.pages > 1 ? R.page / (R.pages - 1) : 0}, fixed: null,
    air: [], next: null, dir: 0, lastLift: -1e9, step: 0,
    prints: new Map(), work: [], setter: null, setK: -1, setCols: 0,
    laid: false, shown: false, ending: false, cross: null, moving: false, force: false,
    raf: 0, pumping: false, safety: 0,
  };
  riffleLeaves(st, 1);
  riffleQueue(st, st.at, true);
  for(const d of [1, -1]) riffleQueue(st, rifflePlace(st, riffleG(st, st.at) + d));
  riffleFeed(st);
  return st;
}

/* A section's spreads: counted where it has been set, reckoned from its
   length where not. A spread's place in the whole book, and back. */
function riffleViews(st, k){ return st.pv.get(k) || Math.max(1, Math.ceil(st.lens[k] / st.cpv)); }
function riffleG(st, v){ let g = v.j; for(let k = 0; k < v.k; k++) g += riffleViews(st, k); return g; }
function rifflePlace(st, g){
  if(g < 0) return null;
  for(let k = 0; k < st.lens.length; k++){ const n = riffleViews(st, k); if(g < n) return {k, j: g}; g -= n; }
  return null;
}
function riffleGoal(st){
  if(st.fixed) return st.fixed;
  const {c, f} = st.aim;
  return {k: c, j: Math.round(f * (riffleViews(st, c) - 1))};
}
/* The pages of a spread, left to right, and what each print is kept as: a
   column of a section where the pages are its own — the section open, one
   set whole, or any section's first spread — or a stand-in near the place. */
function riffleKeys(st, v){
  const exact = v.k === st.cur || st.whole.has(v.k) || v.j === 0;
  const cols = st.two ? [2 * v.j, 2 * v.j + 1] : [v.j];
  return cols.map((col, i) => ({col, i, side: st.two && i ? "r" : "l",
    key: exact ? `${v.k}:${col}` : `${v.k}~${v.j}:${i}`}));
}
const rifflePrinted = (st, v) => riffleKeys(st, v).every(p => st.prints.has(p.key));
/* a page into one of the book's canvases — a blank page is its paper */
function riffleDraw(cv, src){
  const c = cv.getContext("2d");
  c.clearRect(0, 0, cv.width, cv.height);
  if(src) c.drawImage(src, 0, 0, cv.width, cv.height);
}
/* The leaves, made to turn one way — and made again the other way when the
   riffle turns round, which it does with none of them in the air. Each is
   given its place in the stack now, so that restacking it later is only a
   number changed. */
function riffleLeaves(st, dir){
  if(st.poolDir === dir) return;
  st.poolDir = dir;
  for(const s of st.slots){
    if(s.leaf){ s.leaf.page.remove(); s.leaf.flap.remove(); }
    s.leaf = st.flick.lift(s.front, s.back, dir);
    for(const e of [s.leaf.page, s.leaf.flap]){ e.style.visibility = "hidden"; e.style.zIndex = "1"; }
    st.flick.turn(s.leaf, 0);
  }
}
/* A page is a few megabytes of pixels: past a dozen, the oldest go — never
   the ones the next leaf, the thumb's page or the page showing need. */
function riffleTrim(st){
  if(st.prints.size <= 12) return;
  const keep = new Set();
  for(const v of [st.next && st.next.v, riffleGoal(st), st.at]) if(v) for(const p of riffleKeys(st, v)) keep.add(p.key);
  for(const key of st.prints.keys()){
    if(st.prints.size <= 8) break;
    if(!keep.has(key)) st.prints.delete(key);
  }
}
/* the book's canvases given back at once, not whenever memory is swept */
function riffleFree(st){
  const all = [st.piles.left, st.piles.right, ...st.slots.flatMap(s => [s.front, s.back]), ...st.prints.values()];
  for(const cv of all) if(cv){ cv.width = 0; cv.height = 0; }
  st.prints.clear();
}

/* The printing of one spread, a step at a time. */
function* riffleJob(st, v){
  const k = v.k, blocks = R.book.chapters[k].blocks;
  const put = (key, cv) => { st.prints.set(key, cv); riffleTrim(st); };
  if(k === st.cur){
    for(const p of riffleKeys(st, v)){
      if(st.prints.has(p.key)) continue;
      put(p.key, p.col < R.cols ? paintPrint(st.live, p.col, p.side, st.W, st.H, st.hi) : null);
      yield;
    }
    return;
  }
  const setter = st.setter || (st.setter = bookSetter(st.host, st.m, st.host.dataset.spread || "one"));
  const opts = readOpts();
  let t = performance.now();
  const lap = () => { if(performance.now() - t < 4) return false; t = performance.now(); return true; };
  if(st.lens[k] <= RIF_WHOLE){
    /* A short section, set whole: the reader's own pages, and how many. Its
       marking is kept, as the reader keeps it, for opening it. */
    if(st.setK !== k){
      const key = prepKey();
      let p = PREP.sections.get(k);
      if(!p){ p = {tokens: new Array(blocks.length), parts: [], key}; PREP.sections.set(k, p); }
      if(p.key !== key){ p.parts = []; p.html = null; p.key = key; }
      while(p.html == null && p.parts.length < blocks.length){
        const i = p.parts.length;
        if(!p.tokens[i]) p.tokens[i] = segment(blocks[i].text);
        p.parts.push(blockHTML(blocks[i], i, p.tokens[i], opts));
        if(lap()) yield;
      }
      if(p.html == null){ p.html = p.parts.join(""); p.parts = []; }
      st.setCols = setter.html(p.html);
      st.setK = k;
      st.pv.set(k, Math.max(1, Math.ceil(st.setCols / (st.two ? 2 : 1))));
      st.whole.add(k);
      yield;
    }
    v.j = Math.min(v.j, riffleViews(st, k) - 1);
    for(const p of riffleKeys(st, v)){
      if(st.prints.has(p.key)) continue;
      put(p.key, p.col < st.setCols ? paintPrint(setter, p.col, p.side, st.W, st.H, st.lo) : null);
      yield;
    }
    return;
  }
  /* A long one: a few pages about the place — from its first paragraph for
     its first spread, which is then the reader's own; to its last for its
     last; otherwise from the paragraph the place falls in. */
  const n = riffleViews(st, k), last = v.j > 0 && v.j >= n - 1;
  let b0 = 0, b1 = blocks.length;
  if(last){
    b0 = blocks.length;
    for(let acc = 0; b0 > 0 && acc < 2.2 * st.cpv;) acc += blocks[--b0].text.length;
  }else{
    const o = v.j * st.lens[k] / n;
    for(let acc = 0; b0 < blocks.length - 1 && acc + blocks[b0].text.length <= o;) acc += blocks[b0++].text.length;
    b1 = b0;
    for(let acc = 0; b1 < blocks.length && acc < 2.5 * st.cpv; b1++) acc += blocks[b1].text.length;
  }
  const pre = PREP.sections.get(k), parts = [];
  for(let b = b0; b < b1; b++){
    parts.push(blockHTML(blocks[b], b, (pre && pre.tokens[b]) || segment(blocks[b].text), opts));
    if(lap()) yield;
  }
  const total = st.setCols = setter.html(parts.join(""));
  st.setK = -1;
  yield;
  const first = last ? (st.two ? 2 * (Math.ceil(total / 2) - 1) : total - 1) : 0;
  for(const p of riffleKeys(st, v)){
    if(st.prints.has(p.key)) continue;
    const col = first + p.i;
    put(p.key, col < total ? paintPrint(setter, col, p.side, st.W, st.H, st.lo) : null);
    yield;
  }
}

/* The printing is a short queue, the spread the next leaf needs first. A
   job once begun runs to its end before another starts — they share the
   one page set out of sight. */
function riffleQueue(st, v, first = false){
  if(!v || rifflePrinted(st, v)) return;
  const id = `${v.k}:${v.j}`;
  const i = st.work.findIndex(w => w.id === id);
  if(i === 0 || (i > 0 && !first)) return;
  const job = i > 0 ? st.work.splice(i, 1)[0] : {id, v, it: riffleJob(st, v), started: false};
  if(first) st.work.splice(st.work.length && st.work[0].started ? 1 : 0, 0, job);
  else st.work.push(job);
  if(st.work.length > 8) st.work.length = 8;
}
/* A slice of it between frames: a few milliseconds while leaves fly (each
   frame asks for the next), more while none do, back to back while nothing
   is moving at all. */
function riffleFeed(st){
  if(st.pumping || !st.work.length) return;
  st.pumping = true;
  const c = new MessageChannel();
  c.port1.onmessage = () => {
    c.port1.close();
    st.pumping = false;
    if(RIF.st !== st) return;
    const end = performance.now() + (st.air.length ? 5 : 12);
    while(st.work.length && performance.now() < end){
      const w = st.work[0];
      w.started = true;
      let done = true;
      try{ done = w.it.next().done; }
      catch(err){
        console.error(err);
        /* a page that cannot be printed is turned blank rather than waited for */
        for(const p of riffleKeys(st, w.v)) if(!st.prints.has(p.key)) st.prints.set(p.key, null);
      }
      if(done) st.work.shift();
    }
    if(!st.raf) riffleFeed(st);
  };
  c.port2.postMessage(0);
}

function riffleWake(st){ if(!st.raf && !st.moving) st.raf = requestAnimationFrame(riffleTick); }

function riffleTick(){
  const st = RIF.st;
  if(!st) return;
  st.raf = 0;
  const now = performance.now();
  for(let i = 0; i < st.air.length; i++){
    const a = st.air[i], x = (now - a.t0) / a.dur;
    if(x < 1){ st.flick.turn(a.slot.leaf, rifEase(x)); continue; }
    /* landed: its back is the page on the pile it came down on */
    const s = a.slot;
    if(st.two) riffleDraw(st.piles[a.dir > 0 ? "left" : "right"], s.backPrint);
    s.backPrint = null; s.busy = false;
    s.leaf.page.style.visibility = s.leaf.flap.style.visibility = "hidden";
    st.air.splice(i--, 1);
  }
  riffleLaunch(st, now);
  const there = !st.force && rifSame(st.at, riffleGoal(st));
  if(st.air.length || !there){ st.raf = requestAnimationFrame(riffleTick); riffleFeed(st); return; }
  if(st.ending){ riffleArrive(st); return; }
  /* at rest under the thumb: the spreads either side made ready for its
     next move, the way it was going first */
  const g = riffleG(st, st.at);
  for(const d of st.dir < 0 ? [-1, 1] : [1, -1]) riffleQueue(st, rifflePlace(st, g + d));
  riffleFeed(st);
}

function riffleLaunch(st, now){
  /* the page open, on the flat book, before anything lifts off it */
  if(!st.laid){
    if(!rifflePrinted(st, st.at)){ riffleQueue(st, st.at, true); return; }
    const pages = riffleKeys(st, st.at).map(p => st.prints.get(p.key));
    if(st.two){ riffleDraw(st.piles.left, pages[0]); riffleDraw(st.piles.right, pages[1]); }
    else riffleDraw(st.piles.right, pages[0]);
    st.laid = true;
  }
  const goal = riffleGoal(st), G = riffleG(st, st.at), T = riffleG(st, goal);
  if(G === T && !st.force){ st.next = null; return; }
  const dir = Math.sign(T - G) || st.dir || 1;
  /* a leaf the other way waits for the ones going over to land */
  if(st.air.length && st.air[st.air.length - 1].dir !== dir) return;
  if(st.air.length >= RIF_AIR || now - st.lastLift < st.step) return;
  const dist = Math.abs(T - G);
  /* The spread the next leaf opens at: chosen once, and kept while it is
     still on the way to the thumb, so its printing is never thrown away.
     Far off, a leaf carries most of the way there; near, a page. */
  let nx = st.next;
  if(nx){
    const n = riffleG(st, nx.v);
    if(nx.dir !== dir || (st.force ? !rifSame(nx.v, goal) : dir > 0 ? n > T || n <= G : n < T || n >= G)) nx = st.next = null;
  }
  if(!nx){
    const stride = dist <= 2 ? 1 : Math.ceil(dist * 0.6);
    const v = st.force ? {k: goal.k, j: goal.j} : rifflePlace(st, G + dir * Math.max(1, Math.min(dist, stride))) || {k: goal.k, j: goal.j};
    nx = st.next = {v, dir};
  }
  if(!rifflePrinted(st, nx.v)){ riffleQueue(st, nx.v, true); riffleQueue(st, goal); return; }
  /* the leaves turned round, with none in the air */
  if(st.poolDir !== dir) riffleLeaves(st, dir);
  const slot = st.slots.find(s => !s.busy);
  if(!slot) return;
  /* Over it goes: its page off the pile it lies on, the next page showing
     there, and on its back the page it lands open at — on a single page,
     the page it uncovers, as the reader's own turn shows it. */
  const pages = riffleKeys(st, nx.v).map(p => st.prints.get(p.key));
  const from = st.piles[dir > 0 || !st.two ? "right" : "left"];
  const onto = st.two ? pages[dir > 0 ? 1 : 0] : pages[0];
  const back = st.two ? pages[dir > 0 ? 0 : 1] : pages[0];
  riffleDraw(slot.front, from);
  riffleDraw(slot.back, back);
  riffleDraw(from, onto);
  slot.backPrint = back; slot.busy = true;
  /* the latest lifted lies lowest, and lands on top */
  st.n++;
  slot.leaf.page.style.zIndex = String(50000 - st.n);
  slot.leaf.flap.style.zIndex = String(50000 + st.n);
  st.flick.turn(slot.leaf, 0);
  slot.leaf.page.style.visibility = slot.leaf.flap.style.visibility = "";
  if(!st.shown){ st.box.style.opacity = "1"; st.shown = true; }
  const quick = dist > 2;
  st.air.push({slot, dir, t0: now, dur: quick ? 330 : 420});
  st.step = quick ? 110 : 150;
  st.lastLift = now; st.dir = dir;
  st.at = nx.v; st.atExact = !riffleKeys(st, nx.v)[0].key.includes("~");
  st.next = null; st.force = false;
  riffleQueue(st, goal);
}

/* The thumb moved: the book riffles on toward it, whatever it was doing. */
function riffleAim(st, c, f){
  st.aim = {c, f}; st.fixed = null; st.ending = false; st.cross = null; st.force = false;
  clearTimeout(st.safety);
  riffleQueue(st, riffleGoal(st));
  riffleWake(st);
}
/* The thumb let go: the book lands where it is. */
function riffleRelease(st, at){
  st.ending = true;
  if(at && at.c !== st.cur) st.cross = at;
  else{
    st.cross = null;
    if(at) st.aim = at;
    /* the page itself, under the leaves, for them to come down on */
    const g = riffleGoal(st);
    if(g.k === R.chapter && g.j !== R.page){ R.page = g.j; applyPage(); }
  }
  riffleGuard(st);
  riffleWake(st);
}
/* A page that is not being drawn (a tab in the background) gets no frames,
   and the book would never land: while it is still moving it is left
   alone, and once it has stopped it is put straight down on its page. */
function riffleGuard(st){
  clearTimeout(st.safety);
  st.safety = setTimeout(() => {
    if(RIF.st !== st) return;
    if(!document.hidden && performance.now() - st.lastLift < 1500){ riffleGuard(st); return; }
    const cross = !st.moving && st.cross;
    riffleDrop();
    if(cross && R.book) safely("open that section", () => moveChapter(cross.c - R.chapter, {ratio: cross.f}));
    else paintScrub();
  }, 2500);
}
function riffleArrive(st){
  if(!st.cross){ riffleFinish(st); return; }
  if(st.moving) return;
  st.moving = true;
  const {c, f} = st.cross;
  st.cross = null;
  /* Another section is laid out under the book as it lies still — the one
     pause, with nothing moving to show it — and opened where the thumb
     was, as the track counts its pages. */
  setTimeout(() => safely("open that section", async () => {
    if(RIF.st !== st) return;
    await moveChapter(c - R.chapter, {ratio: f});
    if(RIF.st !== st) return;
    R.page = clamp(Math.round(f * (R.pages - 1)), 0, R.pages - 1);
    applyPage();
    st.cur = R.chapter; st.pv.set(st.cur, R.pages); st.whole.add(st.cur);
    st.fixed = {k: st.cur, j: R.page};
    st.moving = false;
    /* where the spread showing was only near the page, a last leaf onto it */
    if(!(st.atExact && rifSame(st.at, st.fixed))) st.force = true;
    riffleWake(st);
  }), 0);
}
/* Landed: the copy fades into the page, which is under it by now. */
function riffleFinish(st){
  if(RIF.st !== st) return;
  RIF.st = null;
  clearTimeout(st.safety); cancelAnimationFrame(st.raf);
  st.work.length = 0;
  if(st.setter) st.setter.ghost.remove();
  const box = st.box;
  let freed = false;
  const gone = () => { if(freed) return; freed = true; box.remove(); riffleFree(st); };
  if(st.shown && !document.hidden){
    const out = box.animate([{opacity: 1}, {opacity: 0}], {duration: 160, easing: "ease-out", fill: "forwards"});
    out.finished.then(gone, gone);
    setTimeout(gone, 400);
  }else gone();
  TURN.busy = false;
  if(R.chromeLate) paintPageChrome(); else paintScrub();
  scheduleWarm();
}
/* Put away at once: the book closed, the view left, the window resized. */
function riffleDrop(){
  const st = RIF.st;
  if(!st) return;
  RIF.st = null;
  clearTimeout(st.safety); cancelAnimationFrame(st.raf);
  st.work.length = 0;
  if(st.setter) st.setter.ghost.remove();
  st.box.remove();
  riffleFree(st);
  TURN.busy = false;
  SCRUB.dragging = false;
  const tip = $("#rd-scrub-tip");
  if(tip) tip.hidden = true;
  /* the thumb and its label back on the page the reader is on */
  if(R.chromeLate) paintPageChrome(); else paintScrub();
}

/* Forward or back one page, across a chapter boundary when it must. */
async function goPage(delta, opts = {}){
  if(!R.book) return false;
  closeGloss();
  clearSelection();
  const target = R.page + delta;
  if(target >= 0 && target < R.pages){
    R.page = target;
    applyPage();
    return true;
  }
  const ok = await moveChapter(delta > 0 ? 1 : -1, {toEnd: delta < 0});
  return ok;
}

function toggleSpread(){
  S.readSpread = S.readSpread === "two" ? "one" : "two"; save();
  paginate();
  toast(spreadOn() ? "Two pages" : S.readSpread === "two" ? "Two pages need a wider window" : "One page");
}

/* The display strip: what the colours mean and how the text is set. */
function paintReaderControls(){
  /* The colouring is one switch in the bar: by level, or off. The deck-based
     "your progress" colouring went with the deck; a saved choice of it now
     reads as level. */
  if(S.readTint !== "off") S.readTint = "level";
  const tinted = S.readTint !== "off";
  $("#rd-tint-btn").setAttribute("aria-pressed", String(tinted));
  $("#rd-tint-btn").classList.toggle("on", tinted);
  $$("#rd-mark button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.mark === S.readMark)));
  $("#sw-ruby").setAttribute("aria-pressed", String(!!S.readRuby));
  /* The turn: a switch for whether, a pair for how. Off remembers the how. */
  const animated = S.readTurn !== "none";
  const style = animated ? S.readTurn : (S.readTurnStyle || "curl");
  $("#sw-turn").setAttribute("aria-pressed", String(animated));
  $("#rd-turn").classList.toggle("dim", !animated);
  $$("#rd-turn button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.turn === style)));
  $("#sw-dim").setAttribute("aria-pressed", String(!!S.readDim));
  $("#sw-scrub").setAttribute("aria-pressed", String(S.readScrub !== false));
  const scrub = $(".rd-scrub");
  if(scrub) scrub.hidden = S.readScrub === false;
  /* Where passages are translated, the connection line, and the device's
     translators — shown wherever the device may be asked to translate. */
  const svc = translator();
  $$("#rd-trsvc button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.svc === svc)));
  $("#rd-mt").hidden = svc === "google";
  mtNetPaint();
  if(svc !== "google") mtPaint();
  /* Pinyin has two controls — the button in the bar and the switch in the
     settings panel — because it is the one people reach for mid-page. They are
     one setting, so both are painted from it rather than from each other. */
  $("#rd-ruby-btn").setAttribute("aria-pressed", String(!!S.readRuby));
  $("#rd-ruby-btn").classList.toggle("on", !!S.readRuby);
  const key = $("#rd-legend"), keyed = S.readTint !== "off";
  key.innerHTML = legendHTML();
  key.classList.toggle("hidden", !keyed);
  key.parentElement.classList.toggle("keyed", keyed);
  fitReadBar();

  const host = $("#rd-prose");
  host.dataset.tint = S.readTint;
  /* Which of the two ways the level is shown. Held apart from the tint so that
     turning the colouring off silences both at once — a mark mode on its own
     would otherwise still paint every word the fallback grey. */
  host.dataset.mark = S.readTint === "off" ? "none" : S.readMark;
  /* Set as a class rather than read off the markup with :has(): a selector
     over the whole page is re-checked on every change inside it, and the
     selection changes something inside it on every move of the pointer. */
  host.classList.toggle("ruby", !!S.readRuby);
  host.style.setProperty("--rd-size", `${S.readSize}px`);
  $("#lbl-rdsize").textContent = `${S.readSize}px`;
  sizeReader();
}

function legendHTML(){
  if(S.readTint === "fam"){
    return [["f0","Not in your deck"],["f1","Learning"],["f2","Known"]]
      .map(([k, label]) => `<span class="hsk-key ${k}"><i></i>${label}</span>`).join("");
  }
  /* "HSK" is said once per key where there is room, and dropped where there
     is less (fitReadBar): the swatch and the number still say which is which. */
  return LEVELS.map(lv => `<span class="hsk-key k${lv}" title="HSK ${levelLabel(lv)}"><i></i><span class="hk-pre">HSK </span>${levelLabel(lv)}</span>`).join("")
    + `<span class="hsk-key kx" title="Beyond HSK"><i></i>Beyond<span class="hk-pre"> HSK</span></span>`;
}
/* The key shares the bar with the title and the buttons.
 *
 * The buttons keep their names only if the key, at its shortest, still fits
 * beside them. That is decided as if the key were showing, whether it is or
 * not, so that turning the colours on or off never moves a button — least of
 * all the one just pressed. Then the key itself: in full where there is room,
 * as bare numbers where there is less, and scrolling sideways, faded at its
 * end, where even those do not fit. Its height is fixed, so none of this
 * moves the page. A phone keeps the key on a row of its own and its buttons
 * bare in any case (styles.css). */
function fitReadBar(){
  const key = $("#rd-legend"), bar = key && key.parentElement;
  if(!bar || !bar.offsetParent) return;
  const fits = () => key.scrollWidth <= key.clientWidth + 1;
  const keyed = bar.classList.contains("keyed"), shown = !key.classList.contains("hidden");
  if(innerWidth > 640){
    bar.classList.remove("bare");
    bar.classList.add("keyed"); key.classList.remove("hidden", "over"); key.classList.add("short");
    const roomy = fits();
    bar.classList.toggle("keyed", keyed); key.classList.toggle("hidden", !shown);
    bar.classList.toggle("bare", !roomy);
  }
  if(!shown) return;
  key.classList.remove("short", "over");
  if(!fits()) key.classList.add("short");
  if(!fits()) key.classList.add("over");
}

/* The reading row scrolls inside itself rather than scrolling the page.
 *
 * A book is not a document you scroll past — it is a surface you sit in front
 * of, and the bar, the legend and the section buttons are wanted at every
 * point in a chapter rather than only at its top and bottom.
 *
 * The height goes on the row rather than on the prose. It is measured rather
 * than expressed in CSS because what sits above it differs between the two
 * layouts and changes as the panels open. An earlier version collapsed the column to zero
 * first so it could read where the section buttons landed — which took the
 * page's scrollbar away, which some engines report as a window resize, which
 * asked for another measurement. The row's top does not depend on its own
 * height, so the space below it can be worked out from the parts instead. */
function sizeReader(){
  const body = $("#rd-body");
  const shell = $("#read-book");
  if(!body || !shell || !R.book) return;
  /* A hidden view has no layout to measure. Every rect in a display:none
     subtree is zero, the height that falls out of that is nonsense, and
     writing it back changes the page enough to ask for another measurement —
     so leaving the Read view with a book still open would spin. offsetParent
     is null exactly when the element or an ancestor is display:none. */
  if(!shell.offsetParent) return;
  /* the bar is as wide as the window and the rail leave it */
  fitReadBar();

  const foot = shell.querySelector(".rd-foot");
  const wrap = document.querySelector(".wrap");
  const gap = parseFloat(getComputedStyle(shell).rowGap) || 0;
  const pad = wrap ? parseFloat(getComputedStyle(wrap).paddingBottom) || 0 : 0;
  const below = gap + (foot ? foot.getBoundingClientRect().height : 0) + pad;

  const height = Math.max(220,
    Math.round(window.innerHeight - body.getBoundingClientRect().top - below));
  /* Writing the same value back would be one more layout for nothing, and on
     an engine that reports the resulting scrollbar change as a resize it is
     also how a measurement turns into a loop. */
  const want = `${height}px`;
  if(body.style.height !== want){ body.style.height = want; if(R.pages) paginate(); }
  else if(R.pages && Math.abs(($("#rd-cols").offsetHeight || 0) - $("#rd-prose").clientHeight) > 1) paginate();

  /* The page begins on a whole pixel. Whatever sits above it — the bar, the
     key — is text, and text is as tall as a device's font makes it, which
     is often a fraction. A page starting on a fraction is composited one
     way live and another as the copy on a turning sheet, and the print
     hops at every turn. The fraction is made up here, once, in a margin. */
  const host = $("#rd-prose");
  if(host){
    host.style.marginTop = "";
    const frac = host.getBoundingClientRect().top % 1;
    if(frac > 0.02 && frac < 0.98) host.style.marginTop = `${(1 - frac).toFixed(2)}px`;
  }
}

/* ---------------- full screen ---------------- */
/* Immersion is two things, and only one of them is the platform's. The page
   side is a class on <body>: the masthead and the rail go, the wrap loses
   its inset, and the book takes the window. The platform side — the
   browser's own chrome, the phone's status bar — is asked for on the way
   in and given back on the way out, and where it is refused (a WebView
   that does not offer it, a page opened from disk) the page side still
   stands, which is most of the effect. */
function setReadFocus(on){
  S.readFocus = !!on; save();
  applyReadFocus();
  if(S.readFocus && R.book){
    const root = document.documentElement;
    if(root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
  }
  toast(S.readFocus ? "Full screen — F or Esc to leave" : "Back to the window");
}
/* The class follows the state: full screen is only ever a book's, so a
   closed book or another tab takes it off, and the button says which. */
function applyReadFocus(){
  const on = !!(S.readFocus && R.book && S.view === "read");
  const was = document.body.classList.contains("immersive");
  document.body.classList.toggle("immersive", on);
  const b = $("#rd-focus");
  if(b){
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("span").textContent = on ? "Exit" : "Full screen";
    b.title = on ? "Leave full screen (F)" : "Full screen (F)";
  }
  if(window.hskkerNativeImmersive) window.hskkerNativeImmersive(on);
  /* The browser's full screen is only ever the reader's: whatever takes the
     page side off — the button, a closed book, another tab — gives the
     window back as well. */
  if(!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  /* The page is re-cut for the width it now has, once the layout has moved. */
  if(was !== on && R.book) setTimeout(() => { sizeReader(); paginate(); }, 40);
}
/* The browser's own way out — Esc, or its exit button — is honoured as ours. */
document.addEventListener("fullscreenchange", () => {
  if(!document.fullscreenElement && document.body.classList.contains("immersive")){
    S.readFocus = false; save(); applyReadFocus();
  }
});

function toggleRuby(on){
  S.readRuby = on;
  save();
  paintReaderControls();
  repaintAnnotations();
}

/* How the reader marks a word: coloured as the page is set, and a span
   rather than a button (segment.js annotateHTML says why). */
function readOpts(){
  return {mode: S.readTint === "off" ? "plain" : S.readTint, fam: R.fam, ruby: S.readRuby, dim: S.readDim, tag: "span"};
}
function annotateBlock(el){
  const i = +el.dataset.b;
  const blk = R.blocks[i];
  if(!blk) return;   // a stale element from another chapter: nothing to mark
  if(!R.tokens[i]) R.tokens[i] = segment(blk.text);
  el.innerHTML = annotateHTML(R.tokens[i], readOpts());
  el.dataset.done = "1";
}

/* Re-mark the chapter — after a switch of colour or pinyin — and cut the
   pages again, since the marks change the flow; the place is kept. */
function repaintAnnotations(){
  clearSelection();
  $("#rd-cols").innerHTML = prepSection(R.chapter).html;
  paginate();
}

/* ---- a section, marked, ahead of time ----
 *
 * Opening a section is three pieces of work: segmenting its text into
 * words, writing the marked-up page, and laying it out. The first two are
 * pure script — tens of milliseconds for a section of a novel, several times
 * that on a phone — and their result does not change while the book is
 * open, so it is done once per section and kept. For the sections either
 * side of the one being read it is done beforehand, a slice at a time in
 * the idle moments between pages, so turning into the next section only has
 * to lay it out. The marked-up page is built as one string and set in one
 * go, rather than set plain and then re-set paragraph by paragraph. */
const PREP = {sections: new Map(), stamp: 0, timer: 0};
function prepKey(){ return [S.readTint, S.readRuby, S.readDim, PREP.stamp].join(":"); }
function blockHTML(b, i, tokens, opts){
  const tag = b.tag === "h" ? "h2" : b.tag === "q" ? "blockquote" : "p";
  return `<${tag} class="blk" data-b="${i}" data-done="1">${annotateHTML(tokens, opts)}</${tag}>`;
}
function prepSection(c){
  const blocks = R.book.chapters[c].blocks, key = prepKey();
  let p = PREP.sections.get(c);
  if(!p){ p = {tokens: new Array(blocks.length), parts: [], key: ""}; PREP.sections.set(c, p); }
  if(p.key !== key){ p.parts = []; p.html = null; p.key = key; }
  if(p.html == null){
    const opts = readOpts();
    for(let i = p.parts.length; i < blocks.length; i++){
      if(!p.tokens[i]) p.tokens[i] = segment(blocks[i].text);
      p.parts.push(blockHTML(blocks[i], i, p.tokens[i], opts));
    }
    p.html = p.parts.join(""); p.parts = [];
  }
  /* A few sections are kept: the one open and its neighbours. */
  for(const k of PREP.sections.keys()) if(Math.abs(k - c) > 1 && PREP.sections.size > 3) PREP.sections.delete(k);
  return p;
}
/* The neighbours, in idle time, a few paragraphs at a slice. */
function schedulePrep(){
  clearTimeout(PREP.timer);
  PREP.timer = setTimeout(() => {
    /* not while a book is opening: its frames come first */
    if(openBookFrom.busy){ schedulePrep(); return; }
    const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : f => setTimeout(() => f({timeRemaining: () => 8, didTimeout: false}), 30);
    const book = R.book;
    const step = deadline => {
      if(!R.book || R.book !== book) return;
      for(const c of [R.chapter + 1, R.chapter - 1]){
        if(c < 0 || c >= R.book.chapters.length) continue;
        const blocks = R.book.chapters[c].blocks, key = prepKey();
        let p = PREP.sections.get(c);
        if(!p){ p = {tokens: new Array(blocks.length), parts: [], key}; PREP.sections.set(c, p); }
        if(p.key !== key){ p.parts = []; p.html = null; p.key = key; }
        if(p.html != null) continue;
        const opts = readOpts();
        while(p.parts.length < blocks.length && (deadline.timeRemaining() > 3 || deadline.didTimeout)){
          const i = p.parts.length;
          if(!p.tokens[i]) p.tokens[i] = segment(blocks[i].text);
          p.parts.push(blockHTML(blocks[i], i, p.tokens[i], opts));
          if(deadline.didTimeout && p.parts.length % 8 === 0) break;
        }
        if(p.parts.length === blocks.length){ p.html = p.parts.join(""); p.parts = []; continue; }
        idle(step, {timeout: 1500});
        return;
      }
    };
    idle(step, {timeout: 1500});
  }, 400);
}

/* @param opts.toEnd  open on the last page rather than the first (going back)
 * @param opts.page   open on this page (a cancelled turn coming home) */
async function moveChapter(delta, opts = {}){
  const next = R.chapter + delta;
  if(next < 0 || next >= R.book.chapters.length) return false;
  R.chapter = next;
  R.meta.chapter = next;
  const ratio = opts.ratio != null ? clamp(opts.ratio, 0, 1) : opts.toEnd ? 1 : 0;
  R.meta.ratio = ratio;
  R.cov = null;
  closeGloss();
  paintReader(ratio);
  if(opts.page != null){ R.page = clamp(opts.page, 0, R.pages - 1); applyPage(); }
  /* The place is written once the page is up, not waited for before it. */
  dbPut("books", R.meta).catch(() => {});
  return true;
}

/* ---------------- turning the page ---------------- */
/* A page turns the way a page of paper folds over.
 *
 * The fold is the perpendicular bisector between the corner's resting place
 * and where the corner is now; move the corner and the fold moves. Three
 * layers make the sheet. The front is the page being left, copied whole and
 * never cut. Over it, the under-layer shows the page being turned to, cut to
 * the part of the page the sheet has come away from, so the new page appears
 * beneath the lifted corner. Over both, the flap is the back of the sheet:
 * the page you are turning to, printed on the verso, seen the way a real
 * book shows it. A point on the flap is a point of the leaf carried across
 * the fold, and that point of the leaf comes to rest mirrored across the
 * spine — so the verso is the next page laid where it will land, reflected
 * across the spine and then across the fold. Two reflections make a
 * rotation: the print stays upright and readable, turned by the angle of the
 * fold, exactly as the back of a page looks halfway over. Shadow lies along
 * the fold and under the lifted edge. In the spread the right-hand page
 * turns forward and the left one back, on a spine down the middle. This is
 * the construction StPageFlip and turn.js use, which is why it reads as
 * paper.
 *
 * Every cut is made with a rotated box that hides its overflow — a "cutter"
 * laid with one edge along the fold, holding its contents at the inverse
 * rotation so they stay put on the page — rather than with clip-path. That
 * is the turn.js way, and it is deliberate: a box and a transform are the
 * two things every GPU compositor draws without going back to the CPU, so
 * a frame of the turn is a handful of matrix updates and no re-rasterised
 * text, which is what keeps it smooth on a phone. clip-path and filters,
 * which the sheet used before, are repainted per frame on many mobile GPUs
 * and rendered wrongly on some.
 *
 * Both copies are cut to sit exactly where the live page sits — the same
 * column, the same line — so nothing moves when the sheet lifts or lands;
 * the live page beneath is swapped while it is covered.
 *
 * A finger or a mouse holds the corner directly; a button or a key carries
 * it along an arc on a clock. "Slide" pushes the page off flat; "None" swaps.
 */
const TURN = {leaf: null, busy: false, drag: null};

function canTurn(dir){
  if(!R.book) return false;
  if(dir > 0) return R.page < R.pages - 1 || R.chapter < R.book.chapters.length - 1;
  return R.page > 0 || R.chapter > 0;
}

/* The columns on screen, copied: the blocks that touch the page, and a spacer
   the height of where the first of them began in its column, so the copy
   breaks where the page breaks. */
function visibleCopy(host, page = R.page){
  return columnsCopy(host, $("#rd-cols"), R.colW + R.gap, page * R.per, R.per);
}
/* Columns [first, first + n) of a laid-out chapter — the live one, or a
   copy laid out elsewhere — copied into a page the size of the host, where
   the live page would show them. */
function columnsCopy(host, cols, stride, first, n){
  const x0 = first * stride, x1 = x0 + n * stride;
  const origin = cols.getBoundingClientRect();
  const padTop = parseFloat(getComputedStyle(cols).paddingTop) || 0;
  const copy = document.createElement("div");
  copy.className = host.className;
  copy.dataset.tint = host.dataset.tint; copy.dataset.mark = host.dataset.mark; copy.dataset.spread = host.dataset.spread;
  copy.style.cssText = host.style.cssText;
  /* The live page's pixel-snapping margin (sizeReader) is the frame's to
     carry, not the copy's: inside the sheet the copy fills its box. */
  copy.style.marginTop = "0";
  /* A copy, not a second original: the clone must not carry the id, or
     every lookup of #rd-cols while a sheet is up may find the copy — and a
     repaint would annotate the copy's paragraphs against the new chapter. */
  const inner = cols.cloneNode(false);
  inner.removeAttribute("id");
  let c0 = null, y0 = 0;
  for(const blk of cols.children){
    const rects = blk.getClientRects();
    if(!rects.length) continue;
    const sx = rects[0].left - origin.left, ex = rects[rects.length - 1].right - origin.left;
    /* A block whose union box merely touches the page's edge is not on it:
       a fragmented block reports one box across all its columns. */
    if(ex <= x0 + 2 || sx >= x1 - 2) continue;
    if(c0 === null){ c0 = Math.floor((sx + 2) / stride); y0 = rects[0].top - origin.top; }
    inner.appendChild(blk.cloneNode(true));
  }
  if(c0 === null) c0 = Math.floor(x0 / stride);
  /* The first copied block lands where its border box sits in the live
     column: a spacer of that height, and no top margin of its own — in the
     live flow that margin is either already inside y0 or truncated at the
     column break, and applying it again is a shift of one heading's margin. */
  const firstBlk = inner.querySelector(".blk");
  if(firstBlk) firstBlk.style.marginTop = "0";
  const lead = Math.max(0, y0 - padTop);
  if(lead > 0.5){
    const spacer = document.createElement("div");
    spacer.style.height = `${lead}px`;
    inner.prepend(spacer);
  }
  inner.style.transform = `translateX(${-(x0 - c0 * stride)}px)`;
  /* A passage in hand is not part of the page. */
  inner.querySelectorAll(".sel").forEach(el => el.classList.remove("sel"));
  copy.appendChild(inner);
  return copy;
}

/* The layer the sheets are laid in, over the page: its layout is its own
   (styles.css .rd-leaves), so a sheet put in or taken out is never a reason
   to lay the section's columns out again. Made once per stage. */
function leafLayer(stage){
  let layer = stage.querySelector(":scope > .rd-leaves");
  if(!layer){
    layer = document.createElement("div");
    layer.className = "rd-leaves";
    layer.setAttribute("aria-hidden", "true");
    stage.appendChild(layer);
  }
  return layer;
}

function shadeStrip(cls){
  const el = document.createElement("div");
  el.className = `rd-shade ${cls}`;
  return el;
}

/**
 * @param dir       +1 forward (the right-hand page's corner lifts), -1 back
 * @param opts.top  lift the top corner rather than the bottom one
 * @param opts.to   the page the sheet turns to, when it is in this chapter:
 *                  its print is copied now, and the sheet is complete at once
 * @param opts.warm build the sheet hidden, to be taken up later by a turn
 */
function buildLeaf(dir, opts = {}){
  const host = $("#rd-prose");
  const stage = host.parentElement;
  const r = host.getBoundingClientRect(), pr = stage.getBoundingClientRect();
  const W = r.width, H = r.height;
  const mode = S.readTurn === "slide" ? "slide" : "curl";
  const next = dir > 0;
  const two = R.per === 2;
  /* The sheet that turns: the whole page, or one side of the spread. */
  const pageX = two ? (next ? W / 2 : 0) : 0, pageW = two ? W / 2 : W;
  const spineX = next ? pageX : pageX + pageW;

  const el = (cls, style) => { const d = document.createElement("div"); d.className = cls; if(style) Object.assign(d.style, style); return d; };
  const px = v => `${v}px`;

  const root = el("rd-leaf", {left: px(r.left - pr.left), top: px(r.top - pr.top), width: px(W), height: px(H)});
  root.dataset.dir = next ? "next" : "prev";
  root.dataset.mode = mode;
  root.setAttribute("aria-hidden", "true");
  /* A sheet made ready is drawn, invisibly, so that taking it up costs no
     painting — except the one for turning back, which waits undrawn. */
  if(opts.warm) root.classList.add("warm");
  if(opts.warm && !next) root.classList.add("cold");

  /* The front: the page being left, whole. */
  const front = el("rd-front");
  const copy = visibleCopy(host);
  const sFront = shadeStrip("front");
  front.append(copy, sFront);

  /* A cutter is a square with one edge along the fold, centred on the
     fold's midpoint, reaching a little over a diagonal each way along it
     and a diagonal deep — so wherever the fold lies it still covers every
     corner of the page. Any bigger and it is only a bigger layer for the
     GPU to hold: the first version was four diagonals, which on a tablet
     is a texture of over six thousand pixels a side. */
  const D = Math.hypot(W, H), SZ = Math.ceil(2.2 * D);
  const cutter = () => el("rd-cut", {width: px(SZ), height: px(SZ)});

  /* Under: the page being turned to, within the turning page's box, cut to
     the lifted side of the fold. Its print arrives with fillFlap(). */
  const under = el("rd-under", {left: px(pageX), width: px(pageW), height: px(H)});
  const underCut = cutter(), underIn = el("rd-in");
  const sUnder = shadeStrip("under");
  underIn.appendChild(sUnder);
  underCut.appendChild(underIn); under.appendChild(underCut);

  /* The flap: cut to the far side of the fold, holding the verso box — the
     turning page's mirror image across the spine, which the rotation then
     carries onto the fold — with the print, a wash of paper, and the fold's
     own shadow inside it. */
  const versoLeft = 2 * spineX - (pageX + pageW);
  const flap = el("rd-flap");
  const flapCut = cutter(), flapIn = el("rd-in");
  const verso = el("rd-verso", {left: px(versoLeft), width: px(pageW), height: px(H)});
  const paper = el("rd-paper");
  const sFlap = shadeStrip("flap");
  verso.append(paper, sFlap);
  flapIn.appendChild(verso); flapCut.appendChild(flapIn); flap.appendChild(flapCut);

  root.append(front, under, flap);
  leafLayer(stage).appendChild(root);

  /* The strips are as long as they will ever need to be, once. Their heights
     are read here, once, rather than on every frame of the turn; from here
     on they move by transform alone, never by left or top, so a frame of
     the turn is compositor work and no layout. */
  const L = D * 1.2;
  const strips = {under: sUnder, front: sFront, flap: sFlap};
  const stripH = {};
  for(const [k, strip] of Object.entries(strips)){
    strip.style.width = px(2 * L);
    strip.style.left = "0"; strip.style.top = "0";
    stripH[k] = strip.offsetHeight;
  }

  const leaf = {root, front, under, underCut, underIn, flap, flapCut, flapIn, verso, strips, stripH,
                W, H, D, SZ, L, pageX, pageW, two, mode, next, spineX, versoLeft, dir, p: 0, c: null,
                chapter: R.chapter, page: R.page};
  setCorner(leaf, !!opts.top);
  if(mode === "slide"){ under.remove(); flap.remove(); }
  /* The print of the page being turned to, on the under-layer and the
     verso: one copy, cloned, because the two show the same page. Given the
     page now when it is in this chapter; otherwise the caller fills it once
     the next chapter is laid out under the sheet. */
  leaf.fillFlap = (page = R.page) => {
    if(mode === "slide" || leaf.filled) return;
    leaf.filled = true;
    const fresh = visibleCopy($("#rd-prose"), page);
    Object.assign(fresh.style, {width: px(W), height: px(H)});
    const forUnder = fresh.cloneNode(true);
    underIn.prepend(forUnder);
    /* The print's stage origin sits at content x = 0 in a spread — the box
       is one side of it — and a page over on a single page, where the box
       is the page's mirror image off the stage: either way, at the box's
       left edge less the box's own offset. */
    fresh.style.left = px((two ? 0 : versoLeft) - versoLeft);
    verso.prepend(fresh);
  };
  if(opts.to != null) leaf.fillFlap(opts.to);
  return leaf;
}

/* Which corner the sheet lifts by is the hand's choice, made at the moment
   of the press — so it is set apart from the building, and can be set on a
   sheet built earlier. */
function setCorner(leaf, top){
  const {H, next, pageX, pageW, spineX} = leaf;
  leaf.top = top;
  leaf.P0 = {x: next ? pageX + pageW : pageX, y: top ? 0 : H};
  leaf.A  = {x: spineX, y: top ? 0 : H};
  leaf.A2 = {x: spineX, y: top ? H : 0};
}

/* ---- the sheet, made ready before it is wanted ----
 *
 * Building the sheet is the expensive part of a turn: the page on screen is
 * copied, the page being turned to is copied twice, and all of it is laid
 * out — a few hundred word buttons in columns, three times over — before
 * the first frame of the fold can be drawn. Done at the moment the finger
 * moves, on a tablet, that is a third of a second of nothing happening and
 * then a fold that leaps to the hand. So it is done beforehand: once a page
 * has settled, in the idle time after it, a sheet for turning forward and
 * one for turning back are built and kept hidden, laid out and complete,
 * and a turn takes one up and shows it. Anything that changes the page
 * under them throws them away; the next idle moment builds them again. A
 * turn that runs into another chapter has no page to copy yet and is built
 * on the spot as before. */
const WARM = {leaves: {}, key: "", timer: 0};

function warmKey(){
  const host = $("#rd-prose");
  return [R.chapter, R.page, R.per, R.colW, R.gap, S.readRuby, S.readTint, S.readMark, S.readSize,
          S.readTurn, host ? host.clientWidth : 0, host ? host.clientHeight : 0].join(":");
}
function dropWarm(){
  for(const k of Object.keys(WARM.leaves)){ WARM.leaves[k].root.remove(); delete WARM.leaves[k]; }
  WARM.key = "";
}
function scheduleWarm(delay = 260){
  clearTimeout(WARM.timer);
  WARM.timer = setTimeout(() => {
    const go = () => safely("prepare the page turn", warmLeaves);
    if(typeof requestIdleCallback === "function") requestIdleCallback(go, {timeout: 600}); else go();
  }, delay);
}
function warmLeaves(){
  const host = $("#rd-prose");
  if(!R.book || !host || !host.offsetParent || S.readTurn === "none") return;
  /* Not while a sheet is in hand: the page under it is about to change.
     Nor while a book is opening: a sheet is tens of milliseconds of layout,
     and the opening's frames are the one thing the page is for then. */
  if(TURN.leaf || TURN.busy || TURN.drag){ scheduleWarm(300); return; }
  if(openBookFrom.busy){ scheduleWarm(500); return; }
  const key = warmKey();
  if(WARM.key !== key) dropWarm();
  WARM.key = key;
  /* One sheet per idle moment, forward first — two at once is a pause a
     reader can feel just after the page has landed. */
  for(const dir of [1, -1]){
    if(WARM.leaves[dir]) continue;
    const to = R.page + dir;
    if(to < 0 || to >= R.pages) continue;   // the next chapter: built when it is turned to
    WARM.leaves[dir] = buildLeaf(dir, {to, warm: true});
    if(!WARM.leaves[-dir] && R.page - dir >= 0 && R.page - dir < R.pages) scheduleWarm(120);
    return;
  }
}

/* The sheet for a turn: the one made ready, if it is still the right one,
   or one built now. */
function makeLeaf(dir, opts = {}){
  const warm = WARM.leaves[dir];
  if(warm && WARM.key === warmKey()){
    delete WARM.leaves[dir];
    warm.root.classList.remove("warm", "cold");
    setCorner(warm, !!opts.top);
    return warm;
  }
  return buildLeaf(dir, opts);
}

/* Where the corner goes when a clock, not a hand, is turning the page: from
   its resting place across to the mirror position on the far side of the
   spine, lifting toward the middle of the page on the way. */
function cornerAt(leaf, p){
  const {H, top, next, P0, pageW} = leaf;
  const x = next ? P0.x - 2 * pageW * p : P0.x + 2 * pageW * p;
  const lift = H * 0.18 * Math.sin(p * Math.PI);
  return {x, y: top ? lift : H - lift};
}

/* Keeps the corner somewhere a real page could reach: no further from
   either spine corner than the paper is long. */
function reachable(leaf, c){
  const {P0, A, A2} = leaf;
  const pin = (a, maxLen) => {
    const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy);
    if(len > maxLen){ const k = maxLen / len; c = {x: a.x + dx * k, y: a.y + dy * k}; }
  };
  pin(A, Math.hypot(P0.x - A.x, P0.y - A.y));
  pin(A2, Math.hypot(P0.x - A2.x, P0.y - A2.y));
  return c;
}

/* 2-D affine maps as CSS matrix() tuples [a,b,c,d,e,f]. */
const AFF = {
  mul: (P, Q) => [P[0] * Q[0] + P[2] * Q[1], P[1] * Q[0] + P[3] * Q[1],
                  P[0] * Q[2] + P[2] * Q[3], P[1] * Q[2] + P[3] * Q[3],
                  P[0] * Q[4] + P[2] * Q[5] + P[4], P[1] * Q[4] + P[3] * Q[5] + P[5]],   // P after Q
  inv: ([a, b, c, d, e, f]) => {
    const det = a * d - b * c, ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
    return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
  },
  T: (x, y) => [1, 0, 0, 1, x, y],
  css: m => `matrix(${m.map(v => +v.toFixed(5)).join(",")})`,
};

/* The cutter for one side of the fold through M with unit normal n: a square
   of side SZ with its top edge along the fold, its body on the side where
   (X - M)·n has the sign of `side`, laid as a rotation (never a reflection,
   so the print inside is never mirrored by the layout). */
function cutFor(M, n, side, SZ){
  const xa = side < 0 ? {x: -n.y, y: n.x} : {x: n.y, y: -n.x};
  const ya = {x: side * n.x, y: side * n.y};
  return [xa.x, xa.y, ya.x, ya.y, M.x - xa.x * SZ / 2, M.y - xa.y * SZ / 2];
}

/* Lays the sheet out for a corner at c. Transforms and opacities only. */
function setLeafPoint(leaf, c){
  const {W, H, P0, mode, next, pageX, pageW, SZ, L, spineX, versoLeft, strips, stripH} = leaf;
  if(mode === "slide"){
    const p = clamp(next ? (P0.x - c.x) / (2 * pageW) : (c.x - P0.x) / (2 * pageW), 0, 1);
    leaf.p = p; leaf.c = c;
    leaf.front.style.transform = `translateX(${(next ? -1 : 1) * p * 100}%)`;
    return;
  }
  c = reachable(leaf, c);
  leaf.c = c;
  leaf.p = clamp(next ? (P0.x - c.x) / (2 * pageW) : (c.x - P0.x) / (2 * pageW), 0, 1);

  const dx = c.x - P0.x, dy = c.y - P0.y;
  const len = Math.hypot(dx, dy);
  if(len < 0.5){
    leaf.under.style.visibility = "hidden";
    leaf.flap.style.visibility = "hidden";
    for(const strip of Object.values(strips)) strip.style.opacity = "0";
    return;
  }
  leaf.under.style.visibility = "";
  leaf.flap.style.visibility = "";
  const n = {x: dx / len, y: dy / len};                 // toward the corner's new place
  const M = {x: (P0.x + c.x) / 2, y: (P0.y + c.y) / 2};

  /* The lifted side, inside the turning page's box. */
  const cutMinus = cutFor(M, n, -1, SZ);
  leaf.underCut.style.transform = AFF.css(AFF.mul(AFF.T(-pageX, 0), cutMinus));
  leaf.underIn.style.transform = AFF.css(AFF.inv(cutMinus));

  /* The far side, holding the verso carried across the spine (Ms) and then
     across the fold (Rf): the verso box lands on the page's reflection, and
     the cutter trims it to the reflection of the lifted part. */
  const a = 1 - 2 * n.x * n.x, b = -2 * n.x * n.y, d = 1 - 2 * n.y * n.y;
  const Rf = [a, b, b, d, M.x - (a * M.x + b * M.y), M.y - (b * M.x + d * M.y)];
  const Ms = [-1, 0, 0, 1, 2 * spineX, 0];
  const cutPlus = cutFor(M, n, 1, SZ);
  leaf.flapCut.style.transform = AFF.css(cutPlus);
  leaf.flapIn.style.transform = AFF.css(AFF.mul(AFF.mul(AFF.inv(cutPlus), Rf), Ms));

  /* The shadows lie along the fold, strongest mid-turn when the sheet stands
     highest, fading as it lies down on either side. The under and front
     strips are in page space. The flap's rides inside the verso box, whose
     space is the page's mirror across the spine: the fold sits at Ms(M)
     there, and the strip's downward side must come out on the lifted side
     of the fold once Rf·Ms has turned it, which puts it at atan2(n.x, n.y). */
  const lift = Math.sin(clamp(leaf.p, 0, 1) * Math.PI);
  const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
  const fade = k => ((k === "under" || k === "flap") ? 0.9 : 0.55) * (0.3 + 0.7 * lift);
  for(const k of ["under", "front"]){
    const strip = strips[k];
    strip.style.transform = `translate(${(M.x - L).toFixed(2)}px, ${(M.y - stripH[k] / 2).toFixed(2)}px) rotate(${ang.toFixed(3)}deg)`;
    strip.style.opacity = fade(k);
  }
  const sf = strips.flap;
  sf.style.transform = `translate(${((2 * spineX - M.x) - versoLeft - L).toFixed(2)}px, ${(M.y - stripH.flap / 2).toFixed(2)}px) rotate(${(Math.atan2(n.x, n.y) * 180 / Math.PI).toFixed(3)}deg)`;
  sf.style.opacity = fade("flap");
}

function setLeaf(leaf, p){
  p = clamp(p, 0, 1);
  setLeafPoint(leaf, cornerAt(leaf, p));
  leaf.p = p;
}

function dropLeaf(){
  if(TURN.leaf){ TURN.leaf.root.remove(); TURN.leaf = null; }
  document.body.classList.remove("turning");
  TURN.busy = false;
  TURN.arc = null;
  if(R.chromeLate) paintPageChrome();
  scheduleWarm();
}

/* Carries the corner from where the hand left it to where it comes to rest. */
function glideLeaf(leaf, toP, ms){
  return new Promise(resolve => {
    const from = leaf.c || cornerAt(leaf, leaf.p);
    const to = cornerAt(leaf, toP);
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    let done = false;
    const finish = () => { if(done) return; done = true; setLeaf(leaf, toP); resolve(); };
    const step = now => {
      if(done) return;
      const t = Math.min(1, (now - t0) / ms), k = ease(t);
      setLeafPoint(leaf, {x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k});
      if(t < 1) requestAnimationFrame(step); else finish();
    };
    requestAnimationFrame(step);
    setTimeout(finish, ms + 120);   // frames stop in a hidden tab; the turn must still land
  });
}

/* Along the arc, on a clock: for a button or a key. The page answers at
   once — it is already moving on the first frame, the way a page flicked
   from the corner is — and slows as it lands. A second press while it is
   still going over lands it there and then (TURN.arc), so paging quickly
   is never a press that goes unheard. */
function arcLeaf(leaf, ms){
  return new Promise(resolve => {
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 2.6);
    let done = false;
    const finish = () => { if(done) return; done = true; setLeaf(leaf, 1); resolve(); };
    TURN.arc = {finish};
    const step = now => {
      if(done) return;
      const t = Math.min(1, (now - t0) / ms);
      setLeaf(leaf, ease(t));
      if(t < 1) requestAnimationFrame(step); else finish();
    };
    requestAnimationFrame(step);
    setTimeout(finish, ms + 120);
  });
}

async function turnPage(dir){
  /* A press while a page is still going over: that one lands now, and this
     one turns the next. (A page in the hand is the hand's.) */
  if(TURN.busy && TURN.arc && !TURN.drag){
    TURN.arc.finish();
    for(let i = 0; i < 20 && TURN.busy; i++) await new Promise(r => setTimeout(r, 0));
  }
  if(TURN.busy || !canTurn(dir)) return;
  const still = S.readTurn === "none" || document.hidden || REDUCED();
  if(still){ await goPage(dir); return; }
  TURN.busy = true;
  document.body.classList.add("turning");
  const leaf = TURN.leaf = makeLeaf(dir);
  setLeaf(leaf, 0);
  await goPage(dir);
  leaf.fillFlap();
  await arcLeaf(leaf, 460);
  dropLeaf();
}

/* Holding the corner. Bound on the page; decides after a few pixels whether
   the pointer means a turn (sideways) or a word (not). The corner the sheet
   lifts by is the one nearer the hand. */
function bindPageSwipe(){
  const host = $("#rd-prose");
  if(!host) return;
  const SLOP = 10;

  host.addEventListener("pointerdown", e => {
    if(TURN.busy || !R.book || e.button > 0) return;
    const r = host.getBoundingClientRect();
    TURN.drag = {id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(),
                 lastX: e.clientX, lastT: performance.now(), v: 0,
                 decided: false, dir: 0, rect: r, chapter: R.chapter, page: R.page};
  });

  host.addEventListener("pointermove", e => {
    const d = TURN.drag;
    if(!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if(!d.decided){
      /* Decided on the sideways component alone. A corner is taken up on a
         diagonal — a thumb lifts before it pulls — and the page has nothing
         to scroll, so an early vertical move is waited out, not refused. */
      if(Math.abs(dx) < SLOP) return;
      const dir = dx < 0 ? 1 : -1;
      if(!canTurn(dir) || S.readTurn === "none"){ TURN.drag = null; return; }
      d.decided = true; d.dir = dir;
      if(typeof clearDwell === "function") clearDwell();
      closeGloss();
      if(window.getSelection) getSelection().removeAllRanges();
      try{ host.setPointerCapture(e.pointerId); }catch(_){}
      TURN.busy = true;
      document.body.classList.add("turning");
      const top = (d.y0 - d.rect.top) < d.rect.height / 2;
      const leaf = TURN.leaf = makeLeaf(dir, {top});
      d.grab = {x: (d.x0 - d.rect.left) - leaf.P0.x, y: (d.y0 - d.rect.top) - leaf.P0.y};
      setLeaf(leaf, 0);
      /* The next page, under the sheet, while it is flat — then onto the back. */
      goPage(dir).then(() => { if(TURN.leaf === leaf) leaf.fillFlap(); });
      return;
    }
    e.preventDefault();
    const now = performance.now();
    d.v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
    d.lastX = e.clientX; d.lastT = now;
    /* A pen or a fast screen reports far more moves than there are frames;
       the sheet is laid out once per frame, for the latest of them. */
    d.at = {x: (e.clientX - d.rect.left) - d.grab.x, y: (e.clientY - d.rect.top) - d.grab.y};
    if(!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if(TURN.drag === d && TURN.leaf) setLeafPoint(TURN.leaf, d.at); });
  });

  const finish = e => {
    const d = TURN.drag;
    if(!d || (e && e.pointerId !== d.id)) return;
    TURN.drag = null;
    if(!d.decided) return;
    const leaf = TURN.leaf;
    if(!leaf){ TURN.busy = false; document.body.classList.remove("turning"); return; }
    if(d.raf){ cancelAnimationFrame(d.raf); d.raf = 0; }
    if(d.at) setLeafPoint(leaf, d.at);
    /* The system taking the pointer away mid-turn — an edge gesture, a palm
       — is treated as the hand letting go where it was: the sheet finishes
       the way it was going, rather than snapping back from wherever it had
       got to. */
    /* A page goes over once it is a fifth of the way, or on a flick with any
       real lift to it. Both were higher, and turning a page felt like work. */
    const flung = (d.dir > 0 ? -d.v : d.v) > 0.3 && leaf.p > 0.04;
    const complete = leaf.p > 0.2 || flung;
    const remaining = complete ? 1 - leaf.p : leaf.p;
    const ms = Math.max(160, Math.min(420, remaining * 560 + 100));
    if(complete){
      glideLeaf(leaf, 1, ms).then(dropLeaf);
    }else{
      /* Settles back; the page it left is put back under it first. */
      const home = d.chapter === R.chapter
        ? Promise.resolve((R.page = d.page, applyPage()))
        : moveChapter(d.chapter - R.chapter, {page: d.page});
      Promise.resolve(home).then(() => glideLeaf(leaf, 0, ms)).then(dropLeaf);
    }
  };
  host.addEventListener("pointerup", finish);
  host.addEventListener("pointercancel", finish);
  /* A page in hand selects nothing. (Refused here, as it starts, rather
     than by a rule over the column: see styles.css .rd-leaf.) */
  host.addEventListener("selectstart", e => { if(TURN.drag || TURN.busy) e.preventDefault(); });
  host.addEventListener("click", e => {
    if(R.swipedAt && performance.now() - R.swipedAt < 400){ e.stopPropagation(); e.preventDefault(); }
  }, true);
  host.addEventListener("pointerup", () => { if(TURN.leaf || TURN.busy) R.swipedAt = performance.now(); }, true);
}

/* ---------------- selecting a passage ---------------- */
/* A word is one tap; a passage is a hold.
 *
 * Hold a word — a finger, a pen, a mouse button — and after a moment it
 * lights up: the passage is in hand. Move, and the highlight runs with the
 * pointer through the words, the commas and the paragraph breaks, in either
 * direction, until you let go. What you let go of is a passage, and a card
 * beside it offers what can be done with one: read it in pinyin, take it
 * apart word by word from the syllabus, hear it, copy it — and translate it,
 * which is the one thing that has to leave the device. Nothing is sent
 * until the button is pressed.
 *
 * The hold is what keeps the three gestures on the page apart, and it is
 * the same gesture under a finger, a pen and a mouse. A tap is a word's
 * writing card. A drag that starts moving at once is a page turn. A press
 * that stays put for HOLD_MS is a selection: the word lights up and is
 * selected, with its meaning on the card, and the turn is off for this
 * press. Let go and the word stands selected with a handle at each end, as
 * text does on a phone; drag either handle to set where the passage starts
 * and ends, or keep holding after the hold and sweep. The hold that used to
 * open a word's card is this now — the card it opens carries the meaning
 * too, and can grow into a passage. Resting a mouse on a word without
 * pressing still opens the word's own card. */
const HOLD_MS = 400;
const SEL = {
  hold: 0,          // the timer between the press and the passage lighting up
  press: null,      // the press being watched: {id, x, y, at:{b,i}}
  anchor: null,     // where the selection began, {b, i}
  focus: null,      // where it has reached, {b, i}
  els: [],          // the marked elements, so unmarking does not walk the page
  live: false,      // pointer still down
  map: null,        // the tokens on the page, with their boxes, for the drag
  hdrag: null,      // a handle being dragged: {id, which, el}
  text: "",
  pinyin: false,    // the card's pinyin line, shown or not
};
const selectionActive = () => !!SEL.anchor;

/* The tokens on the page — the ones whose boxes fall inside the page's
   frame — with their boxes, gathered once when a selection begins. Only
   these can be selected. The chapter is one row of columns with the other
   pages laid out just past the frame's edges, clipped from view but not
   from hit-testing, and an engine asked for the caret nearest a point in
   this frame has been seen to answer with a line from a page not on it; so
   nothing is asked of the engine, and the nearest token is found by
   measuring these boxes. */
function pageTokens(){
  const host = $("#rd-prose");
  if(!host) return [];
  const box = host.getBoundingClientRect();
  const out = [];
  const touches = r => r.width && r.right > box.left + 1 && r.left < box.right - 1;
  $("#rd-cols").querySelectorAll(".blk[data-b]").forEach(blk => {
    /* A paragraph with no fragment on the page has no token on it either,
       and a chapter is mostly such paragraphs. */
    if(![...blk.getClientRects()].some(touches)) return;
    const b = +blk.dataset.b;
    blk.querySelectorAll("[data-i]").forEach(el => {
      const r = el.getBoundingClientRect();
      if(!r.width || r.right <= box.left + 1 || r.left >= box.right - 1 || r.bottom <= box.top || r.top >= box.bottom) return;
      out.push({b, i: +el.dataset.i, el, r});
    });
  });
  return out;
}

/* The token nearest a point, the way text selection reads a pointer
   everywhere: the line the point is on — or the nearest line, for a point
   in the gap between paragraphs or off the page altogether — and on that
   line the token under the pointer, or the last one when the pointer has
   run past the end of the line. In a spread, a point in the gutter goes
   to whichever page is nearer. */
function nearestToken(x, y){
  const list = SEL.map || [];
  let best = null, bestDy = Infinity, bestDx = Infinity;
  for(const t of list){
    const dy = y < t.r.top ? t.r.top - y : y > t.r.bottom ? y - t.r.bottom : 0;
    if(dy > bestDy + 0.5) continue;
    const dx = x < t.r.left ? t.r.left - x : x > t.r.right ? x - t.r.right : 0;
    if(dy < bestDy - 0.5 || dx < bestDx){ best = t; bestDy = dy; bestDx = dx; }
  }
  return best ? {b: best.b, i: best.i} : null;
}

/* The token an element belongs to, for the press that starts it all. */
function tokenOf(el){
  const tok = el && el.closest ? el.closest("#rd-cols [data-i]") : null;
  const blk = tok && tok.closest(".blk[data-b]");
  return blk ? {b: +blk.dataset.b, i: +tok.dataset.i} : null;
}

const before = (a, b) => a.b < b.b || (a.b === b.b && a.i <= b.i);
const samePlace = (a, b) => a.b === b.b && a.i === b.i;
function selBounds(){
  return before(SEL.anchor, SEL.focus) ? [SEL.anchor, SEL.focus] : [SEL.focus, SEL.anchor];
}

/* Mark every token between the two ends, across paragraphs. */
function paintSelection(){
  SEL.els.forEach(el => el.classList.remove("sel"));
  SEL.els = [];
  if(!SEL.anchor || !SEL.focus) return;
  const [s, e] = selBounds();
  for(let b = s.b; b <= e.b; b++){
    const blk = $(`#rd-cols .blk[data-b="${b}"]`);
    if(!blk) continue;
    const lo = b === s.b ? s.i : 0, hi = b === e.b ? e.i : Infinity;
    blk.querySelectorAll("[data-i]").forEach(el => {
      const i = +el.dataset.i;
      if(i >= lo && i <= hi){ el.classList.add("sel"); SEL.els.push(el); }
    });
  }
}

/* The tokens of the selection, paragraph by paragraph. */
function selectedTokens(){
  if(!SEL.anchor || !SEL.focus) return [];
  const [s, e] = selBounds();
  const paras = [];
  for(let b = s.b; b <= e.b; b++){
    const toks = R.tokens[b];
    if(!toks) continue;
    const lo = b === s.b ? s.i : 0, hi = b === e.b ? e.i : toks.length - 1;
    paras.push(toks.slice(lo, hi + 1));
  }
  return paras;
}
const selectedText = () => selectedTokens().map(p => p.map(t => t.w).join("").trim()).filter(Boolean).join("\n");
/* Characters, not tokens: what the reader would count. */
const hanziCount = text => (text.match(/[㐀-鿿豈-﫿]/g) || []).length;

function startSelection(at){
  SEL.anchor = at; SEL.focus = at; SEL.live = true;
  SEL.map = pageTokens();
  document.body.classList.add("selecting");
  /* The hold is spoken for: the word's own hold-to-open card stands aside. */
  if(typeof clearDwell === "function") clearDwell();
  closeGloss();
  paintSelection();
  if(navigator.vibrate) try{ navigator.vibrate(12); }catch(_){}
}

/* The passage as it stands once the pointer is up: the marks stay, a handle
   sits at each end, and the card opens beside it. A selection with no
   character in it — a hold on a comma — is nothing, and goes. */
function settleSelection(){
  const text = selectedText();
  if(!hanziCount(text)){ clearSelection(); return; }
  /* The click this release produces is not a tap on a word. */
  R.swipedAt = performance.now();
  SEL.text = text;
  openSelectionCard();
  placeHandles();
}

/* Everything back the way it was: the marks, the card, the timers. Safe to
   call at any time — every page change does. */
function clearSelection(){
  clearTimeout(SEL.hold); SEL.hold = 0; SEL.press = null;
  const had = !!SEL.anchor;
  SEL.anchor = SEL.focus = null; SEL.live = false; SEL.text = ""; SEL.map = null; SEL.hdrag = null;
  SEL.els.forEach(el => el.classList.remove("sel"));
  SEL.els = [];
  document.body.classList.remove("selecting");
  const card = $("#rd-sel");
  if(card){ card.classList.remove("on"); card.setAttribute("aria-hidden", "true"); }
  $$(".rd-handle").forEach(h => { h.hidden = true; });
  return had;
}

function bindSelection(){
  const host = $("#rd-prose");
  if(!host) return;
  /* The same tolerance as the page turn's: a finger resting for the hold
     drifts, and a drift is not a drag. */
  const SLOP = 10;

  host.addEventListener("pointerdown", e => {
    if(TURN.busy || !R.book || e.button > 0) return;
    /* A press with a passage already in hand puts it away, and the tap it
       is does nothing more — the same as a press outside a word card. The
       hold that may follow starts a fresh selection. */
    if(SEL.anchor && !SEL.live){ clearSelection(); R.swipedAt = performance.now(); }
    const at = tokenOf(e.target);
    if(!at) return;
    clearTimeout(SEL.hold);
    SEL.press = {id: e.pointerId, x: e.clientX, y: e.clientY, at};
    SEL.hold = setTimeout(() => {
      SEL.hold = 0;
      const p = SEL.press;
      if(!p || TURN.busy || (TURN.drag && TURN.drag.decided)) return;
      /* From here the press is a selection, not a turn. */
      TURN.drag = null;
      try{ host.setPointerCapture(p.id); }catch(_){}
      startSelection(p.at);
    }, HOLD_MS);
  });

  host.addEventListener("pointermove", e => {
    const p = SEL.press;
    if(!p || e.pointerId !== p.id) return;
    if(!SEL.live){
      /* Moving off before the hold is up is a turn, not this. */
      if(Math.abs(e.clientX - p.x) > SLOP || Math.abs(e.clientY - p.y) > SLOP){
        clearTimeout(SEL.hold); SEL.hold = 0; SEL.press = null;
      }
      return;
    }
    e.preventDefault();
    const at = nearestToken(e.clientX, e.clientY);
    if(!at || samePlace(at, SEL.focus)) return;
    SEL.focus = at;
    paintSelection();
  });

  const finish = e => {
    const p = SEL.press;
    if(!p || (e && e.pointerId !== p.id)) return;
    clearTimeout(SEL.hold); SEL.hold = 0; SEL.press = null;
    if(!SEL.live) return;
    SEL.live = false;
    try{ host.releasePointerCapture(p.id); }catch(_){}
    settleSelection();
  };
  host.addEventListener("pointerup", finish);
  host.addEventListener("pointercancel", finish);
  /* Losing the pointer to the system mid-selection keeps what was selected. */
  host.addEventListener("lostpointercapture", e => { if(SEL.live) finish(e); });

  /* The long press is a selection, not a request for the browser's menu. */
  host.addEventListener("contextmenu", e => {
    if(SEL.press || SEL.anchor) e.preventDefault();
  });

  /* A press anywhere but the card or the page puts the passage away. Caught
     on the document in the capture phase, like the word cards, so a press
     on a dialog's backdrop or a toolbar button counts. */
  document.addEventListener("pointerdown", e => {
    if(!SEL.anchor || SEL.live) return;
    if(e.target.closest("#rd-sel, #rd-prose, .rd-handle")) return;
    clearSelection();
  }, true);

  addEventListener("resize", () => { if(SEL.anchor && !SEL.live){ placeSelectionCard(); placeHandles(); } });

  bindHandles();
  bindSelectionCard();
}

/* ---- the handles ---- */
/* One at each end of the passage, hanging under the line the way a phone
   draws them: a drop with its point at the edge of the text. Dragging one
   moves that end; drag it past the other and they change places. Made once
   and kept, hidden when there is nothing to hold. */
function bindHandles(){
  const make = which => {
    const h = document.createElement("div");
    h.className = "rd-handle"; h.dataset.which = which; h.hidden = true;
    h.setAttribute("aria-hidden", "true");
    document.body.appendChild(h);
    return h;
  };
  const hs = make("s"), he = make("e");

  const down = e => {
    if(!SEL.anchor || SEL.live || e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const which = e.currentTarget.dataset.which;
    const [s, en] = selBounds();
    /* The end in hand moves; the other stays put as the anchor. */
    SEL.anchor = which === "s" ? en : s;
    SEL.focus = which === "s" ? s : en;
    SEL.hdrag = {id: e.pointerId, which, el: e.currentTarget};
    if(!SEL.map) SEL.map = pageTokens();
    try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
    document.body.classList.add("selecting");
    const card = $("#rd-sel");
    if(card){ card.classList.remove("on"); card.setAttribute("aria-hidden", "true"); }
  };
  const move = e => {
    const d = SEL.hdrag;
    if(!d || e.pointerId !== d.id) return;
    e.preventDefault();
    /* The handle hangs below its line, so the finger on it is below the
       text it is moving: aim a little above the finger. */
    const at = nearestToken(e.clientX, e.clientY - 22);
    if(!at || samePlace(at, SEL.focus)) return;
    SEL.focus = at;
    paintSelection();
    placeHandles();
  };
  const up = e => {
    const d = SEL.hdrag;
    if(!d || (e && e.pointerId !== d.id)) return;
    SEL.hdrag = null;
    try{ d.el.releasePointerCapture(d.id); }catch(_){}
    document.body.classList.remove("selecting");
    settleSelection();
  };
  for(const h of [hs, he]){
    h.addEventListener("pointerdown", down);
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
    h.addEventListener("lostpointercapture", e => { if(SEL.hdrag) up(e); });
    h.addEventListener("contextmenu", e => e.preventDefault());
  }
}

/* The handles go to the first and last marked boxes on the page; an end
   that has run off the page has no handle. */
function placeHandles(){
  const hs = $('.rd-handle[data-which="s"]'), he = $('.rd-handle[data-which="e"]');
  const host = $("#rd-prose");
  if(!hs || !he || !host) return;
  if(!SEL.anchor || SEL.live){ hs.hidden = he.hidden = true; return; }
  const box = host.getBoundingClientRect();
  const onPage = r => r.width && r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top && r.top < box.bottom;
  const rects = SEL.els.map(el => el.getBoundingClientRect()).filter(onPage);
  if(!rects.length){ hs.hidden = he.hidden = true; return; }
  const first = rects[0], last = rects[rects.length - 1];
  hs.hidden = false; he.hidden = false;
  hs.style.left = `${Math.round(first.left)}px`;  hs.style.top = `${Math.round(first.bottom - 4)}px`;
  he.style.left = `${Math.round(last.right)}px`;  he.style.top = `${Math.round(last.bottom - 4)}px`;
}

/* Where the card goes: beside the passage, below it where there is room,
   above it otherwise — the same placement as a word's card, anchored to the
   box the marked words fill on the page rather than to one word. Only the
   marks on the page count: a passage that runs onto the next page is
   anchored to the part of it that is showing. */
function selectionRect(){
  const host = $("#rd-prose");
  if(!host) return null;
  const box = host.getBoundingClientRect();
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for(const el of SEL.els){
    for(const rc of el.getClientRects()){
      if(rc.width === 0 && rc.height === 0) continue;
      if(rc.right < box.left || rc.left > box.right || rc.bottom < box.top || rc.top > box.bottom) continue;
      l = Math.min(l, rc.left); t = Math.min(t, rc.top);
      r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
    }
  }
  if(l === Infinity) return null;
  return {left: l, top: t, right: r, bottom: b, width: r - l, height: b - t};
}

function placeSelectionCard(){
  const card = $("#rd-sel"), host = $("#rd-prose");
  let rect = selectionRect();
  if(!card || !rect || !host){ clearSelection(); return; }
  /* A passage that fills most of the page leaves the card no room beside
     it, and beside the middle of it is beside nothing in particular. It is
     anchored instead to the line the pointer let go on, where the eye is —
     the card then covers only text that is already repeated inside it. */
  if(rect.height > host.clientHeight * 0.45 && SEL.focus){
    const end = $(`#rd-cols .blk[data-b="${SEL.focus.b}"] [data-i="${SEL.focus.i}"]`);
    const rc = end && [...end.getClientRects()].find(r => r.width || r.height);
    if(rc) rect = rc;
  }
  /* The handles hang under the last line; the card goes under them. */
  const room = {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom + 22,
                width: rect.width, height: rect.height + 22};
  placePopover(card, {isConnected: true, getBoundingClientRect: () => room}, {glide: true});
}

/* The languages a passage can be turned into online — the ones Google
   Translate takes by these codes. English first, since the app is in
   English; on the device, English is the one there is. */
const TRANSLATE_TO = [
  ["en", "English"], ["ur", "Urdu"], ["hi", "Hindi"], ["ar", "Arabic"], ["es", "Spanish"],
  ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["ru", "Russian"], ["it", "Italian"],
  ["tr", "Turkish"], ["id", "Indonesian"], ["ms", "Malay"], ["vi", "Vietnamese"], ["th", "Thai"],
  ["ja", "Japanese"], ["ko", "Korean"], ["fa", "Persian"], ["bn", "Bengali"], ["nl", "Dutch"],
  ["pl", "Polish"], ["uk", "Ukrainian"], ["sv", "Swedish"], ["el", "Greek"], ["he", "Hebrew"],
];
const langName = code => (TRANSLATE_TO.find(([c]) => c === code) || TRANSLATE_TO[0])[1];
/* where passages are translated: "auto" (online with a connection, on the
   device without), "google", or "offline" — see runTranslation */
const translator = () => ["google", "offline"].includes(S.readTranslator) ? S.readTranslator : "auto";
const translatorName = () => "Google Translate";

function openSelectionCard(){
  const card = $("#rd-sel"), body = $("#rd-sel-body");
  if(!card || !body) return;
  const text = SEL.text;
  const chars = hanziCount(text);
  const paras = selectedTokens();
  /* The reading, a word at a time; punctuation closes up to the word before
     it, as it does in the text. */
  const pinyin = paras.map(p => p.reduce((acc, t) => {
    if(t.t === "x"){ const x = t.w.trim(); return x ? acc + esc(x) : acc; }
    return acc + (acc ? " " : "") + pinyinHTML(t.p || "");
  }, "")).join("<br>");
  const to = TRANSLATE_TO.some(([c]) => c === S.readTranslateTo) ? S.readTranslateTo : "en";
  /* One word held is a word looked up: its reading, level and senses come
     first, the way the word's own card gives them, before the passage
     tools — a hold on a word used to open that card, and this is what it
     opens now. */
  const words = paras.flat().filter(t => t.t !== "x");
  const one = words.length === 1 ? words[0] : null;
  const senses = one ? (Array.isArray(one.en) ? one.en : one.en ? [one.en] : []) : [];
  const wordHTML = one ? `
    <div class="sl-word">
      <div class="sl-word-h">
        <span class="py">${pinyinHTML(one.p || "")}</span>
        ${one.lv ? lvChip(one.lv) : `<span class="lv">Beyond HSK</span>`}
      </div>
      ${senses.length ? `<ol class="defs sl-defs">${senses.slice(0, 4).map((m, i) =>
          `<li><span class="n">${i + 1}</span><span>${esc(m)}</span></li>`).join("")}</ol>`
        : `<p class="pmeta" style="margin:0">No entry in the syllabus.</p>`}
    </div>` : "";

  body.innerHTML = `
    <div class="sl-head">
      <span class="lbl">${one ? "Word" : `Selected · ${num(chars)} character${chars === 1 ? "" : "s"}`}</span>
      <button class="mini sl-x" data-selclose aria-label="Clear the selection" title="Clear the selection (Esc)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="sl-text hz ${one ? "sl-one" : ""}">${esc(text).replace(/\n/g, "<br>")}</div>
    ${wordHTML}
    <div class="sl-py py ${SEL.pinyin || one ? "hidden" : ""}">${pinyin}</div>
    <div class="sl-acts">
      <button class="btn sm sl-go" data-seltranslate>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h9M8.5 3v2M6 9c1.2 3 3.5 5.6 7 7.5M11 9c-1 3.4-3.6 6.2-7 8"/><path d="M13 21l4.5-11L22 21M14.8 17h5.4"/></svg>
        Translate
      </button>
      ${one ? "" : `<button class="ghost sl-act" data-selpinyin aria-pressed="${SEL.pinyin}">Pinyin</button>`}
      <button class="ghost sl-act" data-selwords aria-pressed="false">Word by word</button>
      <button class="ghost sl-act" data-selcopy>Copy</button>
    </div>
    <div class="sl-il hidden"></div>
    <div class="sl-out hidden" data-selout>
      <div class="sl-out-h">
        <span class="lbl">Into</span>
        ${translator() === "offline" && MT_ENGINES[deviceEngine()].langs.length === 1 ? `<span class="sl-lang-one">English</span>` : `
        <select class="sl-lang" data-sellang aria-label="Translate into">
          ${TRANSLATE_TO.map(([c, n]) => `<option value="${c}" ${c === to ? "selected" : ""}>${n}</option>`).join("")}
        </select>`}
      </div>
      <p class="sl-tr" data-seltr></p>
      <div class="sl-src"><span data-selsrc>${translator() === "offline" || (translator() === "auto" && navigator.onLine === false)
        ? `On this device · ${esc(MT_ENGINES[deviceEngine()].title)}` : translatorName()}</span></div>
    </div>`;
  body.scrollTop = 0;
  card.classList.add("on");
  card.setAttribute("aria-hidden", "false");
  placeSelectionCard();
}

/* The card's own controls. Bound once, read off the target. */
function bindSelectionCard(){
  const card = $("#rd-sel");
  if(!card) return;
  card.addEventListener("click", e => {
    const t = e.target;
    if(t.closest("[data-selclose]")){ clearSelection(); return; }
    if(t.closest("[data-selpinyin]")){
      SEL.pinyin = !SEL.pinyin;
      card.querySelector(".sl-py").classList.toggle("hidden", !SEL.pinyin);
      t.closest("[data-selpinyin]").setAttribute("aria-pressed", String(SEL.pinyin));
      placeSelectionCard();
      return;
    }
    if(t.closest("[data-selwords]")){
      const btn = t.closest("[data-selwords]");
      const host = card.querySelector(".sl-il");
      if(!host.dataset.done){
        /* Paragraphs run on, with a mark where each breaks. */
        const slice = [];
        selectedTokens().forEach((p, k) => { if(k) slice.push({t: "x", w: "¶"}); slice.push(...p); });
        host.innerHTML = interlinearHTML(slice);
        host.dataset.done = "1";
      }
      const hidden = host.classList.toggle("hidden");
      btn.setAttribute("aria-pressed", String(!hidden));
      placeSelectionCard();
      return;
    }
    if(t.closest("[data-selcopy]")){
      copyText(SEL.text).then(ok => toast(ok ? "Copied" : "Could not copy"));
      return;
    }
    if(t.closest("[data-seltranslate]")){ runTranslation(); return; }
    /* the offline model, fetched from the card, and the passage translated
       once it is in */
    if(t.closest("[data-selmt]")){ runTranslation({fetch: true}); return; }
  });
  card.addEventListener("change", e => {
    const sel = e.target.closest("[data-sellang]");
    if(!sel) return;
    S.readTranslateTo = sel.value; save();
    runTranslation();
  });
}

async function copyText(text){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; }
  }catch(_){}
  try{
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }catch(_){ return false; }
}

/* Translating the passage, on the button only. Where it goes is the
   reader's choice (S.readTranslator):
     "auto"    — Google Translate while there is a connection, and the
                 device's own translator when there is none, or when Google
                 cannot be reached; the default.
     "google"  — always online, falling back to the device only if Google
                 cannot be reached.
     "offline" — always on the device; nothing leaves it.
   Online is the one thing in the reader that talks to a server; the answer
   is shown with its source's name on it. Answers are kept for the session,
   so re-reading a passage does not ask twice. */
let translateSeq = 0;
const translateCache = new Map();
async function runTranslation(opts = {}){
  const card = $("#rd-sel");
  if(!card || !SEL.text) return;
  const out = card.querySelector("[data-selout]"), tr = card.querySelector("[data-seltr]");
  const btn = card.querySelector("[data-seltranslate]"), src = card.querySelector("[data-selsrc]");
  /* the card's language, or English where it offers none (on this device) */
  const pickLang = card.querySelector("[data-sellang]");
  const to = pickLang ? pickLang.value || "en" : "en";
  const text = SEL.text, mode = translator();
  const seq = ++translateSeq;
  const live = () => seq === translateSeq && SEL.text === text;
  const show = (cls, html, dir = "ltr") => {
    if(!live()) return;
    tr.className = `sl-tr ${cls}`.trim(); tr.innerHTML = html; tr.dir = dir;
    placeSelectionCard();
  };
  const result = s => esc(s).replace(/\n/g, "<br>");
  const rtl = code => /^(ar|ur|fa|he)$/.test(code) ? "rtl" : "ltr";
  /* On the device: the translator chosen for it — or, when the device is
     only standing in for Google, whichever one it has ready. What is not
     here yet — the browser's English, Compact in the Android app — is
     fetched only when asked, from the card. */
  const onDevice = async (why, standIn) => {
    const id = standIn ? await mtReadyEngine(to) : deviceEngine();
    if(!id){
      /* nothing translated it: say only why Google was not used */
      if(src) src.textContent = "On this device";
      show("err", `${esc(why.split(" — ")[0])}. ${mtNative()
        ? `To translate without a connection, install ${esc(MT_ENGINES.opus.title)} under Translation in the reading settings — ${MT_SIZE}, once.`
        : "No translator on this device is ready — see Translation in the reading settings."}`);
      return;
    }
    const eng = MT_ENGINES[id];
    /* the device translates into English; another language is Google's */
    const into = eng.langs.includes(to) ? to : "en";
    if(src) src.textContent = `On this device · ${eng.title}${eng.by ? ` · ${eng.by}` : ""}`;
    const notes = [why, into === to ? "" : "In English — on this device, passages are translated into English"].filter(Boolean);
    const lead = notes.length ? `<span class="sl-note">${esc(notes.join(". "))}.</span>` : "";
    const key = JSON.stringify(["device", id, into, text]);
    if(translateCache.has(key)){ show("", lead + result(translateCache.get(key)), rtl(into)); return; }
    const ready = await mtEngineReady(id, into);
    if(!ready && id !== "browser"){
      /* Compact: installed on request in the Android app, carried by other copies */
      if((await mtState()) === "missing"){
        show("err", `${lead}${esc(eng.title)} is not in this copy of the app. Choose ${esc(MT_ENGINES.browser.title)} under
          Translation in the reading settings, or use a build made after <code>npm run translation</code>.`);
        return;
      }
      if(!opts.fetch){
        show("err", `${lead}${esc(eng.title)} is not installed on this device yet — ${MT_SIZE}, once.
          <button class="linky" data-selmt>Install it</button>`);
        return;
      }
      if(navigator.onLine === false){ show("err", `${lead}Installing ${esc(eng.title)} needs a connection — ${MT_SIZE}, once.`); return; }
      show("wait", `${lead}Installing ${esc(eng.title)}…`);
      await mtInstall(p => show("wait", `${lead}Installing ${esc(eng.title)}… ${p}%`));
    }
    if(!ready && id === "browser" && !opts.fetch){
      show("err", `${lead}${esc(langName(into))} is not downloaded for ${esc(eng.title)} yet — the browser fetches it once,
        a few megabytes. <button class="linky" data-selmt>Download it</button>`);
      return;
    }
    let done;
    if(id === "browser"){
      show("wait", `${lead}${ready ? "Translating on this device…" : "Downloading the language…"}`);
      done = await btText(text, into, p => show("wait", `${lead}Downloading the language… ${p}%`));
    }else{
      show("wait", `${lead}Opening ${esc(eng.title)}…`);
      await mtLoad(id, MT.loading ? null : p => show("wait", `${lead}Opening ${esc(eng.title)}… ${p}%`));
      done = await mtText(text, id, into, (sofar, n, total) =>
        show("", `${lead}${result(sofar)} <span class="sl-more">${n} of ${total}…</span>`, rtl(into)));
    }
    translateCache.set(key, done);
    show("", lead + result(done), rtl(into));
  };
  out.classList.remove("hidden");
  if(btn) btn.disabled = true;
  try{
    if(mode === "offline"){ await onDevice("", false); return; }
    if(mode === "auto" && navigator.onLine === false){ await onDevice("No connection — translated on this device", true); return; }
    if(src) src.textContent = translatorName("google");
    show("wait", `Translating into ${esc(langName(to))}…`);
    try{
      const done = await translateText(text, to, mode === "auto" ? 7000 : 12000);
      show("", result(done), rtl(to));
    }catch(err){
      if(!live()) return;
      /* Google out of reach: the device stands in, if it has a translator */
      await onDevice(navigator.onLine === false ? "No connection — translated on this device"
        : "Google Translate could not be reached — translated on this device", true);
    }
  }catch(err){
    show("err", `Translation on this device did not work: ${esc(err.message || err)}.
      <button class="linky" data-selmt>Try again</button>`);
  }finally{
    if(live() && btn) btn.disabled = false;
    if(live()) placeSelectionCard();
  }
}

async function translateText(text, to, ms = 12000){
  const key = JSON.stringify(["google", to, text]);
  if(translateCache.has(key)) return translateCache.get(key);
  const result = await googleText(text, to, ms);
  translateCache.set(key, result);
  return result;
}

/* ---- on this device ----
 * Into English, by one of two translators, as the reader picks
 * (S.readOfflineModel; empty means the best this device has):
 *
 *   browser  The browser's own, where it has one — Chrome and Edge on a
 *            computer (the Translator API). The most accurate by a distance
 *            in testing, and near-instant; the browser downloads its
 *            Chinese–English pair itself, a few megabytes, and keeps it.
 *   opus     Compact: OPUS-MT zho-eng (University of Helsinki, CC BY 4.0) on
 *            Transformers.js and ONNX Runtime Web (Apache 2.0, MIT). Quick,
 *            and good on ordinary prose. Its files live in data/translation/
 *            (listed in its files.json). The copies that carry it — the app
 *            opened from this folder, the web build — load them from
 *            app/data/mt/ (scripts/build-translation.mjs). The Android app
 *            does not carry its 135 MB: the reader installs it there on
 *            request, into the app's own storage on the device
 *            (OfflineTranslatorPlugin), and it is read back from there.
 *
 * Larger models were tried and none did better in English: NLLB-200 (900 MB,
 * offered in 1.26.26 for other languages, since removed — the reader works in
 * English) invented sentences, a 1.5-billion-parameter chat model does not
 * fit the browser's 32-bit WebAssembly memory, and the half-billion one
 * wandered off into answering instead of translating.
 *
 * Compact has to run wherever the app does, and that includes a page opened
 * straight from disk (file://), where the browser will not fetch a file,
 * start a worker from one or load a module from one — only a plain script.
 * So its files ship as scripts (base64, a few megabytes a piece), the page
 * loads them and puts them back together (mtShipped), and the worker is
 * started from its own source (mtWorkerMain), takes the files as Blobs,
 * makes its own blob URLs of the runtime, and serves the model to
 * Transformers.js from memory. It is not let near the network. It is put
 * away after some minutes unused — a loaded model is hundreds of megabytes
 * of memory — and opened again from the app's files in a few seconds. */
const MT = {worker: null, workerId: "", seq: 0, calls: new Map(), memo: new Map(),
            loading: null, index: null, list: null, base: "", installing: null, percent: 0, error: "",
            painted: 0, cleared: false};
const MT_HOME = "data/mt/";
const MT_SIZE = "about 135 MB";
/* the Android app's installer (native.js), where there is one */
const mtNative = () => (window.hskkerNative && window.hskkerNative.translator) || null;
const browserName = () => /\bEdg\//.test(navigator.userAgent) ? "Edge" : /\bChrome\//.test(navigator.userAgent) ? "Chrome" : "this browser";
const MT_ENGINES = {
  browser: {id: "browser", title: `Built into ${browserName()}`, by: "", note: "Best quality · instant", langs: ["en"]},
  opus: {id: "opus", title: "Compact", by: "OPUS-MT, University of Helsinki", note: "Works offline · about 135 MB",
         langs: ["en"], model: "Xenova/opus-mt-zh-en", opts: () => ({max_new_tokens: 512})},
};
const MT_MODELS = ["opus"];

/* The translator for the device: the reader's pick, or the best there is. */
function deviceEngine(){
  const pick = S.readOfflineModel;
  if(pick === "browser" && btHas()) return "browser";
  if(MT_MODELS.includes(pick)) return pick;
  return btHas() ? "browser" : "opus";
}
/* Ready to translate into `to` without a connection? */
async function mtEngineReady(id, to){
  if(id === "browser") return (await btState(MT_ENGINES.browser.langs.includes(to) ? to : "en")) === "available";
  return mtHave(id);
}
/* Standing in for Google: the reader's pick if it is ready, else whichever is. */
async function mtReadyEngine(to){
  const order = [deviceEngine(), "browser", ...MT_MODELS].filter((x, i, a) => a.indexOf(x) === i);
  for(const id of order){
    if(id === "browser" && !btHas()) continue;
    if(await mtEngineReady(id, MT_ENGINES[id].langs.includes(to) ? to : "en")) return id;
  }
  return "";
}

/* ---- the browser's own translator ----
 * Chrome and Edge on a computer: Translator.create for a language pair,
 * which the browser downloads once (asking for a tap on the way — a press
 * of Translate or Download is one) and keeps. It answers in milliseconds.
 * It leaves Chinese commas and stops in an English sentence now and then;
 * they are made English. */
const BT = {made: new Map(), state: new Map()};
const btHas = () => !!(self.Translator && typeof self.Translator.create === "function");
async function btState(to){
  if(!btHas()) return "unavailable";
  try{
    const a = await Promise.race([self.Translator.availability({sourceLanguage: "zh", targetLanguage: to}),
      new Promise(r => setTimeout(() => r("unavailable"), 4000))]);
    BT.state.set(to, a);
    return a;
  }catch(_){ return "unavailable"; }
}
async function btTranslator(to, onPercent){
  if(BT.made.has(to)) return BT.made.get(to);
  const made = self.Translator.create({sourceLanguage: "zh", targetLanguage: to,
    monitor(m){ m.addEventListener("downloadprogress", e => { if(onPercent) onPercent(Math.min(99, Math.floor(e.loaded * 100))); }); }});
  BT.made.set(to, made);
  try{ const t = await made; BT.state.set(to, "available"); return t; }
  catch(err){ BT.made.delete(to); throw err; }
}
async function btText(text, to, onPercent){
  const t = await btTranslator(to, onPercent);
  const out = [];
  for(const para of text.split("\n")){
    if(!para.trim()) continue;
    let s = String(await t.translate(para.trim()));
    if(!/^(ja|ko)$/.test(to)){
      s = s.replace(/\s*，\s*/g, ", ").replace(/\s*、\s*/g, ", ").replace(/\s*；\s*/g, "; ").replace(/\s*：\s*/g, ": ")
           .replace(/\s*。\s*/g, ". ").replace(/\s*！\s*/g, "! ").replace(/\s*？\s*/g, "? ")
           .replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
    }
    out.push(s);
  }
  return out.join("\n");
}

/* ---- Compact, as shipped ----
 * app/data/mt/index.js names the files and their pieces; each piece is a
 * script that calls HSKKER_MT(file, piece, base64). Loaded one after the
 * other — never two scripts of a few megabytes parsing at once — decoded,
 * and put back together as Blobs, each checked against its size. */
function mtScript(src){
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = () => { tag.remove(); resolve(); };
    tag.onerror = () => { tag.remove(); reject(new Error(`${src} is missing`)); };
    document.head.appendChild(tag);
  });
}
/* the index, or null where this copy of the app was built without Compact */
function mtIndex(){
  if(!MT.index) MT.index = mtScript(MT_HOME + "index.js").then(() => self.HSKKER_MT_INDEX || null, () => null);
  return MT.index;
}
/* ---- Compact, installed (the Android app) ----
 * The list of its files (app/data/translation-files.js, which the APK does
 * carry) goes to the app's installer, which fetches them into the app's own
 * storage and says how far it has got; they are read back through the
 * bridge's file address. Nothing is installed until the reader asks. */
function mtList(){
  if(!MT.list) MT.list = mtScript("data/translation-files.js").then(() => self.HSKKER_MT_FILES || null, () => null);
  return MT.list;
}
/* Compact here: "ready", "absent" (the Android app, not installed yet),
   "installing", or "missing" (a copy built without it) */
async function mtState(){
  const nat = mtNative();
  if(!nat) return (await mtIndex()) ? "ready" : "missing";
  if(MT.installing) return "installing";
  const list = await mtList();
  if(!list) return "missing";
  try{
    const st = await nat.status(list.files);
    MT.base = st.base;
    return st.installed ? "ready" : "absent";
  }catch(_){ return "absent"; }
}
async function mtHave(id){ return id === "opus" && (await mtState()) === "ready"; }
/* Installs Compact — once; asking while it installs joins that. */
function mtInstall(onPercent){
  if(MT.installing){
    if(onPercent) MT.onPercent = onPercent;
    return MT.installing;
  }
  const nat = mtNative();
  if(!nat) return Promise.reject(new Error("Compact comes with this copy of the app, or not at all"));
  MT.percent = 0; MT.error = ""; MT.onPercent = onPercent;
  /* asked to be kept by the system, not cleared to make room */
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  /* settled inside, so that whoever awaits it finds it over, not still installing */
  MT.installing = (async () => {
    try{
      const list = await mtList();
      if(!list) throw new Error("this copy of the app has no list of Compact's files");
      const res = await nat.install(list.files, (done, total) => {
        MT.percent = Math.min(99, Math.floor(done / total * 100));
        if(MT.onPercent) MT.onPercent(MT.percent);
        mtPaint();
      });
      MT.base = res.base;
    }catch(err){
      MT.error = err.message || String(err);
      throw err;
    }finally{
      MT.installing = null; MT.onPercent = null;
      mtPaint(true);
    }
  })();
  mtPaint(true);
  return MT.installing;
}
/* Compact gone from the app's storage, and from memory. */
async function mtRemove(){
  mtStop();
  for(const k of [...MT.memo.keys()]) if(k.startsWith("opus:")) MT.memo.delete(k);
  for(const k of [...translateCache.keys()]) if(k.startsWith('["device","opus"')) translateCache.delete(k);
  await mtNative().remove();
  MT.base = ""; MT.error = "";
  mtPaint(true);
}
/* Compact's files as Blobs, from wherever this copy keeps them. */
async function mtGather(onPercent){
  const nat = mtNative();
  if(!nat) return mtShipped(onPercent);
  const list = await mtList();
  if((await mtState()) !== "ready") throw new Error("Compact is not installed");
  const total = list.files.reduce((n, f) => n + f.bytes, 0), blobs = {};
  let done = 0;
  for(const f of list.files){
    const res = await fetch(nat.url(MT.base, f.path));
    if(!res.ok) throw new Error(`${f.path} could not be read (${res.status})`);
    const blob = await res.blob();
    if(blob.size !== f.bytes) throw new Error(`${f.path} is damaged — remove Compact and install it again`);
    blobs[f.name] = blob;
    done += f.bytes;
    if(onPercent) onPercent(Math.min(99, Math.floor(done / total * 100)));
  }
  return blobs;
}
/* Base64 to bytes: the browser's own decoder where it has one; where not
   (an Android WebView before Chrome 140, say), as a data: address fetched —
   the browser decodes that natively too, several times quicker than
   decoding a few megabytes a character at a time in script. */
const mtBase64 = typeof Uint8Array.fromBase64 === "function" ? async s => Uint8Array.fromBase64(s)
  : async s => {
    try{ return new Uint8Array(await (await fetch("data:application/octet-stream;base64," + s)).arrayBuffer()); }
    catch(_){
      const bin = atob(s), out = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  };
/* One piece's base64. Where the page may fetch its own files — a server —
   it is read as text, a few pieces at a time, and the
   base64 taken out of it: no script to parse. A page opened from disk may
   not fetch, so there the piece runs as the script it is. */
async function mtPiece(file, i, k, viaFetch){
  if(viaFetch){
    const res = await fetch(MT_HOME + file);
    if(!res.ok) throw new Error(`${file} did not load (${res.status})`);
    const text = await res.text(), a = text.indexOf('"') + 1, b = text.lastIndexOf('"');
    if(!(a > 0 && b > a)) throw new Error(`${file} is damaged`);
    return text.slice(a, b);
  }
  let got = null;
  self.HSKKER_MT = (fi, fk, data) => { if(fi === i && fk === k) got = data; };
  try{ await mtScript(MT_HOME + file); }finally{ delete self.HSKKER_MT; }
  if(got == null) throw new Error(`${file} did not load`);
  return got;
}
async function mtShipped(onPercent){
  const index = await mtIndex();
  if(!index) throw new Error("Compact is not in this copy of the app");
  const total = index.files.reduce((n, f) => n + f.bytes, 0);
  const parts = index.files.map(() => []);
  const jobs = index.files.flatMap((f, i) => f.chunks.map((file, k) => ({file, i, k})));
  let done = 0, next = 0;
  /* fetched where the page may (asked once, of the index), three at a time;
     otherwise as scripts, one at a time, so two never share the hand-off */
  let viaFetch = false;
  if(location.protocol !== "file:"){
    try{ viaFetch = (await fetch(MT_HOME + "index.js")).ok; }catch(_){}
  }
  const lanes = viaFetch ? 3 : 1;
  await Promise.all(Array.from({length: lanes}, async () => {
    while(next < jobs.length){
      const {file, i, k} = jobs[next++];
      parts[i][k] = await mtBase64(await mtPiece(file, i, k, viaFetch));
      done += parts[i][k].length;
      if(onPercent) onPercent(Math.min(99, Math.floor(done / total * 100)));
    }
  }));
  const blobs = {};
  index.files.forEach((f, i) => {
    blobs[f.name] = new Blob(parts[i]);
    parts[i] = null;
    if(blobs[f.name].size !== f.bytes) throw new Error(`${f.name} is damaged in this copy of the app`);
  });
  return blobs;
}

/* ---- the worker ----
 * Its own source, started from a blob: self-contained, since it is turned
 * into text. It takes the runtime and the model from the page as Blobs, and
 * answers "load" and "translate". */
function mtWorkerMain(){
  let mt = null;
  self.onmessage = async e => {
    const m = e.data || {};
    try{
      if(m.type === "load"){
        /* only what the page handed over: no network at all */
        const net = self.fetch;
        self.fetch = (u, o) => {
          const s = String((u && u.url) || u);
          return s.startsWith("blob:") ? net(u, o) : Promise.reject(new Error("the offline translator has no network: " + s));
        };
        const blobURL = (text, type) => URL.createObjectURL(new Blob([text], {type}));
        const T = await import(blobURL(await m.runtime.lib.text(), "text/javascript"));
        /* The runtime's loader works out an address for its .wasm from its
           own, even when it is handed the .wasm itself; a blob: address is
           no base for that, so it is given one that is, never fetched. */
        const glue = (await m.runtime.glue.text()).split("import.meta.url").join(JSON.stringify("https://hskker.invalid/ort/"));
        const files = m.files;
        T.env.allowLocalModels = false;
        T.env.useBrowserCache = false;
        T.env.useCustomCache = true;
        T.env.customCache = {
          match: async key => {
            const k = String((key && key.url) || key);
            const name = Object.keys(files).find(f => k.endsWith("/" + f));
            return name ? new Response(files[name], {headers: {"content-length": String(files[name].size)}}) : undefined;
          },
          put: async () => {},
        };
        const wasm = T.env.backends.onnx.wasm;
        wasm.numThreads = 1;
        wasm.wasmBinary = await m.runtime.wasm.arrayBuffer();
        wasm.wasmPaths = {mjs: blobURL(glue, "text/javascript")};
        mt = await T.pipeline("translation", m.model, {dtype: "q8", device: "wasm"});
        postMessage({id: m.id, ok: true});
      }else if(m.type === "translate"){
        const out = await mt(m.text, m.opts);
        postMessage({id: m.id, ok: true, text: (out && out[0] && out[0].translation_text) || ""});
      }
    }catch(err){
      postMessage({id: m.id, ok: false, error: String((err && err.message) || err)});
    }
  };
}
function mtWorker(){
  if(MT.worker) return MT.worker;
  const src = URL.createObjectURL(new Blob([`(${mtWorkerMain})()`], {type: "text/javascript"}));
  const w = MT.worker = new Worker(src);
  w.onmessage = e => {
    const m = e.data || {};
    const call = MT.calls.get(m.id);
    if(!call) return;
    MT.calls.delete(m.id);
    if(m.ok) call.resolve(m.text); else call.reject(new Error(m.error));
  };
  /* a worker that cannot start, or dies — out of memory, say — fails
     whatever was asked of it */
  w.onerror = e => {
    e.preventDefault();
    const err = new Error(e.message || "the translator stopped");
    MT.calls.forEach(c => c.reject(err)); MT.calls.clear();
    mtStop();
  };
  return w;
}
function mtStop(){
  clearTimeout(MT.idle);
  if(MT.worker){ MT.worker.terminate(); MT.worker = null; }
  /* whatever was still waiting on it is told, rather than left waiting */
  const gone = new Error("the translator was put away");
  MT.calls.forEach(c => c.reject(gone)); MT.calls.clear();
  MT.workerId = ""; MT.loading = null;
}
function mtCall(type, data){
  clearTimeout(MT.idle);
  return new Promise((resolve, reject) => {
    const id = ++MT.seq;
    MT.calls.set(id, {resolve, reject});
    mtWorker().postMessage({id, type, ...data});
  }).finally(() => {
    clearTimeout(MT.idle);
    MT.idle = setTimeout(() => { if(!MT.calls.size) mtStop(); }, 4 * 60 * 1000);
  });
}

/* Compact, ready in the worker: its files read out of the app and handed
   over. Asking while it is opening joins that. */
function mtLoad(id, onPercent){
  if(MT.loading && MT.workerId === id) return MT.loading;
  mtStop();
  MT.workerId = id;
  const run = (async () => {
    try{
      const all = await mtGather(onPercent), runtime = {}, files = {};
      for(const [name, blob] of Object.entries(all)) (["lib", "glue", "wasm"].includes(name) ? runtime : files)[name] = blob;
      await mtCall("load", {model: MT_ENGINES[id].model, runtime, files});
    }catch(err){
      if(MT.loading === run) mtStop();
      throw err;
    }
  })();
  MT.loading = run;
  return run;
}

/* A passage, a sentence at a time, in order, each told as it comes; the
   paragraphs kept. A sentence already translated this session is not asked
   again. */
async function mtText(text, id, to, onStep){
  const paras = text.split("\n").map(mtSentences).filter(p => p.length);
  const total = paras.reduce((n, p) => n + p.length, 0);
  const outs = paras.map(() => []);
  const sofar = () => outs.map(o => o.join(" ")).filter(Boolean).join("\n");
  const opts = MT_ENGINES[id].opts(to);
  let n = 0;
  for(let i = 0; i < paras.length; i++){
    for(const s of paras[i]){
      const memo = `${id}:${to}:${s}`;
      let t = MT.memo.get(memo);
      if(t == null){
        /* what has nothing to translate — a stray quotation mark — stays as it is */
        t = /[\p{L}\p{N}]/u.test(s) ? String(await mtCall("translate", {text: s, opts})).trim() : s;
        MT.memo.set(memo, t);
      }
      outs[i].push(t);
      if(++n < total && onStep) onStep(sofar(), n, total);
    }
  }
  return sofar();
}
/* A paragraph's sentences. One longer than the model reads well is cut at
   its commas. */
function mtSentences(para){
  const out = [];
  for(const raw of para.split(/(?<=[。！？；…!?])/)){
    const s = raw.trim();
    if(!s) continue;
    if(s.length <= 160){ out.push(s); continue; }
    let cur = "";
    for(const part of s.split(/(?<=[，、：,])/)){
      if(cur && cur.length + part.length > 160){ out.push(cur); cur = ""; }
      cur += part;
    }
    if(cur) out.push(cur);
  }
  return out;
}

/* 1.26.25–1.26.27 downloaded Compact (and 1.26.26 a 900 MB multilingual
   model) into an IndexedDB database of their own. Compact now comes with the
   copies that carry it and is installed into the Android app's own storage,
   so that copy goes, once, and its space with it. */
async function mtClearOld(){
  if(MT.cleared) return;
  MT.cleared = true;
  try{
    if(indexedDB.databases && !(await indexedDB.databases()).some(d => d.name === "hskker-mt")) return;
    await new Promise(resolve => { const q = indexedDB.deleteDatabase("hskker-mt"); q.onsuccess = q.onerror = q.onblocked = () => resolve(); });
    if(self.caches) await caches.delete("transformers-cache");
  }catch(_){}
}

/* ---- in the reading settings ----
 * Under the three-way switch, a line on the connection and where a passage
 * would go now, and the translators for the device: each with what it is,
 * whether it is ready, and the one thing to do about it — the browser's
 * English to fetch; in the Android app, Compact to install or remove. A
 * press on a translator picks it. */
async function mtNetPaint(){
  const line = $("#rd-net");
  if(!line) return;
  const mode = translator(), online = navigator.onLine !== false;
  const eng = MT_ENGINES[deviceEngine()];
  line.textContent = mode === "google" ? (online ? "Connected — passages go to Google Translate." : "No connection — Online cannot translate until there is one.")
    : mode === "offline" ? `Passages stay on this device — ${eng.title}.`
    : online ? `Connected — passages go to Google Translate; with no connection, to ${eng.title} on this device.`
    : `No connection — passages are translated on this device, by ${eng.title}.`;
  line.classList.toggle("off", !online);
}
/* The list sits in the reader, where any change is a layout of the whole
   section, and an install reports several times a second — so while one
   runs it is repainted at most a few times a second. */
async function mtPaint(now){
  const box = $("#rd-mt"), list = $("#rd-mt-list");
  if(!box || box.hidden || !list) return;
  const t = performance.now();
  if(!now && MT.installing && t - MT.painted < 250) return;
  MT.painted = t;
  mtClearOld();
  const pick = deviceEngine();
  const ids = (btHas() ? ["browser"] : []).concat(MT_MODELS);
  const btNow = btHas() ? (BT.state.get("en") || await btState("en")) : "unavailable";
  const compact = await mtState(), installable = !!mtNative();
  const row = id => {
    const e = MT_ENGINES[id];
    let status, act = "", bar = "";
    if(id === "browser"){
      status = btNow === "available" ? "<b>Ready</b>" : btNow === "unavailable" ? "Not available here" : "English not downloaded yet";
      if(btNow === "downloadable" || btNow === "downloading") act = `<button class="ghost sm" data-mtact="browser">Download</button>`;
    }else{
      status = compact === "ready" ? "<b>Ready</b>"
        : compact === "installing" ? `Installing… <b>${MT.percent}%</b>`
        : compact === "missing" ? "Not in this copy of the app"
        : MT.error ? `Stopped: ${esc(MT.error)}. What arrived is kept.` : "Not installed";
      if(installable && compact === "ready") act = `<button class="ghost sm" data-mtact="remove">Remove</button>`;
      if(installable && compact === "absent") act = `<button class="ghost sm" data-mtact="install">${MT.error ? "Try again" : "Install"}</button>`;
      if(compact === "installing") bar = `<div class="rd-mt-bar"><i style="width:${MT.percent}%"></i></div>`;
    }
    return `<div class="rd-mt-row" data-mt="${id}">
      <button class="rd-mt-pick" data-mtpick="${id}" aria-pressed="${id === pick}">
        <span class="rd-mt-dot" aria-hidden="true"></span>
        <span class="rd-mt-txt"><b>${esc(e.title)}</b><small>${esc(id === "opus" && !installable ? "Comes with this copy · works offline" : e.note)}</small></span>
      </button>
      <span class="rd-mt-st">${status}</span>${act}${bar}
    </div>`;
  };
  list.innerHTML = ids.map(row).join("");
  mtNetPaint();
}
/* the list's presses: pick a translator; fetch the browser's English;
   install or remove Compact */
async function mtListClick(e){
  const pick = e.target.closest("[data-mtpick]"), act = e.target.closest("[data-mtact]");
  if(act && act.dataset.mtact === "browser"){
    act.disabled = true; act.textContent = "Downloading…";
    try{ await btTranslator("en", p => { act.textContent = `Downloading… ${p}%`; }); }
    catch(err){ toast(`${browserName()} could not fetch its English: ${err.message || err}`); }
    mtPaint(true);
    return;
  }
  if(act && act.dataset.mtact === "install"){
    if(navigator.onLine === false){ toast(`Installing Compact needs a connection — ${MT_SIZE}, once`); return; }
    await mtInstall().catch(() => {});
    return;
  }
  if(act && act.dataset.mtact === "remove"){
    if(confirm(`Remove Compact (${MT_SIZE}) from this device? Translating with no connection will need it installed again.`)) await mtRemove();
    return;
  }
  if(pick){
    S.readOfflineModel = pick.dataset.mtpick; save();
    mtPaint(true);
  }
}
addEventListener("online", mtNetPaint);
addEventListener("offline", mtNetPaint);

/* ---- Google Translate ----
 * Long passages go in pieces, cut at sentence ends, so no request grows past
 * what a URL can carry; the pieces come back in order. Two endpoints, the
 * second tried when the first is refused. */
async function googleText(text, to, ms = 12000){
  const pieces = [];
  for(const para of text.split("\n")){
    let cur = "";
    for(const sent of para.split(/(?<=[。！？；…!?])/)){
      if(cur && cur.length + sent.length > 1200){ pieces.push(cur); cur = ""; }
      cur += sent;
    }
    if(cur) pieces.push(cur);
    pieces.push("\n");
  }
  const outs = [];
  for(const piece of pieces){
    if(piece === "\n"){ outs.push("\n"); continue; }
    if(!piece.trim()) continue;
    outs.push(await googlePiece(piece, to, ms));
  }
  return outs.join(" ").replace(/ *\n */g, "\n").trim();
}

async function googlePiece(text, to, ms = 12000){
  const q = encodeURIComponent(text);
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  const opts = ctl ? {signal: ctl.signal} : {};
  try{
    try{
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${to}&dt=t&dj=1&q=${q}`, opts);
      if(!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const sentences = (data && data.sentences) || [];
      const joined = sentences.map(s => s.trans || "").join("");
      if(joined.trim()) return joined.trim();
      throw new Error("empty");
    }catch(first){
      if(ctl && ctl.signal.aborted) throw first;
      const res = await fetch(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=${to}&q=${q}`, opts);
      if(!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const flat = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0][0] : data[0])
        : (data && data.sentences ? data.sentences.map(s => s.trans).join("") : "");
      if(typeof flat === "string" && flat.trim()) return flat.trim();
      throw new Error("empty");
    }
  }finally{
    clearTimeout(timer);
  }
}




/* Where the reader has got to, as a place in the chapter (placeOfPage),
   written a beat after the page settles. */
function rememberPosition(){
  if(!R.meta) return;
  clearTimeout(posTimer);
  posTimer = setTimeout(writePosition, 700);
}
/* Also called as a book closes, so a turn in its last beat is kept: the
   closing used to drop the waiting write with the book, and the book opened
   a page back. */
function writePosition(){
  clearTimeout(posTimer); posTimer = 0;
  if(!R.meta) return;
  R.meta.ratio = placeOfPage(R.page, R.pages);
  R.meta.chapter = R.chapter;
  return dbPut("books", R.meta);
}

/* ---------------- the gloss ---------------- */

/* A word is looked at mid-sentence, so the sheet slides up from the bottom and
   leaves the line it came from on screen. A modal dialog — which is what the
   rest of the app opens for a detail — would cover the very thing being read. */
function openGloss(blockIndex, tokenIndex, opts = {}){
  const tokens = R.tokens[blockIndex];
  if(!tokens) return;
  const tok = tokens[tokenIndex];
  if(!tok || tok.t === "x") return;

  const wordEl = $(`#rd-prose .blk[data-b="${blockIndex}"] .rdw[data-i="${tokenIndex}"]`);
  /* The same word tapped again puts the card away — unless the card opened
     itself by dwelling, in which case the tap is a reader confirming what they
     were already looking at, and it stays. */
  if(R.sheet && R.sheet.blockIndex === blockIndex && R.sheet.tokenIndex === tokenIndex){
    if(R.sheet.byDwell){ R.sheet.byDwell = false; return; }
    closeGloss(); return;
  }

  const sheet = R.sheet = {tok, blockIndex, tokenIndex, wordEl, byDwell: !!opts.byDwell};
  $("#gloss-body").innerHTML = glossHTML(tok);
  $("#gloss-body").scrollTop = 0;   // a new word starts at the top, however far the last was read
  placePopover($("#gloss"), wordEl, {glide: true});
  $("#gloss").classList.add("on");
  $("#gloss").setAttribute("aria-hidden", "false");
  $$("#rd-prose .rdw.gl-active").forEach(w => w.classList.remove("gl-active"));
  if(wordEl) wordEl.classList.add("gl-active");
  hydrateGloss($("#gloss-body"), tok, {
    still: () => R.sheet === sheet,
    grew: () => placePopover($("#gloss"), wordEl, {glide: true}),
  }).catch(() => {});
}

/**
 * Puts a word card beside the word it is about. Shared by the reader and the
 * Talk tab, so the two cards behave as one thing.
 *
 * Below the word by default, with the caret at the word's centre. Above it
 * when below would run off the bottom of the window. Slid sideways, never
 * past either edge, and the caret slides the other way so it still points at
 * the word after the card has moved. Measured off layout rather than the
 * painted box, so it lands right on the first frame instead of after the
 * fade — and rerun on scroll, so the card follows the line.
 *
 * @param opts.glide  ease the card to its new place rather than jumping. For
 *   a card already up that is moving to another word, or has changed size —
 *   not for one being opened, which should land where it belongs, and not for
 *   one following a scrolling line, which must keep up with it.
 */
function placePopover(el, word, opts = {}){
  if(!el || !word || !word.isConnected) return;
  el.classList.toggle("glide", !!opts.glide && el.classList.contains("on"));
  const GAP = 10, EDGE = 12;
  const w = word.getBoundingClientRect();
  const width = el.offsetWidth;

  let left = Math.round(w.left + w.width / 2 - 24);
  left = Math.max(EDGE, Math.min(left, innerWidth - width - EDGE));

  /* The card is as tall as its content up to a cap, and never taller than
     the room on the side it lands on: a word low on the page gets a card
     above it, and when neither side has room for all of it, the side with
     more room gets a shorter card that scrolls inside itself — so the end of
     the last example is always reachable, rather than off the screen. The
     cap is a custom property on the card so it can be read back to normal
     before measuring. */
  const cap = Math.round(Math.min(innerHeight * 0.58, 480));
  el.style.setProperty("--gl-max", `${cap}px`);
  const natural = el.offsetHeight;
  const roomBelow = innerHeight - EDGE - (w.bottom + GAP);
  const roomAbove = w.top - GAP - EDGE;
  let place;
  if(natural <= roomBelow) place = "below";
  else if(natural <= roomAbove) place = "above";
  else{
    place = roomBelow >= roomAbove ? "below" : "above";
    el.style.setProperty("--gl-max", `${Math.max(140, Math.floor(place === "below" ? roomBelow : roomAbove))}px`);
  }
  const height = el.offsetHeight;
  const top = place === "below" ? w.bottom + GAP : w.top - GAP - height;

  el.dataset.place = place;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(EDGE, Math.round(top))}px`;
  el.style.setProperty("--caret-x", `${Math.round(Math.min(Math.max(w.left + w.width / 2 - left, 18), width - 18))}px`);
}

/**
 * The gloss card itself: word, reading, level, senses, the characters it is
 * made of, and the sentence it was found in. Pure, so the reader's sheet and
 * the Talk card's sheet are the same card — one place decides what a
 * looked-up word shows.
 *
 * The card is glanceable, not a form: no buttons to add, open or close. It is
 * put away by tapping anywhere else, or — when it opened itself by hovering —
 * by the pointer moving off the word. The full entry is still one tap away
 * through the characters it lists.
 *
 * @param opts.nav  whether the characters link out to their own entry. The
 *   reader's card does: an entry opens over the book and the book is still
 *   there when it closes. A card hosted in the detail dialog itself would
 *   have the same link replace what it sits on with the entry; off there,
 *   the character swaps this same card over instead.
 */
/* The word card. What is known at once is drawn at once — the word, its
   reading, its level, the first sense the segmenter carries — and the rest
   is filled in as it arrives: the full entry (every sense, the part of
   speech, measure words, the traditional form) from the level's vocabulary
   file, and example sentences from the grammar points. See
   hydrateGloss(). A character that is not itself a word shows the words it
   is found in instead. */
function glossHTML(tok, opts = {}){
  const {nav = true} = opts;
  const senses = Array.isArray(tok.en) ? tok.en : tok.en ? [tok.en] : [];
  return `
    <div class="gl-head">
      <div>
        <div class="gl-w hz">${esc(tok.w)}</div>
        <div class="gl-p py">${pinyinHTML(tok.p)}</div>
      </div>
      <div class="gl-side">
        ${tok.lv ? lvChip(tok.lv) : `<span class="lv">Beyond HSK</span>`}
        
      </div>
    </div>

    <div class="gl-defs">${senses.length
      ? `<ol class="defs">${senses.slice(0, 6).map((m, i) =>
          `<li><span class="n">${i + 1}</span><span>${esc(m)}</span></li>`).join("")}</ol>`
      : `<p class="pmeta" style="margin:0">No entry in the syllabus — this is outside the
          3,000 characters and the 11,092 words.</p>`}</div>

    ${tok.w.length > 1 ? `<div class="gl-chars">${[...tok.w].map(c => nav
        ? `<button class="gl-ch" data-open="char:${esc(c)}">${esc(c)}</button>`
        /* Without navigation the character is still worth a look — it swaps
           this same sheet over to the character's own entry, and stays put. */
        : `<button class="gl-ch" data-glosschar="${esc(c)}" title="Look up ${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}

    <div class="gl-ex" data-gl-ex><p class="pmeta gl-wait">Looking for examples…</p></div>`;
}

/* The full entry and the examples, filled in behind the card once they have
   loaded. `grew` is called after each fill so the card can be placed again
   for its new height; `still` says whether this card is still the one up. */
async function hydrateGloss(body, tok, {grew, still, nav = true} = {}){
  const alive = () => (!still || still()) && body.isConnected;
  const meta = await getMeta();
  if(!alive()) return;

  /* The entry. */
  const isWord = tok.t === "w" && tok.lv && tok.id;
  const entry = isWord ? (await getVocab(tok.lv)).find(w => w.id === tok.id) : null;
  if(!alive()) return;
  if(entry){
    const senses = entry.en || [];
    const bits = [];
    if(entry.pos && entry.pos.length) bits.push(entry.pos.map(p => esc(meta.pos[p] || p)).join(" · "));
    if(entry.t && entry.t !== entry.s) bits.push(`trad. <span class="hz">${esc(entry.t)}</span>`);
    if(entry.cl && entry.cl.length) bits.push(`measure word <span class="hz">${entry.cl.map(esc).join(" / ")}</span>`);
    const defs = body.querySelector(".gl-defs");
    if(defs) defs.innerHTML = `
      ${bits.length ? `<div class="gl-meta">${bits.join('<span class="dot">·</span>')}</div>` : ""}
      ${senses.length ? `<ol class="defs">${senses.slice(0, 8).map((m, i) =>
          `<li><span class="n">${i + 1}</span><span>${esc(m)}</span></li>`).join("")}</ol>` : ""}
      ${nav ? `<div class="gl-more"><button class="linky" data-open="word:${esc(entry.id)}">
          ${senses.length > 8 ? `${senses.length - 8} more sense${senses.length - 8 === 1 ? "" : "s"} · ` : ""}Full entry</button></div>` : ""}`;
    if(grew) grew();
  }

  /* The examples. */
  const host = body.querySelector("[data-gl-ex]");
  if(!host) return;
  let examples = isWord ? ((await getExamples(tok.lv))[tok.w] || []) : [];
  if(!alive()) return;
  if(examples.length){
    const mark = zh => esc(zh).split(esc(tok.w)).join(`<mark>${esc(tok.w)}</mark>`);
    /* Where each came from, by name: the grammar point's title. A tap opens it. */
    const grammar = examples.some(e => /^G\d+$/.test(e[3])) ? await getGrammar().catch(() => []) : [];
    if(!alive()) return;
    const source = src => {
      if(!/^G\d+$/.test(src)) return "";
      const g = grammar.find(x => String(x.id) === src.slice(1));
      return `<button class="linky" data-open="grammar:${src.slice(1)}" title="Open the grammar point"><i>Grammar · </i><b>${esc(g ? g.title : "point " + src.slice(1))}</b></button>`;
    };
    host.innerHTML = `
      <div class="gl-sent-h"><span class="lbl">Examples</span></div>
      <ol class="gl-exl">${examples.map(([zh, py, en, src]) => `
        <li>
          <div class="gl-exz hz">${mark(zh)}</div>
          ${S.pinyin !== false && py ? `<div class="gl-exp py">${esc(py)}</div>` : ""}
          <div class="gl-exe">${esc(en)}</div>
          <div class="gl-exs">
            
            ${source(src)}
          </div>
        </li>`).join("")}</ol>`;
  }else{
    /* A character: the words it is part of, nearest level first. */
    const words = tok.w.length === 1 ? (await wordsWithChar(tok.w, 9)).filter(w => w.s !== tok.w) : [];
    if(!alive()) return;
    host.innerHTML = words.length ? `
      <div class="gl-sent-h"><span class="lbl">In words</span></div>
      <div class="gl-inwords">${words.map(w => `
        <button class="gl-iw" ${nav ? `data-open="word:${esc(w.id)}"` : `data-glossword="${esc(w.s)}"`}>
          <span class="hz">${esc(w.s)}</span><span class="py">${esc(w.p)}</span><span class="en">${esc(w.en[0] || "")}</span>
        </button>`).join("")}</div>` : "";
  }
  if(grew) grew();
}

function closeGloss(){
  R.sheet = null;
  $$("#rd-prose .rdw.gl-active").forEach(w => w.classList.remove("gl-active"));
  const el = $("#gloss");
  if(el){ el.classList.remove("on"); el.setAttribute("aria-hidden", "true"); }
}

/* The sentence a token sits in, found by walking out to the nearest full stop
   in each direction. Chinese punctuation only — a Latin full stop inside a
   sentence is nearly always a decimal point or an abbreviation. */
const SENTENCE_END = /[。！？；…\n]/;
function sentenceAround(tokens, at){
  let from = at, to = at;
  while(from > 0){
    const prev = tokens[from - 1];
    if(prev.t === "x" && SENTENCE_END.test(prev.w)) break;
    from--;
  }
  while(to < tokens.length - 1){
    const tok = tokens[to];
    if(tok.t === "x" && SENTENCE_END.test(tok.w)) break;
    to++;
  }
  const slice = tokens.slice(from, to + 1);
  return {from, to, slice, text: slice.map(t => t.w).join("").trim()};
}

/* Word-by-word under the sentence.
 *
 * This is the honest form of translation for something that runs entirely on
 * the device: every word with its reading and its dictionary sense, in the
 * order the sentence puts them. It is not a fluent English sentence and does
 * not pretend to be one — but it is what actually lets you work out a line you
 * are nearly able to read, and unlike a fluent translation it leaves the work
 * with the reader, which is the whole point of reading at this level. */
function interlinearHTML(slice){
  const cells = slice.filter(t => t.t !== "x" || /\S/.test(t.w)).map(tok => {
    if(tok.t === "x") return `<span class="il il-x">${esc(tok.w)}</span>`;
    const gloss = Array.isArray(tok.en) ? tok.en[0] : tok.en;
    return `<span class="il ${S.readTint === "off" ? "" : levelClass(tok.lv)}">
      <b class="hz">${esc(tok.w)}</b>
      <i class="py">${esc(tok.p || "—")}</i>
      <em>${esc((gloss || "—").split(";")[0].trim().slice(0, 34))}</em>
    </span>`;
  }).join("");
  return `<div class="interlinear">${cells}</div>`;
}

/* ---------------- what is in this text ---------------- */

/* Coverage opens into the shared detail dialog rather than sitting under the
   prose. With the reading column bounded to the window, a panel below it was a
   panel nobody could see without scrolling a page that no longer scrolls. */
function openAnalysis(){
  openDetail(`<h2>Coverage</h2>
    <p class="pmeta">How much of this you can already read.</p>
    <div class="seg mini-seg" id="rd-scope" style="margin-bottom:13px">
      <button data-scope="chapter" aria-pressed="${R.scope !== "book"}">This section</button>
      <button data-scope="book" aria-pressed="${R.scope === "book"}">Whole book</button>
    </div>
    <div id="rd-analysis"></div>`);
  $("#rd-scope").onclick = e => {
    const b = e.target.closest("button[data-scope]");
    if(!b) return;
    $$("#rd-scope button").forEach(x => x.setAttribute("aria-pressed", x === b));
    safely("read through the text", () => analyse(b.dataset.scope));
  };
  return analyse(R.scope);
}

async function analyse(scope){
  R.scope = scope;
  const host = $("#rd-analysis");
  if(!host) return;
  host.innerHTML = `<p class="pmeta">Reading through the text…</p>`;

  /* A whole novel is a few hundred thousand tokens. Yielding once before the
     work starts lets the message above actually paint. */
  await new Promise(r => setTimeout(r, 16));

  const chapters = scope === "book" ? R.book.chapters : [R.book.chapters[R.chapter]];
  const tokens = [];
  for(const ch of chapters)
    for(const b of ch.blocks) tokens.push(...segment(b.text));

  R.fam = await familiarity();
  R.cov = coverage(tokens, R.fam);
  paintAnalysis();
}

function paintAnalysis(){
  const cov = R.cov;
  const host = $("#rd-analysis");
  if(!cov || !host) return;
  const pct = n => cov.running ? Math.round(n / cov.running * 100) : 0;
  const inHSK = cov.running - cov.byLevel.x;

  const rows = LEVELS.map(lv =>
    bar(`HSK ${levelLabel(lv)}`,
        `${num(cov.byLevel[lv])} · ${pct(cov.byLevel[lv])}% · ${num(cov.typesByLevel[lv])} distinct`,
        cov.byLevel[lv] / Math.max(1, cov.running),
        `var(--hsk-${lv})`)).join("")
    + bar("Beyond HSK",
        `${num(cov.byLevel.x)} · ${pct(cov.byLevel.x)}% · ${num(cov.typesByLevel.x)} distinct`,
        cov.byLevel.x / Math.max(1, cov.running), "var(--hsk-x)");

  const mine = mineable(cov, R.fam, 40);

  host.innerHTML = `
    <div class="kpis">
      ${kpi(num(cov.running), "Words", "running words")}
      ${kpi(num(cov.types), "Distinct", "different words")}
      ${kpi(`${pct(inHSK)}<small>%</small>`, "In the HSK", "of the running words")}
      ${kpi(`${Math.round(cov.comfort * 100)}<small>%</small>`, "You know", "mastered in your deck")}
    </div>

    <p class="pmeta" style="margin:13px 0 4px">${comfortNote(cov)}</p>
    <div class="blist">${rows}</div>

    ${mine.length ? `
      <div class="fold-row">
        <div class="fold-what">
          <b>${num(mine.length)} unknown syllabus word${mine.length === 1 ? "" : "s"} here</b>
          <p class="pmeta" style="margin:3px 0 0">Commonest in this text first, which is not the same
            order as commonest in the language — a word this book leans on is worth having.</p>
        </div>
        <div class="fold-acts">
          <button class="ghost" id="rd-mine10">Add the top 10</button>
          <button class="ghost" id="rd-mine">Add all ${num(mine.length)}</button>
        </div>
      </div>
      <div class="rows" style="margin-top:11px">${mine.slice(0, 12).map(t => `
        <button class="erow" data-open="word:${esc(t.tok.id)}">
          <span class="eh">${esc(t.w)}</span>
          <span class="ep py">${pinyinHTML(t.tok.p)}</span>
          <span class="ee">${esc((Array.isArray(t.tok.en) ? t.tok.en[0] : t.tok.en) || "")}</span>
          <span class="ex"><span class="lv">${t.n}×</span>${lvChip(t.tok.lv)}</span>
        </button>`).join("")}</div>`
      : `<p class="pmeta" style="margin-top:13px">Every syllabus word in this text is already in your
         deck. What is left is the ${num(cov.typesByLevel.x)} distinct words outside the standard.</p>`}`;

  $("#rd-mine10")?.addEventListener("click", () => mineWords(mine.slice(0, 10)));
  $("#rd-mine")?.addEventListener("click", () => mineWords(mine));
}

/* A sentence about the number, because the number on its own misleads. The
   received figure for comfortable reading is around 98% of running words
   known; below about 90% a text is being decoded rather than read. */
function comfortNote(cov){
  const p = Math.round(cov.comfort * 100);
  const scope = R.scope === "book" ? "this book" : "this section";
  if(!cov.running) return "There is no Chinese in this section.";
  if(p >= 98) return `You know ${p}% of the running words in ${scope} — comfortable reading.`;
  if(p >= 90) return `You know ${p}% of the running words in ${scope}. Around one word in ten is new,
    which is hard work but the range where reading teaches you the most.`;
  return `You know ${p}% of the running words in ${scope}. Below about 90% a text is decoded rather
    than read — mining the commonest unknown words below first will change that fastest.`;
}

async function mineWords(list){
  let added = 0;
  for(const t of list) added += await addToDeck("word", t.tok.id, t.tok.lv, ["recognize"]);
  R.fam = await familiarity();
  repaintAnnotations();
  paintAnalysis();
  await renderRail();
  toast(added ? `Added ${added} card${added === 1 ? "" : "s"} to your deck` : "Those are already in your deck");
}
