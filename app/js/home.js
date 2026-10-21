/* home.js — the opening screen: who you are, where you left off, where to go. */

/* The section icons, drawn once here so the launcher and the pick-up cards
   can carry them; the nav has the same set inline. */
const HOME_ICON = {
  vocab:   `<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M8 7.5h7M8 11h5"/>`,
  chars:   `<path d="M15.5 4.5 19 8 8.5 18.5 4 20l1.5-4.5z"/><path d="M13.5 6.5 17 10"/>`,
  grammar: `<path d="M12 3v18M5 8h14M7 21h10"/><path d="M9 3h6"/>`,
  read:    `<path d="M12 6.5C10.5 5 8.3 4.3 4 4.5v13c4.3-.2 6.5.5 8 2 1.5-1.5 3.7-2.2 8-2v-13c-4.3-.2-6.5.5-8 2z"/><path d="M12 6.5v13"/>`,
  clock:   `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  talk:    `<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V13"/><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5v6a1.5 1.5 0 0 1-1.5 1.5H18v3l-3.5-3H11"/>`,
  close:   `<path d="M6 6l12 12M18 6 6 18"/>`,
};
const homeIcon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICON[k] || ""}</svg>`;

async function renderHome(){
  const meta = await getMeta();
  const talk = typeof talkMeta === "function" ? await talkMeta() : null;
  await Promise.all([paintHero(meta), paintPickup()]);

  /* The launcher: every section and the size of what is behind it, so the
     first screen says what the app is as well as where to go. */
  const books = (await dbAll("books").catch(() => [])).length;
  const tiles = [
    ["chars",   "Characters",  num(meta.totals.chars),          "with stroke order"],
    ["grammar", "Grammar",     num(meta.totals.grammar),        `points · ${num(meta.totals.grammarWithNotes)} explained`],
    ["talk",    "Talk",        talk ? num(talk.questions) : "", talk ? `conversation questions · ${talk.decks} decks` : "Conversation questions, by level"],
    ["read",    "Read",        num(books),                      `${books === 1 ? "book" : "books"} on your shelf · glossed`],
  ];
  const preview = await tilePreviews({talk});
  $("#home-launch").innerHTML = tiles.map(([v, name, n, sub]) => `
    <button class="tile" data-go="${v}">
      <span class="ti">${homeIcon(v)}</span>
      <span class="tn">${esc(name)}</span>
      ${preview[v] ? `<span class="tp">${preview[v]}</span>` : ""}
      ${n ? `<span class="tv">${n}</span>` : ""}
      <span class="ts">${esc(sub)}</span>
    </button>`).join("");

  /* The ladder: the seven levels as one row of steps, banded, with the one
     you work at marked. Each says what it holds. */
  /* Where there is room, each level says what it adds — words, characters,
     grammar, a line each — and how far up the whole syllabus it takes you:
     the words of every level up to and including it, against all of them. */
  const allWords = meta.levels.reduce((n, l) => n + l.words, 0);
  let upTo = 0;
  $("#home-board").innerHTML = LEVELS.map((lv, i) => {
    const m = meta.levels.find(l => l.id === lv);
    const full = m.grammarExplained === m.grammar;
    upTo += m.words;
    return `<button class="lvcard b${bandOf(lv)} ${lv === S.level ? "on" : ""}" data-lv="${lv}" data-zh="${LEVEL_NUMERALS[i]}"
      aria-pressed="${lv === S.level}" title="HSK ${levelLabel(lv)}: ${num(m.words)} words, ${num(m.chars)} characters, ${m.grammar} grammar points${full ? "" : `, ${m.grammarExplained} explained`}">
      <span class="lh"><span class="ln">HSK ${levelLabel(lv)}</span>
        ${lv === S.level ? `<span class="lnow">Working here</span>` : `<span class="lb">${esc(m.band)}</span>`}</span>
      <span class="lstat">${num(m.words)} words · ${num(m.chars)} characters<br>${m.grammar} grammar${
        full ? "" : ` · ${m.grammarExplained} explained`}</span>
      <span class="lrows">
        <span><i>Words</i><b>${num(m.words)}</b></span>
        <span><i>Characters</i><b>${num(m.chars)}</b></span>
        <span><i>Grammar</i><b>${num(m.grammar)}${full ? "" : `<small> · ${num(m.grammarExplained)} explained</small>`}</b></span>
      </span>
      <span class="lladder"><span class="lbar"><i style="width:${(upTo / allWords * 100).toFixed(1)}%"></i></span>
        <small>${num(upTo)} of ${num(allWords)} words by here</small></span>
    </button>`;
  }).join("");
}

const LEVEL_NUMERALS = ["一", "二", "三", "四", "五", "六", "七"];

/* ---------------- what each tile shows ---------------- */
/* On a screen tall enough to give the launcher room, each tile shows a
   glimpse of what is behind it, at your level, between its name and its
   figure: a handful of the level's characters, two of its grammar points,
   the conversation questions at each level, the book you are reading. The
   picks are seeded by the day, like the word of the day, so they hold still
   until midnight. */
async function tilePreviews({talk}){
  const out = {};
  const day = Math.floor(Date.now() / 86400000);
  const pick = (list, n) => {
    const got = [];
    for(let k = 0; k < list.length && got.length < n; k++){
      const x = list[(day * 31 + k * 97) % list.length];
      if(!got.includes(x)) got.push(x);
    }
    return got;
  };
  const cols = (rows, k) => `<span class="tp-k">${k}</span><span class="tp-cols">${rows.map(r =>
    `<span class="${r.on ? "on" : ""}" title="${esc(r.title)}"><i><b style="--v:${Math.max(0, Math.min(1, r.v)).toFixed(3)}"></b></i><em>${esc(r.label)}</em></span>`).join("")}</span>`;

  /* characters: five from the words of your level */
  try{
    const words = await getVocab(S.level);
    const pool = [...new Set(words.flatMap(w => [...(S.script === "traditional" ? w.t || w.s : w.s)]))].filter(c => /[一-鿿]/.test(c));
    if(pool.length) out.chars = `<span class="tp-k">From HSK ${levelLabel(S.level)}</span>
      <span class="tp-hz">${pick(pool, 5).map(c => `<i>${esc(c)}</i>`).join("")}</span>`;
  }catch(_){}

  /* grammar: two points of your level */
  try{
    const points = (await getGrammar()).filter(g => String(g.lv) === String(S.level));
    if(points.length) out.grammar = `<span class="tp-k">At HSK ${levelLabel(S.level)}</span>
      <span class="tp-g">${pick(points, 2).map(g => `<span><b>${esc(g.topicZh || g.categoryZh || "")}</b><small>${esc(g.topic || g.title || "")}</small></span>`).join("")}</span>`;
  }catch(_){}

  /* talk: the questions readable at each level */
  if(talk && talk.byLevel){
    const by = talk.byLevel, lvls = ["1", "2", "3", "4", "5", "6", "7"];
    const n = lv => lv === "7" ? Object.entries(by).filter(([k]) => +k >= 7).reduce((sum, [, v]) => sum + v, 0) : (by[lv] || 0);
    const most = Math.max(1, ...lvls.map(n));
    out.talk = cols(lvls.map(lv => ({label: lv === "7" ? "7+" : lv, v: n(lv) / most, on: lv === S.level,
      title: `${num(n(lv))} questions readable at HSK ${levelLabel(lv)}`})), "Questions, by level");
  }

  /* read: the book you are in, or an invitation */
  const books = (await dbAll("books").catch(() => [])).sort((x, y) => (y.opened || 0) - (x.opened || 0));
  if(books.length){
    const b = books[0];
    const pct = b.chapters ? Math.round((b.chapter + (b.ratio || 0)) / b.chapters * 100) : 0;
    out.read = `<span class="tp-k">Reading now</span>
      <span class="tp-book"><b>${esc(b.title)}</b><span class="tp-bar"><i style="width:${pct}%"></i></span>
        <small>Section ${b.chapter + 1} of ${num(b.chapters)} · ${pct}%</small></span>`;
  }else{
    out.read = `<span class="tp-empty">Add an EPUB or paste a text: every word coloured by its level</span>`;
  }
  return out;
}

/* ---------------- the hero ---------------- */
/* A greeting, the level and the exam, and a word for the day: one word from
   the level you are working at, the same word all day (seeded by the date),
   large, in the Chinese face you chose — the screen opens on the language
   rather than on a menu. Tapping it opens the entry. */
async function paintHero(meta){
  const me = typeof activeProfile === "function" ? activeProfile() : null;
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "long"});
  const left = me && typeof daysToExam === "function" ? daysToExam(me.examDate) : null;
  const m = meta.levels.find(l => l.id === S.level);

  const word = await wordOfTheDay();
  $("#home-hero").innerHTML = `
    <div class="hero-text">
      <p class="hero-date">${esc(today)}</p>
      <h2 class="hero-h">${esc(greet)}${me ? `, ${esc(me.name)}` : ""}.</h2>
      <p class="hero-sub">Working at <b>HSK ${levelLabel(S.level)}</b> · ${esc(bandName(S.level))}${
        m ? ` · ${num(m.words)} words, ${num(m.chars)} characters, ${m.grammar} grammar points` : ""}</p>
      <div class="hero-row">
        ${left !== null ? `<span class="hero-pill exam">${homeIcon("clock")}${left === 0 ? "Exam day" : `${num(left)} day${left === 1 ? "" : "s"} to the exam`}</span>`
                        : `<button class="hero-pill" data-go="settings" title="Set an exam date in Settings">${homeIcon("clock")}Set an exam date</button>`}
        ${me && me.note ? `<span class="hero-note">${esc(me.note)}</span>` : ""}
      </div>
    </div>
    ${word ? `
    <div class="wotd" data-open="word:${esc(word.id)}" role="button" tabindex="0" title="Open the entry">
      <span class="wotd-k">Word of the day</span>
      <span class="wotd-zh hz">${esc(hanziOf(word.s, word.t))}</span>
      <span class="wotd-py py">${pinyinHTML(word.p)}</span>
      <span class="wotd-en">${esc(word.en.slice(0, 2).join("; "))}</span>
      <span class="wotd-f">${lvChip(word.lv)}</span>
    </div>` : ""}`;
}

