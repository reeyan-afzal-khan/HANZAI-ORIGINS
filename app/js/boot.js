/* boot.js — event wiring and start-up. Loaded last, after every function it
   points at exists. */

/* ---------------- views ---------------- */
/* Set once the opening view is on screen, so the first show() does not scroll. */
let booted = false;
const VIEWS = ["home", "chars", "grammar", "talk", "read", "settings"];
const RENDER = {
  home: renderHome, chars: renderChars,
  grammar: renderGrammar, read: renderRead, talk: renderTalk,
  settings: renderSettings,
};

function show(view){
  if(!VIEWS.includes(view)) view = "home";
  // The gloss belongs to the page it was opened from; leaving takes it with you.
  if(view !== "read"){ closeGloss(); if(typeof TURN !== "undefined" && TURN.leaf) dropLeaf(); if(typeof riffleDrop === "function") riffleDrop(); }
  /* The book stays open so that coming back resumes it, but the full-screen
     reading layout must not follow you out of the view — on a phone it hides
     the masthead and the tabs, and leaving it on would stand somebody on the
     home screen with no way to navigate at all. */
  document.body.classList.toggle("reading", view === "read" && !!R.book);
  if(typeof applyReadFocus === "function") applyReadFocus();
  /* A conversation is kept while you look something up in another tab — its
     card is still there when you come back — but its word card is not. */
  if(view !== "talk" && typeof closeTalkGloss === "function") closeTalkGloss();
  /* The character tree filling the window belongs to its tab. */
  if(view !== "chars") document.body.classList.remove("ct-max");
  const changed = S.view !== view;
  S.view = view; save();
  VIEWS.forEach(v => $(`#v-${v}`).classList.toggle("hidden", v !== view));
  /* A new view arrives rather than appears: a short rise-and-fade, once,
     removed when it lands so nothing is left transformed under it. */
  const sec = $(`#v-${view}`);
  if(booted && changed) sec.style.opacity = "0";
  $$("#nav button[data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === view));
  /* On a phone the tabs are one row that scrolls sideways: the one you are
     on is brought to the middle of it. */
  const navRow = $("#nav"), onTab = navRow.querySelector(`button[data-v="${view}"]`);
  if(onTab && navRow.scrollWidth > navRow.clientWidth + 1){
    const x = onTab.getBoundingClientRect().left - navRow.getBoundingClientRect().left + navRow.scrollLeft;
    navRow.scrollTo({left: x - (navRow.clientWidth - onTab.offsetWidth) / 2, behavior: booted && !REDUCED() ? "smooth" : "auto"});
  }
  // Switching views starts you at the top of the new one — but the very first
  // paint should leave the masthead where it is rather than scrolling past it.
  if(booted) window.scrollTo({top: 0});
  const drawn = Promise.resolve(RENDER[view]()).catch(err => viewFailed(view, err));
  if(booted && changed) enterView(sec, drawn);
}

/* A new view arrives rather than appears: a short rise and fade — started
   once the view has drawn itself, so the drawing and the motion never share
   a frame (the rise used to begin on the old contents and be repainted as
   the new ones arrived under it), and run as a compositor animation, with
   no layout forced to restart a CSS one. Never held back for long: a view
   still waiting on its data after a moment rises as it is. Measured lists
   are re-measured once it has landed. */
function enterView(sec, drawn){
  const land = () => { sec.style.opacity = ""; sizeLists(); };
  if(REDUCED()){ drawn.finally(land); land(); return; }
  const frame = () => new Promise(ok => { requestAnimationFrame(() => ok()); setTimeout(ok, 50); });
  Promise.race([drawn, new Promise(ok => setTimeout(ok, 150))]).then(frame).then(() => {
    if(S.view !== sec.id.slice(2)){ sec.style.opacity = ""; return; }
    sec.style.opacity = "";
    const an = sec.animate([{opacity: 0, transform: "translateY(6px)"}, {opacity: 1, transform: "none"}],
      {duration: 220, easing: "cubic-bezier(.2,.8,.2,1)"});
    let done = false;
    const end = () => { if(!done){ done = true; sizeLists(); } };
    an.finished.then(end, end);
    /* a page that is not being drawn runs no animation: the view is shown
       as it is rather than left waiting at the rise's first frame */
    setTimeout(() => { if(an.playState !== "finished") an.cancel(); end(); }, 420);
  });
}

/* A view that cannot render is nearly always one thing: the generated syllabus
   is not there. Say that, in the page, with the command that fixes it — the
   raw stack is kept behind a disclosure for the case where it is something
   else. */
function viewFailed(view, err){
  const host = $(`#v-${view}`);
  if(!host) return;
  const missing = /Could not load data\//.test(String(err && err.message));
  host.innerHTML = `<div class="panel">
    <h3>${missing ? "The syllabus data is missing" : "That view failed to load"}</h3>
    <p class="pmeta">${missing
      ? `HANZAI-ORIGINS keeps the HSK 3.0 lists in <code>app/data/</code>, which is generated rather than
         committed. Run <b>npm run data</b> once — and <b>npm run strokes</b> if you want stroke
         order offline — then reload.`
      : `Something went wrong rendering this screen.`}</p>
    <details style="margin-top:9px">
      <summary class="lbl" style="cursor:pointer">Technical detail</summary>
      <p class="qtext" style="white-space:pre-wrap;margin-top:7px">${esc(String(err && err.stack || err))}</p>
    </details>
  </div>`;
}

$("#nav").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if(!b) return;
  /* The tab you are already on: back to the top of its list, the way a
     second tap on a phone's tab bar does. */
  if(b.dataset.v === S.view){
    const list = $(`#v-${S.view} .list-scroll`);
    if(list) list.scrollTo({top: 0, behavior: REDUCED() ? "auto" : "smooth"});
    window.scrollTo({top: 0, behavior: REDUCED() ? "auto" : "smooth"});
    return;
  }
  show(b.dataset.v);
});

/* ---------------- collapsible panels ---------------- */
/* Every panel carrying a data-fold key becomes collapsible. The heading turns
   into a real button — keyboard and screen readers get the same control the
   mouse does — and which panels are closed is remembered. */
function setupFolds(){
  $$(".panel[data-fold]").forEach(panel => {
    const h3 = panel.querySelector(":scope > h3");
    if(!h3 || h3.dataset.wired) return;
    h3.dataset.wired = "1";
    h3.setAttribute("role", "button");
    h3.setAttribute("tabindex", "0");
    h3.insertAdjacentHTML("beforeend", '<i class="pfold" aria-hidden="true"></i>');

    const key = panel.dataset.fold;
    const apply = () => {
      const closed = S.folded.includes(key);
      panel.classList.toggle("folded", closed);
      h3.setAttribute("aria-expanded", String(!closed));
    };
    const toggle = () => {
      S.folded = S.folded.includes(key)
        ? S.folded.filter(k => k !== key)
        : [...S.folded, key];
      save();
      apply();
    };
    h3.addEventListener("click", toggle);
    h3.addEventListener("keydown", e => {
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
    });
    apply();
  });
}

/* ---------------- one delegated click handler ---------------- */
/* Rows, chips and cards are all rebuilt on every paint, so nothing is bound
   per element — the page listens once and reads the intent off the target. */
