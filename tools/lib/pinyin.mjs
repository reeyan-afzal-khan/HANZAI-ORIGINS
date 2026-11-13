/**
 * pinyin.mjs — the one place a line of Chinese gets its pinyin at build time.
 *
 * No data file in data/ carries pinyin for its sentences; the syllabus does,
 * one reading per word and per character, and every sentence is read off
 * that — here for the build, and in app/js/segment.js (readingOf) for the app,
 * the same way, so a Talk question and a grammar example come out in one
 * style:
 *
 *   reading('早上好！你好吗？')     ->  'Zǎoshang hǎo! Nǐ hǎo ma?'
 *
 * The line is cut into the longest words the lexicon knows, each word gives
 * its own reading (the reading in context — 得 is "de" in 觉得 and "dé"
 * alone), and a character outside every word falls back to its dictionary
 * reading. Words are separated by spaces, syllables within a word are not;
 * Chinese punctuation comes through as its Latin counterpart, attached to
 * the word before it; a sentence starts with a capital.
 *
 *   makeReader(words, chars)          words: {s, p, lv} · chars: {h, p}
 *   readerFromExport()                the same, built from app/data/ (after npm run data)
 */
import { readFileSync } from 'node:fs'

const HAN = /[一-鿿]/

const PUNCT = {
  '，': ',', '。': '.', '？': '?', '！': '!', '、': ',', '；': ';', '：': ':',
  '（': ' (', '）': ')', '“': ' "', '”': '" ', '‘': " '", '’': "' ", '《': ' <', '》': '> ',
  '…': '...', '——': ' -- ', '—': ' - ', '·': ' ', '　': ' ',
}

/** @param {Iterable<{s:string,p:string,lv:string|number}>} words @param {Iterable<{h:string,p:string}>} chars */
export function makeReader(words, chars) {
  const lex = new Map()
  let max = 1
  for (const { s, p, lv } of words) {
    if (!s || !p) continue
    const prev = lex.get(s)
    if (prev && +prev.lv <= +lv) continue      // the lower level's reading wins a tie
    lex.set(s, { p, lv })
    if (s.length > max) max = s.length
  }
  const charP = new Map()
  for (const { h, p } of chars) if (h && p) charP.set(h, p)

  return (text) => {
    const src = String(text)
    let out = ''
    let i = 0
    // a space before a word, unless it opens a quote or a bracket
    const push = (s) => { out += (out && !/[\s"'(<]$/.test(out) ? ' ' : '') + s }
    while (i < src.length) {
      const ch = src[i]
      if (!HAN.test(ch)) {
        const two = src.slice(i, i + 2)
        if (PUNCT[two] !== undefined) { out += PUNCT[two]; i += 2; continue }
        out += PUNCT[ch] ?? ch
        i++
        continue
      }
      let hit = null, len = 0
      for (let n = Math.min(max, src.length - i); n >= 2; n--) {
        const found = lex.get(src.slice(i, i + n))
        if (found) { hit = found; len = n; break }
      }
      if (hit) { push(hit.p); i += len; continue }
      const one = lex.get(ch)
      push(one ? one.p : (charP.get(ch) ?? ch))
      i++
    }
    return capitalise(out.replace(/\s+/g, ' ').replace(/\s+(?=[.,!?;:)>])/g, '').trim())
  }
}

/** A capital at the start, after a full stop, question or exclamation mark,
 *  and at the opening of a quotation. */
export const capitalise = (s) =>
  s.replace(/(^|[.!?]\s+|["(<]|\s')(\p{L})/gu, (_, a, c) => a + c.toUpperCase())

/** The reader over the exported syllabus, for scripts that run after npm run data. */
export function readerFromExport(dataDir = 'app/data') {
  const jsonp = (file) => {
    let out = null
    new Function('HSKDATA', readFileSync(file, 'utf8'))((_n, payload) => { out = payload })
    return out
  }
  const search = jsonp(`${dataDir}/search.js`).map(([, s, p, , lv]) => ({ s, p, lv }))
  return makeReader(search, jsonp(`${dataDir}/chars.js`))
}
