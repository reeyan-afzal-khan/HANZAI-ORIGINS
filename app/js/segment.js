/* segment.js — cutting Chinese text into words, and colouring them by what
 * the syllabus says about each one.
 *
 * Chinese is written without spaces, so nothing can be looked up, coloured or
 * tapped until the text has been cut into words. The cut here is longest-match
 * against the syllabus itself: HANZAI-ORIGINS already knows 11,092 words and 3,000
 * characters, so the same lexicon that powers the search box is the dictionary
 * the reader segments with.
 *
 * Longest-match is not the best segmenter that exists — a statistical one does
 * better on names and on the handful of genuinely ambiguous strings. It is the
 * right one *here*: the whole point of the reading surface is "which of these
 * are HSK words, and at what level", and a matcher that prefers the longest
 * syllabus entry answers exactly that question. Where it finds nothing it
 * falls back to single characters, which are still worth colouring — a
 * character off the 3,000 list is itself the useful signal.
 */

const HAN = /[㐀-鿿豈-﫿]/;
/* Longest entry in the lexicon, measured once it is built. Nothing looks
   further ahead than this. */
let LEX_MAX = 4;
let LEX = null;          // surface form -> {id, p, en, lv, f}
let CHARLEX = null;      // single character -> {p, en, lv, rank}
/* Every pinyin syllable that occurs in the standard, toneless. Derived from
   the 3,000 characters' own readings rather than from a hard-coded table of
   the ~410 legal syllables: the app already ships the readings, and a list
   built from them cannot disagree with the data it is used to split. */
let SYLLABLES = null;

/* The lexicon is the search index — [id, simplified, pinyin, gloss, level,
   frequency] — which is already loaded for the search box and carries
   everything a gloss needs for a fifth of what the seven vocabulary files
   cost. Where two levels list the same surface form the lower one wins: a
   reader meeting 得 wants to be told it is HSK 1, not HSK 4. */
async function lexicon(){
  if(LEX) return LEX;
  const [rows, chars] = await Promise.all([getSearch(), getChars()]);

  LEX = new Map();
  for(const [id, s, p, en, lv, f] of rows){
    const prev = LEX.get(s);
    if(prev && +prev.lv <= +lv) continue;
    LEX.set(s, {id, p, en, lv, f});
    if(s.length > LEX_MAX) LEX_MAX = s.length;
  }

  CHARLEX = new Map();
  SYLLABLES = new Set();
  for(const c of chars){
    CHARLEX.set(c.h, {p: c.p, en: c.en, lv: c.lv, rank: c.rank});
    for(const reading of [c.p, ...(c.pAlt || [])]){
      const flat = plainPinyin(reading);
      if(flat) SYLLABLES.add(flat);
    }
  }

  return LEX;
}

/* Everything the deck knows, folded down to one rank per item.
 *
 * 2 mastered · 1 in the deck · 0 not in the deck. The line between 0 and 1 is
 * drawn at "is it in the deck at all" rather than at "has it been answered
 * once", because on the page the useful question is which words are already
 * being dealt with — a word mined this morning and not yet seen in a session
 * is one you have decided about, and colouring it the same as a word you have
 * never met would make adding one to the deck change nothing on screen.
 *
 * Only recognition cards count: a word whose listening card is still new is
 * not a word you fail to recognise on the page, and this is a reading
 * surface. */
async function familiarity(){
  const cards = await dbAll("cards");
  const words = new Map(), chars = new Map();
  for(const c of cards){
    if(c.mode !== "recognize") continue;
    const rank = isMastered(c) ? 2 : 1;
    const into = c.kind === "word" ? words : c.kind === "char" ? chars : null;
    if(!into) continue;
    if((into.get(c.ref) ?? -1) < rank) into.set(c.ref, rank);
  }
  return {words, chars};
}

/* ---------------- the cut ---------------- */

/* Text in, tokens out. A token is one of:
 *   {t:"w", w, lv, id, p, en, f}   a syllabus word
 *   {t:"c", w, lv, p, en}          a single character, in the 3,000 or not
 *   {t:"x", w}                     punctuation, latin, digits, whitespace
 *
 * `lv` is null for anything the standard does not list, which is the state the
 * reader paints as "beyond HSK" — the single most useful thing the colouring
 * tells someone reading a real book.
 */