document.addEventListener("click", e => {
  const open = e.target.closest("[data-open]");
  if(open){
    const [kind, ...rest] = open.dataset.open.split(":");
    const ref = rest.join(":");
    safely("open that entry", () =>
      kind === "word" ? openWord(ref) :
      kind === "char" ? openChar(ref) :
      kind === "grammar" ? openGrammar(ref) : null);
    return;
  }

  const deck = e.target.closest("[data-deck]");
  if(deck){
    const [kind, ref, lv] = deck.dataset.deck.split(":");
    safely("update your deck", async () => {
      const have = await cardsFor(kind, ref);
      if(have.length){
        await removeFromDeck(kind, ref);
        toast("Removed from your deck");
      }else{
        const n = await addToDeck(kind, ref, lv);
        toast(n === 1 ? "Added 1 card" : `Added ${n} cards`);
      }
      closeDetail();
      await Promise.all([renderRail(), treeDeckChanged(), grammarDeckChanged()]);
    });
    return;
  }

  if(e.target.closest("[data-close]")) closeDetail();

  /* An entry's "Explore in the tree", or a part with no entry of its own:
     the character tree, grown from it. */
  const grow = e.target.closest("[data-grow]");
  if(grow){ treeGrowFrom(grow.dataset.grow); return; }

  const resume = e.target.closest("[data-resume]");
  if(resume){
    show("read");
    safely("open that text", () => openBook(resume.dataset.resume));
    return;
  }
  /* The home screen's pick-up card for a conversation: the tab opens
     straight onto the card that was up. */
  if(e.target.closest("[data-talkresume]") && S.view !== "talk"){
    TK.resumeOnRender = true;
    show("talk");
    return;
  }

  /* A launcher tile is a section. The nav's own listener only hears the nav. */
  const go = e.target.closest("[data-go]");
  if(go){ show(go.dataset.go); return; }

  /* The dashboard's "move up" is the ladder's own switch, from a sentence. */
  const lvcard = e.target.closest(".lvcard[data-lv], [data-setlv]");
  if(lvcard){
    setLevel(lvcard.dataset.lv || lvcard.dataset.setlv);
    safely("switch level", async () => {
      await renderHome();
      toast(`Working at HSK ${levelLabel(S.level)}`);
    });
  }
});

/* ---------------- word cards, both surfaces ----------------
   The reader's card and the Talk tab's are the same card: anchored to a
   word, and put away by a press anywhere else. Both are driven from here so
   they cannot drift apart. */

/* Set by a press that put a card away, and cleared once its click has run. */
let pressSpent = false;

/* Putting a card away: any press anywhere that is not on a card and not on a
   word. Caught at pointerdown, in the capture phase, on the document — so it
   fires for a dialog's backdrop, for anything a modal has made inert, before
   any of them can swallow it, and for touch and pen the same as for a mouse.
   A press on a word is left to the click that follows it, which decides
   between opening the next word and toggling the same one closed. */
const dismissWordCards = e => {
  if(e.target.closest("#gloss, #tk-gloss") || e.target.closest(".rdw[data-i]")) return;
  let spent = false;
  if(R.sheet){ closeGloss(); spent = true; }
  if(TK.sheet){ closeTalkGloss(); spent = true; }
  /* The click from this same press must not then close a dialog too: the
     press meant "put the card away", and it is spent. */
  if(spent) pressSpent = true;
};
document.addEventListener("pointerdown", dismissWordCards, true);
/* And click, for anything that produces a click without a pointer — a screen
   reader's activation, a keyboard-driven press — so no way in is left out. */
document.addEventListener("click", dismissWordCards, true);

/* A card is anchored to a word, so a window that changes size moves it with
   the word. */
addEventListener("resize", () => {
  if(R.sheet) placePopover($("#gloss"), R.sheet.wordEl);
  if(TK.sheet) placePopover($("#tk-gloss"), TK.sheet.wordEl);
});

/* Opening a card without a tap. Two gestures, one timer.
 *
 * Hovering — a mouse, or a pen held above the screen — arms the timer on
 * arrival and the card it opens is a hover card: it goes away when the
 * pointer leaves the word. Holding — a finger, a pen or a mouse button kept
 * down on the word — arms it on the press, and the card it opens stays,
 * because a held press is a deliberate ask and lifting the finger must not
 * take the answer away; a tap elsewhere puts it away. The click that some
 * platforms fire when a long hold ends is swallowed, so the writing card does
 * not open on top of the gloss that was just asked for.
 *
 * Pointer type is read for hover only. Which device pressed does not matter,
 * and treating it as if it did is what left the S Pen, which some shells
 * report as a mouse and some as a pen, with no way to open a card at all. */
let dwellTimer = 0, dwellWord = null, dwellPress = false, swallowClick = false;
const HOVERS = t => t === "mouse" || t === "pen";
function armDwell(word, press){
  clearDwell();
  if(!S.glossDwell || !word) return;
  dwellWord = word; dwellPress = !!press;
  dwellTimer = setTimeout(() => {
    if(dwellWord !== word || !word.isConnected) return;
    const byDwell = !dwellPress;
    if(dwellPress) swallowClick = true;
    const blk = word.closest("#rd-prose .blk[data-b]");
    if(blk) openGloss(+blk.dataset.b, +word.dataset.i, {byDwell});
    else if(word.closest("[data-talkline]")) openTalkGloss(word, {byDwell});
  }, S.glossDwellMs || 2000);
}
function clearDwell(){ clearTimeout(dwellTimer); dwellTimer = 0; dwellWord = null; dwellPress = false; }
document.addEventListener("pointerover", e => {
  if(!HOVERS(e.pointerType)) return;
  /* With a passage selected, the pointer comes to rest on the last word of
     it; a hover card opening there would land on the passage's own card. */
  if(typeof selectionActive === "function" && selectionActive()) return;
  const w = e.target.closest(".rdw[data-i]");
  if(w && w !== dwellWord) armDwell(w, false);
});
document.addEventListener("pointerout", e => {
  if(!HOVERS(e.pointerType)) return;
  const w = e.target.closest(".rdw[data-i]");
  if(w && w === dwellWord && !dwellPress && !w.contains(e.relatedTarget)) clearDwell();
});
document.addEventListener("pointerdown", e => {
  swallowClick = false;
  const w = e.target.closest(".rdw[data-i]");
  if(w) armDwell(w, true); else clearDwell();
}, true);
["pointerup", "pointercancel"].forEach(t => document.addEventListener(t, clearDwell, true));
document.addEventListener("click", e => {
  if(!swallowClick) return;
  swallowClick = false;
  e.preventDefault(); e.stopPropagation();
}, true);
/* A hover card goes away by itself too: the moment the pointer is off the
   word — and off the card, which sits right under it and may be what the
   pointer is heading for — it is put away, after a beat short enough to feel
   immediate and long enough to cross the gap between the two. Any press on
   the card keeps it: from then on it is a card the reader asked for, and only
   a tap elsewhere puts it away. Hovering pointers only — a finger has no
   hover to lift. */
let leaveTimer = 0;
const dwellSheet = () => (R.sheet && R.sheet.byDwell) ? R.sheet
                       : (TK.sheet && TK.sheet.byDwell) ? TK.sheet : null;
function inDwellCard(el){
  const sheet = dwellSheet();
  if(!sheet || !el || el.nodeType !== 1) return false;
  const card = sheet === TK.sheet ? $("#tk-gloss") : $("#gloss");
  return (sheet.wordEl && sheet.wordEl.contains(el)) || card.contains(el);
}
document.addEventListener("pointerout", e => {
  if(!HOVERS(e.pointerType) || !inDwellCard(e.target) || inDwellCard(e.relatedTarget)) return;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    const sheet = dwellSheet();
    if(!sheet) return;
    if(sheet === TK.sheet) closeTalkGloss(); else closeGloss();
  }, 220);
});
document.addEventListener("pointerover", e => {
  if(HOVERS(e.pointerType) && inDwellCard(e.target)) clearTimeout(leaveTimer);
});
/* A press on the card pins it. A press on the word is left to the click that
   follows, which already knows that a tap on a dwelt word means "keep it". */
