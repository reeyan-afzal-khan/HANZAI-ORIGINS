/* study.js — the deck.
 *
 * The card model, the deck edits the entries and the reader make, and the
 * streak the home screen reports. */


/* ==================================================================
   THE DECK
   ================================================================== */

/* The card model.
 *
 * A card is one item in one study mode — a word to recognise, a character to
 * write. It carries the fields a spaced-repetition scheduler keys on (state,
 * ease, interval, due) so the record is ready for one; the grading
 * arithmetic that used to sit here went with the review session it drove
 * and is in the history if a session comes back. What the deck does today
 * is say which words the reader has decided about (segment.js paints them)
 * and count what a level's coverage is. */

const DAY = 86400000;
const INITIAL_EASE = 2.5;

const cardId = (kind, ref, mode) => `${kind}:${ref}:${mode}`;

function newCard(kind, ref, mode, lv, now = Date.now()){
  return {
    id: cardId(kind, ref, mode),
    kind, ref: String(ref), mode, lv,
    state: "new", ease: INITIAL_EASE, interval: 0, step: 0,
    reps: 0, lapses: 0, due: now, created: now, last: null,
  };
}

/* A card counts as mastered once it is reliably scheduled three weeks out. */
const isMastered = c => c.state === "review" && c.interval >= 21;


/* ==================================================================
   DECK EDITS AND THE STREAK
   ================================================================== */

/* Which card types each kind of item generates. A word is worth knowing in
   three directions; a character is worth knowing and worth being able to
   write; a grammar point is one card. */
const MODES = {
  word:    ["recognize", "recall", "listen"],
  char:    ["recognize", "write"],
  grammar: ["recognize"],
};

function startOfDay(t = Date.now()){
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ---------------- deck edits ---------------- */
async function addToDeck(kind, ref, lv, modes){
  const wanted = modes || MODES[kind];
  const have = new Set((await cardsFor(kind, ref)).map(c => c.mode));
  const add = wanted.filter(m => !have.has(m)).map(m => newCard(kind, String(ref), m, lv));
  if(add.length) await dbPutMany("cards", add);
  return add.length;
}
const removeFromDeck = (kind, ref) => deleteCardsFor(kind, ref);

/* Consecutive days ending today — or ending yesterday, if today has not
   started yet, so opening the app in the morning does not read as a break. */
function computeStreak(times){
  if(!times.length) return 0;
  const days = new Set(times.map(t => startOfDay(t)));
  let cursor = startOfDay();
  if(!days.has(cursor)){
    cursor -= DAY;
    if(!days.has(cursor)) return 0;
  }
  let streak = 0;
  while(days.has(cursor)){ streak++; cursor -= DAY; }
  return streak;
}
