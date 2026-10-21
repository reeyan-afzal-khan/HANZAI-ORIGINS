# data/talk/ — the Talk tab's conversation bank

Two JSON files: the questions, and the model answers written for them.
Read by `scripts/build-talk.mjs`, which stamps every question with the HSK
level it is readable at and writes `app/data/talk/`. Rebuild with
`npm run talk` — after `npm run data`, since the level stamping needs the
lexicon that export writes.

Neither file carries pinyin. The app reads a line's pinyin off the syllabus
when it is wanted (the ruby over each character, the line under a question,
the pinyin search), as it does for every other sentence it shows — see
`scripts/lib/pinyin.mjs` for the one way that is done.

## questions.json — 4,228 bilingual questions

```json
{
  "version": 2,
  "categories": ["Alcohol, substances & risky habits", …],   // 30 topics; a question's `cat` indexes this
  "frames":     ["Are ...", "Are there ...?", …],            // 101 sentence shapes; `frame` indexes this
  "stageLabels": ["1 - Icebreaker", "2 - Warm-up", "3 - Getting to know", "4 - Deep", "5 - Intimate / Debate"],
  "sensLabels":  ["1 - Safe", "2 - Light", "3 - Personal", "4 - Sensitive", "5 - Very sensitive"],
  "decks": [                        // 9 ready-made decks
    {
      "name": "Cold open",
      "why":  "Two people who just met, standing in a queue or a lift.",
      "rule": "stage 1; sensitivity <= 1; questions only; <= 10 words",   // how it was chosen, for the reader
      "ids":  [1, 2, 3, …]          // question ids, in the order dealt
    }
  ],
  "questions": [
    {
      "id": 1,                      // 1-based, dense — the build asserts it; decks point at these
      "score": 100,                 // how good a conversation question it is, 0–100
      "sens": 1,                    // sensitivity 1–5, indexes sensLabels
      "stage": 1,                   // conversation stage 1–5, indexes stageLabels
      "cat": 13,                    // index into categories
      "frame": 22,                  // index into frames
      "prompt": 0,                  // 1 when it is a prompt ("Tell me about…") rather than a question
      "en": "Do you like hiking?",
      "zh": "你喜欢徒步吗？"
    }
  ]
}
```

The Chinese is what the app segments, grades and reads pinyin off, so it
should stay natural, simplified, and fully punctuated.

## answers.json — the model answers

Each answer is four parts, each part given two ways: `[english, chinese]`.

```json
{
  "version": 1,
  "parts": [["A", "Answer",  "State a position and qualify it once…"],   // the four-part shape (A · R · E · C):
            ["R", "Reason",  "…"], ["E", "Example", "…"], ["C", "Close", "…"]],  // letter, name, guidance
  "exact": [                        // 55 answers written for one specific question
    [1,                             // the question id
     ["Yes, genuinely — …", "…", "…", "…"],     // the four parts in English
     ["喜欢，是真的喜欢——…", "…", "…", "…"]]     // the same in Chinese
  ],
  "frameKind": ["yesno", "yesno", …],   // for each of the 101 frames, which scaffold answers it
  "topic": {                        // a model answer per topic, keyed by category index,
    "0": { "open": [[en, zh] ×4], "opinion": [[en, zh] ×4] }   // for an open question and for an opinion one
  },
  "topicFallback": { "0": "open", … },   // which of the two to use when the frame does not say
  "scaffold": {                     // the bare four-part skeleton for a kind of question
    "yesno": { "nm": "Yes / no question",
               "a": [en, zh], "r": [en, zh], "e": [en, zh], "c": [en, zh] }
  }
}
```

How an answer is chosen for a question: an `exact` one if it has one;
otherwise the `topic` answer for its category, `open` or `opinion` as
`frameKind[frame]` (or `topicFallback`) says; the `scaffold` is what the app
shows as the shape to aim for.

## Editing

Fix the text in place. A new question goes at the end with the next id
(ids must stay dense, and the build stops if they are not); a deck names
ids. Then `npm run data && npm run talk`.
