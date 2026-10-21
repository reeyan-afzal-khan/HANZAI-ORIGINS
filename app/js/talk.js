/* talk.js — conversation practice.
 *
 * 4,228 questions in Chinese and English, ordered from the things you can ask
 * a stranger in a lift to the things you only ask someone who trusts you, and
 * dealt as decks that match the situation you are in. The tab is built to sit
 * beside a chat window: pick a question, send it, answer it yourself.
 *
 * What the syllabus adds. Every question's Chinese is cut into words against
 * the same lexicon the reader uses, so a card is coloured by
 * HSK level, every word opens its card and its stroke order, and each row is
 * stamped at build time with the level it is readable at — which is what lets
 * a deck be dealt "at your level" and lets a card say what it will cost you.
 *
 * The record lives in IndexedDB with the rest of your progress (store.js),
 * one row per question dealt, and everything the tab reports — how many, how
 * deep, with whom, the streak, what has already been asked of each person —
 * is derived from those rows.
 *
 * Data: app/data/talk/questions.js and answers.js, written by
 * scripts/build-talk.mjs from data/talk/*.json. */

/* A question row. Positional: there are 4,228 of them. */
const Q = {ID:0, SC:1, SE:2, ST:3, CA:4, FR:5, PR:6, EN:7, ZH:8, HL:9, BX:10};
const TK_STAGE = ["Icebreaker", "Warm-up", "Getting to know", "Deep", "Intimate"];
const TK_SENS  = ["Safe", "Light", "Personal", "Sensitive", "Very sensitive"];
/* The heat ramp the gauge, the card spines and the deck spines run on. */
const TK_HEAT = ["--h1", "--h2", "--h3", "--h4", "--h5"];
const tkHeat = stage => `var(${TK_HEAT[clamp(stage, 1, 5) - 1]})`;
const TK_GATE = {
  4: "The next level includes money, health, faith, politics and past relationships. Sent cold to somebody you met an hour ago, these read as an interrogation rather than a conversation.",
  5: "The last level includes sex, addiction, grief and loss. Only open this with somebody who already trusts you, or where you have both explicitly agreed to debate it.",
};
/* A run left open this long is still the conversation you were having. */
const TK_RESUME_MS = 6 * 3600 * 1000;
const TK_HIST_CAP = 40;
const TK_PAGE = 60;

const TK = {
  data: null, ans: null, byId: null,
  /* The live run, or null. */
  run: null,
  /* Whose conversation this is: an index into S.talkPeople, -1 for nobody. */
  pid: -1,
  /* What the record says has already been asked of that person. */
  seen: null, seenPid: null,
  /* The record, read once and appended to. */
  events: null, sessions: null,
  /* The last few topics and frames dealt, so the draw can steer around them. */
  recentCat: [], recentFrame: [],
  hist: [],
  /* An ad-hoc deck built from a search or the saved list. */
  custom: null,
  /* Browsing. */
  query: "", browse: false, fSens: new Set(), fStage: new Set(), fFreq: 0, fLevel: false, fSort: "freq",
  results: [], shown: 0,
  /* The token lists behind every annotated line on screen, keyed by line id,
     and the word card open over one of them. */
  lines: {}, sheet: null, fam: null,
  studyTab: "words", goalTimer: 0,
  /* Set by the home screen's pick-up card: the next render resumes the run
     rather than painting the decks. */
  resumeOnRender: false,
};

/* ---------------- data ---------------- */
async function talkData(){
  if(TK.data) return TK.data;
  const d = await loadData("talk/questions");
  TK.data = d;
  TK.byId = new Map(d.q.map(q => [q[Q.ID], q]));
  return d;
}
const talkAnswers = () => TK.ans ? Promise.resolve(TK.ans) : loadData("talk/answers").then(a => (TK.ans = a));
/* Counts only — for the home screen, which should not parse a megabyte to
   say how many questions there are. */
const talkMeta = () => loadData("talk/meta").catch(() => null);

/* ---------------- the record ---------------- */
async function talkEvents(){ return TK.events || (TK.events = await dbAll("talk")); }
async function talkSessions(){ return TK.sessions || (TK.sessions = await dbAll("talksess")); }
/* After an import or a reset the cached record is stale; the next read
   refetches it. Called from store.js. */
function forgetTalkRecord(){ TK.events = null; TK.sessions = null; TK.seen = null; TK.seenPid = null; }

/* ev = {q, at, how (0 asked · 1 deeper · 2 lighter · 3 skipped), depth, deck, secs, pid} */
async function talkRecord(ev){
  const events = await talkEvents();
  events.push(ev);
  if(TK.seen && TK.seenPid === ev.pid) TK.seen.add(ev.q);
  await dbAdd("talk", ev);
}

/* ---------------- people ---------------- */
/* Names are matched case-insensitively on the trimmed string: "lin" on
   Tuesday and "Lin" on Friday is the same person. */
const tkKey = nm => String(nm || "").trim().toLowerCase();
function talkPersonId(name, create){
  const k = tkKey(name);
  if(!k) return -1;
  let i = S.talkPeople.findIndex(p => tkKey(p) === k);
  if(i < 0 && create){ S.talkPeople.push(String(name).trim().slice(0, 24)); i = S.talkPeople.length - 1; save(); }
  return i;
}
/* What has already been used on this person. Per person rather than global:
   a good icebreaker should come back for the next stranger and should never
   come back for the same one. With nobody named, the list is what was asked
   in runs with nobody named. */
async function talkSeen(pid){
  if(TK.seen && TK.seenPid === pid) return TK.seen;
  const events = await talkEvents();
  TK.seenPid = pid;
  TK.seen = new Set(events.filter(e => e.pid === pid).map(e => e.q));
  return TK.seen;
}
async function setTalkPartner(name){
  S.talkPartner = String(name || "").trim().slice(0, 24);
  TK.pid = talkPersonId(S.talkPartner, true);
  save();
  await talkSeen(TK.pid);
}
function talkPersonStats(pid, events, sessions){
  let asked = 0, first = 0, last = 0, deepest = 0, runs = 0;
  const qs = new Set();
  for(const e of events){
    if(e.pid !== pid) continue;
    asked++; qs.add(e.q);
    if(!first || e.at < first) first = e.at;
    if(e.at > last) last = e.at;
    if(e.depth > deepest) deepest = e.depth;
  }
  for(const s of sessions) if(s.pid === pid) runs++;
  return {asked, covered: qs.size, first, last, deepest, runs};
}

/* Counts per question, from the record. */
async function talkCounts(){
  const cnt = new Map();
  for(const e of await talkEvents()) cnt.set(e.q, (cnt.get(e.q) || 0) + 1);
  return cnt;
}

/* Consecutive days ending today or yesterday — yesterday still counts, or the
   streak dies at midnight for anyone who talks at 11pm. */
