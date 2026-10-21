/**
 * db.mjs — the SQLite store that is now the single source of truth for
 * everything HANZAI-ORIGINS ships.
 *
 *   data/*          ──[build-db.mjs]──────>  data/hskker.db
 *   data/hskker.db  ──[build-data.mjs]────>  app/data/*.js
 *   data/hskker.db  ──[build-strokes.mjs]─>  app/data/strokes/*.js
 *
 * The database is the authoring and query surface: `sqlite3 data/hskker.db`
 * answers questions about the corpus that used to need a throwaway script, and
 * every generated file the app loads is a projection of a table in here.
 *
 * The app itself never opens this file, and cannot: `fetch` is blocked on
 * file:// and a WebAssembly SQLite build would have to be fetched too, so the
 * shipped format stays self-registering JavaScript. That is a build artefact
 * now rather than the primary store — see build-data.mjs for the export step.
 *
 * Uses node:sqlite, built into Node 22+, so the pipeline still installs and
 * builds with no native module and no network.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export { DB_PATH } from './paths.mjs'
import { DB_PATH } from './paths.mjs'
/** How many files the 12.5 MB of stroke data is bucketed into. */
export const STROKE_SHARDS = 64

/**
 * Which shard a character's stroke data lives in. Derived from the codepoint so
 * the app can work it out on its own — no index has to be consulted to know
 * which file to ask for, which keeps the runtime a single script tag.
 */
export const shardOf = (char) => char.codePointAt(0) % STROKE_SHARDS
/** Shard file names are zero-padded so a directory listing sorts correctly. */
export const shardName = (n) => String(n).padStart(2, '0')

/* Columns holding a JSON array or object are named here rather than guessed at,
   so a plain string that happens to look like JSON is never silently parsed. */
const JSON_COLUMNS = new Set([
  'pos', 'en', 'cl', 'alt', 'components', 'examples', 'pinyin_alt', 'data', 'value',
])

const SCHEMA = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                  -- JSON
);

CREATE TABLE levels (
  id                TEXT PRIMARY KEY,  -- '1'..'6', '7'
  ord               INTEGER NOT NULL,
  label             TEXT NOT NULL,     -- '1'..'6', '7-9'
  band              TEXT NOT NULL,     -- Beginner | Intermediate | Advanced
  words             INTEGER NOT NULL,
  chars             INTEGER NOT NULL,
  grammar           INTEGER NOT NULL,
  grammar_explained INTEGER NOT NULL
);

CREATE TABLE pos (
  code TEXT PRIMARY KEY,               -- 'N', 'V', 'Adj', ...
  name TEXT NOT NULL                   -- 'noun', 'verb', ...
);

CREATE TABLE words (
  id          TEXT PRIMARY KEY,        -- official HSK id
  ord         INTEGER NOT NULL,        -- source order, so exports stay stable
  simplified  TEXT NOT NULL,
  traditional TEXT NOT NULL,
  pinyin      TEXT NOT NULL,
  level       TEXT NOT NULL REFERENCES levels(id),
  freq        INTEGER,                 -- corpus frequency, null when unknown
  radical     TEXT NOT NULL DEFAULT '',
  pos         TEXT NOT NULL DEFAULT '[]',  -- JSON array of pos codes
  en          TEXT NOT NULL DEFAULT '[]',  -- JSON array of glosses
  cl          TEXT NOT NULL DEFAULT '[]',  -- JSON array of classifiers
  alt         TEXT                         -- JSON array of alternative spellings
);
CREATE INDEX words_level ON words(level);
CREATE INDEX words_simplified ON words(simplified);

CREATE TABLE chars (
  hanzi          TEXT PRIMARY KEY,
  ord            INTEGER NOT NULL,
  level          TEXT NOT NULL REFERENCES levels(id),
  writing_level  INTEGER,
  traditional    TEXT NOT NULL,
  in_words       INTEGER,              -- how many HSK words use this character
  rank           INTEGER,              -- rank in a modern-Chinese corpus
  stroke_count   INTEGER,
  radical        TEXT NOT NULL DEFAULT '',
  radical_no     INTEGER,
  decomposition  TEXT NOT NULL DEFAULT '',
  etymology      TEXT NOT NULL DEFAULT '',
  pinyin         TEXT NOT NULL DEFAULT '',
  cedict_radical TEXT NOT NULL DEFAULT '',
  components     TEXT NOT NULL DEFAULT '[]',  -- JSON array
  examples       TEXT NOT NULL DEFAULT '[]',  -- JSON array
  pinyin_alt     TEXT NOT NULL DEFAULT '[]',  -- JSON array of further readings
  en             TEXT NOT NULL DEFAULT '[]'   -- JSON array
);
CREATE INDEX chars_level ON chars(level);
CREATE INDEX chars_rank ON chars(rank);