document.addEventListener("pointerdown", e => {
  const sheet = dwellSheet();
  if(sheet && e.target.closest("#gloss, #tk-gloss")){ sheet.byDwell = false; clearTimeout(leaveTimer); }
}, true);

/* A finger held on a word is a look-up, not a request for the browser's
   selection menu. Only for words, only while the feature is on. */
document.addEventListener("contextmenu", e => {
  if(S.glossDwell && e.target.closest(".rdw[data-i]")) e.preventDefault();
});

/* A dialog's backdrop is the dialog element itself, so a click that lands on
   it and not on the panel inside means "outside" — close the entry, unless
   this press already spent itself closing a word card. */
$("#detail").addEventListener("click", e => {
  if(e.target !== $("#detail")) return;
  if(pressSpent) return;
  closeDetail();
});
/* Whatever the press was for, it is over once its click has run. Cleared here,
   at the end of the bubble, rather than in the backdrop handler — a press on
   the entry itself never reaches that handler and would leave the flag set,
   which would then swallow the next real backdrop click. */
document.addEventListener("click", () => { pressSpent = false; });

$("#help").addEventListener("click", e => { if(e.target === $("#help")) closeDialog($("#help")); });
/* Escape on any of the three content dialogs runs the same out animation as
   a click would, unless something before it has already spent the key —
   defaultPrevented says so. */
["#detail", "#writing", "#help"].forEach(sel => $(sel).addEventListener("cancel", e => {
  if(e.defaultPrevented) return;
  e.preventDefault();
  closeDialog(e.currentTarget);
}));


/* ---------------- browsers ---------------- */
/* The lists' searches paint once the typing pauses (as Talk's does): on a
   phone every key — every step of a pinyin composition — repainting a list
   of hundreds is typing that lags behind the fingers. Clearing the box
   paints at once. */
const typed = (paint, ms = 90) => { let t = 0; return value => { clearTimeout(t); if(!value) paint(); else t = setTimeout(paint, ms); }; };
const paintCharsSoon = typed(() => paintChars()), paintGrammarSoon = typed(() => paintGrammar());
$("#csearch").addEventListener("input", e => { C.query = e.target.value; C.limit = 300; paintCharsSoon(C.query); });
$("#cmore").onclick = () => { C.limit += 300; paintChars(); };
$("#cview").onclick = e => {
  const b = e.target.closest("button[data-cv]");
  if(b && b.dataset.cv !== S.charView) setCharView(b.dataset.cv);
};
$("#creach").onclick = e => {
  const b = e.target.closest("button[data-reach]");
  if(!b || b.dataset.reach === S.treeReach) return;
  S.treeReach = b.dataset.reach; save();
  safely("grow the tree", renderChars);
};
/* Enter in the search, with the tree up, grows the tree from the first match. */
$("#csearch").addEventListener("keydown", e => {
  if(e.key === "Enter" && S.charView === "tree" && C.query.trim()){ e.preventDefault(); treeSearchPick(); }
});
$("#csort").onclick = e => {
  const b = e.target.closest("button[data-s]");
  if(!b) return;
  C.sort = b.dataset.s; C.limit = 300;
  $$("#csort button").forEach(x => x.setAttribute("aria-pressed", x === b));
  paintChars();
};
/* All, or only the characters not started, being learned, or mastered. */
$("#cstatus").onclick = e => {
  const b = e.target.closest("button[data-status]");
  if(!b || b.disabled || b.dataset.status === C.status) return;
  C.status = b.dataset.status; C.limit = 300;
  paintChars();
};
/* A cell of the grid, and the stroke button of the panel beside it. */
$("#v-chars").addEventListener("click", e => {
  const cell = e.target.closest("[data-csel]");
  if(cell){ cPick(cell.dataset.csel); return; }
  if(e.target.closest('[data-cp="strokes"]') && C.writer) C.writer.animate();
});

$("#gsearch").addEventListener("input", e => { G.query = e.target.value; paintGrammarSoon(G.query); });
/* All of a level's points, or one of the standard's sections. */
$("#gsecs").onclick = e => {
  const b = e.target.closest("button[data-gsec]");
  if(!b || b.dataset.gsec === G.sec) return;
  G.sec = b.dataset.gsec;
  paintGrammar();
};
/* A row, a point named in the panel, or the panel's previous and next. */
$("#v-grammar").addEventListener("click", e => {
  const b = e.target.closest("[data-gsel]");
  if(b && !b.disabled) gPick(+b.dataset.gsel);
});
/* Across the width where the point opens beside the list, the list and the
   panel are laid out again. */
if(window.matchMedia){
  const mq = matchMedia("(min-width:1100px)");
  if(mq.addEventListener) mq.addEventListener("change", () => {
    if(S.view === "grammar" && G.all) paintGrammar();
    if(S.view === "chars" && S.charView !== "tree" && C.all) paintChars();
  });
}

/* ---------------- talk ---------------- */
let tkTimer = 0;
$("#tksearch").addEventListener("input", e => {
  clearTimeout(tkTimer);
  TK.query = e.target.value;
  tkTimer = setTimeout(() => safely("search the questions", renderTalk), 140);
});
$("#tk-browse").onclick = () => { TK.browse = !TK.browse; safely("browse the questions", renderTalk); };
$("#tk-level").onclick = () => {
  S.talkLevelOnly = !S.talkLevelOnly; save();
  toast(S.talkLevelOnly ? `Only questions readable at HSK ${levelLabel(S.level)}` : "Every question");
  safely("filter the decks", renderTalk);
};
$("#talk-partner").addEventListener("change", e => safely("set who you are talking to", async () => {
  await setTalkPartner(e.target.value);
  paintTalkPeople(); paintTalkDecks();
}));
$("#tk-mode").onclick = e => {
  const b = e.target.closest("button[data-m]"); if(!b) return;
  S.talkMode = b.dataset.m; save(); paintTalkOptions();
};
$("#tk-goal").onclick = e => {
  const b = e.target.closest("button[data-g]"); if(!b) return;
  S.talkGoal = +b.dataset.g; save(); paintTalkOptions();
};
/* The three switches. Wired here rather than through bindToggle below, which
   is a const this block would reach before it exists. */
[["#sw-tk-ruby", "talkRuby"], ["#sw-tk-tint", "talkTint"], ["#sw-tk-study", "talkStudy"]]
  .forEach(([sel, key]) => { $(sel).onclick = () => {
    S[key] = !S[key]; save();
    $(sel).setAttribute("aria-pressed", String(S[key]));
    if(key === "talkRuby" || key === "talkTint") paintTalkQotd();
  }; });
