/**
 * Builds the supplementary vocabulary: everyday words the official HSK 3.0
 * list leaves out — 你好, 早上好, 生日快乐 — so the character map can show how
 * characters combine into the words people actually say.
 *
 *   <cache>/cedict.txt.gz   CC-CEDICT (mdbg.net), readings and meanings
 *   <cache>/zh_cn_50k.txt   OpenSubtitles 2018 word frequencies (hermitdave/FrequencyWords)
 *   (the cache is node_modules/.cache/hskker, where fetch-sources.mjs puts them)
 *
 * A word is taken when it is among the commonest in the frequency list, has a
 * dictionary entry that is not a name, is two to four characters long, is
 * written only with the 3,000 HSK characters, and is not already an HSK word.
 * Its level is the level of its hardest character: a word made of HSK 1
 * characters can be read at HSK 1. The words are not part of the standard and
 * the app says so wherever it shows one.
 *
 * Reduced to src/data/dictionary/extrawords.json, which is committed:
 * [simplified, pinyin, meaning, level, frequency rank], commonest first.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseCsv } from './lib/csv.mjs'
import { HSK3, DICT } from './lib/paths.mjs'
import { toneMarks, parseCedictLine } from './lib/cedict.mjs'

const CACHE = 'node_modules/.cache/hskker'
const CEDICT = `${CACHE}/cedict.txt.gz`
const FREQ = `${CACHE}/zh_cn_50k.txt`
/* How many to keep: the commonest, enough to give every level of characters
   its everyday combinations without burying the official words. */
const KEEP = 6000

for (const f of [CEDICT, FREQ]) {
  if (!existsSync(f)) {
    console.error(`${f} is missing — run \`npm run sources\` first.`)
    process.exit(1)
  }
}

const level = new Map()
for (const c of parseCsv(readFileSync(HSK3.chars, 'utf8'))) level.set(c.Hanzi, c.Level === '7-9' ? 7 : Number(c.Level))
const official = new Set()
for (const row of parseCsv(readFileSync(HSK3.words, 'utf8'))) {
  official.add(row.Simplified.replace(/[0-9]$/, ''))
  for (const form of row.Simplified.split('|')) official.add(form.replace(/[0-9]$/, ''))
  if (row.Variants) {
    try { for (const v of JSON.parse(row.Variants)) if (v.Simplified) official.add(v.Simplified) } catch { /* the headword is enough */ }
  }
}

/* A gloss that only says what the entry is not — a name, a variant, a
   cross-reference — or only gives the measure word. */
const empty = (g) => /^(surname |variant of|old variant|erhua variant|see |used in |abbr\. for|CL:|Taiwan pr\.|also pr\.|also written)/i.test(g)
const entries = new Map()
for (const line of gunzipSync(readFileSync(CEDICT)).toString('utf8').split('\n')) {
  const e = parseCedictLine(line.trimEnd())
  if (!e) continue
  const n = [...e.simplified].length
  if (n < 2 || n > 4) continue
  /* a proper noun's reading is capitalised in CC-CEDICT */
  if (/^[A-Z]/.test(e.reading)) continue
  const meanings = e.glosses.filter((g) => !empty(g)).map((g) => g.replace(/\s*\(CL:[^)]*\)/g, '').trim()).filter(Boolean)
  if (!meanings.length) continue
  const list = entries.get(e.simplified)
  const entry = { pinyin: e.reading.split(/\s+/).map(toneMarks).join(''), meanings }
  if (list) list.push(entry)
  else entries.set(e.simplified, [entry])
}

const HAN = /^[㐀-鿿]+$/
const out = []
let rank = 0, seen = 0
for (const line of readFileSync(FREQ, 'utf8').split('\n')) {
  const word = line.split(' ')[0]
  if (!word) continue
  rank++
  if (!HAN.test(word)) continue
  const chars = [...word]
  if (chars.length < 2 || chars.length > 4) continue
  seen++
  if (official.has(word) || !chars.every((c) => level.has(c))) continue
  const list = entries.get(word)
  if (!list) continue
  /* the entry with the most to say, for a word with several readings */
  const best = list.slice().sort((a, b) => b.meanings.length - a.meanings.length)[0]
  const meaning = best.meanings.slice(0, 2).join('; ').slice(0, 80)
  out.push([word, best.pinyin, meaning, Math.max(...chars.map((c) => level.get(c))), rank])
  if (out.length >= KEEP) break
}

writeFileSync(DICT.extrawords, JSON.stringify(out))
const byLevel = {}
for (const w of out) byLevel[w[3]] = (byLevel[w[3]] || 0) + 1
console.log(`${DICT.extrawords}: ${out.length} everyday words (from ${seen} Chinese words up to rank ${rank})`)
console.log('  by the level of their hardest character:', Object.entries(byLevel).map(([lv, n]) => `${lv === '7' ? '7–9' : lv}: ${n}`).join(', '))
