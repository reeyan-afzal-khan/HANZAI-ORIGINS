/**
 * compile.mjs — turns the raw HSK 3.0 sources into plain objects.
 *
 *   data/hsk3/words.csv            11,092 official vocabulary items (levels 1–6, 7–9)
 *   data/hsk3/chars.csv             3,000 official characters
 *   data/hsk3/grammar.csv             573 official grammar points
 *   data/dictionary/glosses.json    CC-CEDICT-derived English meanings, merged in by headword
 *   data/dictionary/chardict.json   readings and definitions for every HSK character
 *   data/dictionary/charextra.json  frequency rank, strokes, radical, decomposition
 *
 * The paths come from paths.mjs; data/README.md says what each file is.
 *
 * This module only reads and reshapes. It writes nothing: build-db.mjs loads
 * the result into data/hskker.db, and build-data.mjs exports from there to the
 * files the app loads. Splitting it out is what lets the database sit between
 * the two, rather than each output format re-deriving the same merges.
 */
import { readFileSync } from 'node:fs'
import { parseCsv } from './csv.mjs'
import { HSK3, DICT } from './paths.mjs'
import { makeReader } from './pinyin.mjs'
import { tx, GROUP_EN } from './grammar-taxonomy.mjs'
import hsk1 from '../../data/grammar/hsk1.mjs'
import hsk2 from '../../data/grammar/hsk2.mjs'
import hsk3 from '../../data/grammar/hsk3.mjs'
import hsk4 from '../../data/grammar/hsk4.mjs'
import hsk5 from '../../data/grammar/hsk5.mjs'
import hsk6 from '../../data/grammar/hsk6.mjs'

const NOTES = { ...hsk1, ...hsk2, ...hsk3, ...hsk4, ...hsk5, ...hsk6 }

export const LEVELS = ['1', '2', '3', '4', '5', '6', '7-9']
export const key = (lv) => (lv === '7-9' ? '7' : lv)

export const POS_EN = {
  N: 'noun', V: 'verb', Adj: 'adjective', Adv: 'adverb', M: 'measure word',
  Conj: 'conjunction', Pron: 'pronoun', Prep: 'preposition', Aux: 'auxiliary',
  Num: 'numeral', Suffix: 'suffix', Prefix: 'prefix', Intj: 'interjection',
  Phonetic: 'phonetic',
}