function talkStreak(events){
  const days = new Set(events.map(e => startOfDay(e.at)));
  let probe = startOfDay();
  if(!days.has(probe)) probe -= DAY;
  let cur = 0;
  while(days.has(probe)){ cur++; probe -= DAY; }
  return {cur, activeDays: days.size};
}

/* ---------------- decks ---------------- */
const tkDeck = () => TK.run && TK.run.deck < 0 ? TK.custom : TK.data.decks[TK.run ? TK.run.deck : 0];
const tkDeckAt = i => i < 0 ? TK.custom : TK.data.decks[i];
const tkDeckName = i => i < 0 ? (TK.custom ? TK.custom.name : "Your selection") : ((TK.data.decks[i] || {}).name || "Deck");
const tkStages = d => [...new Set(d.ids.map(id => TK.byId.get(id)[Q.ST]))].sort();
/* The level a question is readable at, as the chip the rest of the app uses. */
const tkLevelChip = q => q[Q.HL] >= 8 ? `<span class="lv">Beyond HSK</span>` : lvChip(String(q[Q.HL]));
const tkAtLevel = q => q[Q.HL] <= +S.level;

/* The questions a deck still has to offer at one depth: not seen by this
   person, not past the sensitivity agreed, not on a muted topic — and, with
   the level filter on, readable at the level you work at. */
function talkPool(depth, exact){
  const r = TK.run, d = tkDeck(), out = [];
  const muted = new Set(S.talkMuted);
  for(const id of d.ids){
    const q = TK.byId.get(id);
    if(exact ? q[Q.ST] !== depth : q[Q.ST] > depth) continue;
    if(q[Q.SE] > Math.min(depth, r.sensOK)) continue;
    /* A muted topic is a standing preference about the shipped decks; it does
       not override a selection made by hand. */
    if(r.deck >= 0 && muted.has(q[Q.CA])) continue;
    if(S.talkLevelOnly && !tkAtLevel(q)) continue;
    if(TK.seen && TK.seen.has(id)) continue;
    out.push(q);
  }
  return out;
}

/* How much a topic is held back for having just come up. Uniform random over
   a pool where one category holds a third of the questions deals that
   category a third of the time, in clumps; this is what stops eight of twenty
   cards being about films. Grammar frames get a lighter version. */
const TK_CAT_PENALTY   = [0.06, 0.20, 0.40, 0.60, 0.78, 0.90, 0.96, 1];
const TK_FRAME_PENALTY = [0.35, 0.60, 0.80, 0.92, 1];
const tkPenalty = (list, val, table) => {
  const k = list.lastIndexOf(val);
  if(k < 0) return 1;
  const ago = list.length - 1 - k;
  return table[ago] != null ? table[ago] : 1;
};

/* Weighted toward the common end: a question scoring 100 is about six times
   as likely as one scoring 0, so the language you meet first is the language
   you will actually hear — but only tilted, or every run would be the same. */
function talkDraw(){
  const r = TK.run;
  let p = talkPool(r.depth, true);
  if(!p.length) p = talkPool(r.depth, false);
  if(!p.length && TK.seen && TK.seen.size){
    /* Everything this person could be asked has been asked: start over with
       them rather than stalling. */
    TK.seen.clear(); p = talkPool(r.depth, false);
  }
  if(!p.length) return null;
  let total = 0;
  const w = p.map(q => {
    let x = 1 + (q[Q.SC] | 0) / 20;
    x *= tkPenalty(TK.recentCat, q[Q.CA], TK_CAT_PENALTY);
    x *= tkPenalty(TK.recentFrame, q[Q.FR], TK_FRAME_PENALTY);
    total += x;
    return x;
  });
  let hit = p[p.length - 1], t = Math.random() * total;
  for(let i = 0; i < p.length; i++){ t -= w[i]; if(t <= 0){ hit = p[i]; break; } }
  TK.recentCat.push(hit[Q.CA]);   if(TK.recentCat.length > 8) TK.recentCat.shift();
  TK.recentFrame.push(hit[Q.FR]); if(TK.recentFrame.length > 8) TK.recentFrame.shift();
  return hit;
}

/* ---------------- the view ---------------- */
async function renderTalk(){
  await Promise.all([talkData(), lexicon()]);
  if(TK.resumeOnRender){ TK.resumeOnRender = false; return resumeTalkRun(); }
  TK.pid = talkPersonId(S.talkPartner, false);
  if(S.talkPartner && TK.pid < 0) TK.pid = talkPersonId(S.talkPartner, true);
  await talkSeen(TK.pid);

  const running = !!TK.run;
  $("#talk-idle").classList.toggle("hidden", running);
  $("#talk-run").classList.toggle("hidden", !running);
  $("#talk-done").classList.add("hidden");
  if(running){ paintTalkRun(); return; }

  /* A run the page was closed on. Recent enough, it is offered back; older
     than that it was not a conversation you are still having, so it is
     banked as a finished run. */
  const snap = S.talkRun;
  if(snap && Date.now() - (snap.at || 0) > TK_RESUME_MS){ await bankTalkSnapshot(snap); }

  $("#tksearch").value = TK.query;
  $("#tk-browse").setAttribute("aria-pressed", String(TK.browse));
  const browsing = TK.browse || !!TK.query.trim();
  $("#talk-home").classList.toggle("hidden", browsing);
  $("#talk-browse").classList.toggle("hidden", !browsing);
  if(browsing){ paintTalkFilters(); talkSearch(); return; }

  /* The set-up panels open folded the first time, so the screen is the
     decks and not a page of switches; from then on it is whatever was left. */
  if(S.talkFoldsSet !== 2){
    S.talkFoldsSet = 2;
    /* Already wired by boot, before the list changed: set each by hand. */
    const set = (k, closed) => {
      S.folded = S.folded.filter(x => x !== k);
      if(closed) S.folded.push(k);
      const panel = $(`.panel[data-fold="${k}"]`), h3 = panel && panel.querySelector(":scope > h3");
      if(panel){ panel.classList.toggle("folded", closed); if(h3) h3.setAttribute("aria-expanded", String(!closed)); }
    };
    for(const k of ["talk-options", "talk-topics", "talk-saved"]) set(k, true);
    set("talk-how", false);   // the one panel in the side column, and it reads better open
    save();
  }
  paintTalkResume();
  paintTalkQotd();
  paintTalkPeople();
  paintTalkDecks();
  paintTalkOptions();
  paintTalkTopics();
  paintTalkSaved();
  setupFolds();
}