$("#talk-topics").onclick = e => {
  const b = e.target.closest("[data-talktopic]"); if(!b) return;
  const i = +b.dataset.talktopic;
  S.talkMuted = S.talkMuted.includes(i) ? S.talkMuted.filter(x => x !== i) : [...S.talkMuted, i];
  save(); paintTalkTopics(); paintTalkDecks();
};
$("#tk-practice-saved").onclick = () => talkPractise(S.talkSaved.map(id => TK.byId.get(id)).filter(Boolean), "Saved questions");
$("#tk-copy-saved").onclick = () => safely("copy the saved questions", async () => {
  const rows = S.talkSaved.map(id => TK.byId.get(id)).filter(Boolean);
  const ok = await copyText(rows.map(q => `${q[Q.ZH]}\n${q[Q.EN]}`).join("\n\n"));
  toast(ok ? `Copied ${rows.length} question${rows.length === 1 ? "" : "s"}` : "Could not copy");
});
$("#tk-clear-saved").onclick = () => {
  if(!S.talkSaved.length || !confirm("Clear every saved question?")) return;
  S.talkSaved = []; save(); paintTalkSaved(); toast("Saved list cleared");
};
/* Browsing. */
$("#talk-browse").addEventListener("click", e => {
  const b = e.target.closest(".fchip"); if(!b) return;
  const flip = (set, v) => { if(set.has(v)) set.delete(v); else set.add(v); };
  if(b.dataset.tks) flip(TK.fSens, +b.dataset.tks);
  else if(b.dataset.tkt) flip(TK.fStage, +b.dataset.tkt);
  else if(b.dataset.tkq !== undefined) TK.fFreq = +b.dataset.tkq;
  else if(b.dataset.tkl) TK.fLevel = !TK.fLevel;
  else if(b.dataset.tko) TK.fSort = b.dataset.tko;
  else return;
  paintTalkFilters(); safely("search the questions", talkSearch);
});
$("#tk-clearf").onclick = () => {
  TK.fSens.clear(); TK.fStage.clear(); TK.fFreq = 0; TK.fLevel = false; TK.fSort = "freq";
  TK.query = ""; $("#tksearch").value = "";
  paintTalkFilters(); safely("search the questions", talkSearch);
};
$("#tk-more").onclick = () => { TK.shown = Math.min(TK.results.length, TK.shown + TK_PAGE); paintTalkHits(); };
$("#tk-practice").onclick = () => talkPractise(TK.results, TK.query.trim() ? `“${TK.query.trim()}”` : "Your selection");
$("#tk-random").onclick = () => { const q = TK.results[Math.floor(Math.random() * TK.results.length)]; if(q) talkOpenQuestion(q[Q.ID]); };
/* Everything on the decks screen that opens, resumes or starts a run. */
$("#v-talk").addEventListener("click", e => {
  const deck = e.target.closest("[data-talkdeck]");
  if(deck){ talkStart(+deck.dataset.talkdeck); return; }
  const open = e.target.closest("[data-talkopen]");
  if(open){ talkOpenQuestion(+open.dataset.talkopen); return; }
  const person = e.target.closest("[data-talkperson]");
  if(person){
    safely("switch person", async () => {
      await setTalkPartner(person.dataset.talkperson === S.talkPartner ? "" : person.dataset.talkperson);
      paintTalkPeople(); paintTalkDecks();
      toast(S.talkPartner ? `Talking to ${S.talkPartner}` : "Talking to nobody in particular");
    });
    return;
  }
  if(e.target.closest("[data-talkresume]")){ safely("pick the conversation up", resumeTalkRun); return; }
  if(e.target.closest("[data-talkdrop]")){ safely("close the conversation", async () => { await bankTalkSnapshot(S.talkRun); await renderTalk(); }); return; }
  const again = e.target.closest("[data-talkagain]");
  if(again){ talkStart(+again.dataset.talkagain); return; }
  if(e.target.closest("[data-talkhome]")){ safely("open the decks", renderTalk); return; }
  /* In a run: a word opens its writing card; the deck button on a word row
     puts it in or out of the review deck. */
  const word = e.target.closest("[data-talkword]");
  if(word){
    const [line, i] = word.dataset.talkword.split(":");
    const tok = (TK.lines[line] || [])[+i];
    closeTalkGloss();
    if(tok && tok.t !== "x") safely("open that word", () => openWriting(tok.w, {nav: true, tok}));
    return;
  }
  const dk = e.target.closest("[data-tkdeck]");
  if(dk){
    const [id, lv] = dk.dataset.tkdeck.split(":");
    safely("update your deck", () => talkToggleDeckWord(id, lv));
    return;
  }
  const tk = e.target.closest("[data-talkline] .rdw[data-i]");
  if(tk){
    const line = tk.closest("[data-talkline]");
    const tok = (TK.lines[line.dataset.talkline] || [])[+tk.dataset.i];
    closeTalkGloss();
    if(tok && tok.t !== "x") safely("open that word", () => openWriting(tok.w, {nav: true, tok}));
  }
});
/* The run's controls. */
$("#tk-warm").onclick = () => talkMove(1);
$("#tk-cool").onclick = () => talkMove(-1);
$("#tk-skip").onclick = () => talkNext(3);
$("#tk-next").onclick = () => talkNext(0);
$("#tk-back").onclick = talkBack;
$("#tk-end").onclick = () => safely("end the conversation", () => talkFinish(true));
$("#tk-reveal").onclick = talkReveal;
$("#tk-save").onclick = talkToggleSaved;
$("#tk-copy").onclick = () => safely("copy the question", talkCopy);
$("#tk-study-toggle").onclick = () => {
  const open = $("#tk-study-body").classList.toggle("hidden");
  $("#tk-study-toggle").setAttribute("aria-expanded", String(!open));
  paintTalkStudy();
};
$("#tk-study-tabs").onclick = e => {
  const b = e.target.closest("button[data-s]"); if(!b) return;
  TK.studyTab = b.dataset.s; paintTalkStudy();
};
bindTalkSwipe();
/* The consent gate closes through its two buttons; Escape reads as "stay lighter". */
$("#talk-gate").addEventListener("click", e => {
  const b = e.target.closest("[data-gate]");
  if(b) answerTalkGate(b.dataset.gate);
  else if(e.target === $("#talk-gate")) answerTalkGate("no");
});
$("#talk-gate").addEventListener("cancel", e => { e.preventDefault(); answerTalkGate("no"); });

/* ---------------- reading ---------------- */
$("#bookfile").onchange = e => {
  const f = e.target.files[0];
  e.target.value = "";
  if(!f) return;
  /* Parsing is where a malformed book shows up, and the message it throws is
     written for a reader rather than for a console — so it is shown as is. */
  Promise.resolve()
    .then(() => importBook(f))
    .catch(err => { console.error(err); toast(String(err.message || "That file could not be read")); });
};
$("#b-paste-cancel").onclick = () => $("#paste-panel").classList.add("hidden");
$("#b-paste-go").onclick = () => {
  const text = $("#paste-text").value;
  if(!text.trim()){ toast("Nothing to add"); return; }
  Promise.resolve()
    .then(() => importPasted(text, $("#paste-title").value.trim()))
    .then(() => { $("#paste-text").value = ""; $("#paste-title").value = ""; $("#paste-panel").classList.add("hidden"); })
    .catch(err => toast(String(err.message || "That could not be added")));
};

$("#read-library").addEventListener("click", e => {
  const open = e.target.closest("[data-book]");
  if(open){
    /* the cover to lift: the book's own on the shelf, the large one for "Now reading" */
    const cover = (open.closest(".bk") || open.closest("#read-now")) ?.querySelector(".bk-cover");
    safely("open that text", () => openBookFrom(open.dataset.book, cover));
    return;
  }
  const drop = e.target.closest("[data-unshelf]");
  if(drop) safely("remove that text", () => unshelve(drop.dataset.unshelf));
});