// ---------------------------------------------------------------- meanings
/** Strips tone marks so HSK pinyin can be matched against CC-CEDICT readings. */
function toneless(pinyin) {
  return (pinyin || '')
    .normalize('NFD')
    .replace(/[\u0300-\u0304\u0308\u030c]/g, '')
    .replace(/[\s\u00b7'-]/g, '')
    .replace(/\u00fc/g, 'v')
    .toLowerCase()
}

/** Proper-name glosses are rarely the sense the syllabus intends. */
const isName = (gloss) => /^(surname|variant of|abbr\. for|\(old\))/i.test(gloss)

/** Normalises spacing and apostrophes so "bàba" and "bà ba" compare equal. */
const flat = (p) => (p || '').replace(/[\s\u00b7'-]/g, '').toLowerCase()

function rankEntries(entries, pinyin) {
  const exact = flat(pinyin)
  const want = toneless(pinyin)
  return [...entries].sort((a, b) => {
    // An exact tone-for-tone match wins: it separates 吧 ba (particle) from 吧 bā (bar).
    const tone = Number(flat(b.pinyin) === exact) - Number(flat(a.pinyin) === exact)
    if (tone) return tone
    const match = Number(toneless(b.pinyin) === want) - Number(toneless(a.pinyin) === want)
    if (match) return match
    const named = Number(isName(a.en[0])) - Number(isName(b.en[0]))
    if (named) return named
    return b.en.length - a.en.length
  })
}

/**
 * Entries written as 爸爸|爸, 有（一）点儿 or 第（第二） carry a Variants field with
 * each clean form and its own pinyin, POS and traditional spelling. The first
 * variant becomes the headword; the rest are listed as alternative spellings.
 */
function resolveForms(row) {
  if (row.Variants) {
    try {
      const v = JSON.parse(row.Variants).filter((x) => x.Simplified)
      if (v.length) {
        return {
          forms: v.map((x) => x.Simplified),
          pinyin: v[0].Pinyin || row.Pinyin.split('|')[0],
          pos: (v[0].POS || row.POS).replace(/\bPr\b/, 'Pron'),
          traditional: v[0].Traditional || row.Traditional.split('|')[0],
        }
      }
    } catch { /* fall through to the raw row */ }
  }
  const simplified = row.Simplified.replace(/[0-9]$/, '')
  return {
    forms: [simplified],
    pinyin: row.Pinyin.split('|')[0],
    pos: row.POS,
    traditional: row.Traditional.split('|')[0] || simplified,
  }
}

/** Drops blanks and case-only duplicates, such as the capitalised surname reading. */
function dedupeReadings(readings, primary) {
  const seen = new Set([primary.toLowerCase()])
  const out = []
  for (const r of readings.filter(Boolean)) {
    const k = r.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/**
 * Reads data/ and returns everything the store holds, in source order.
 * @returns {{words: object[], chars: object[], grammar: object[],
 *            meta: object, stats: object}}
 */
export function compile() {
  /** Readings and definitions for every HSK character, extracted from CC-CEDICT. */
  const chardict = JSON.parse(readFileSync(DICT.chardict, 'utf8'))
  /** How common each character is, how it is written, and what it is built from. */
  const charextra = JSON.parse(readFileSync(DICT.charextra, 'utf8'))

  const cedict = JSON.parse(readFileSync(DICT.glosses, 'utf8'))
  /** A headword can have several readings; all are kept so the right one can be picked. */
  const meanings = new Map()
  for (const w of cedict) {
    for (const form of w.forms ?? []) {
      const entry = {
        en: form.meanings ?? [],
        cl: form.classifiers ?? [],
        trad: form.traditional,
        pinyin: form.pinyin ?? '',
        freq: w.frequency ?? null,
        radical: w.radical ?? '',
      }
      if (!entry.en.length) continue
      const list = meanings.get(w.simplified)
      if (list) list.push(entry)
      else meanings.set(w.simplified, [entry])
    }
  }

  function lookup(hw, pinyin) {
    const entries = meanings.get(hw)
    if (!entries?.length) return null
    const [best] = rankEntries(entries, pinyin)
    // Push proper-name senses to the back rather than dropping them.
    const en = [...best.en].sort((a, b) => Number(isName(a)) - Number(isName(b)))
    return { ...best, en }
  }

  // ---------------------------------------------------------------- vocabulary
  const vocabRows = parseCsv(readFileSync(HSK3.words, 'utf8'))
  const words = []
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, []]))
  let missing = 0

  vocabRows.forEach((row, ord) => {
    const { forms, pinyin, pos, traditional } = resolveForms(row)
    const m = lookup(forms[0], pinyin) ?? forms.map((f) => lookup(f, pinyin)).find(Boolean) ?? null
    if (!m) missing++
    const entry = {
      ord,
      id: row.ID,
      s: forms[0],
      t: traditional || m?.trad || forms[0],
      p: pinyin,
      pos: pos.split('/').filter(Boolean),
      lv: key(row.Level),
      en: m?.en ?? [],
      cl: m?.cl ?? [],
      f: m?.freq ?? null,
      r: m?.radical ?? '',
    }
    if (forms.length > 1) entry.alt = forms.slice(1)
    words.push(entry)
    byLevel[row.Level].push(entry)
  })

  // ---------------------------------------------------------------- characters
  const charRows = parseCsv(readFileSync(HSK3.chars, 'utf8'))
  // A character's own reading/meaning, when it is itself a listed vocabulary item.
  const singles = new Map()
  for (const w of words) {
    if ([...w.s].length === 1 && !singles.has(w.s)) singles.set(w.s, w)
  }

  let charsWithoutReading = 0
  const chars = charRows.map((c, ord) => {
    // A character listed as a word in its own right keeps that entry's reading and
    // sense; everything else falls back to the CC-CEDICT character dictionary.
    const self = singles.get(c.Hanzi)
    const dict = chardict[c.Hanzi]
    const m = lookup(c.Hanzi, self?.p ?? dict?.p ?? '')
    const p = self?.p || dict?.p || ''
    const en = self?.en?.length ? self.en : (dict?.en ?? m?.en ?? [])
    const x = charextra[c.Hanzi] ?? {}
    if (!p) charsWithoutReading++
    return {
      ord,
      h: c.Hanzi,
      lv: key(c.Level),
      wl: c.WritingLevel ? Number(c.WritingLevel) : null,
      t: c.Traditional || c.Hanzi,
      // How many of the 11,092 HSK words this character appears in.
      inWords: c.Freq ? Number(c.Freq) : null,
      // Rank in a modern-Chinese corpus; 1 is the commonest character in the language.
      rank: x.rank ?? null,
      sc: x.sc ?? null,
      rad: x.rad ?? '',
      radn: x.radn ?? null,
      dec: x.dec ?? '',
      comp: x.comp ?? [],
      ety: x.ety ?? '',
      ex: (c.Examples || '').split(/\s+/).filter(Boolean),
      p,
      // Further readings of a polyphonic character, ignoring case-only duplicates
      // such as the capitalised surname reading CC-CEDICT lists separately.
      pAlt: dedupeReadings([dict?.p, ...(dict?.alt ?? [])], p),
      en,
      r: m?.radical ?? self?.r ?? '',
    }
  })

  // ---------------------------------------------------------------- grammar
  /* The examples in data/grammar/ are written as Chinese and English; their
     pinyin is read off the words and characters compiled above, as every
     other sentence in the app is. */
  const reading = makeReader(words, chars)
  const grammarRows = parseCsv(readFileSync(HSK3.grammar, 'utf8'))
  const grammar = grammarRows.map((g, ord) => {
    const no = Number(g.No)
    const note = NOTES[no]
    const topicZh = (g.Details || g.Category || '').replace(/\s+/g, ' ').trim()
    return {
      ord,
      id: no,
      lv: key(g.Level),
      group: GROUP_EN[g.Group] ?? g.Group,
      groupZh: g.Group,
      category: tx(g.Category),
      categoryZh: g.Category.replace(/\s+/g, ' ').trim(),
      topic: tx(topicZh),
      topicZh,
      content: (g.Content || '').replace(/\s+/g, ' ').trim(),
      title: note?.title ?? tx(topicZh),
      summary: note?.summary ?? '',
      examples: (note?.examples ?? []).map((ex) => ({ zh: ex.zh, py: reading(ex.zh), en: ex.en })),
    }
  })

  // ---------------------------------------------------------------- manifest
  const meta = {
    standard: 'HSK 3.0 — 国际中文教育中文水平等级标准 (2021)',
    generated: new Date().toISOString().slice(0, 10),
    levels: LEVELS.map((lv) => ({
      id: key(lv),
      label: lv === '7-9' ? '7–9' : lv,
      band: Number(key(lv)) <= 3 ? 'Beginner' : Number(key(lv)) <= 6 ? 'Intermediate' : 'Advanced',
      words: byLevel[lv].length,
      chars: chars.filter((c) => c.lv === key(lv)).length,
      grammar: grammar.filter((g) => g.lv === key(lv)).length,
      grammarExplained: grammar.filter((g) => g.lv === key(lv) && g.summary).length,
    })),
    totals: {
      words: vocabRows.length,
      chars: chars.length,
      grammar: grammar.length,
      grammarWithNotes: grammar.filter((g) => g.summary).length,
    },
    pos: POS_EN,
  }

  return {
    words,
    chars,
    grammar,
    meta,
    stats: { missingGlosses: missing, charsWithoutReading },
  }
}
