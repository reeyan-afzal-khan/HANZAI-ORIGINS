# data/hsk3/ — the official HSK 3.0 lists

The standard itself, as three CSV files (from [ivankra/hsk30](https://github.com/ivankra/hsk30),
MIT). They are the spine of the app: every word, character and grammar point
the app knows comes from here, and everything else is attached to them.
Read by `scripts/lib/compile.mjs`; rebuild with `npm run data`.

Levels are `1`–`6` and `7-9`. In the app and the database `7-9` is stored as
`7` and shown as "7–9".

## words.csv — 11,092 vocabulary items

| Column        | Holds                                                        | Used |
| ------------- | ------------------------------------------------------------ | ---- |
| `ID`          | `L1-0001` — level and position; the word's id everywhere     | yes  |
| `Simplified`  | the headword; a trailing digit (`会2`) tells homographs apart and is stripped | yes |
| `Traditional` | traditional form(s), `\|`-separated; the first is used       | yes  |
| `Pinyin`      | reading(s), `\|`-separated; the first is used                | yes  |
| `POS`         | `N V Adj Adv M Pron …` (the lists' own tags; `Pr` is read as `Pron`) | yes |
| `Level`       | `1`–`6`, `7-9`                                               | yes  |
| `WebNo`, `WebPinyin`, `OCR` | the list maintainers' bookkeeping               | no   |
| `Variants`    | JSON list of alternative forms (`[{"Simplified":…,"Pinyin":…,"POS":…}]`); the first with a simplified form wins | yes |
| `CEDICT`      | the CC-CEDICT key (`愛\|爱[ai4]`) — the join to the glosses  | no (glosses join on the headword) |

## chars.csv — 3,000 characters

| Column         | Holds                                                     | Used |
| -------------- | --------------------------------------------------------- | ---- |
| `Hanzi`        | the character                                             | yes  |
| `Level`        | the level it is read at                                   | yes  |
| `WritingLevel` | the level it is written at (blank: not required)          | yes  |
| `Traditional`  | traditional form, blank when the same                     | yes  |
| `Freq`         | how many words in the lists it appears in                 | yes  |
| `Examples`     | those words, space-separated                              | yes  |

Readings, meanings, strokes and components are not here — see `../dictionary/`.

## grammar.csv — 573 grammar points

| Column     | Holds                                                     | Used |
| ---------- | --------------------------------------------------------- | ---- |
| `No`       | 1–573; the point's id, and the key into `../grammar/`     | yes  |
| `Level`    | `1`–`6`, `7-9`                                            | yes  |
| `Group`    | 词类 / 短语 / 句子成分 / 句子 … — translated by `scripts/lib/grammar-taxonomy.mjs` | yes |
| `Category` | the sub-heading within the group (Chinese)                | yes  |
| `Details`  | the point's own name, where the list gives one            | yes  |
| `Content`  | the forms or examples the standard lists                  | yes  |

The English explanations of the points are not in this file: they live in
`../grammar/hsk*.mjs`, keyed by `No`, and are merged in by `compile.mjs`.

## Editing

Edit the CSV in place (UTF-8, keep the header row), then `npm run data`.
`npm run sources` downloads the upstream lists again and overwrites these
three files, so put a correction that should survive a refresh in the build
(`scripts/lib/compile.mjs`) rather than in the CSV.