$("#rd-back").onclick = () => safely("close the book", closeBookGently);
$("#rd-prev").onclick = () => safely("turn back", () => turnPage(-1));
$("#rd-next").onclick = () => safely("turn the page", () => turnPage(1));
bindPageSwipe();
bindSelection();
bindScrub();
$("#rd-turn").onclick = e => {
  const b = e.target.closest("button[data-turn]");
  if(!b) return;
  S.readTurnStyle = b.dataset.turn;
  if(S.readTurn !== "none") S.readTurn = b.dataset.turn;
  save(); paintReaderControls();
};
$("#sw-turn").onclick = () => {
  S.readTurn = S.readTurn === "none" ? (S.readTurnStyle || "curl") : "none";
  if(S.readTurn !== "none") S.readTurnStyle = S.readTurn;
  save(); paintReaderControls();
};
/* Where passages are translated, and the device's translators: a press on
   one picks it; its button downloads, removes, or tries again. */
$("#rd-trsvc").onclick = e => {
  const b = e.target.closest("button[data-svc]");
  if(!b) return;
  S.readTranslator = b.dataset.svc; save();
  paintReaderControls();
};
$("#rd-mt-list").addEventListener("click", e => safely("set up offline translation", () => mtListClick(e)));
/* The reading settings: a menu dropped from its button over the page. It
   closes from the button again, from Escape, or from a press anywhere outside
   it, so a reader who has set the type can go straight back to the page
   without first finding the button that opened it. It sits over the page
   rather than above it, so opening it does not re-cut the pages. */
function setReaderPanel(shown){
  const panel = $("#rd-panel");
  if(shown === undefined) shown = panel.classList.contains("hidden");
  if(shown === !panel.classList.contains("hidden")) return;
  if(shown) fitReaderPanel();
  panel.classList.toggle("hidden", !shown);
  $("#rd-tools").setAttribute("aria-expanded", String(shown));
  $("#rd-tools").classList.toggle("on", shown);
}
/* as tall as the window leaves below the bar, then it scrolls */
function fitReaderPanel(){
  const bar = $("#read-book .rdbar");
  if(bar) $("#rd-panel").style.setProperty("--rd-panel-max",
    `${Math.max(200, Math.floor(window.innerHeight - bar.getBoundingClientRect().bottom - 14))}px`);
}
$("#rd-tools").onclick = () => setReaderPanel();
/* A web font arriving changes how wide the bar's names and key are. */
if(document.fonts && document.fonts.addEventListener)
  document.fonts.addEventListener("loadingdone", () => { if(R.book) fitReadBar(); });
document.addEventListener("pointerdown", e => {
  if($("#rd-panel").classList.contains("hidden")) return;
  if(e.target.closest("#rd-panel, #rd-tools")) return;
  setReaderPanel(false);
  /* A press on the page only puts the menu away: it does not also start a
     turn, hold a word, or (as the click that follows) open a word's card. */
  if(e.target.closest("#rd-prose")){
    e.stopPropagation();
    const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener("click", eat, {capture: true, once: true});
    setTimeout(() => document.removeEventListener("click", eat, true), 700);
  }
}, true);
$("#rd-tint-btn").onclick = () => {
  S.readTint = S.readTint === "off" ? "level" : "off"; save();
  paintReaderControls();
  repaintAnnotations();
};
$("#sw-ruby").onclick = () => toggleRuby(!S.readRuby);
$("#rd-ruby-btn").onclick = () => toggleRuby(!S.readRuby);
$("#sw-dim").onclick = () => {
  S.readDim = !S.readDim; save();
  paintReaderControls(); repaintAnnotations();
};
let sizeTimer = 0;
$("#r-rdsize").addEventListener("input", e => {
  S.readSize = +e.target.value; save();
  $("#lbl-rdsize").textContent = `${S.readSize}px`;
  $("#rd-prose").style.setProperty("--rd-size", `${S.readSize}px`);
  /* The pages are cut again once the slider rests. */
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => { if(R.book) paginate(); }, 120);
});
$("#rd-contents").onclick = () => showContents();
$("#rd-find-btn").onclick = () => {
  const panel = $("#rd-find");
  const shown = !panel.classList.toggle("hidden");
  $("#rd-find-btn").setAttribute("aria-expanded", String(shown));
  $("#rd-find-btn").classList.toggle("on", shown);
  sizeReader();
  if(shown) $("#rd-q").focus();
};
let findTimer = 0;
$("#rd-q").addEventListener("input", e => {
  clearTimeout(findTimer);
  const q = e.target.value;
  findTimer = setTimeout(() => safely("search this book", () => { findInBook(q); sizeReader(); }), 160);
});
$("#rd-hits").addEventListener("click", e => {
  const b = e.target.closest("[data-goto]");
  if(!b) return;
  const [c, blk] = b.dataset.goto.split(":").map(Number);
  safely("go to that sentence", () => gotoBlock(c, blk));
});
$("#rd-analyse").onclick = () => safely("read through the text", openAnalysis);
$("#rd-mark").onclick = e => {
  const b = e.target.closest("button[data-mark]");
  if(!b) return;
  S.readMark = b.dataset.mark; save();
  paintReaderControls();
  repaintAnnotations();
};

/* A tap anywhere in the prose is a tap on a word — the buttons are inside the
   paragraph, so this is one listener for a chapter rather than thousands. A
   tap opens the writing card; the gloss is what resting on the word gives. */
$("#rd-prose").addEventListener("click", e => {
  const tk = e.target.closest(".rdw[data-i]");
  if(!tk) return;
  const blk = tk.closest(".blk[data-b]");
  const tokens = blk && R.tokens[+blk.dataset.b];
  const tok = tokens && tokens[+tk.dataset.i];
  closeGloss();
  if(tok && tok.t !== "x") safely("open that word", () => openWriting(tok.w, {nav: true, tok}));
});

/* The writing card's own ways out: its Close button, its backdrop, and any
   link that leaves it for a full entry — which opens in the detail sheet
   beneath, so this one steps aside first. */
$("#writing").addEventListener("click", e => {
  if(e.target === $("#writing") || e.target.closest("[data-wrclose]") || e.target.closest("[data-open]"))
    closeWriting();
});
$("#rd-spread-btn").onclick = () => toggleSpread();
$("#rd-focus").onclick = () => setReadFocus(!S.readFocus);
/* A rotated phone, a resized window, or a panel opening above the prose all
   change what is left for it. */
let resizeTimer = 0, resizeW = window.innerWidth;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    /* sizeReader cuts the pages again itself when the page's height has
       changed (a keyboard opening, a rotation); only a new width needs them
       cut here as well. Cutting them regardless laid the whole section out
       twice for every keyboard that opened. */
    const w = window.innerWidth, wider = w !== resizeW;
    resizeW = w;
    /* a riffle's flat book is the page's old size */
    if(wider && typeof riffleDrop === "function") riffleDrop();
    if(R.book){ sizeReader(); if(wider) paginate(); }
    if(!$("#rd-panel").classList.contains("hidden")) fitReaderPanel();
    sizeLists();
    if(typeof placeTalkStudy === "function") placeTalkStudy();
    /* The fold control's words depend on which layout is showing. */
    setRail(S.railMin);
  }, 140);
});