function segment(text){
  const out = [];
  const src = String(text);
  let i = 0, plain = "";

  const flushPlain = () => { if(plain){ out.push({t:"x", w: plain}); plain = ""; } };

  while(i < src.length){
    const ch = src[i];
    if(!HAN.test(ch)){ plain += ch; i++; continue; }
    flushPlain();

    /* Longest first, so 中国人 is one word rather than 中国 followed by a
       stranded 人. */
    let hit = null, len = 0;
    for(let n = Math.min(LEX_MAX, src.length - i); n >= 2; n--){
      const slice = src.slice(i, i + n);
      const found = LEX.get(slice);
      if(found){ hit = found; len = n; break; }
    }
    if(hit){
      out.push({t:"w", w: src.slice(i, i + len), lv: hit.lv, id: hit.id,
                p: hit.p, en: hit.en, f: hit.f});
      i += len;
      continue;
    }

    const single = LEX.get(ch);
    if(single){
      out.push({t:"w", w: ch, lv: single.lv, id: single.id,
                p: single.p, en: single.en, f: single.f});
    }else{
      /* Not a word in the standard. It may still be one of the 3,000
         characters — 3,000 characters and 11,092 words are different lists,
         and 1,480 characters are not themselves vocabulary entries. */
      const c = CHARLEX ? CHARLEX.get(ch) : null;
      out.push({t:"c", w: ch, lv: c ? c.lv : null,
                p: c ? c.p : "", en: c ? c.en : []});
    }
    i++;
  }
  flushPlain();
  return out;
}

/* ---------------- a line's reading ---------------- */

/* Chinese punctuation as its Latin counterpart, so a reading reads as a
   sentence rather than a list of syllables. Mirrors scripts/lib/pinyin.mjs. */
const READ_PUNCT = {
  "，": ",", "。": ".", "？": "?", "！": "!", "、": ",", "；": ";", "：": ":",
  "（": " (", "）": ")", "“": ' "', "”": '" ', "‘": " '", "’": "' ", "《": " <", "》": "> ",
  "…": "...", "——": " -- ", "—": " - ", "·": " ", "　": " ",
};

/* The pinyin of a line, read off the syllabus: each word's own reading,
   words apart, syllables within a word together, a capital at the start of
   each sentence. No data file carries pinyin for its sentences — the Talk
   questions and the grammar examples are both read this way, here and at
   build time (scripts/lib/pinyin.mjs), so they come out in one style. Needs
   lexicon() to have been awaited. */
