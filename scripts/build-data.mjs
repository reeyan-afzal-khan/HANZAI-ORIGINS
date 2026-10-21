/**
 * Exports data/hskker.db into the files the app loads at runtime.
 *
 *   npm run data      builds the database first, then exports it
 *   npm run db        just the database
 *
 * Output goes to app/data/ as one file per level plus a global search index.
 *
 * Each file is JavaScript that registers itself, not JSON: `fetch` is blocked
 * on file:// by every browser's CORS policy, and app/ has to run when somebody
 * double-clicks index.html. A <script> tag has no such restriction, so one
 * format serves file://, http and the Android WebView alike.
 *
 * That is why the database stays on this side of the build rather than being
 * shipped and queried in the browser: SQLite compiled to WebAssembly would
 * have to fetch both the engine and the .db file, which is exactly the thing
 * file:// will not allow. So the store is authoritative and these files are
 * its projection — one place to query, one format to ship.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { openDb, rows } from './lib/db.mjs'

const OUT = 'app/data'
const db = openDb()

/** Writes a payload as a script that hands itself to the app's registry. */
function emit(name, payload) {
  mkdirSync(`${OUT}/${name}`.replace(/\/[^/]+$/, ''), { recursive: true })
  writeFileSync(`${OUT}/${name}.js`, `HSKDATA(${JSON.stringify(name)},${JSON.stringify(payload)})\n`)
}

const levels = rows(db, 'SELECT * FROM levels ORDER BY ord')
if (!levels.length) throw new Error('data/hskker.db has no levels — run `npm run db`')

// ---------------------------------------------------------------- vocabulary
/* Key order is load-bearing only in that it keeps the generated files stable
   between runs, so a rebuild that changed nothing produces no diff. */
const wordShape = (w) => {
  const out = {
    id: w.id, s: w.simplified, t: w.traditional, p: w.pinyin,
    pos: w.pos, lv: w.level, en: w.en, cl: w.cl, f: w.freq, r: w.radical,
  }
  if (w.alt) out.alt = w.alt
  return out
}

for (const lv of levels) {
  emit(`vocab/${lv.id}`,
    rows(db, 'SELECT * FROM words WHERE level = ? ORDER BY ord', lv.id).map(wordShape))
}

/* [id, simplified, pinyin, first gloss, level, frequency] for every word — read
   off the search view, which derives the gloss in SQL rather than in here. */
emit('search',
  rows(db, 'SELECT id, simplified, pinyin, gloss, level, freq FROM search ORDER BY ord')
    .map((r) => [r.id, r.simplified, r.pinyin, r.gloss, r.level, r.freq]))

// ---------------------------------------------------------------- characters
emit('chars', rows(db, 'SELECT * FROM chars ORDER BY ord').map((c) => ({
  h: c.hanzi, lv: c.level, wl: c.writing_level, t: c.traditional,
  inWords: c.in_words, rank: c.rank, sc: c.stroke_count, rad: c.radical,
  radn: c.radical_no, dec: c.decomposition, comp: c.components, ety: c.etymology,
  ex: c.examples, p: c.pinyin, pAlt: c.pinyin_alt, en: c.en, r: c.cedict_radical,
})))

// ---------------------------------------------------------------- grammar
emit('grammar', rows(db, 'SELECT * FROM grammar ORDER BY ord').map((g) => ({
  id: g.id, lv: g.level, group: g.grp, groupZh: g.grp_zh,
  category: g.category, categoryZh: g.category_zh,
  topic: g.topic, topicZh: g.topic_zh, content: g.content,
  title: g.title, summary: g.summary, examples: g.examples,
})))

// ---------------------------------------------------------------- manifest
const meta = Object.fromEntries(
  rows(db, 'SELECT key, value FROM meta').map((r) => [r.key, r.value]),
)
emit('meta', meta)

console.log(`${OUT}/  exported from data/hskker.db`)
console.log(`  words   ${db.prepare('SELECT COUNT(*) n FROM words').get().n}`)
console.log(`  chars   ${db.prepare('SELECT COUNT(*) n FROM chars').get().n}`)
console.log(`  grammar ${db.prepare('SELECT COUNT(*) n FROM grammar').get().n}`)
console.log(meta.levels.map((l) => `  L${l.label}: ${l.words}w ${l.chars}c ${l.grammar}g`).join('\n'))
