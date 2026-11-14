/**
 * cedict.mjs — reading CC-CEDICT, for the build scripts that take readings
 * and meanings from it (build-chardict.mjs, build-extrawords.mjs).
 *
 *   Traditional Simplified [pin1 yin1] /meaning/meaning/
 */

const VOWELS = 'aoeiuv'
const MARKS = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
}

/** Converts CC-CEDICT's numbered pinyin ("hao3") into tone marks ("hǎo"). */
export function toneMarks(syllable) {
  const m = /^([a-zA-Zü:]+)([1-5])?$/.exec(syllable.replace(/u:/g, 'v'))
  if (!m) return syllable
  const [, body, tone] = m
  const index = (tone ? Number(tone) : 5) - 1
  const lower = body.toLowerCase()
  // Standard placement: a/o/e take the mark; otherwise it falls on the last vowel.
  let target = -1
  for (const v of 'aoe') {
    const i = lower.indexOf(v)
    if (i >= 0) {
      target = i
      break
    }
  }
  if (target < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if (VOWELS.includes(lower[i])) {
        target = i
        break
      }
    }
  }
  if (target < 0) return body.replace(/v/g, 'ü')
  const marked = MARKS[lower[target]]?.[index] ?? lower[target]
  return (body.slice(0, target) + marked + body.slice(target + 1)).replace(/v/g, 'ü')
}

/** One line of the dictionary, or null for a comment or anything unreadable. */
export function parseCedictLine(line) {
  if (!line || line[0] === '#') return null
  const m = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/\s*$/.exec(line)
  if (!m) return null
  const [, traditional, simplified, reading, body] = m
  return { traditional, simplified, reading, glosses: body.split('/').filter(Boolean) }
}