/* ---------------- the decks screen ---------------- */
function paintTalkResume(){
  const host = $("#talk-resume"), snap = S.talkRun;
  if(!snap || !TK.byId.get(snap.cur)){ host.hidden = true; host.innerHTML = ""; return; }
  const who = snap.pid >= 0 ? S.talkPeople[snap.pid] : "";
  host.hidden = false;
  host.innerHTML = `
    <button class="pick" data-talkresume>
      <span class="pk-ic">${homeIcon("talk")}</span>
      <span class="pk-body">
        <span class="pk-k">Pick up the conversation</span>
        <span class="pk-t">${esc(snap.name || tkDeckName(snap.deck))}${who ? ` · with ${esc(who)}` : ""}</span>
        <span class="pk-m">${snap.asked} asked · ${esc(TK_STAGE[snap.depth - 1])} · ${agoText(snap.at)}</span>
      </span>
    </button>
    <button class="pick" data-talkdrop>
      <span class="pk-ic">${homeIcon("close")}</span>
      <span class="pk-body">
        <span class="pk-k">Or close it</span>
        <span class="pk-t">Count it and start fresh</span>
        <span class="pk-m">The ${snap.asked} question${snap.asked === 1 ? "" : "s"} stay in your record</span>
      </span>
    </button>`;
}

/* One high-frequency question, the same one all day, seeded by the date —
   a rotation rather than a random pick. Preferably one readable at your
   level; the whole common band where the level is too low to fill a month. */
function talkQotd(){
  const all = TK.data.q.filter(q => q[Q.SC] >= 70 && q[Q.SE] <= 3);
  const mine = all.filter(q => q[Q.HL] <= Math.max(3, +S.level));
  const pool = mine.length >= 60 ? mine : all;
  if(!pool.length) return TK.data.q[0];
  const d = new Date();
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = (key ^ 0x5F37) * 2654435761 % 2147483647;
  return pool[Math.abs(h) % pool.length];
}
function paintTalkQotd(){
  const q = talkQotd();
  const tokens = segment(q[Q.ZH]);
  TK.lines.qotd = tokens;
  $("#talk-qotd-meta").textContent = new Date().toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "long"});
  $("#talk-qotd").innerHTML = `
    <div class="qq">${esc(q[Q.EN])}</div>
    <div class="cpdialogue talk-zh qz" data-talkline="qotd" data-tint="${S.talkTint ? "level" : "off"}" data-ruby="${S.talkRuby ? "on" : "off"}">
      <div class="cphz">${annotateHTML(tokens, {mode: "level", ruby: true})}</div></div>
    ${S.pinyin && !S.talkRuby ? `<div class="qp py">${pinyinHTML(readingOf(q[Q.ZH]))}</div>` : ""}
    <div class="qacts">
      <button class="btn sm" data-talkopen="${q[Q.ID]}">Ask this one</button>
      <span class="lbl" style="margin-left:auto;display:flex;gap:6px;align-items:center">${tkLevelChip(q)} freq ${q[Q.SC]}</span>
    </div>`;
}

