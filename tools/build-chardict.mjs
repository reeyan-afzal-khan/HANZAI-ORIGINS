/**
 * Extracts readings and definitions for the 3,000 HSK 3.0 characters from
 * CC-CEDICT into a small committed file, so the app has a reading and a meaning
 * for every character — not only the ones that are themselves HSK words.
 *
 *   curl -sL https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz \
 *     | gunzip > node_modules/.cache/hskker/cedict.txt
 *   node tools/build-chardict.mjs
 *
 * The full 4 MB dictionary is not committed; src/data/dictionary/chardict.json is.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { parseCsv } from './lib/csv.mjs'
import { HSK3, DICT } from './lib/paths.mjs'
import { toneMarks } from './lib/cedict.mjs'

const SRC = process.argv[2] ?? 'node_modules/.cache/hskker/cedict.txt'
if (!existsSync(SRC)) {
  console.error(`CC-CEDICT not found at ${SRC}. See the comment at the top of this file.`)
  process.exit(1)
}

const chars = parseCsv(readFileSync(HSK3.chars, 'utf8'))
const wanted = new Set()
for (const { Hanzi, Traditional } of chars) {
  for (const c of [Hanzi, ...String(Traditional || '').split(/[/|]/)]) {
    const t = c.trim()
    if ([...t].length === 1) wanted.add(t)
  }
}

const isName = (gloss) => /^(surname |variant of|old variant|used in |abbr\. for)/i.test(gloss)

const found = new Map()
for (const line of readFileSync(SRC, 'utf8').split('\n')) {
  if (!line || line[0] === '#') continue
  const m = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/\s*$/.exec(line)
  if (!m) continue
  const [, traditional, simplified, reading, body] = m
  const glosses = body.split('/').filter(Boolean)
  const pinyin = reading.split(/\s+/).map(toneMarks).join('')

  // Index under both scripts: the HSK character list includes traditional forms.
  for (const char of new Set([simplified, traditional])) {
    if ([...char].length !== 1 || !wanted.has(char)) continue
    const entry = { p: pinyin, en: glosses, name: glosses.every(isName) }
    const list = found.get(char)
    if (list) list.push(entry)
    else found.set(char, [entry])
  }
}

const out = {}
for (const [char, entries] of found) {
  // Ordinary senses come before proper-name-only ones; richer entries come first.
  const ranked = entries.sort(
    (a, b) => Number(a.name) - Number(b.name) || b.en.length - a.en.length,
  )
  out[char] = {
    p: ranked[0].p,
    // Other readings of a polyphonic character, in the order CC-CEDICT lists them.
    alt: [...new Set(ranked.slice(1).map((e) => e.p))].filter((p) => p !== ranked[0].p),
    en: ranked.flatMap((e) => e.en).slice(0, 6),
  }
}

writeFileSync(DICT.chardict, JSON.stringify(out))
const missing = [...wanted].filter((c) => !out[c])
console.log(`Extracted ${Object.keys(out).length} of ${wanted.size} characters`)
if (missing.length) console.log(`No entry for ${missing.length}: ${missing.slice(0, 30).join(' ')}`)