$("#gloss").addEventListener("click", e => {
  if(e.target.closest("[data-interlinear]")){
    const host = $("#gloss .gl-interlinear");
    if(!host || !R.sheet) return;
    if(!host.dataset.done){
      const tokens = R.tokens[R.sheet.blockIndex];
      host.innerHTML = interlinearHTML(sentenceAround(tokens, R.sheet.tokenIndex).slice);
      host.dataset.done = "1";
    }
    host.classList.toggle("hidden");
    return;
  }
  // A tap on a character opens the shared detail dialog, which the delegated
  // [data-open] handler above already knows how to do.
});

/* The contents list reuses the detail dialog: it is a glance-and-dismiss list,
   which is exactly what that dialog is for. */
function showContents(){
  openDetail(`<h2>Contents</h2>
    <p class="pmeta">${esc(R.meta.title)}${R.meta.author ? " · " + esc(R.meta.author) : ""}</p>
    <div class="rows toc">${R.book.chapters.map((ch, i) => `
      <button class="erow wide ${i === R.chapter ? "on" : ""}" data-goch="${i}">
        <span class="ep">${esc(ch.title)}</span>
        <span class="ee">${num(ch.blocks.length)} paragraph${ch.blocks.length === 1 ? "" : "s"}</span>
        <span class="ex">${i === R.chapter ? `<span class="lv b2">here</span>` : ""}</span>
      </button>`).join("")}</div>`);
  $("#detail-body").addEventListener("click", e => {
    const b = e.target.closest("[data-goch]");
    if(!b) return;
    closeDetail();
    safely("open that section", () => moveChapter(+b.dataset.goch - R.chapter));
  }, {once: true});
}

/* ---------------- settings ---------------- */
const bindRange = (sel, key, label, fmt = v => v) => {
  $(sel).addEventListener("input", e => {
    S[key] = +e.target.value;
    $(label).textContent = fmt(S[key]);
    save();
  });
};
bindRange("#r-dwell", "glossDwellMs", "#lbl-dwell", v => `${(v / 1000).toFixed(1)} s`);

const bindToggle = (sel, key, after) => {
  $(sel).onclick = () => {
    S[key] = !S[key];
    $(sel).setAttribute("aria-pressed", S[key]);
    save();
    if(after) after();
  };
};
bindToggle("#sw-tones", "tones", () => show(S.view));
bindToggle("#sw-scrub", "readScrub", () => { paintReaderControls(); toast(S.readScrub ? "Page track shown" : "Page track hidden"); });
bindToggle("#sw-dwell", "glossDwell", () =>
  $("#dwell-row").classList.toggle("dim", !S.glossDwell));

$("#sw-auto").onclick = () => {
  S.autoTheme = !S.autoTheme;
  $("#sw-auto").setAttribute("aria-pressed", S.autoTheme);
  if(S.autoTheme){
    const sk = skinOf(S.skin);
    if(sk.dark) S.skinDark = sk.id; else S.skinLight = sk.id;
    syncSystemSkin();
    toast(`Following the system · ${skinOf(S.skinDark).nm} / ${skinOf(S.skinLight).nm}`);
  }else{
    paintSkin(S.skin);
  }
  save();
};
$("#texes").onclick = e => {
  const b = e.target.closest(".tex[data-k]");
  if(!b) return;
  S.bgTex = b.dataset.k; save(); applyTexture();
};
$("#r-tex").oninput = e => { S.bgTexOp = +e.target.value; save(); applyTexture(); };

$("#skins").addEventListener("click", e => {
  const b = e.target.closest(".skin");
  if(b) applySkin(b.dataset.k);
});
$("#script").onclick = e => {
  const b = e.target.closest("button[data-s]");
  if(!b) return;
  S.script = b.dataset.s; save();
  $$("#script button").forEach(x => x.setAttribute("aria-pressed", x === b));
  toast(`Showing ${S.script}`);
};
$("#motion").onclick = e => {
  const b = e.target.closest("button[data-m]");
  if(!b) return;
  S.motion = b.dataset.m; save(); applyMotion();
  $$("#motion button").forEach(x => x.setAttribute("aria-pressed", x === b));
  toast(S.motion === "on" ? "Animations on" : S.motion === "off" ? "Animations off"
    : REDUCED() ? "Following the device — it asks for no animations" : "Following the device");
};
$("#r-text").addEventListener("input", e => applyTextScale(+e.target.value));
$("#font-zh").onclick = e => {
  const b = e.target.closest(".fontcard[data-font]");
  if(!b) return;
  S.fontZh = b.dataset.font; save(); applyFonts();
  toast(`Chinese in ${fontById("zh", S.fontZh).name}`);
};
$("#font-en").onclick = e => {
  const b = e.target.closest(".fontcard[data-font]");
  if(!b) return;
  S.fontEn = b.dataset.font; save(); applyFonts();
  toast(`English in ${fontById("en", S.fontEn).name}`);
};

$("#b-export").onclick = doExport;
$("#b-import").onclick = () => $("#importfile").click();
$("#importfile").onchange = e => {
  const f = e.target.files[0];
  if(f) doImport(f);
  e.target.value = "";
};
$("#b-reset").onclick = async () => {
  if(!confirm("Delete every card, review and result? Your settings and theme are kept.")) return;
  await resetProgress();
  toast("Progress cleared");
  await renderRail();
  show(S.view);
};

/* ---------------- who is using this ---------------- */

/* The first run, and adding a profile later, are the same two questions asked
   in the same box — a name to be called by and a level to start from. Both are
   skippable: somebody who wants to start reviewing in four seconds should not
   have to fill in a form to do it, and everything here can be changed in
   Settings afterwards. */
function showWelcome(opts){
  const adding = !!(opts && opts.adding);
  $("#welcome-body").innerHTML = `
    <h2>${adding ? "Add a profile" : "Welcome to HANZAI-ORIGINS"}</h2>
    <p class="pmeta">${adding
      ? `A profile is a separate record on this device — its own deck, shelf, settings
         and theme. Nothing is shared with the others.`
      : `The whole HSK 3.0 standard, on this device. There is no account and nothing is
         uploaded; a profile is just how this copy of the app knows whose deck it is
         holding. You can skip this and set it later.`}</p>

    <label class="pf-field"><span class="lbl">What should it call you?</span>
      <input class="search" id="wl-name" maxlength="40" autocomplete="off"
        placeholder="A name, a nickname, anything"></label>

    <span class="lbl" style="display:block;margin:13px 0 6px">Starting level</span>
    <div class="filters" id="wl-levels">${LEVELS.map(lv =>
      `<button class="fchip" data-lv="${lv}" aria-pressed="${lv === "1"}">HSK ${levelLabel(lv)}</button>`).join("")}</div>
    <p class="pmeta" style="margin-top:9px">New cards are drawn from here. Everything you
      start stays in review whatever you pick, and you can move it whenever you like.</p>

    <div class="acts">
      <button class="go" id="wl-go">${adding ? "Create it" : "Start"}</button>
      ${adding ? `<button class="no" data-close-welcome>Cancel</button>`
               : `<button class="no" data-close-welcome>Skip</button>`}
    </div>`;

  let level = "1";
  $("#wl-levels").onclick = e => {
    const b = e.target.closest("button[data-lv]");
    if(!b) return;
    level = b.dataset.lv;
    $$("#wl-levels button").forEach(x => x.setAttribute("aria-pressed", x === b));
  };
  $("#wl-go").onclick = () => {
    const name = $("#wl-name").value.trim() || "You";
    if(adding){
      const p = newProfile(name);
      saveProfiles();
      /* The new profile's level is written into its own settings blob, which
         belongs to a database this page has not opened — so it is stored under
         that profile's key directly and picked up when the reload lands. */
      try{ localStorage.setItem(p.id === "1" ? "hskker.v1" : `hskker.v1.${p.id}`,
             JSON.stringify({level})); }catch(e){}
      switchProfile(p.id);
      return;
    }
    newProfile(name);
    ACTIVE = PROFILES[0].id;
    saveProfiles();
    S.level = level;
    save();
    $("#welcome").close();
    safely("set up your profile", async () => { await renderRail(); show("home"); });
  };
  $("#welcome-body").addEventListener("click", e => {
    if(!e.target.closest("[data-close-welcome]")) return;
    if(!adding && !PROFILES.length){ newProfile("You"); ACTIVE = PROFILES[0].id; saveProfiles(); }
    $("#welcome").close();
    safely("open your profile", renderRail);
  });
  $("#welcome").showModal();
  $("#wl-name").focus();
}

