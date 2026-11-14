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

const readerWords = [null];
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

  }

  webEngine.reset_dictionary();
  readerWords.length = 1;
  const words = [];
  for(const [w, entry] of LEX){
    words.push(w);
    readerWords.push({t:"w", w, lv:entry.lv, id:entry.id, p:entry.p, en:entry.en, f:entry.f});
  }
  /* The dictionary goes over in one call, NUL-separated. The engine numbers
     the words from 1 in that order, which is their place in readerWords. */
  copyReaderText(words.join("\0"));
  webEngine.add_words();

  CHARLEX = new Map();
  SYLLABLES = new Set();
  for(const c of chars){
    CHARLEX.set(c.h, {p: c.p, en: c.en, lv: c.lv, rank: c.rank});
    for(const reading of [c.p, ...(c.pAlt || [])]){
      const flat = plainPinyin(reading);
      if(flat) SYLLABLES.add(flat);
    }
  }

  copyReaderText([...SYLLABLES].join("\0"));
  webEngine.add_syllables();
  RUBY.clear();
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
function copyReaderText(text){
  const ptr = webEngine.input(text.length);
  const units = new Uint16Array(webEngine.memory.buffer, ptr, text.length);
  for(let i = 0; i < text.length; i++) units[i] = text.charCodeAt(i);
  return ptr;
}

// The returned view is valid until the next engine call.
function readerMatches(text){
  copyReaderText(text);
  const length = webEngine.tokenize();
  return new Int32Array(webEngine.memory.buffer, webEngine.output(), length);
}

function readerToken(id){
  /* A fresh token each time, since callers keep them; spelled out, which
     V8 builds markedly faster than a spread copy. */
  if(id > 0){
    const r = readerWords[id];
    return {t:"w", w:r.w, lv:r.lv, id:r.id, p:r.p, en:r.en, f:r.f};
  }
  const w = String.fromCharCode(-id - 1);
  const c = CHARLEX.get(w);
  return {t:"c", w, lv:c ? c.lv : null, p:c ? c.p : "", en:c ? c.en : []};
}

function segment(text){
  const src = String(text);
  const matches = readerMatches(src);
  const tokens = [];
  let start = 0;
  for(let i = 0; i < matches.length; i += 2){
    const end = matches[i], id = matches[i + 1];
    tokens.push(id ? readerToken(id) : {t:"x", w:src.slice(start, end)});
    start = end;
  }
  return tokens;
}

/* ---------------- a line's reading ---------------- */

/* Chinese punctuation as its Latin counterpart, so a reading reads as a
   sentence rather than a list of syllables. Mirrors tools/lib/pinyin.mjs. */
const READ_PUNCT = {
  "，": ",", "。": ".", "？": "?", "！": "!", "、": ",", "；": ";", "：": ":",
  "（": " (", "）": ")", "“": ' "', "”": '" ', "‘": " '", "’": "' ", "《": " <", "》": "> ",
  "…": "...", "——": " -- ", "—": " - ", "·": " ", "　": " ",
};

