/**
 * Where the data lives. Every build script reads its inputs and writes its
 * outputs through this table, so a folder moves in one place. The layout,
 * and what each file is for, is described in src/data/README.md.
 *
 *   src/data/hsk3/        the official HSK 3.0 lists (words, characters, grammar)
 *   src/data/dictionary/  glosses, character readings and analysis
 *   src/data/talk/        the conversation bank and its model answers
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
}

export const TALK = {
  dir: `${DATA}/talk`,
  questions: `${DATA}/talk/questions.json`,
  answers: `${DATA}/talk/answers.json`,
}

export const DB_PATH = `${DATA}/hskker.db`

/** The offline translator (the reader's "Compact"): the files it is made of,
 *  listed in src/data/translation/files.json and kept there exactly as
 *  downloaded; the list as the app reads it (release/web/data/translation-files.js,
 *  which the Android app installs from); and the files as the copies that
 *  carry them load them, under release/web/data/mt/ (see tools/build-translation.mjs). */
export const TRANSLATION = {
  dir: `${DATA}/translation`,
  list: 'release/web/data/translation-files.js',
  out: 'release/web/data/mt',
}