/* The lock screen. Modal and undismissable while it is up — there is no
   "cancel" that could reveal the profile behind it. */
function showLock(){
  const me = activeProfile();
  $("#lock-body").innerHTML = `
    <div class="pf-head">
      <span class="pf-face" style="background:${esc(me.hue)}">${esc(initialOf(me.name))}</span>
      <div class="pf-id"><b>${esc(me.name)}</b><small>This profile is locked</small></div>
    </div>
    <label class="pf-field" style="margin-top:13px"><span class="lbl">Passcode</span>
      <input class="search" id="lk-pass" type="password" autocomplete="current-password"></label>
    <p class="pmeta" id="lk-msg" style="margin-top:9px"></p>
    <div class="acts">
      <button class="go" id="lk-go">Unlock</button>
      ${PROFILES.length > 1 ? `<button class="no" id="lk-other">Use another profile</button>` : ""}
    </div>`;
  document.body.classList.add("locked");
  $("#lock").showModal();
  $("#lk-pass").focus();

  const attempt = async () => {
    const ok = await checkPasscode(me.id, $("#lk-pass").value);
    if(!ok){
      $("#lk-msg").textContent = "That is not the passcode.";
      $("#lk-pass").value = "";
      $("#lk-pass").focus();
      return;
    }
    $("#lock").close();
    document.body.classList.remove("locked");
    unlocked = true;
    touchProfile();
    safely("open your profile", renderRail);
  };
  $("#lk-go").onclick = attempt;
  $("#lk-pass").addEventListener("keydown", e => { if(e.key === "Enter") attempt(); });
  const other = $("#lk-other");
  if(other) other.onclick = () => {
    const next = PROFILES.find(p => p.id !== me.id && !p.lock) || PROFILES.find(p => p.id !== me.id);
    if(next) switchProfile(next.id);
  };
  /* Esc closes a <dialog> by default, which would hand over the app. */
  $("#lock").addEventListener("cancel", e => e.preventDefault());
}

$("#rc-who").onclick = showProfiles;

/* ---------------- keyboard ---------------- */
const HELP = [
  ["Anywhere", [["1 – 6", "Jump to a section"], ["/", "Search this section"], ["[", "Fold or unfold the sidebar"], ["?", "This list"], ["Esc", "Close a dialog, or clear a search"]]],
  ["The character grid", [["← → ↑ ↓", "Move across the grid, beside the character open"], ["Enter", "Open its full entry"]]],
  ["The character tree", [["← → ↑ ↓", "Walk the tree: along a branch, back to the root, between siblings"], ["Enter", "Open the entry of the tile picked"], ["Space", "Open or fold its branch"], ["G", "Grow a tree from the tile picked"], ["Backspace", "Back to the root before"], ["+ −", "Zoom in and out"], ["0", "Fit the whole tree"], ["F", "Fill the window with the tree, and back"], ["Esc", "Put the tile down"]]],
  ["Talking",   [["→", "Deeper — one level down"], ["←", "Lighter — back off a level"], ["Space", "Another question like this one"], ["X", "Skip this one"], ["S", "Save it for later"], ["C", "Copy it — the Chinese, then the English"], ["R", "Reveal the other language"], ["B", "Back to the previous card"]]],
  ["Grammar",   [["↑ ↓", "The point before and after, beside the list"]]],
  ["Reading",   [["← →", "Previous and next page"], ["F", "Full screen, and back"], ["Esc", "Close the gloss, clear a selected passage, or leave full screen"]]],
];

