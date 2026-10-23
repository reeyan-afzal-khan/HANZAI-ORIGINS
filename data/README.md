# data/

Everything the app is built from, one folder per kind of thing. Each folder
has a README that says what every file holds, field by field, and what to run
after changing it. The build scripts reach most of these files through
`scripts/lib/paths.mjs`, so a path is written in one place.

```
data/
├── hsk3/         the official HSK 3.0 lists — words, characters, grammar (CSV)
├── dictionary/   what is known about each word and character (JSON)
├── grammar/      the grammar points' explanations and example sentences (JS modules)
├── talk/         the Talk tab's conversation bank and model answers (JSON)
├── translation/  the reader's offline translator, as published — fetched, not committed (see its README)
└── hskker.db     the store built from hsk3/, dictionary/ and grammar/ — generated, not committed
```

## How it flows

```
hsk3/  dictionary/  grammar/  ──[npm run db]──>  hskker.db  ──[npm run data]──>  app/data/
talk/                         ──[npm run talk]────────────────────────────────>  app/data/talk/
translation/                  ──[npm run translation]─────────────────────────>  app/data/mt/
```

`npm run data` runs the syllabus build, then the example-sentence build that
reads it, then the radical index (`npm run radicals` on its own). `npm run talk` needs `npm run data` to have run first, since
it reads the lexicon the export wrote. Nothing in `app/data/` is edited by
hand.

## Changing something

| You want to…                              | Edit                                  | Then run                          |
| ----------------------------------------- | ------------------------------------- | --------------------------------- |
| fix a word, character or grammar point    | `hsk3/*.csv` (see its README)         | `npm run data`                    |
| fix a meaning or a character's reading    | `dictionary/*.json`                   | `npm run data`                    |
| fix a radical's strokes or name           | `dictionary/radicals.json`            | `npm run radicals`                |
| fix a grammar explanation or example      | `grammar/hsk*.mjs`                    | `npm run data`                    |
| fix a question, deck or model answer      | `talk/*.json`                         | `npm run data && npm run talk`    |
| refresh the upstream lists                | nothing — `npm run sources` rewrites `hsk3/` and `dictionary/` | `npm run data` |

The files here are the source of truth. `hskker.db` and `app/data/` are
rebuilt from them and can be thrown away at any time.

## Pinyin

Only the syllabus carries pinyin — one reading per word in `hsk3/words.csv`
and per character in `dictionary/chardict.json`. No sentence anywhere in
`data/` (a Talk question, a grammar example) stores its own: it is read off
those readings, word by word, in one style everywhere —
`scripts/lib/pinyin.mjs` at build time, `readingOf` in `app/js/segment.js` in
the app. So a reading is fixed in one place, and the sentence files stay half
the size.