CREATE TABLE grammar (
  id          INTEGER PRIMARY KEY,
  ord         INTEGER NOT NULL,
  level       TEXT NOT NULL REFERENCES levels(id),
  grp         TEXT NOT NULL DEFAULT '',
  grp_zh      TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  category_zh TEXT NOT NULL DEFAULT '',
  topic       TEXT NOT NULL DEFAULT '',
  topic_zh    TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  examples    TEXT NOT NULL DEFAULT '[]'      -- JSON array
);
CREATE INDEX grammar_level ON grammar(level);

/* The app's search index is a projection of words rather than a second copy:
   [id, simplified, pinyin, first gloss, level, frequency]. */
CREATE VIEW search AS
  SELECT id, ord, simplified, pinyin,
         COALESCE(json_extract(en, '$[0]'), '') AS gloss,
         level, freq
  FROM words;
`

/* One row per character that has stroke-order data — the table that replaced
   4,147 separate .js files. The data column is the hanzi-writer payload
   verbatim: passed straight through to the app, never reparsed on the way.
 *
 * Kept apart from the schema above because it survives a syllabus rebuild.
 * It is 12.5 MB, `npm run strokes` is the only thing that writes it, and stroke
 * order does not change when a gloss does — so throwing it away every time
 * data/ is recompiled would cost minutes to regenerate for no reason. */
const SCHEMA_STROKES = `
CREATE TABLE IF NOT EXISTS strokes (
  hanzi TEXT PRIMARY KEY,
  shard INTEGER NOT NULL,
  data  TEXT NOT NULL             -- JSON: {strokes:[...], medians:[...]}
);
CREATE INDEX IF NOT EXISTS strokes_shard ON strokes(shard);
`

/* The table a syllabus rebuild must not touch: it is loaded by its own
   command (strokes cost minutes to fetch). */
const KEPT = (name) => name === 'strokes'

/**
 * Opens the store for writing, rebuilding the syllabus tables from nothing.
 * The strokes table is left as it is — see SCHEMA_STROKES.
 */
export function createDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  /* Dropped and recreated rather than migrated: these tables are generated
     from data/ on every run, so there is no state in them worth preserving,
     and a half-migrated schema is a much worse failure than a rebuild. */
  db.exec('PRAGMA journal_mode = OFF')
  db.exec('PRAGMA synchronous = OFF')
  /* node:sqlite enforces foreign keys by default, which would refuse to drop
     a table another one points at; the whole set goes, so the order is moot. */
  db.exec('PRAGMA foreign_keys = OFF')
  const existing = db
    .prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table','view')`)
    .all()
  for (const { name, type } of existing) {
    if (String(name).startsWith('sqlite_') || KEPT(name)) continue
    db.exec(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS "${name}"`)
  }
  db.exec(SCHEMA)
  db.exec(SCHEMA_STROKES)
  return db
}

/** Opens the store for writing without touching what is already in it. */
export function openDbForWrite(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = OFF')
  db.exec('PRAGMA synchronous = OFF')
  db.exec(SCHEMA_STROKES)
  return db
}

/** Opens the store read-only, for the export steps. */
export function openDb(path = DB_PATH) {
  try {
    return new DatabaseSync(path, { readOnly: true })
  } catch {
    throw new Error(
      `Could not open ${path} — run \`npm run db\` to build it from data/.`,
    )
  }
}

/**
 * Runs `fn` inside one transaction. Inserting 11,092 words a statement at a
 * time is otherwise 11,092 separate commits, which turns a two-second build
 * into a two-minute one.
 */
export function batch(db, fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/**
 * An insert for `table` that takes a row object keyed by column name.
 * @param opts.replace last write wins instead of raising on a duplicate key.
 */
export function inserter(db, table, columns, opts = {}) {
  const stmt = db.prepare(
    `INSERT ${opts.replace ? 'OR REPLACE ' : ''}INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
  )
  return (row) =>
    stmt.run(
      ...columns.map((c) => {
        const v = row[c]
        if (v === undefined || v === null) return null
        if (typeof v === 'boolean') return v ? 1 : 0
        if (typeof v === 'object') return JSON.stringify(v)
        return v
      }),
    )
}

/** Runs a query and revives the JSON columns, so callers get real arrays. */
export function rows(db, sql, ...params) {
  return db
    .prepare(sql)
    .all(...params)
    .map((r) => {
      const out = {}
      for (const [k, v] of Object.entries(r)) {
        out[k] = JSON_COLUMNS.has(k) && typeof v === 'string' ? JSON.parse(v) : v
      }
      return out
    })
}
