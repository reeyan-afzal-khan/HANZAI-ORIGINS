/**
 * Builds the character-analysis layer: how common a character is, how it is
 * written, and what it is made of.
 *
 *   <cache>/hanziDB.csv     frequency rank, stroke count, Kangxi radical
 *   <cache>/dictionary.txt  Make Me A Hanzi — decomposition and etymology
 *   (the cache is node_modules/.cache/hskker, where fetch-sources.mjs puts them)
 *
 * Reduced to data/dictionary/charextra.json, which is committed; the two sources are
 * not. Run `npm run sources` to refresh them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCsv } from './lib/csv.mjs'
import { HSK3, DICT } from './lib/paths.mjs'

const CACHE = 'node_modules/.cache/hskker'

/** Ideographic Description Characters — the operators in a decomposition. */
const IDS = /[⿰-⿿]/g
const CJK = /[㐀-鿿豈-﫿]/

const hsk = parseCsv(readFileSync(HSK3.chars, 'utf8'))
const wanted = new Set(hsk.map((c) => c.Hanzi))

const db = new Map()
for (const row of parseCsv(readFileSync(`${CACHE}/hanziDB.csv`, 'utf8'))) {
  // The upstream header misspells "character"; kept verbatim rather than patched.
  if (!db.has(row.charcter)) db.set(row.charcter, row)
}

const mm = new Map()
for (const line of readFileSync(`${CACHE}/dictionary.txt`, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const d = JSON.parse(line)
  mm.set(d.character, d)
}

/** The parts a character is built from, in the order the decomposition lists them. */
function components(decomposition, self) {
  if (!decomposition) return []
  const parts = [...decomposition.replace(IDS, '').replace(/？/g, '')]
    .filter((ch) => CJK.test(ch) && ch !== self)
  return [...new Set(parts)]
}

/** A one-line gloss for a component, so the breakdown reads as meaning and not just shapes. */
function gloss(ch) {
  const d = mm.get(ch)
  if (!d?.definition) return ''
  return d.definition.split(/[;,]/)[0].trim().slice(0, 40)
}

const out = {}
let noDec = 0
let noEty = 0
for (const ch of wanted) {
  const d = db.get(ch)
  const m = mm.get(ch)
  const dec = m?.decomposition && m.decomposition !== '？' ? m.decomposition : ''
  const comp = components(dec, ch)
  if (!dec) noDec++
  if (!m?.etymology?.hint) noEty++

  out[ch] = {
    // Rank in a modern-Chinese corpus; 1 is the commonest character in the language.
    rank: d ? Number(d.frequency_rank) : null,
    sc: d ? Number(d.stroke_count) : null,
    rad: d?.radical || m?.radical || '',
    // Kangxi radical number, e.g. 38 for 女. The upstream value is "38.3".
    radn: d?.radical_code ? Number(String(d.radical_code).split('.')[0]) : null,
    dec,
    comp: comp.map((c) => ({ c, g: gloss(c) })),
    ety: m?.etymology?.hint || '',
    etyType: m?.etymology?.type || '',
  }
}

writeFileSync(DICT.charextra, JSON.stringify(out))
console.log(`charextra: ${Object.keys(out).length} characters`)
console.log(`  ${Object.keys(out).length - noDec} with a decomposition, ${Object.keys(out).length - noEty} with an etymology`)
const ranked = Object.values(out).filter((x) => x.rank)
console.log(`  frequency ranks ${Math.min(...ranked.map((x) => x.rank))}–${Math.max(...ranked.map((x) => x.rank))}`)
