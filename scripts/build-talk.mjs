/**
 * Builds the conversation bank the Talk tab runs on.
 *
 *   node scripts/build-talk.mjs        (npm run talk)
 *
 * Reads data/talk/questions.json — 4,228 bilingual conversation questions
 * with their decks, topics, sensitivity and stage — and data/talk/answers.json,
 * the AREC model answers, and writes them to app/data/talk/ as the
 * self-registering scripts the app loads.
 *
 * The one thing added on the way through is the syllabus. Every question's
 * Chinese is cut into words against the same lexicon the reader uses
 * (app/data/search.js + app/data/chars.js, so `npm run data` must have run
 * first), and each row is stamped with the HSK level it is readable at: the
 * lowest level that covers nine in ten of its running words, with anything
 * outside the standard counted as beyond 7–9. That is what lets the decks be
 * dealt "at your level" and lets a card say what it will cost you to read.
 *
 * Row layout, kept positional because there are 4,228 of them and the file
 * is loaded on every visit to the tab:
 *   [id, score, sens, stage, cat, frame, prompt, en, zh, hsk, beyond]
 * No pinyin: the app reads a question's pinyin off the syllabus when it is
 * wanted (segment.js readingOf), as it does for every other line.
 *   hsk     1–7 for the level the question reads at, 8 when it needs words
 *           outside the standard even at 7–9
 *   beyond  how many distinct words fall outside the 11,092
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import vm from 'node:vm'
import { TALK } from './lib/paths.mjs'

const OUT = 'app/data/talk'

/** Loads one of the app's own data files by running it with HSKDATA shimmed. */
function loadData(name) {
  let got = null
  const ctx = vm.createContext({ HSKDATA: (_n, payload) => { got = payload } })
  vm.runInContext(readFileSync(`app/data/${name}.js`, 'utf8'), ctx)
  if (got === null) throw new Error(`app/data/${name}.js did not register — run npm run data`)
  return got
}

function emit(name, payload) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/${name}.js`, `HSKDATA(${JSON.stringify('talk/' + name)},${JSON.stringify(payload)})\n`)
}

// ---------------------------------------------------------------- the lexicon
/* The same cut the app makes at runtime (segment.js): longest match against the
   search index, lower level winning a tie, single characters falling back to
   the 3,000 list. Reproduced here rather than imported because segment.js is a
   browser script that reaches for the page's globals. */
const search = loadData('search')
const chars = loadData('chars')
const LEX = new Map()
let LEX_MAX = 1
for (const [, s, , , lv] of search) {
  const prev = LEX.get(s)
  if (prev !== undefined && +prev <= +lv) continue
  LEX.set(s, +lv)
  if (s.length > LEX_MAX) LEX_MAX = s.length
}
const CHARLV = new Map(chars.map((c) => [c.h, +c.lv]))
const HAN = /[㐀-鿿豈-﫿]/

/** Levels of the running words in a sentence; 8 for anything off the standard. */
function levelsOf(zh) {
  const out = []
  const src = String(zh)
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (!HAN.test(ch)) { i++; continue }
    let hit = null, len = 0
    for (let n = Math.min(LEX_MAX, src.length - i); n >= 2; n--) {
      const lv = LEX.get(src.slice(i, i + n))
      if (lv !== undefined) { hit = lv; len = n; break }
    }
    if (hit !== null) { out.push({ w: src.slice(i, i + len), lv: hit }); i += len; continue }
    const single = LEX.get(ch)
    if (single !== undefined) out.push({ w: ch, lv: single })
    else out.push({ w: ch, lv: CHARLV.has(ch) ? CHARLV.get(ch) : 8 })
    i++
  }
  return out
}

/** The lowest level that covers 90% of the running words, and how many
 *  distinct words sit outside the standard entirely. */
function readableAt(zh) {
  const toks = levelsOf(zh)
  if (!toks.length) return { hsk: 1, beyond: 0 }
  const lv = toks.map((t) => t.lv).sort((a, b) => a - b)
  const at = Math.min(lv.length - 1, Math.ceil(lv.length * 0.9) - 1)
  const beyond = new Set(toks.filter((t) => t.lv === 8).map((t) => t.w)).size
  return { hsk: lv[at], beyond }
}

// ---------------------------------------------------------------- questions
const src = JSON.parse(readFileSync(TALK.questions, 'utf8'))
const byId = new Map(src.questions.map((q) => [q.id, q]))
const hist = {}
const rows = src.questions.map((q) => {
  const { hsk, beyond } = readableAt(q.zh)
  hist[hsk] = (hist[hsk] || 0) + 1
  return [q.id, q.score, q.sens, q.stage, q.cat, q.frame, q.prompt ? 1 : 0, q.en, q.zh, hsk, beyond]
})

/* Decks carry question ids; the app resolves them through the row order, so
   the rows are written in id order and asserted to be dense. */
rows.forEach((r, i) => { if (r[0] !== i + 1) throw new Error(`question ids are not dense at ${r[0]}`) })
for (const d of src.decks) for (const id of d.ids) if (!byId.has(id)) throw new Error(`deck ${d.name} names unknown question ${id}`)

emit('questions', {
  version: src.version,
  categories: src.categories,
  frames: src.frames,
  stageLabels: src.stageLabels,
  sensLabels: src.sensLabels,
  decks: src.decks.map((d) => ({ name: d.name, why: d.why, rule: d.rule, ids: d.ids })),
  q: rows,
})

// ---------------------------------------------------------------- answers
const ans = JSON.parse(readFileSync(TALK.answers, 'utf8'))
for (const row of ans.exact) if (!byId.has(row[0])) throw new Error(`answer for unknown question ${row[0]}`)
emit('answers', {
  version: ans.version,
  parts: ans.parts,
  exact: ans.exact,
  frameKind: ans.frameKind,
  topic: ans.topic,
  topicFallback: ans.topicFallback,
  scaffold: ans.scaffold,
})

/* Counts alone, for the home screen's launcher tile: it should not have to
   parse a megabyte of questions to say how many there are. */
emit('meta', {
  questions: rows.length,
  decks: src.decks.length,
  answers: ans.exact.length,
  byLevel: Object.fromEntries(Object.keys(hist).sort((a, b) => a - b).map((k) => [k, hist[k]])),
})

const label = (lv) => (lv === 8 ? 'beyond' : lv === 7 ? '7–9' : String(lv))
console.log(`talk: ${rows.length} questions · ${src.decks.length} decks · ${ans.exact.length} exact answers`)
console.log('  readable at HSK ' + Object.keys(hist).sort((a, b) => a - b)
  .map((k) => `${label(+k)}: ${hist[k]}`).join(' · '))
