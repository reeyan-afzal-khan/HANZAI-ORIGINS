/**
 * Downloads the upstream sources and reduces them to the compact files the
 * build reads. Run this only when refreshing the data; the reduced files are
 * committed, so a normal checkout builds offline.
 *
 *   node scripts/fetch-sources.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { parseCsv } from './lib/csv.mjs'
import { HSK3, DICT } from './lib/paths.mjs'

const CACHE = 'node_modules/.cache/hskker'
mkdirSync(HSK3.dir, { recursive: true })
mkdirSync(DICT.dir, { recursive: true })
mkdirSync(CACHE, { recursive: true })

const LISTS = 'https://raw.githubusercontent.com/ivankra/hsk30/master/'
const GLOSSES = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json'
const CEDICT = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'
const HANZIDB = 'https://raw.githubusercontent.com/ruddfawcett/hanziDB.csv/master/data/hanziDB.csv'
const MAKEMEAHANZI = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt'

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  console.log(`  ${dest}`)
}

console.log('Official HSK 3.0 lists')
for (const [file, dest] of [['hsk30.csv', HSK3.words], ['hsk30-chars.csv', HSK3.chars], ['hsk30-grammar.csv', HSK3.grammar]]) {
  await download(LISTS + file, dest)
}

console.log('\nEnglish glosses')
const full = `${CACHE}/complete.json`
await download(GLOSSES, full)

// Only the HSK headwords and the handful of fields the build uses are kept:
// the upstream file is ~9 MB, the reduction about 2 MB.
const needed = new Set()
for (const row of parseCsv(readFileSync(HSK3.words, 'utf8'))) {
  needed.add(row.Simplified.replace(/[0-9]$/, ''))
  if (row.Variants) {
    try {
      for (const v of JSON.parse(row.Variants)) if (v.Simplified) needed.add(v.Simplified)
    } catch { /* the plain headword is already recorded */ }
  }
}
for (const c of parseCsv(readFileSync(HSK3.chars, 'utf8'))) needed.add(c.Hanzi)

const glosses = JSON.parse(readFileSync(full, 'utf8'))
  .filter((w) => needed.has(w.simplified))
  .map((w) => ({
    simplified: w.simplified,
    radical: w.radical ?? '',
    frequency: w.frequency ?? null,
    forms: (w.forms ?? []).map((f) => ({
      traditional: f.traditional,
      pinyin: f.transcriptions?.pinyin ?? '',
      meanings: f.meanings ?? [],
      classifiers: (f.classifiers ?? []).map((c) => c.simplified ?? c).filter(Boolean),
    })),
  }))
writeFileSync(DICT.glosses, JSON.stringify(glosses))
console.log(`  ${DICT.glosses} (${glosses.length} entries)`)

console.log('\nCC-CEDICT character dictionary')
const gz = `${CACHE}/cedict.txt.gz`
await download(CEDICT, gz)
execFileSync('gunzip', ['-kf', gz])
execFileSync('node', ['scripts/build-chardict.mjs', `${CACHE}/cedict.txt`], { stdio: 'inherit' })

if (!existsSync(DICT.chardict)) throw new Error('chardict.json was not produced')

console.log('\nCharacter analysis')
// Frequency and stroke counts, and the component breakdown behind them.
await download(HANZIDB, `${CACHE}/hanziDB.csv`)
await download(MAKEMEAHANZI, `${CACHE}/dictionary.txt`)
// The two sources are 3 MB together and stay in the cache; only the
// reduction is committed.
execFileSync('node', ['scripts/build-charextra.mjs'], { stdio: 'inherit' })

console.log('\nSources refreshed. Run `npm run data` to rebuild.')