async function wordOfTheDay(){
  try{
    const words = await getVocab(S.level);
    if(!words || !words.length) return null;
    /* Days since the epoch, mixed with the level, so the pick changes at
       midnight and differs between levels — and never depends on storage. */
    const day = Math.floor(Date.now() / 86400000);
    let h = (day * 2654435761 + (+S.level || 0) * 97) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return words[h % words.length];
  }catch(_){ return null; }
}

/* ---------------- pick up where you left off ---------------- */
/* The book and the conversation you last touched. Each is one tap back into
   it; a fresh copy shows none and the row is not there. */
async function paintPickup(){
  const host = $("#home-pickup");
  const cards = [];

  const books = (await dbAll("books")).sort((x, y) => y.opened - x.opened);
  if(books.length){
    const b = books[0];
    const pct = b.chapters ? Math.round((b.chapter + (b.ratio || 0)) / b.chapters * 100) : 0;
    cards.push(`<button class="pick" data-resume="${esc(b.id)}">
      <span class="pk-ic">${homeIcon("read")}</span>
      <span class="pk-body">
        <span class="pk-k">Continue reading</span>
        <span class="pk-t">${esc(b.title)}</span>
        <span class="pk-m">Section ${b.chapter + 1} of ${num(b.chapters)} · ${pct}%</span>
        <span class="pk-track"><i style="width:${pct}%"></i></span>
      </span>
    </button>`);
  }

  /* A conversation left open recently enough to be the one you were having. */
  const snap = S.talkRun;
  if(snap && snap.cur && Date.now() - (snap.at || 0) < 6 * 3600 * 1000){
    const who = snap.pid >= 0 && S.talkPeople ? S.talkPeople[snap.pid] : "";
    const stage = ["Icebreaker", "Warm-up", "Getting to know", "Deep", "Intimate"][snap.depth - 1] || "";
    cards.push(`<button class="pick" data-talkresume>
      <span class="pk-ic">${homeIcon("talk")}</span>
      <span class="pk-body">
        <span class="pk-k">Pick up the conversation</span>
        <span class="pk-t">${esc(snap.name || "Your selection")}${who ? ` · with ${esc(who)}` : ""}</span>
        <span class="pk-m">${snap.asked} asked · ${esc(stage)} · ${agoText(snap.at)}</span>
      </span>
    </button>`);
  }

  host.innerHTML = cards.join("");
  host.hidden = !cards.length;
}


/* The three shapes every panel on this app is built from. */
const kpi = (v, k, sub = "") =>
  `<div class="kpi"><span class="v">${typeof v === "number" ? num(v) : v}</span>
   <span class="k">${esc(k)}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;

const bar = (name, value, frac, colour = "var(--acc)") =>
  `<div class="brow"><span class="bn">${name}</span><span class="bv">${value}</span>
   <span class="btrack"><i class="bfill" style="width:${clamp(frac * 100, 2, 100)}%;--bc:${colour}"></i></span></div>`;

/* The rail's status card: whose copy this is, and the level they work at. */
async function renderRail(){
  const me = typeof activeProfile === "function" ? activeProfile() : null;
  $("#rc-face").textContent = me ? initialOf(me.name) : levelLabel(S.level);
  $("#rc-face").style.background = me ? me.hue : "";
  $("#rc-name").textContent = me ? me.name : `HSK ${levelLabel(S.level)}`;
  $("#rc-sub").textContent = me
    ? `HSK ${levelLabel(S.level)} · ${bandName(S.level)}`
    : bandName(S.level);
}
