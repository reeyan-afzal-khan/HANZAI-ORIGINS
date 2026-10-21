# data/grammar/ — what the app says about each grammar point

An English explanation and two example sentences for every grammar point of
levels 1–6, 425 of the 573, written for this project. The points themselves,
and their Chinese names, are the official list in `../hsk3/grammar.csv`; this
folder is what is said about them. The points of levels 7–9 have no note yet
and keep the list's own name and forms.
Read by `scripts/lib/compile.mjs`; rebuild the app with `npm run data`.

## hsk1.mjs … hsk6.mjs — one file per level

Each file is a JavaScript module whose default export maps a point's `No` in
`grammar.csv` to its note:

```js
export default {
  2: { title: 'Modal verbs 会 and 能', summary: '会 = a learned ability ("know how to"); 能 = …', examples: [
    { zh: '我会说汉语。', en: 'I can speak Chinese.' },
    { zh: '今天我不能去。', en: "I can't go today." } ] },
}
```

| Field      | Holds                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `title`    | the point's name in the app (without a note, the list's name, translated) |
| `summary`  | the explanation, a few sentences                                       |
| `examples` | sentences in Chinese (`zh`) and English (`en`)                         |

The examples carry no pinyin: it is read off the syllabus at build time, as
for every other sentence in the app (`scripts/lib/pinyin.mjs`). They are also
where the word cards' examples come from: `npm run data` ends by picking, for
each word of the syllabus, up to three of these sentences that use it
(`scripts/build-examples.mjs`).
