/**
 * Builds data/hskker.db — the canonical store — from data/ (see data/README.md).
 *
 *   npm run db
 *
 * Everything the app ships is generated from this file afterwards:
 *
 *   npm run data       app/data/*.js          the syllabus
 *   npm run strokes    app/data/strokes/*.js  stroke order, and the strokes table
 *
 * `npm run data` runs this first, so the usual path is still one command. Run
 * it on its own when you want the database without re-exporting, or to poke at
 * the corpus directly:
 *
 *   sqlite3 data/hskker.db "SELECT level, COUNT(*) FROM words GROUP BY level"
 *   sqlite3 data/hskker.db "SELECT hanzi, rank FROM chars ORDER BY rank LIMIT 20"
 */
import { statSync } from 'node:fs'
import { compile } from './lib/compile.mjs'
import { createDb, batch, inserter, DB_PATH } from './lib/db.mjs'

const { words, chars, grammar, meta, stats } = compile()

const db = createDb()

batch(db, () => {
  const addMeta = inserter(db, 'meta', ['key', 'value'])
  /* meta is stored a key at a time rather than as one blob, so a single field
     can be read back without parsing the whole manifest. Stringified here
     rather than left to the inserter, so a string value is stored as JSON too
     and every row can be parsed back the same way. */
  for (const [key, value] of Object.entries(meta))
    addMeta({ key, value: JSON.stringify(value) })

  const addLevel = inserter(db, 'levels', [
    'id', 'ord', 'label', 'band', 'words', 'chars', 'grammar', 'grammar_explained',
  ])
  meta.levels.forEach((l, ord) =>
    addLevel({
      id: l.id, ord, label: l.label, band: l.band,
      words: l.words, chars: l.chars, grammar: l.grammar,
      grammar_explained: l.grammarExplained,
    }))

  const addPos = inserter(db, 'pos', ['code', 'name'])
  for (const [code, name] of Object.entries(meta.pos)) addPos({ code, name })

  const addWord = inserter(db, 'words', [
    'id', 'ord', 'simplified', 'traditional', 'pinyin', 'level',
    'freq', 'radical', 'pos', 'en', 'cl', 'alt',
  ])
  for (const w of words)
    addWord({
      id: w.id, ord: w.ord, simplified: w.s, traditional: w.t, pinyin: w.p,
      level: w.lv, freq: w.f, radical: w.r, pos: w.pos, en: w.en, cl: w.cl,
      /* Null rather than [] when a word has no alternative spellings: the
         export puts the key back only for the entries that had one. */
      alt: w.alt ?? null,
    })

  const addChar = inserter(db, 'chars', [
    'hanzi', 'ord', 'level', 'writing_level', 'traditional', 'in_words', 'rank',
    'stroke_count', 'radical', 'radical_no', 'decomposition', 'etymology',
    'pinyin', 'cedict_radical', 'components', 'examples', 'pinyin_alt', 'en',
  ])
  for (const c of chars)
    addChar({
      hanzi: c.h, ord: c.ord, level: c.lv, writing_level: c.wl, traditional: c.t,
      in_words: c.inWords, rank: c.rank, stroke_count: c.sc, radical: c.rad,
      radical_no: c.radn, decomposition: c.dec, etymology: c.ety, pinyin: c.p,
      cedict_radical: c.r, components: c.comp, examples: c.ex,
      pinyin_alt: c.pAlt, en: c.en,
    })

  const addGrammar = inserter(db, 'grammar', [
    'id', 'ord', 'level', 'grp', 'grp_zh', 'category', 'category_zh',
    'topic', 'topic_zh', 'content', 'title', 'summary', 'examples',
  ])
  for (const g of grammar)
    addGrammar({
      id: g.id, ord: g.ord, level: g.lv, grp: g.group, grp_zh: g.groupZh,
      category: g.category, category_zh: g.categoryZh, topic: g.topic,
      topic_zh: g.topicZh, content: g.content, title: g.title,
      summary: g.summary, examples: g.examples,
    })
})

/* Strokes are left alone: they are the one table `npm run strokes` owns, they
   are 21 MB, and rebuilding the syllabus should not throw away stroke data
   that is still perfectly current. */
db.exec('VACUUM')
db.close()

const mb = (statSync(DB_PATH).size / 1048576).toFixed(1)
console.log(`${DB_PATH}  ${mb} MB`)
console.log(`  words   ${words.length} (${words.length - stats.missingGlosses} with English glosses)`)
console.log(`  chars   ${chars.length} (${chars.length - stats.charsWithoutReading} with a reading)`)
console.log(`  grammar ${grammar.length} (${meta.totals.grammarWithNotes} with written notes)`)
console.log('  strokes are loaded separately — npm run strokes')