function paintTalkPeople(){
  $("#talk-partner").value = S.talkPartner;
  const events = TK.events || [], sessions = TK.sessions || [];
  const rows = S.talkPeople.map((nm, i) => ({nm, i, ...talkPersonStats(i, events, sessions)}))
    .sort((a, b) => b.last - a.last);
  $("#talk-who-meta").textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "person" : "people"}` : "nobody yet";
  $("#talk-people").innerHTML = rows.slice(0, 12).map(p => `
    <button class="person${tkKey(p.nm) === tkKey(S.talkPartner) ? " on" : ""}" data-talkperson="${esc(p.nm)}">
      <b>${esc(p.nm)}</b>
      <small>${p.covered ? `${num(p.covered)} asked` : "new"}</small>
    </button>`).join("");
}

/* Every deck, with how much of it is left for this person and, with the
   level filter on, how much of it you can already read. */
function paintTalkDecks(){
  const seen = TK.seen || new Set();
  const muted = new Set(S.talkMuted);
  $("#tk-level").setAttribute("aria-pressed", String(!!S.talkLevelOnly));
  $("#tk-level").textContent = `Readable at HSK ${levelLabel(S.level)}`;
  $("#talk-decks").innerHTML = TK.data.decks.map((d, i) => {
    const st = tkStages(d);
    const rows = d.ids.map(id => TK.byId.get(id));
    const open = rows.filter(q => !muted.has(q[Q.CA]) && (!S.talkLevelOnly || tkAtLevel(q)));
    const left = open.filter(q => !seen.has(q[Q.ID])).length;
    const atLevel = rows.filter(tkAtLevel).length;
    return `<button class="deck" data-talkdeck="${i}" style="--dc:${tkHeat(st[0])}"
      title="${esc(d.why)} · ${TK_STAGE[st[0] - 1]}${st.length > 1 ? ` to ${TK_STAGE[st[st.length - 1] - 1]}` : ""}">
      <span class="spine"></span><b>${esc(d.name)}<span class="tk-deckstage">${TK_STAGE[st[0] - 1]}${st.length > 1 ? ` → ${TK_STAGE[st[st.length - 1] - 1]}` : ""}</span></b>
      <span class="cnt">${num(left < open.length ? left : open.length)}${left < open.length ? " left" : " cards"}<br>${num(atLevel)} at HSK ${levelLabel(S.level)}</span>
      <small>${esc(d.why)}</small>
    </button>`;
  }).join("");
}

function paintTalkOptions(){
  $$("#tk-mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === S.talkMode)));
  $$("#tk-goal button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.g === (S.talkGoal | 0))));
  $("#sw-tk-ruby").setAttribute("aria-pressed", String(!!S.talkRuby));
  $("#sw-tk-tint").setAttribute("aria-pressed", String(!!S.talkTint));
  $("#sw-tk-study").setAttribute("aria-pressed", String(!!S.talkStudy));
}

function paintTalkTopics(){
  const muted = new Set(S.talkMuted);
  $("#talk-muted-n").textContent = muted.size;
  $("#talk-topics").innerHTML = TK.data.categories.map((c, i) =>
    `<button class="topic" data-talktopic="${i}" aria-pressed="${muted.has(i)}">${esc(c)}</button>`).join("");
}

function paintTalkSaved(){
  const list = S.talkSaved.map(id => TK.byId.get(id)).filter(Boolean);
  $("#talk-saved-meta").textContent = list.length ? `${list.length} saved · tap one to ask it` : "nothing saved yet";
  $("#talk-saved-acts").classList.toggle("hidden", !list.length);
  $("#talk-saved").innerHTML = list.length
    ? `<div class="hits">${list.map(q => talkHitHTML(q, "")).join("")}</div>`
    : `<p class="pmeta">Tap the bookmark on a card to keep it here — the questions you want to come back to.</p>`;
}

/* ---------------- browse ---------------- */
const tkStrip = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let TK_INDEX = null;
/* English, Chinese and the pinyin read off the syllabus, so "ni hao" finds
   the question as well as 你好 does. */
const tkIndex = () => TK_INDEX || (TK_INDEX = TK.data.q.map(q => `${tkStrip(q[Q.EN])} ${q[Q.ZH]} ${tkStrip(readingOf(q[Q.ZH]))}`));

function paintTalkFilters(){
  const chip = (attr, v, label, on) => `<button class="fchip" data-${attr}="${v}" aria-pressed="${on}">${label}</button>`;
  $("#tk-f-sens").innerHTML = `<span class="lbl">Sensitivity</span>` + [1,2,3,4,5].map(n => chip("tks", n, `${n} ${TK_SENS[n - 1]}`, TK.fSens.has(n))).join("");
  $("#tk-f-stage").innerHTML = `<span class="lbl">Stage</span>` + [1,2,3,4,5].map(n => chip("tkt", n, TK_STAGE[n - 1], TK.fStage.has(n))).join("");
  $("#tk-f-freq").innerHTML = `<span class="lbl">Frequency</span>` + [0,50,70,80,90].map(n => chip("tkq", n, n ? `${n}+` : "Any", n === TK.fFreq)).join("")
    + chip("tkl", 1, `Readable at HSK ${levelLabel(S.level)}`, TK.fLevel);
  $("#tk-f-sort").innerHTML = `<span class="lbl">Order</span>` + [["freq", "Most common"], ["level", "Easiest first"], ["order", "Bank order"], ["asked", "Least asked"]]
    .map(([k, l]) => chip("tko", k, l, k === TK.fSort)).join("");
}

/* Mark the run of text the search matched. The offset is found in the
   stripped copy and the three pieces escaped separately, so a question with
   an angle bracket in it cannot inject markup. */
function tkHilite(text, term){
  if(!term) return esc(text);
  const i = tkStrip(text).indexOf(term);
  if(i < 0) return esc(text);
  return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + term.length)) + "</mark>" + esc(text.slice(i + term.length));
}
function talkHitHTML(q, term){
  return `<button class="hit" data-talkopen="${q[Q.ID]}" style="--dc:${tkHeat(q[Q.ST])}">
    <span class="spine"></span>
    <span><span class="he">${tkHilite(q[Q.EN], term)}</span>
      <span class="hz">${esc(q[Q.ZH])}</span>
      <span class="hm">${tkLevelChip(q)} · ${TK_STAGE[q[Q.ST] - 1]} · sens ${q[Q.SE]} · freq ${q[Q.SC]} · ${esc(TK.data.categories[q[Q.CA]])}</span>
    </span></button>`;
}

async function talkSearch(){
  const idx = tkIndex();
  const term = tkStrip(TK.query.trim());
  const cnt = TK.fSort === "asked" ? await talkCounts() : null;
  const out = [];
  for(let i = 0; i < TK.data.q.length; i++){
    const q = TK.data.q[i];
    if(TK.fSens.size && !TK.fSens.has(q[Q.SE])) continue;
    if(TK.fStage.size && !TK.fStage.has(q[Q.ST])) continue;
    if(TK.fFreq && q[Q.SC] < TK.fFreq) continue;
    if(TK.fLevel && !tkAtLevel(q)) continue;
    if(term && !idx[i].includes(term)) continue;
    out.push(q);
  }
  if(TK.fSort === "freq")       out.sort((a, b) => b[Q.SC] - a[Q.SC] || a[Q.ID] - b[Q.ID]);
  else if(TK.fSort === "level") out.sort((a, b) => a[Q.HL] - b[Q.HL] || b[Q.SC] - a[Q.SC]);
  else if(TK.fSort === "asked") out.sort((a, b) => ((cnt.get(a[Q.ID]) || 0) - (cnt.get(b[Q.ID]) || 0)) || b[Q.SC] - a[Q.SC]);
  TK.results = out;
  TK.shown = Math.min(TK_PAGE, out.length);
  paintTalkHits();
}
function paintTalkHits(){
  const n = TK.results.length, term = tkStrip(TK.query.trim());
  $("#tk-hitcount").textContent = `${num(n)} question${n === 1 ? "" : "s"}${TK.shown < n ? ` · showing ${TK.shown}` : ""}`;
  $("#tk-practice").disabled = !n;
  $("#tk-practice").textContent = n ? `Practise these ${num(n)}` : "Practise these";
  $("#tk-random").disabled = !n;
  if(!n){
    $("#tk-hits").innerHTML = `<div class="empty">Nothing matches that.<br>Try fewer filters, or search the Chinese instead.</div>`;
    $("#tk-more").classList.add("hidden");
    return;
  }
  $("#tk-hits").innerHTML = TK.results.slice(0, TK.shown).map(q => talkHitHTML(q, term)).join("");
  const more = n - TK.shown;
  $("#tk-more").classList.toggle("hidden", more <= 0);
  $("#tk-more").textContent = `Show ${Math.min(TK_PAGE, more)} more · ${num(more)} left`;
}

/* ---------------- a run ---------------- */
function talkStart(i, jumpTo){
  const d = tkDeckAt(i);
  if(!d || !d.ids.length){ toast("That deck is empty"); return; }
  const lo = tkStages(d)[0];
  const deckMax = Math.max(...d.ids.map(id => TK.byId.get(id)[Q.SE]));
  const open = async () => {
    TK.run = {deck: i, depth: lo, sensOK: lo >= 4 ? Math.max(lo, deckMax) : Math.min(3, deckMax),
              asked: 0, topics: [], deepest: lo, cur: null, revealed: false,
              start: Date.now(), shownAt: 0, pid: TK.pid};
    TK.hist = []; TK.recentCat = []; TK.recentFrame = [];
    await talkShowRun();
    if(!TK.run) return;   // ended before the deck was even on screen
    if(jumpTo){
      TK.run.cur = jumpTo; TK.run.shownAt = Date.now();
      TK.run.depth = clamp(jumpTo[Q.ST], lo, tkStages(d).slice(-1)[0]);
      TK.run.sensOK = Math.max(TK.run.sensOK, jumpTo[Q.SE]);
      TK.run.deepest = TK.run.depth;
      paintTalkRun(); saveTalkRun();
    }else talkNext(0);
  };
  /* A deck that starts at depth 4 needs the consent check up front, or its
     opening pool would be empty. */
  if(lo >= 4 && deckMax >= 4) talkConsent(lo, () => safely("start the deck", open), () => {});
  else safely("start the deck", open);
}

async function talkShowRun(){
  TK.fam = await familiarity().catch(() => ({words: new Map(), chars: new Map()}));
  $("#talk-idle").classList.add("hidden");
  $("#talk-done").classList.add("hidden");
  $("#talk-run").classList.remove("hidden");
  $("#tk-study-body").classList.toggle("hidden", !S.talkStudy);
  $("#tk-study-toggle").setAttribute("aria-expanded", String(!!S.talkStudy));
  clearInterval(TK.goalTimer);
  TK.goalTimer = setInterval(() => { if(TK.run && S.view === "talk") paintTalkGoal(); }, 1000);
  window.scrollTo({top: 0});
}

/* Snapshot of the run, for the phone that evicts the page mid-conversation. */
function saveTalkRun(){
  const r = TK.run;
  S.talkRun = r && r.cur ? {
    deck: r.deck, depth: r.depth, sensOK: r.sensOK, asked: r.asked, topics: r.topics, deepest: r.deepest,
    cur: r.cur[Q.ID], start: r.start, at: Date.now(), pid: r.pid, name: tkDeckName(r.deck),
    customIds: r.deck < 0 && TK.custom ? TK.custom.ids : null, customName: r.deck < 0 && TK.custom ? TK.custom.name : "",
    hist: TK.hist.map(h => [h.q[Q.ID], h.depth]).slice(-TK_HIST_CAP),
  } : null;
  save();
}
async function resumeTalkRun(){
  await Promise.all([talkData(), lexicon()]);
  const snap = S.talkRun;
  const cur = snap && TK.byId.get(snap.cur);
  if(!cur){ S.talkRun = null; save(); return; }
  if(snap.deck < 0){
    const ids = (snap.customIds || []).filter(id => TK.byId.has(id));
    if(!ids.length){ S.talkRun = null; save(); return; }
    TK.custom = {name: snap.customName || "Your selection", why: `${ids.length} questions you picked.`, ids};
  }
  TK.pid = snap.pid;
  S.talkPartner = snap.pid >= 0 ? (S.talkPeople[snap.pid] || "") : "";
  await talkSeen(TK.pid);
  TK.run = {deck: snap.deck, depth: snap.depth, sensOK: snap.sensOK, asked: snap.asked, topics: snap.topics || [],
            deepest: snap.deepest, cur, revealed: false, start: snap.start || Date.now(), shownAt: Date.now(), pid: snap.pid};
  TK.hist = (snap.hist || []).map(([id, depth]) => ({q: TK.byId.get(id), depth})).filter(h => h.q);
  TK.recentCat = []; TK.recentFrame = [];
  await talkShowRun();
  paintTalkRun();
}
/* A run too old to resume is written into the record as it stood. */
async function bankTalkSnapshot(snap){
  S.talkRun = null; save();
  if(!snap || !(snap.asked > 0)) return;
  const row = {at: snap.start || snap.at, to: snap.at, deck: snap.deck, name: snap.customName || "",
               asked: snap.asked, deepest: snap.deepest, topics: (snap.topics || []).length, pid: snap.pid};
  (await talkSessions()).push(row);
  await dbAdd("talksess", row);
}

function paintTalkRun(){
  placeTalkStudy();
  paintTalkCard(); paintTalkGauge(); paintTalkGoal();
}

/* Where the study panel lives: under the card until 1400px, beside it in the
   side column from there (see the stylesheet). The node is moved rather than
   duplicated, so its handlers and its open state come with it. */
function placeTalkStudy(){
  const study = $("#tk-study"), side = $("#tk-side"), run = $("#talk-run"), main = $("#main");
  if(!study || !side) return;
  /* Measured on the main column, not the window: a tablet with the rail
     folded has 170px more than the same tablet with it open. */
  const room = main ? main.clientWidth : window.innerWidth;
  const wide = window.innerWidth >= 1100 && room >= 1040;
  run.classList.toggle("side-study", wide);
  run.classList.toggle("side-study-xl", wide && room >= 1400);
  if(wide && study.parentElement !== side) side.appendChild(study);
  else if(!wide && study.parentElement !== run) run.insertBefore(study, $("#tk-ctl"));
}

/* how: 0 asked · 1 deeper · 2 lighter · 3 skipped */
function talkNext(how){
  const r = TK.run; if(!r) return;
  if(r.cur){
    const ev = {q: r.cur[Q.ID], at: Date.now(), how: how | 0, depth: r.depth, deck: r.deck,
                secs: Math.min(3600, Math.round((Date.now() - r.shownAt) / 1000)), pid: r.pid};
    safely("record that question", () => talkRecord(ev));
    if(TK.seen) TK.seen.add(r.cur[Q.ID]);
    r.asked++;
    if(!r.topics.includes(r.cur[Q.CA])) r.topics.push(r.cur[Q.CA]);
    TK.hist.push({q: r.cur, depth: r.depth});
    if(TK.hist.length > TK_HIST_CAP) TK.hist.shift();
  }
  r.deepest = Math.max(r.deepest, r.depth);
  r.cur = talkDraw(); r.revealed = false; r.shownAt = Date.now();
  closeTalkGloss();
  paintTalkRun(); saveTalkRun();
}

/* Back to the card before this one. Deliberately not an undo: the record
   already has that question, so this only changes what is on screen. */
function talkBack(){
  const prev = TK.hist.pop();
  if(!prev || !TK.run) return;
  if(TK.seen) TK.seen.delete(prev.q[Q.ID]);
  TK.run.cur = prev.q; TK.run.depth = prev.depth; TK.run.revealed = false; TK.run.shownAt = Date.now();
  closeTalkGloss();
  paintTalkRun(); saveTalkRun();
}

function talkMove(dir){
  const r = TK.run; if(!r) return;
  const st = tkStages(tkDeck()), lo = st[0], hi = st[st.length - 1];
  const want = clamp(r.depth + dir, lo, hi);
  const how = dir > 0 ? 1 : 2;
  if(want === r.depth && dir > 0){ talkNext(how); return; }
  if(dir > 0 && want >= 4 && r.sensOK < want){
    talkConsent(want, () => { r.sensOK = want; r.depth = want; talkNext(how); }, paintTalkGauge);
    return;
  }
  r.depth = want; talkNext(how);
}

/* Past sensitivity 3 the other person has to be up for it, and with a
   stranger online that means asking first. */
function talkConsent(level, yes, no){
  const dlg = $("#talk-gate");
  $("#tk-gate-h").textContent = level === 5 ? "The deepest rung" : "This is where it gets personal";
  $("#tk-gate-p").textContent = TK_GATE[level];
  /* Answered through the buttons (boot.js), not the dialog's close event: the
     out animation closes the box a beat later, and the answer should not
     wait on it. Escape and the backdrop both read as "stay lighter". */
  TK.gate = {yes, no};
  dlg.classList.remove("closing");
  dlg.showModal();
}
function answerTalkGate(answer){
  const dlg = $("#talk-gate"), cb = TK.gate;
  TK.gate = null;
  closeDialog(dlg);
  if(cb) (answer === "yes" ? cb.yes : cb.no)();
}

async function talkFinish(showRecap){
  const r = TK.run; if(!r) return;
  clearInterval(TK.goalTimer);
  closeTalkGloss();
  const ran = Date.now() - r.start;
  TK.run = null; S.talkRun = null; save();
  if(r.asked > 0){
    const row = {at: r.start, to: Date.now(), deck: r.deck, name: r.deck < 0 && TK.custom ? TK.custom.name : "",
                 asked: r.asked, deepest: r.deepest, topics: r.topics.length, pid: r.pid};
    (await talkSessions()).push(row);
    await dbAdd("talksess", row);
  }
  if(!showRecap) return;
  const hitGoal = S.talkGoal && r.asked >= S.talkGoal;
  const perCard = r.asked ? Math.round(ran / 1000 / r.asked) : 0;
  const streak = talkStreak(await talkEvents());
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const stat = (k, v) => `<div class="rstat"><span>${k}</span><b>${v}</b></div>`;
  $("#talk-run").classList.add("hidden");
  $("#talk-done").classList.remove("hidden");
  $("#talk-done").innerHTML = `
    <div class="panel">
      <h3>${hitGoal ? "Goal reached" : r.asked >= 12 ? "That was a long one" : r.asked >= 4 ? "That was a good run" : "A short one"}
        <span class="lbl" style="font-weight:500">${esc(tkDeckName(r.deck))}${r.pid >= 0 ? ` · with ${esc(S.talkPeople[r.pid] || "")}` : ""}</span></h3>
      <div class="recap">
        ${stat("Questions asked", `${r.asked}${S.talkGoal ? ` / ${S.talkGoal}` : ""}`)}
        ${stat("Time on the deck", mmss(ran))}
        ${perCard ? stat("Average per card", `${perCard}s`) : ""}
        ${stat("Deepest rung reached", TK_STAGE[r.deepest - 1])}
        ${stat("Topics touched", r.topics.length)}
        ${stat("Day streak", streak.cur)}
      </div>
      <div class="act-row" style="margin-top:14px">
        <button class="btn" data-talkagain="${r.deck}">Same deck again</button>
        <button class="ghost" data-talkhome>Back to the decks</button>
      </div>
    </div>`;
  window.scrollTo({top: 0});
}

/* ---------------- the card ---------------- */
function paintTalkCard(){
  const r = TK.run, q = r && r.cur;
  const card = $("#tk-card");
  if(!q){
    card.style.setProperty("--dc", "var(--line)");
    $("#tk-chips").innerHTML = "";
    $("#tk-en").textContent = "You have been through every question at this depth.";
    $("#tk-zh").innerHTML = ""; $("#tk-py").innerHTML = "";
    $("#tk-frame").textContent = ""; $("#tk-id").textContent = "";
    $("#tk-reveal").classList.add("hidden");
    $("#tk-study").classList.add("hidden");
    $("#tk-en").classList.remove("hidden"); $("#tk-zhblock").classList.add("hidden");
    return;
  }
  const times = (TK.events || []).reduce((n, e) => n + (e.q === q[Q.ID] ? 1 : 0), 0);
  card.style.setProperty("--dc", tkHeat(q[Q.ST]));
  $("#tk-chips").innerHTML =
    `<span class="chip depth">${TK_STAGE[q[Q.ST] - 1]}</span>` +
    `<span class="chip sens${q[Q.SE]}">${q[Q.SE]} · ${TK_SENS[q[Q.SE] - 1]}</span>` +
    tkLevelChip(q) +
    `<span class="chip">${esc(TK.data.categories[q[Q.CA]])}</span>` +
    `<span class="chip" title="How common this question is in real conversation, 0–100">freq ${q[Q.SC]}</span>` +
    (q[Q.PR] ? `<span class="chip">Prompt</span>` : "") +
    (times ? `<span class="chip">asked ${times}×</span>` : "");

  const tokens = segment(q[Q.ZH]);
  TK.lines = {q: tokens};
  $("#tk-en").textContent = q[Q.EN];
  const zh = $("#tk-zh");
  zh.dataset.tint = S.talkTint ? "level" : "off";
  zh.dataset.ruby = S.talkRuby ? "on" : "off";
  zh.innerHTML = `<div class="cphz">${annotateHTML(tokens, {mode: "level", ruby: true})}</div>`;
  $("#tk-py").innerHTML = pinyinHTML(readingOf(q[Q.ZH]));
  $("#tk-py").classList.toggle("hidden", !S.pinyin || !!S.talkRuby);
  $("#tk-frame").textContent = q[Q.FR] != null ? TK.data.frames[q[Q.FR]] : "";
  $("#tk-id").textContent = `Q${String(q[Q.ID]).padStart(4, "0")}`;
  $("#tk-save").setAttribute("aria-pressed", String(S.talkSaved.includes(q[Q.ID])));

  /* Which language leads, and which is hidden until you try. The nodes never
     move — flex order does it. */
  const one = S.talkMode !== "both", zhFirst = S.talkMode === "zh";
  $("#tk-en").style.order = zhFirst ? 3 : 1;
  $("#tk-zhblock").style.order = zhFirst ? 1 : 3;
  $("#tk-en").classList.toggle("hidden", zhFirst && one && !r.revealed);
  $("#tk-zhblock").classList.toggle("hidden", !zhFirst && one && !r.revealed);
  $("#tk-reveal").classList.toggle("hidden", !one || r.revealed);
  $("#tk-reveal").textContent = zhFirst ? "Show the English" : "Show the 中文";

  $("#tk-s-asked").textContent = r.asked;
  $("#tk-s-depth").textContent = r.depth;
  $("#tk-s-left").textContent = num(talkPool(r.depth, true).length);
  $("#tk-s-saved").textContent = S.talkSaved.length;
  $("#tk-back").disabled = !TK.hist.length;
  paintTalkStudy();
}

function paintTalkGauge(){
  const r = TK.run; if(!r) return;
  const d = tkDeck(), st = tkStages(d), lo = st[0], hi = st[st.length - 1];
  $("#tk-rungs").innerHTML = [1,2,3,4,5].map(n => {
    const inDeck = n >= lo && n <= hi;
    const cls = [inDeck && n <= r.depth ? "reached" : "", n === r.depth ? "here" : "", !inDeck ? "locked" : ""].join(" ");
    return `<div class="rung ${cls}" style="--rc:${tkHeat(n)}">
      <span class="bar" style="width:${40 + (n - 1) * 15}%"></span><span class="name">${TK_STAGE[n - 1]}</span>
      <span class="n">${inDeck ? `${num(talkPool(n, true).length)} more` : "not in this deck"}</span></div>`;
  }).join("");
  $("#tk-deck-name").textContent = d.name;
  const cap = Math.min(r.sensOK, r.depth);
  $("#tk-deck-rule").textContent = cap <= 1 ? "safe questions only" : `nothing past ${TK_SENS[cap - 1].toLowerCase()}`;
}

function paintTalkGoal(){
  const r = TK.run; if(!r) return;
  const goal = S.talkGoal | 0;
  const ms = Date.now() - r.start, s = Math.max(0, Math.floor(ms / 1000));
  const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  $("#tk-goal-l").textContent = goal ? `Goal · ${goal} questions` : "This run";
  $("#tk-goal-v").textContent = `${goal ? `${r.asked} / ${goal}` : `${r.asked} asked`} · ${time}`;
  $("#tk-goal-fill").style.width = `${Math.round(Math.min(1, r.asked / (goal || 20)) * 100)}%`;
  $("#tk-goalbar").classList.toggle("done", !!goal && r.asked >= goal);
  const who = r.pid >= 0 ? S.talkPeople[r.pid] : "";
  $("#tk-goal-who").textContent = who ? `with ${who}` : "";
  $("#tk-goal-who").classList.toggle("hidden", !who);
}

/* ---------------- the study panel ---------------- */
/* Under every card: the words the question is made of, each with its level,
   reading and gloss and a way into the deck; and a sample answer. */
function paintTalkStudy(){
  const q = TK.run && TK.run.cur;
  const host = $("#tk-study");
  if(!q){ host.classList.add("hidden"); return; }
  host.classList.remove("hidden");
  $$("#tk-study-tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s === TK.studyTab)));

  const tokens = TK.lines.q || [];
  const words = [], seenW = new Set();
  for(const t of tokens){ if(t.t === "x" || seenW.has(t.w)) continue; seenW.add(t.w); words.push(t); }
  const beyond = words.filter(t => !t.lv).length;
  const newW = words.filter(t => t.t === "w" && t.id && TK.fam && familiarityOf(t, TK.fam) === 0).length;
  $("#tk-study-sum").textContent = `${words.length} word${words.length === 1 ? "" : "s"}`
    + (newW ? ` · ${newW} not in your deck` : "") + (beyond ? ` · ${beyond} beyond HSK` : "");

  if($("#tk-study-body").classList.contains("hidden")) return;
  const pane = $("#tk-study-pane");
  if(TK.studyTab === "words") pane.innerHTML = talkWordsHTML(words);
  else{
    pane.innerHTML = `<p class="pmeta">Loading the sample answer…</p>`;
    talkAnswers().then(() => { if(TK.run && TK.run.cur === q && TK.studyTab === "answer") pane.innerHTML = talkAnswerHTML(q); })
      .catch(() => { pane.innerHTML = `<p class="pmeta">The sample answers could not be loaded — run <b>npm run talk</b>.</p>`; });
  }
}

function talkWordsHTML(words){
  if(!words.length) return `<div class="empty">No words to show in this one.</div>`;
  return `<div class="wlist">${words.map((t, i) => {
    const fam = TK.fam && t.t === "w" && t.id ? familiarityOf(t, TK.fam) : null;
    const gloss = Array.isArray(t.en) ? t.en.slice(0, 2).join("; ") : (t.en || "");
    return `<div class="wrow tk-wrow">
      <button class="wh hz" data-talkword="q:${tokenIndexOf(t)}" title="Open the writing card">${esc(t.w)}</button>
      <span class="wp py">${pinyinHTML(t.p)}</span>
      <span class="we">${esc(gloss) || "<i>not in the standard</i>"}</span>
      <span class="wl">${t.lv ? lvChip(t.lv) : `<span class="lv">Beyond HSK</span>`}
        ${t.t === "w" && t.id ? `<button class="mini tk-deckbtn" data-tkdeck="${esc(t.id)}:${esc(t.lv)}" aria-pressed="${fam > 0}"
            title="${fam === 2 ? "Known — in your deck" : fam === 1 ? "In your deck — tap to remove" : "Add to your deck"}">
            ${fam === 2 ? "✓" : fam === 1 ? "●" : "+"}</button>` : ""}
      </span>
    </div>`;
  }).join("")}</div>`;
}
/* The index of a token in the question's list, for the tap that opens it. */
const tokenIndexOf = t => (TK.lines.q || []).indexOf(t);

/* Roughly how long a passage takes to say: 135 words a minute for English,
   220 characters for Mandarin — so you can see whether you are looking at a
   ten-second reply or the two minutes an examiner is waiting for. */
function tkSpeakSecs(en, zh){
  const w = String(en).trim().split(/\s+/).filter(Boolean).length;
  const c = (String(zh).match(/[一-鿿]/g) || []).length;
  return Math.round(Math.max(w / 135, c / 220) * 60);
}
const tkMmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* Three sources, closest fit first, and the panel says which it got:
   exact — written for this question; topic — a full-length answer for this
   topic and this question shape; frame — the bare four-move scaffold. */
function talkAnswerFor(q){
  const A = TK.ans; if(!A) return null;
  const row = A.exact.find(r => r[0] === q[Q.ID]);
  if(row) return {source: "exact", parts: [0,1,2,3].map(i => [row[1][i], row[2][i]])};
  const shape = A.frameKind[q[Q.FR]] || "open";
  const cat = A.topic && A.topic[q[Q.CA]];
  if(cat){
    const hit = cat[shape] || cat[(A.topicFallback || {})[q[Q.CA]]];
    if(hit) return {source: "topic", shape, parts: hit, topicName: TK.data.categories[q[Q.CA]]};
  }
  const kind = A.scaffold[shape] || A.scaffold.open;
  return kind ? {source: "frame", kind: kind.nm, parts: [kind.a, kind.r, kind.e, kind.c]} : null;
}

function talkAnswerHTML(q){
  const a = talkAnswerFor(q);
  if(!a) return `<div class="empty">No answer for this one.</div>`;
  const full = a.source !== "frame";
  const total = a.parts.reduce((s, p) => s + tkSpeakSecs(p[0], p[1]), 0);
  const note = a.source === "exact"
    ? `A full-length answer to this exact question — about ${tkMmss(total)} spoken, the length an examiner is waiting for. Read it, then say your own version. The structure and the level of detail are what to copy, not the content.`
    : a.source === "topic"
    ? `A full-length answer to a question of this kind — about ${tkMmss(total)} spoken. It is not about this exact question: it is the length, the shape and the vocabulary a good answer on ${esc((a.topicName || "").split(/[,&]/)[0].toLowerCase().trim())} needs. Put your own content through it and keep everything else.`
    : `There is no written answer for this one, so here is the shape to build one in, chosen to fit how the question is asked (${esc(a.kind)}). The middle two are yours, and the example is the part that should take longest.`;
  return `<p class="pmeta">${note}</p><div class="arec">` + a.parts.map((p, i) => {
    const [k, nm, how] = TK.ans.parts[i];
    const secs = full ? tkSpeakSecs(p[0], p[1]) : 0;
    const tokens = segment(p[1]);
    TK.lines[`a${i}`] = tokens;
    return `<div class="apart${full ? "" : " frame"}">
      <span class="ak">${k}</span>
      <span class="an">${esc(nm)}${secs ? `<i class="asec">${secs}s</i>` : ""}<small>${esc(how)}</small></span>
      <div class="az cpdialogue talk-zh" data-talkline="a${i}" data-tint="${S.talkTint ? "level" : "off"}" data-ruby="${S.talkRuby ? "on" : "off"}">
        <div class="cphz">${annotateHTML(tokens, {mode: "level", ruby: true})}</div></div>
      ${S.pinyin && !S.talkRuby ? `<span class="ap py">${pinyinHTML(readingOf(p[1]))}</span>` : ""}
      <span class="ae second">${esc(p[0])}</span>
    </div>`;
  }).join("") + `</div>`;
}

/* ---------------- the word card on a line ---------------- */
/* The same popover the reader uses, anchored to a word in the
   question or a sample answer. `data-talkline` on the container names which
   token list the word's index reads from. */
function openTalkGloss(wordEl, opts = {}){
  const line = wordEl.closest("[data-talkline]");
  const tokens = line && TK.lines[line.dataset.talkline];
  const tok = tokens && tokens[+wordEl.dataset.i];
  if(!tok || tok.t === "x") return;
  if(TK.sheet && TK.sheet.wordEl === wordEl){
    if(TK.sheet.byDwell){ TK.sheet.byDwell = false; return; }
    closeTalkGloss(); return;
  }
  const sheet = TK.sheet = {tok, wordEl, byDwell: !!opts.byDwell};
  const el = $("#tk-gloss"), body = $("#tk-gloss-body");
  body.innerHTML = glossHTML(tok, {nav: true});
  body.scrollTop = 0;
  placePopover(el, wordEl, {glide: true});
  el.classList.add("on");
  el.setAttribute("aria-hidden", "false");
  $$("#v-talk .rdw.gl-active").forEach(w => w.classList.remove("gl-active"));
  wordEl.classList.add("gl-active");
  hydrateGloss(body, tok, {
    nav: true,
    still: () => TK.sheet === sheet,
    grew: () => placePopover(el, wordEl, {glide: true}),
  }).catch(() => {});
}
function closeTalkGloss(){
  TK.sheet = null;
  $$("#v-talk .rdw.gl-active").forEach(w => w.classList.remove("gl-active"));
  const el = $("#tk-gloss");
  if(el){ el.classList.remove("on"); el.setAttribute("aria-hidden", "true"); }
}

/* ---------------- actions on a card ---------------- */
function talkToggleSaved(){
  const q = TK.run && TK.run.cur; if(!q) return;
  const i = S.talkSaved.indexOf(q[Q.ID]);
  if(i >= 0){ S.talkSaved.splice(i, 1); toast("Removed from saved"); }
  else{ S.talkSaved.push(q[Q.ID]); toast("Saved for later"); }
  save();
  $("#tk-save").setAttribute("aria-pressed", String(i < 0));
  $("#tk-s-saved").textContent = S.talkSaved.length;
}
/* The Chinese for them to read, the English so you know what you sent. */
async function talkCopy(){
  const q = TK.run && TK.run.cur; if(!q) return;
  const ok = await copyText(`${q[Q.ZH]}\n${q[Q.EN]}`);
  toast(ok ? "Copied — 中文 then English" : "Could not copy");
}
function talkReveal(){
  if(!TK.run || TK.run.revealed) return;
  TK.run.revealed = true;
  paintTalkCard();
}

/* Opening one question from a search, the saved list or the question of the
   day: a run on the deck it belongs to, starting on that card. */
function talkOpenQuestion(id){
  const q = TK.byId.get(id); if(!q) return;
  let di = TK.data.decks.findIndex(d => d.ids.includes(id));
  if(TK.run && TK.run.deck < 0 && TK.custom && TK.custom.ids.includes(id)) di = -1;
  if(di < 0 && !(TK.run && TK.run.deck < 0)){
    di = TK.data.decks.findIndex(d => { const st = tkStages(d); return q[Q.ST] >= st[0] && q[Q.ST] <= st[st.length - 1]; });
    if(di < 0) di = 0;
  }
  if(TK.run) talkFinish(false);
  talkStart(di, q);
}

/* A selection turned into a deck: a search result, or the saved list. A
   hand-made selection is fresh for this person, but only it. */
function talkPractise(rows, name){
  const ids = rows.map(q => q[Q.ID]);
  if(!ids.length){ toast("Nothing to practise"); return; }
  TK.custom = {name, why: `${ids.length} questions you picked.`, ids};
  if(TK.seen) for(const id of ids) TK.seen.delete(id);
  if(TK.run) talkFinish(false);
  talkStart(-1);
}

/* The deck button on a word row: in or out of the review deck. */
async function talkToggleDeckWord(id, lv){
  const have = await cardsFor("word", id);
  if(have.length){ await removeFromDeck("word", id); toast("Removed from your deck"); }
  else{ const n = await addToDeck("word", id, lv); toast(n === 1 ? "Added 1 card" : `Added ${n} cards`); }
  TK.fam = await familiarity();
  paintTalkStudy();
  await renderRail();
}

/* ---------------- swipes ---------------- */
/* On a phone the card is a thing you flick: right to go deeper, left to go
   lighter, up to skip. Horizontal only once the finger has committed to a
   direction, so a page scroll is not read as a swipe. */
function bindTalkSwipe(){
  const card = $("#tk-card");
  let x0 = 0, y0 = 0, on = false, axis = null;
  card.addEventListener("pointerdown", e => {
    if(e.pointerType === "mouse" || e.target.closest("button")) return;
    x0 = e.clientX; y0 = e.clientY; on = true; axis = null;
  });
  card.addEventListener("pointermove", e => {
    if(!on) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if(!axis && Math.hypot(dx, dy) > 12) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if(axis !== "x") return;
    card.classList.toggle("swipe-w", dx > 30);
    card.classList.toggle("swipe-c", dx < -30);
  });
  const end = e => {
    if(!on) return;
    on = false;
    card.classList.remove("swipe-w", "swipe-c");
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if(!TK.run || !TK.run.cur) return;
    if(axis === "x" && Math.abs(dx) > 70) talkMove(dx > 0 ? 1 : -1);
    else if(axis === "y" && dy < -80) talkNext(3);
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", () => { on = false; card.classList.remove("swipe-w", "swipe-c"); });
}
