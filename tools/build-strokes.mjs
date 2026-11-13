/**
 * Loads stroke-order data for the HSK 3.0 characters into data/hskker.db, then
 * exports it to app/data/strokes/ so writing practice works offline and inside
 * the Android build.
 *
 *   npm i -D hanzi-writer-data && npm run strokes
 *
 * This used to write one .js file per character: 4,147 of them, two thirds of
 * every file in the repository, and 21 MB on disk for 12.5 MB of data — 4,000
 * files that small waste most of a cluster each. The data now lives in the
 * strokes table and is exported in 64 buckets, around 200 KB apiece.
 *
 * Bucketed rather than concatenated because the app still has to load stroke
 * data on demand — 12.5 MB in one file would be parsed in full the first time
 * anybody practised a single character. Which bucket a character is in is its
 * codepoint modulo 64, so the app can work it out without consulting an index.
 *
 * Still self-registering .js rather than .json, for the same reason as the
 * syllabus: fetch is blocked on file://, and a <script> tag is not.
 *
 * Without this the app falls back to fetching stroke data from a CDN, which
 * needs a network connection.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseCsv } from './lib/csv.mjs'
import { HSK3 } from './lib/paths.mjs'
import { openDbForWrite, batch, inserter, rows, shardOf, shardName, STROKE_SHARDS } from './lib/db.mjs'

const require = createRequire(import.meta.url)
const OUT = 'app/data/strokes'

let dataDir
try {
  dataDir = require.resolve('hanzi-writer-data/package.json').replace(/package\.json$/, '')
} catch {
  console.error('hanzi-writer-data is not installed.\n\n  npm i -D hanzi-writer-data\n')
  process.exit(1)
}

const chars = parseCsv(readFileSync(HSK3.chars, 'utf8'))
const db = openDbForWrite()

// ------------------------------------------------------------------ load
const missing = []

batch(db, () => {
  db.exec('DELETE FROM strokes')
  /* Last write wins: a character can be reached more than once — 干 is its own
     entry and also the traditional form listed against 乾 — and the payload is
     identical either way. The old one-file-per-character build overwrote in
     exactly the same way. */
  const add = inserter(db, 'strokes', ['hanzi', 'shard', 'data'], { replace: true })

  for (const { Hanzi, Traditional } of chars) {
    // The Traditional column lists variants separated by / or |.
    const forms = [Hanzi, ...String(Traditional || '').split(/[/|]/)]
      .map((c) => c.trim())
      .filter((c) => [...c].length === 1)
    for (const ch of new Set(forms)) {
      const src = `${dataDir}${ch}.json`
      if (!existsSync(src)) {
        missing.push(ch)
        continue
      }
      /* The payload is already JSON and goes through verbatim — stored as text
         and handed to the app unparsed, exactly as the old per-character files
         did. Nothing in the pipeline needs to look inside it. */
      add({ hanzi: ch, shard: shardOf(ch), data: readFileSync(src, 'utf8').trim() })
    }
  }
})

// ------------------------------------------------------------------ export
/* Rebuilt from scratch: a shard left behind by an older, differently-sized run
   would be dead weight the service worker still caches. */
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const sizes = []
for (let n = 0; n < STROKE_SHARDS; n++) {
  const bucket = db
    .prepare('SELECT hanzi, data FROM strokes WHERE shard = ? ORDER BY hanzi')
    .all(n)
  /* An empty bucket still gets a file. The app asks for a shard by arithmetic
     rather than by looking a character up, so a 404 for a gap in the range
     would be indistinguishable from a broken build. */
  const body = bucket.map((r) => `${JSON.stringify(r.hanzi)}:${r.data}`).join(',')
  const text = `HSKSTROKE.shard(${n},{${body}})\n`
  writeFileSync(`${OUT}/${shardName(n)}.js`, text)
  sizes.push(Buffer.byteLength(text))
}

/* The manifest lists every character that has data, as one string. It is read
   before any shard is, so a character outside the set — anything the syllabus
   does not cover — goes straight to the CDN instead of pulling 330 KB to
   discover it is not in there. */
const have = rows(db, 'SELECT hanzi FROM strokes ORDER BY hanzi').map((r) => r.hanzi)
writeFileSync(`${OUT}/manifest.js`,
  `HSKSTROKE.manifest(${JSON.stringify({
    shards: STROKE_SHARDS,
    count: have.length,
    generated: new Date().toISOString(),
    chars: have.join(''),
  })})\n`)

db.close()

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const total = sizes.reduce((a, b) => a + b, 0)
console.log(`Stroke data for ${have.length} characters -> ${OUT}/`)
console.log(`  ${STROKE_SHARDS} shards, ${(total / 1048576).toFixed(1)} MB total`)
console.log(`  smallest ${kb(Math.min(...sizes))}, largest ${kb(Math.max(...sizes))}, ` +
            `average ${kb(total / STROKE_SHARDS)}`)
if (missing.length) console.log(`No data for ${missing.length}: ${missing.slice(0, 20).join(' ')}`)