function readingOf(text){
  const tokens = segment(text);
  let out = "";
  const push = s => { out += (out && !/[\s"'(<]$/.test(out) ? " " : "") + s; };
  for(const tok of tokens){
    if(tok.t === "x"){
      const raw = tok.w;
      for(let i = 0; i < raw.length; i++){
        const two = raw.slice(i, i + 2);
        if(READ_PUNCT[two] !== undefined){ out += READ_PUNCT[two]; i++; continue; }
        out += READ_PUNCT[raw[i]] ?? raw[i];
      }
      continue;
    }
    push(tok.p || tok.w);
  }
  return out.replace(/\s+/g, " ").replace(/\s+(?=[.,!?;:)>])/g, "").trim()
    .replace(/(^|[.!?]\s+|["(<]|\s')(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
}

/* ---------------- pinyin, syllable by syllable ---------------- */

/* Letters only: tone marks and the diaeresis dropped, lower-cased. The same
   projection is used to build the syllable inventory and to search it, so the
   two cannot drift. */
const plainPinyin = p => String(p || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\s'·\-]/g, "")
  .toLowerCase();

/* A word's reading cut into syllables, keeping the tone marks where they fall.
 *
 * Pinyin in the syllabus is written run together — "àihào", "péngyou" — so
 * putting a reading over each character means finding the seams. The scan is
 * greedy longest-first with backtracking, because the seams are genuinely
 * ambiguous ("xian" is xi-an or xian) and only a split that consumes the whole
 * string and lands on the right number of syllables is any use.
 *
 * Returns null rather than guessing when it cannot: the caller falls back to
 * one reading over the whole word, which is never wrong, only less precise. */
function splitPinyin(reading, want){
  if(!SYLLABLES || !reading) return null;

  /* Each letter with whatever combining marks trail it, so the pieces can be
     handed back with their tones still attached. */
  const units = [];
  for(const ch of String(reading).normalize("NFD")){
    if(/[\u0300-\u036f]/.test(ch)){
      if(units.length) units[units.length - 1].raw += ch;
      continue;
    }
    if(/[\s'·\-]/.test(ch)) continue;
    units.push({raw: ch, plain: ch.toLowerCase()});
  }
  if(units.length < want) return null;

  const plain = units.map(u => u.plain).join("");
  const seams = [];

  /* No syllable of Mandarin is longer than six letters (zhuang, chuang). */
  const walk = (at, left) => {
    if(at === plain.length) return left === 0;
    if(left === 0) return false;
    for(let n = Math.min(6, plain.length - at); n >= 1; n--){
      if(!SYLLABLES.has(plain.slice(at, at + n))) continue;
      seams.push(n);
      if(walk(at + n, left - 1)) return true;
      seams.pop();
    }
    return false;
  };
  if(!walk(0, want)) return null;

  const out = [];
  let at = 0;
  for(const n of seams){
    out.push(units.slice(at, at + n).map(u => u.raw).join("").normalize("NFC"));
    at += n;
  }
  return out;
}

/* A word's reading cut into its syllables when the count is not known: the
   fewest syllables that consume the whole string, or null. What pinyinHTML
   uses to colour "àihào" as two tones rather than one. */
function syllablesOf(reading){
  const n = plainPinyin(reading).length;
  for(let want = 1; want <= Math.ceil(n / 2) + 1; want++){
    const parts = splitPinyin(reading, want);
    if(parts) return parts;
  }
  return null;
}

/* One word with a reading over each character where the seams can be found,
   and one reading over the whole word where they cannot. A word's own reading
   is preferred to its characters' dictionary readings because it is the one in
   context — 得 is "de" in 觉得 and "dé" on its own, and only the word knows. */
function rubyHTML(tok){
  const chars = [...tok.w];
  if(chars.length === 1) return `<ruby>${esc(tok.w)}<rt>${esc(tok.p)}</rt></ruby>`;

  let parts = splitPinyin(tok.p, chars.length);
  /* Failing that, each character's own dictionary reading — exact for all but
     the polyphonic ones, and there is nothing better to fall back to. */
  if(!parts && CHARLEX && chars.every(c => CHARLEX.get(c)?.p))
    parts = chars.map(c => CHARLEX.get(c).p);

  if(!parts) return `<ruby>${esc(tok.w)}<rt>${esc(tok.p)}</rt></ruby>`;
  return `<ruby>${chars.map((c, i) =>
    `${esc(c)}<rt>${esc(parts[i] || "")}</rt>`).join("")}</ruby>`;
}

/* ---------------- what a token is worth ---------------- */

/* The class that carries the colour. Eight states: the six numbered levels,
   the 7–9 band, and everything the standard does not list. */
const levelClass = lv => lv ? `k${lv}` : "kx";

/* Familiarity, for the reader mode that paints your own progress rather than
   the syllabus. Words fall back to their characters: if you know every
   character in a word you have not met, the word is not fully unknown. */
function familiarityOf(tok, fam){
  if(tok.t === "x") return null;
  if(tok.t === "w" && tok.id && fam.words.has(tok.id)) return fam.words.get(tok.id);
  const ranks = [...tok.w].map(c => fam.chars.get(c) ?? 0);
  if(!ranks.length) return 0;
  return Math.min(...ranks);
}

/* Characters Chinese typography will not let a line begin or end with.
 *
 * This normally costs nothing — a browser breaking a run of Chinese already
 * knows not to strand a full stop at the start of a line. It stops being free
 * here because every word is its own element: the break opportunity between
 * a word and the punctuation after it is an inline-box boundary, and that is
 * taken without consulting either character's line-break class. line-break:
 * strict does not help, because the rule it tightens is not the one being
 * broken. So the punctuation is glued to its neighbour in the markup instead. */
const NO_LINE_START = /[。．，、；：！？）］｝〕〉》」』】〞’”…‥・%,.:;!?)\]}]/;
const NO_LINE_END = /[（［｛〔〈《「『【〝‘“(\[{]/;

/* One block of text as annotated HTML.
 *
 * Every word becomes a button so it is reachable by keyboard and by screen
 * reader as well as by thumb — the alternative, a div with a click handler, is
 * a word you cannot tab to. `data-i` indexes back into the token list the
 * caller holds, which is how a tap finds the gloss without the markup having
 * to carry it.
 *
 * The reader asks for spans instead (`tag: "span"`), marked role="button". A
 * browser lays every <button> out as a box of its own — a small flexbox, even
 * set inline — and a section of a novel is ten thousand of them: half of the
 * time it took to lay a section out, and to copy a page for its turn, was
 * that. An inline span kept whole by nowrap breaks the lines the same way. */
function annotateHTML(tokens, opts){
  const {mode = "level", fam = null, ruby = false, dim = false, tag = "button"} = opts || {};
  const out = [];
  /* Opening punctuation waiting for the word it belongs in front of. Held
     as markup, since each piece is already wrapped. */
  let pending = "";

  /* Punctuation is not a word, but it is part of the line: a passage
     selected by hand runs through the commas, so each piece carries the
     index of its token too, and takes the highlight with its neighbours.
     The pieces are set inline-block, as the word buttons are, so the
     highlight is one band of one height; whitespace is left as text, where
     an atomic box would swallow it. */
  const punct = (i, text) => text.split(/(\s+)/).map(part => !part ? "" : /^\s+$/.test(part)
    ? esc(part) : `<span class="rdx" data-i="${i}">${esc(part)}</span>`).join("");

  const glueBack = (i, text) => {
    if(!out.length){ out.push(punct(i, text)); return; }
    out[out.length - 1] = `<span class="nb">${out[out.length - 1]}${punct(i, text)}</span>`;
  };

  tokens.forEach((tok, i) => {
    if(tok.t === "x"){
      const raw = tok.w;
      let a = 0;
      while(a < raw.length && NO_LINE_START.test(raw[a])) a++;
      let b = raw.length;
      while(b > a && NO_LINE_END.test(raw[b - 1])) b--;

      if(a) glueBack(i, raw.slice(0, a));
      if(b > a) out.push(punct(i, raw.slice(a, b)));
      if(b < raw.length) pending += punct(i, raw.slice(b));
      return;
    }

    let cls = "rdw";
    if(mode === "level") cls += " " + levelClass(tok.lv);
    else if(mode === "fam"){
      const rank = familiarityOf(tok, fam);
      cls += " f" + rank;
    }
    if(dim && mode === "level" && fam && familiarityOf(tok, fam) === 2) cls += " seen";

    const body = ruby && tok.p ? rubyHTML(tok) : esc(tok.w);
    const word = tag === "span"
      ? `<span class="${cls}" data-i="${i}" role="button" tabindex="-1">${body}</span>`
      : `<button class="${cls}" data-i="${i}" tabindex="-1">${body}</button>`;

    if(pending){
      out.push(`<span class="nb">${pending}${word}</span>`);
      pending = "";
    }else{
      out.push(word);
    }
  });

  if(pending) out.push(pending);
  return out.join("");
}

/* ---------------- coverage ---------------- */

/* What a stretch of text is made of, by level and by what you already know.
 *
 * Counted two ways at once because they answer different questions. Tokens
 * ("running words") say what share of the reading is comfortable — the common
 * words dominate, which is why a text can be 85% HSK 1–3 and still unreadable.
 * Types (distinct words) say how much there is to learn, and it is the number
 * that decides whether a book is worth starting. */
function coverage(tokens, fam){
  const byLevel = {}, typesByLevel = {};
  for(const lv of LEVELS){ byLevel[lv] = 0; typesByLevel[lv] = 0; }
  byLevel.x = 0; typesByLevel.x = 0;

  const seen = new Map();          // surface -> {n, tok}
  let running = 0, knownRunning = 0;

  for(const tok of tokens){
    if(tok.t === "x") continue;
    running++;
    const key = tok.lv || "x";
    byLevel[key]++;
    if(fam && familiarityOf(tok, fam) === 2) knownRunning++;

    const hit = seen.get(tok.w);
    if(hit) hit.n++;
    else{ seen.set(tok.w, {n: 1, tok}); typesByLevel[key]++; }
  }

  const types = [...seen.entries()].map(([w, v]) => ({w, n: v.n, tok: v.tok}));
  const knownTypes = fam ? types.filter(t => familiarityOf(t.tok, fam) === 2).length : 0;

  return {
    running, types: types.length, byLevel, typesByLevel,
    knownRunning, knownTypes,
    comfort: running ? knownRunning / running : 0,
    list: types,
  };
}

/* The words worth taking out of this text and into the deck: unknown, in the
   syllabus, commonest in *this* text first. Frequency here is local on
   purpose — a word the book uses forty times is worth learning before a
   commoner one it uses twice. */
function mineable(cov, fam, limit = 200){
  return cov.list
    .filter(t => t.tok.t === "w" && t.tok.id && familiarityOf(t.tok, fam) === 0)
    .sort((a, b) => b.n - a.n || +a.tok.lv - +b.tok.lv)
    .slice(0, limit);
}