function showHelp(){
  $("#help-body").innerHTML = `<h2>Shortcuts</h2><div class="keys">` +
    HELP.map(([sec, rows]) => `<div class="keysec">${esc(sec)}</div>` +
      rows.map(([k, d]) => `<div class="keyrow"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join("")
    ).join("") +
    `</div><div class="acts"><button class="go" onclick="closeDialog(document.getElementById('help'))">Close</button></div>`;
  $("#help").showModal();
}
$("#b-help").onclick = showHelp;

/* The sidebar folds to its icons — a wide table or a page of text gets the
   236px back — and stays folded across sessions. The class does all the work
   in CSS; what has to follow it in script is the lists and the reader, which
   are measured against a width that just changed. */
/* Runs fn once the rail has finished moving: on the end of the column
   transition, or on a timer a little longer than it if that never comes
   (a hidden tab, reduced motion, a layout with no rail). */
function afterRailMove(fn){
  const wrap = document.querySelector(".wrap");
  let done = false;
  const fire = () => { if(done) return; done = true; wrap.removeEventListener("transitionend", onEnd); fn(); };
  const onEnd = e => { if(e.target === wrap && e.propertyName === "grid-template-columns") fire(); };
  wrap.addEventListener("transitionend", onEnd);
  setTimeout(fire, 420);
}

/* The main column changes width the whole time the rail is moving, and the
   card grids on Home lay themselves out by auto-fill — so mid-move a row can
   re-count its columns and every card jumps to a new place, which is the one
   thing in the fold that reads as jitter. Before the move, the layout the
   rail will land on is measured (applied for an instant with the transition
   off, then taken back before anything is painted), and each grid is held at
   that column count for the duration: the cards then only change width,
   smoothly, and nothing changes rows. Returns the release. */
function holdGrids(min){
  if(innerWidth < 900) return () => {};
  const grids = $$("#main .board, #main .launch, #main .pickup").filter(g => g.offsetParent);
  if(!grids.length) return () => {};
  const wrap = $(".wrap"), was = document.body.classList.contains("railmin");
  wrap.classList.add("railsnap");
  document.body.classList.toggle("railmin", min);
  /* The resolved track list; auto-fit's collapsed tracks are listed at 0px
     and are not columns. */
  const counts = grids.map(g => getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/)
    .filter(t => parseFloat(t) > 0).length || 1);
  document.body.classList.toggle("railmin", was);
  void wrap.offsetWidth;
  wrap.classList.remove("railsnap");
  grids.forEach((g, i) => { g.style.gridTemplateColumns = `repeat(${counts[i]}, minmax(0,1fr))`; });
  return () => grids.forEach(g => { g.style.gridTemplateColumns = ""; });
}

function setRail(min){
  const changed = S.railMin !== !!min;
  S.railMin = !!min; save();
  /* An open book is re-cut for the new width, and the cut would show as a
     jolt mid-slide; so the page dims while the rail moves and comes back,
     already re-paginated, once it has stopped. */
  const book = changed && R.book && S.view === "read" && innerWidth >= 900;
  if(book) $("#rd-body").classList.add("refit");
  const release = changed ? holdGrids(S.railMin) : () => {};
  document.body.classList.toggle("railmin", S.railMin);
  const b = $("#b-rail");
  b.setAttribute("aria-pressed", String(S.railMin));
  const narrow = innerWidth < 900;
  const what = narrow ? (S.railMin ? "Show the header and tab names" : "Fold the menu up")
                      : (S.railMin ? "Expand the sidebar" : "Collapse the sidebar");
  b.setAttribute("aria-label", what);
  b.title = what + " ([)";
  b.querySelector("span").textContent = S.railMin ? "Expand" : "Collapse";
  /* Folded, the tabs are glyphs alone, so each carries its name as a tooltip;
     unfolded the word is right there and a tooltip would only repeat it. */
  $$("#nav button[data-v]").forEach(t => { if(S.railMin) t.title = t.textContent.trim(); else t.removeAttribute("title"); });
  const you = $("#rc-who");
  if(you) you.title = S.railMin ? `${$("#rc-name").textContent} · switch profile` : "Switch profile";
  afterRailMove(() => {
    release();
    sizeLists();
    if(typeof placeTalkStudy === "function") placeTalkStudy();
    if(R.book){ sizeReader(); paginate(); }
    /* A beat, not a frame: frames stop in a hidden tab and the page must
       still come back. */
    setTimeout(() => $("#rd-body").classList.remove("refit"), book ? 40 : 0);
  });
}
$("#b-rail").onclick = () => setRail(!S.railMin);
setRail(S.railMin);

document.addEventListener("keydown", e => {
  /* A card that is a div with role=button — the word of the day — answers
     Enter and space the way a button would. */
  if((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('[role="button"][data-open]')){
    e.preventDefault(); e.target.click(); return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  /* Escape in a search box: an empty box gives the keyboard back; one with a
     query in it clears the query first, and the list follows. */
  if(e.key === "Escape" && e.target.matches && e.target.matches('input[type="search"]')){
    if(e.target.value){ e.target.value = ""; e.target.dispatchEvent(new Event("input", {bubbles: true})); }
    else e.target.blur();
    return;
  }
  /* Escape with the reading settings open puts them away, even from the
     text-size slider, which is an input and would otherwise keep the key. */
  if(e.key === "Escape" && !$("#rd-panel").classList.contains("hidden") && !$("#detail").open){
    setReaderPanel(false); return;
  }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;

  if(e.key === "?"){ e.preventDefault(); showHelp(); return; }
  if(e.key === "[" && !$("#detail").open){ e.preventDefault(); setRail(!S.railMin); return; }
  /* Slash to search: whichever search box the view on screen has. */
  if(e.key === "/"){
    const box = $(`#v-${S.view} input[type="search"]`);
    if(box && box.offsetParent){ e.preventDefault(); box.focus(); box.select(); }
    return;
  }
  /* Escape with a word sheet up puts the sheet away and nothing else. Caught
     here, at keydown, as well as on the dialog's cancel event: cancel is at
     the browser's discretion — it can skip it when it judges there was no
     recent activation — and this is not. Prevented so the dialog does not
     also act on the same key. */
  if(e.key === "Escape" && (R.sheet || TK.sheet)){
    e.preventDefault(); if(R.sheet) closeGloss(); if(TK.sheet) closeTalkGloss(); return;
  }
  /* And a selected passage the same way: the marks and the card go, nothing else. */
  if(e.key === "Escape" && selectionActive()){ e.preventDefault(); clearSelection(); return; }
  if($("#detail").open || $("#help").open || $("#writing").open || $("#talk-gate").open) return;

  /* A conversation: the arrows change level, space deals the next card, and
     one letter each for the things on the card's foot. */
  if(TK.run && S.view === "talk" && TK.run.cur){
    const k = e.key.toLowerCase();
    if(e.key === "ArrowRight"){ e.preventDefault(); talkMove(1); }
    else if(e.key === "ArrowLeft"){ e.preventDefault(); talkMove(-1); }
    else if(e.key === " " || e.key === "Enter"){ if(e.target.closest("button")) return; e.preventDefault(); talkNext(0); }
    else if(k === "x"){ e.preventDefault(); talkNext(3); }
    else if(k === "s"){ e.preventDefault(); talkToggleSaved(); }
    else if(k === "c"){ e.preventDefault(); safely("copy the question", talkCopy); }
    else if(k === "r"){ e.preventDefault(); talkReveal(); }
    else if(k === "b"){ e.preventDefault(); talkBack(); }
    else return;
    return;
  }

  if(S.view === "read" && R.book){
    if(e.key === "f" || e.key === "F"){ e.preventDefault(); setReadFocus(!S.readFocus); return; }
    if(e.key === "Escape" && document.body.classList.contains("immersive")){ e.preventDefault(); setReadFocus(false); return; }
    if(e.key === "ArrowLeft" || e.key === "PageUp"){ e.preventDefault(); safely("turn back", () => turnPage(-1)); return; }
    if(e.key === "ArrowRight" || e.key === "PageDown" || e.key === " "){ e.preventDefault(); safely("turn the page", () => turnPage(1)); return; }
  }

  /* The grammar list beside its open point: the arrows step through it. */
  if(S.view === "grammar" && gWide() && (e.key === "ArrowDown" || e.key === "ArrowUp") && G.all && !$("#detail").open){
    e.preventDefault(); gStep(e.key === "ArrowDown" ? 1 : -1); return;
  }
  /* The grid beside its open character: the arrows move across it, Enter
     opens the entry. */
  if(S.view === "chars" && S.charView !== "tree" && cWide() && C.sel && !$("#detail").open){
    if(/^Arrow(Up|Down|Left|Right)$/.test(e.key)){ e.preventDefault(); cMove(e.key); return; }
    if(e.key === "Enter" && !e.target.closest("button, a")){ e.preventDefault(); safely("open that entry", () => openChar(C.sel)); return; }
  }
  /* The character tree: the arrows walk it, + − and 0 zoom (tree.js). */
  if(treeKey(e)) return;
  const n = +e.key;
  if(n >= 1 && n <= VIEWS.length){ e.preventDefault(); show(VIEWS[n - 1]); }
});

/* ---------------- start ---------------- */
if(window.matchMedia){
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncSystemSkin);
}
/* Set once the profile is open, so nothing paints somebody's deck behind a
   lock screen. */
let unlocked = false;

paintSkin(S.autoTheme ? (prefersDark() ? S.skinDark : S.skinLight) : S.skin);
applyTexture();
applyTextScale();
applyFonts();
$("#r-rdsize").value = S.readSize;
setupFolds();

/* An install from before profiles gets a record for the deck it already has;
   a genuinely new one is asked who it belongs to. */
ensureProfile();
if(!PROFILES.length){
  showWelcome({});
}else if(isLocked()){
  showLock();
}else{
  unlocked = true;
  touchProfile();
}
safely("load your record", renderRail);
/* index.html#talk — a launcher shortcut from the manifest — opens that tab.
   Read once and never written: the app pushes no history, so the Android
   back button keeps meaning "leave" rather than "undo a tab". */
const hashView = (location.hash || "").slice(1);
show(VIEWS.includes(hashView) ? hashView : S.view);
booted = true;

/* The service worker is for the web build. Inside the Android shell every
   file is already on the device, so a worker there only copies 40 MB of
   assets into cache storage a second time and re-fetches the code on every
   launch for nothing; and an install that once had one is cleaned up. */
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  if(window.Capacitor){
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  }else{
    addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    // A page found running the previous build is reloaded by the new worker
    // itself once it has taken over — see the activate handler in sw.js.
  }
}
