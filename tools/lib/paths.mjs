/**
 * Where the data lives. Every build script reads its inputs and writes its
 * outputs through this table, so a folder moves in one place. The layout,
 * and what each file is for, is described in src/data/README.md.
 *
 *   src/data/hsk3/        the official HSK 3.0 lists (words, characters, grammar)
 *   src/data/dictionary/  glosses, character readings and analysis
 *   src/data/grammar/     the grammar points' notes and example sentences
 *   src/data/hskker.db    the generated store, not committed
 */

export const DATA = 'src/data'

export const HSK3 = {
  dir: `${DATA}/hsk3`,
  words: `${DATA}/hsk3/words.csv`,
  chars: `${DATA}/hsk3/chars.csv`,
  grammar: `${DATA}/hsk3/grammar.csv`,
}

export const DICT = {
  dir: `${DATA}/dictionary`,
  glosses: `${DATA}/dictionary/glosses.json`,
  chardict: `${DATA}/dictionary/chardict.json`,
  charextra: `${DATA}/dictionary/charextra.json`,
  radicals: `${DATA}/dictionary/radicals.json`,
  /** everyday words the HSK list leaves out (build-extrawords.mjs) */
  extrawords: `${DATA}/dictionary/extrawords.json`,
}

export const DB_PATH = `${DATA}/hskker.db`
