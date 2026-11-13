/* build-examples.mjs — example sentences for the words of the syllabus.
 *
 *   app/data/grammar.js + app/data/vocab/*.js
 *     -> app/data/examples/<level>.js   HSKDATA("examples/1", {"爱": [[zh, pinyin, en, source], …], …})
 *
 * The word card in the reader and the Talk tab shows how a word is used, and
 * the app holds a corpus of translated sentences for it: the examples
 * written for the grammar points. This picks up to three sentences for each
 * of the 11,092 words that one of them uses, preferring a sentence of a
 * readable length. A one-character word is only taken from a sentence where
 * it stands alone — where the character is not part of a longer word of the
 * syllabus — since 说 inside 小说 is not an example of 说.
 *
 * One file per level, loaded when a card for a word of that level opens.
 * The source is G<id>, the grammar point the sentence was written for; a tap
 * opens it.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, "app", "data");
const OUT = join(DATA, "examples");
const PER_WORD = 3;

/* The data files are JSONP; read them with a stub in place of the page. */
function jsonp(file){
  let out = null;
  const src = readFileSync(file, "utf8");
  new Function("HSKDATA", src)((name, payload) => { out = payload; });
  return out;
}

const words = [];
for(const f of readdirSync(join(DATA, "vocab"))) words.push(...jsonp(join(DATA, "vocab", f)));
const grammar = jsonp(join(DATA, "grammar.js"));

/* Every word, by its simplified form; the longest word is the window. */
const byWord = new Map();
let maxLen = 1;
for(const w of words){
  if(!byWord.has(w.s)) byWord.set(w.s, []);
  byWord.get(w.s).push(w);
  if(w.s.length > maxLen) maxLen = w.s.length;
}
const isWord = s => byWord.has(s);

/* Does the character at i stand alone — not inside a longer syllabus word? */
function standalone(zh, i){
  for(let len = 2; len <= Math.min(maxLen, 4); len++){
    for(let a = Math.max(0, i - len + 1); a <= i && a + len <= zh.length; a++){
      if(isWord(zh.slice(a, a + len))) return false;
    }
  }
  return true;
}

/* candidates: word -> [{zh, py, en, src, score}] */
const cands = new Map();
function offer(word, zh, py, en, src, base){
  if(!zh || !en) return;
  const len = zh.length;
  if(len < 4 || len > 60) return;
  let score = base - Math.abs(len - 18) / 6;
  let list = cands.get(word);
  if(!list) cands.set(word, list = []);
  if(list.some(c => c.zh === zh)) return;
  list.push({zh, py: py || "", en, src, score});
}

/* The grammar examples: short, written to be clear, translated. */
let gLines = 0;
for(const g of grammar){
  for(const ex of g.examples || []){
    gLines++;
    seen(ex.zh, (word, i) => offer(word, ex.zh, ex.py, ex.en, `G${g.id}`, 8 + (word.length === 1 && !standalone(ex.zh, i) ? -100 : 0)));
  }
}

/* Every syllabus word that occurs in zh, with the index of one occurrence. */
function seen(zh, fn){
  const done = new Set();
  for(let i = 0; i < zh.length; i++){
    for(let len = 1; len <= maxLen && i + len <= zh.length; len++){
      const s = zh.slice(i, i + len);
      if(!isWord(s) || done.has(s)) continue;
      done.add(s);
      fn(s, i);
    }
  }
}

/* Write one file per level. */
rmSync(OUT, {recursive: true, force: true});
mkdirSync(OUT, {recursive: true});
const perLevel = new Map();
let covered = 0, total = 0, sentences = 0;
for(const w of words){
  total++;
  const list = (cands.get(w.s) || []).filter(c => c.score > -50).sort((a, b) => b.score - a.score).slice(0, PER_WORD);
  if(!list.length) continue;
  covered++; sentences += list.length;
  if(!perLevel.has(w.lv)) perLevel.set(w.lv, {});
  perLevel.get(w.lv)[w.s] = list.map(c => [c.zh, c.py, c.en, c.src]);
}
let bytes = 0;
for(const [lv, map] of perLevel){
  const js = `HSKDATA("examples/${lv}",${JSON.stringify(map)})\n`;
  writeFileSync(join(OUT, `${lv}.js`), js);
  bytes += Buffer.byteLength(js);
  console.log(`  examples/${lv}.js  ${Object.keys(map).length} words  ${(Buffer.byteLength(js) / 1048576).toFixed(2)} MB`);
}
console.log(`examples: ${covered}/${total} words have sentences (${sentences} in all) from ${gLines} grammar examples — ${(bytes / 1048576).toFixed(1)} MB`);