/* The pinyin of a line, read off the syllabus: each word's own reading,
   words apart, syllables within a word together, a capital at the start of
   each sentence. No data file carries pinyin for its sentences — the Talk
   questions and the grammar examples are both read this way, here and at
   build time (tools/lib/pinyin.mjs), so they come out in one style. Needs
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
  copyReaderText(plain);
  const count = webEngine.split_syllables(want);
  if(!count) return null;
  const seams = new Uint32Array(webEngine.memory.buffer, webEngine.output(), count);

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
const RUBY = new Map();
function rubyHTML(tok){
  /* A book uses the same few thousand words over and over, and a word's
     ruby cannot change once the lexicon is in, so each is worked out once.
     Nothing is kept before then, while the seams cannot yet be found. */
  const key = tok.w + "\0" + tok.p;
  let html = RUBY.get(key);
  if(html === undefined){
    html = rubyMarkup(tok);
    if(SYLLABLES) RUBY.set(key, html);
  }
  return html;
}
function rubyMarkup(tok){
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

// Pack one block for the Rust renderer. Text lengths are UTF-16 offsets, the
// same units used by browser selection ranges and saved reading positions.
function annotateHTML(tokens, opts){
  const {mode = "level", fam = null, ruby = false, dim = false, tag = "button"} = opts || {};
  const n = tokens.length, ranked = !!fam && (mode === "fam" || dim);
  /* Ruby markup is made before anything is packed: splitting a reading
     calls the engine too, which would overwrite its input. */
  const bodies = ruby ? tokens.map(tok => tok.t !== "x" && tok.p ? rubyHTML(tok) : tok.w) : null;
  let size = 5 * n;
  for(let i = 0; i < n; i++) size += (bodies ? bodies[i] : tokens[i].w).length;
  const ptr = webEngine.input(size);
  const input = new Uint16Array(webEngine.memory.buffer, ptr, size);
  let at = 0;
  for(let i = 0; i < n; i++){
    const tok = tokens[i], body = bodies ? bodies[i] : tok.w, len = body.length, word = tok.t !== "x";
    input[at] = word ? ruby && tok.p ? 2 : 1 : 0;
    input[at + 1] = Number(tok.lv) || 0;
    input[at + 2] = word && ranked ? familiarityOf(tok, fam) : 0;
    input[at + 3] = len & 65535;
    input[at + 4] = len >>> 16;
    at += 5;
    for(let k = 0; k < len; k++) input[at++] = body.charCodeAt(k);
  }
  const length = webEngine.annotate(mode === "level" ? 1 : mode === "fam" ? 2 : 0, tag === "span", dim && !!fam);
  return engineUnits(webEngine.annotation_ptr(), length);
}

/* The engine's UTF-16 output as a string. The browser's own decoder does this
   an order of magnitude faster than building the string in script. It is set
   to keep a leading U+FEFF and to fail on a lone surrogate, which it would
   otherwise replace; that rare text is copied unit by unit instead, so the
   result is always exactly what the engine wrote. */
const engineUTF16 = new TextDecoder("utf-16le", {fatal: true, ignoreBOM: true});
function engineUnits(ptr, length){
  const units = new Uint16Array(webEngine.memory.buffer, ptr, length);
  try{ return engineUTF16.decode(units); }catch(_){}
  let text = "";
  for(let i = 0; i < length; i += 8192) text += String.fromCharCode.apply(null, units.subarray(i, i + 8192));
  return text;
}

/* ---------------- coverage ---------------- */

/* What a stretch of text is made of, by level and by what you already know.
 *
 * Counted two ways at once because they answer different questions. Tokens
 * ("running words") say what share of the reading is comfortable — the common
 * words dominate, which is why a text can be 85% HSK 1–3 and still unreadable.
 * Types (distinct words) say how much there is to learn, and it is the number
 * that decides whether a book is worth starting. */
function countReaderWords(text, counts){
  const matches = readerMatches(String(text));
  for(let i = 1; i < matches.length; i += 2){
    const id = matches[i];
    if(id) counts.set(id, (counts.get(id) || 0) + 1);
  }
}

function readerCoverage(counts, fam){
  const byLevel = {}, typesByLevel = {}, list = [];
  for(const lv of [...LEVELS, "x"]){ byLevel[lv] = 0; typesByLevel[lv] = 0; }
  let running = 0, knownRunning = 0, knownTypes = 0;
  for(const [id, n] of counts){
    const tok = readerToken(id), level = tok.lv || "x";
    running += n;
    byLevel[level] += n;
    typesByLevel[level]++;
    list.push({w:tok.w, n, tok});
    if(fam && familiarityOf(tok, fam) === 2){ knownRunning += n; knownTypes++; }
  }
  return {running, types:list.length, byLevel, typesByLevel, knownRunning, knownTypes,
          comfort:running ? knownRunning / running : 0, list};
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
