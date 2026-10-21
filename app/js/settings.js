/* settings.js — the controls, and the About block. */

function renderSettings(){
  $("#sw-tones").setAttribute("aria-pressed", S.tones);
  $("#sw-dwell").setAttribute("aria-pressed", S.glossDwell !== false);
  $("#r-dwell").value = S.glossDwellMs || 2000;
  $("#lbl-dwell").textContent = `${((S.glossDwellMs || 2000) / 1000).toFixed(1)} s`;
  $("#dwell-row").classList.toggle("dim", S.glossDwell === false);
  $("#sw-auto").setAttribute("aria-pressed", S.autoTheme);
  $$("#script button").forEach(b => b.setAttribute("aria-pressed", b.dataset.s === S.script));
  const motion = ["off", "system"].includes(S.motion) ? S.motion : "on";
  $$("#motion button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === motion));
  applyTextScale();
  renderFonts();
  renderSkins();
  renderTextures();
  paintSkin(S.skin);
  renderProfile();
  renderAbout();
}


async function renderAbout(){
  const [meta, talk] = await Promise.all([getMeta(),
    typeof talkMeta === "function" ? talkMeta() : null]);
  const row = (k, v) => `<div><span>${esc(k)}</span><b>${v}</b></div>`;
  $("#about").innerHTML = [
    row("Version", APP_VERSION),
    row("Standard", "HSK 3.0 (2021)"),
    row("Vocabulary", `${num(meta.totals.words)} words`),
    row("Characters", `${num(meta.totals.chars)} hanzi`),
    row("Grammar", `${meta.totals.grammar} points · ${meta.totals.grammarWithNotes} explained`),
    ...(talk ? [row("Talk", `${num(talk.questions)} questions · ${talk.decks} decks · ${talk.answers} model answers`)] : []),
    row("Data built", meta.generated),
  ].join("");
}

/* ---------------- backup ---------------- */
async function doExport(){
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hanzai-origins-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}

async function doImport(file){
  try{
    await importAll(JSON.parse(await file.text()));
    /* the book held in memory may be one the backup has just replaced */
    if(typeof BOOK !== "undefined"){ BOOK.id = null; BOOK.data = null; }
    toast("Backup restored");
    renderSettings();
    show(S.view);
    await renderRail();
  }catch(e){
    toast(e.message || "Could not read that file");
  }
}

/* ---------------- the profile ---------------- */

/* Days until the exam, or null when there is no date or it has passed. A
   countdown is the one number that changes what somebody does today. */
function daysToExam(iso){
  if(!iso) return null;
  const then = new Date(iso + "T00:00:00");
  if(isNaN(then)) return null;
  const days = Math.round((startOfDay(then.getTime()) - startOfDay()) / DAY);
  return days >= 0 ? days : null;
}

async function renderProfile(){
  const host = $("#profile-body");
  const me = activeProfile();
  if(!me){ host.innerHTML = ""; return; }

  const left = daysToExam(me.examDate);
  const others = PROFILES.filter(p => p.id !== me.id);

  host.innerHTML = `
    <div class="pf-head">
      <span class="pf-face" style="background:${esc(me.hue)}">${esc(initialOf(me.name))}</span>
      <div class="pf-id">
        <b>${esc(me.name)}</b>
        <small>HSK ${levelLabel(S.level)} · ${esc(bandName(S.level))} · joined
          ${new Date(me.created).toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"})}</small>
      </div>
      ${me.lock ? `<span class="lv b2">locked</span>` : ""}
    </div>

    ${left !== null ? `<div class="pf-stats">
      ${kpi(left, "To exam", left === 1 ? "day" : "days")}
    </div>` : ""}

    <label class="pf-field"><span class="lbl">Name</span>
      <input class="search" id="pf-name" maxlength="40" value="${esc(me.name)}"
        autocomplete="off" placeholder="What should the app call you?"></label>

    <label class="pf-field"><span class="lbl">Exam date <i>optional</i></span>
      <input class="search" id="pf-exam" type="date" value="${esc(me.examDate || "")}"></label>

    <label class="pf-field"><span class="lbl">Note <i>optional</i></span>
      <input class="search" id="pf-note" maxlength="120" value="${esc(me.note || "")}"
        autocomplete="off" placeholder="Why you are learning, what you are working towards…"></label>

    <span class="lbl" style="display:block;margin:13px 0 6px">Colour</span>
    <div class="pf-hues" id="pf-hues">${P_HUES.map(h =>
      `<button class="pf-hue" data-hue="${h}" style="background:${h}"
         aria-label="Use this colour" aria-pressed="${h === me.hue}"></button>`).join("")}</div>

    <div class="row" style="margin-top:6px">
      <div><b>Passcode</b><p>${canLock()
        ? `Asks for a passcode before this profile opens. It keeps somebody else
           on this device out of your record — it is not encryption, and it does not
           hide anything from a browser's developer tools.`
        : `Unavailable here: this browser has no WebCrypto, and a hand-rolled
           passcode would be worse than none.`}</p></div>
      <button class="sw" id="sw-lock" aria-pressed="${!!me.lock}" aria-label="Passcode"
        ${canLock() ? "" : "disabled"}></button>
    </div>

    <div class="fold-row">
      <div class="fold-what">
        <b>${others.length ? `${others.length} other profile${others.length === 1 ? "" : "s"} on this device`
          : "This is the only profile on this device"}</b>
        <p class="pmeta" style="margin:3px 0 0">Each profile keeps its own shelf, saved words,
          settings and theme. Nothing is shared between them and nothing leaves the device.</p>
      </div>
      <div class="fold-acts">
        <button class="ghost" id="pf-switch">Switch profile</button>
        <button class="ghost" id="pf-new">New profile</button>
      </div>
    </div>`;

  $("#pf-name").addEventListener("change", e => {
    me.name = e.target.value.trim().slice(0, 40) || "Untitled";
    saveProfiles(); renderProfile(); renderRail();
  });
  $("#pf-exam").addEventListener("change", e => { me.examDate = e.target.value; saveProfiles(); renderProfile(); });
  $("#pf-note").addEventListener("change", e => { me.note = e.target.value.slice(0, 120); saveProfiles(); });
  $("#pf-hues").addEventListener("click", e => {
    const b = e.target.closest("[data-hue]");
    if(!b) return;
    me.hue = b.dataset.hue; saveProfiles(); renderProfile(); renderRail();
  });
  $("#pf-switch").onclick = showProfiles;
  $("#pf-new").onclick = () => showWelcome({adding: true});
  $("#sw-lock").onclick = () => me.lock ? clearPasscode() : askNewPasscode();
}

/* The switcher. A list of who is on this device, and the way to add one. */
function showProfiles(){
  const me = activeProfile();
  openDetail(`<h2>Profiles</h2>
    <p class="pmeta">Each keeps its own deck, shelf and settings on this device.</p>
    <div class="rows">${PROFILES.map(p => `
      <button class="erow pf-row ${p.id === (me && me.id) ? "on" : ""}" data-goprofile="${esc(p.id)}">
        <span class="pf-face sm" style="background:${esc(p.hue)}">${esc(initialOf(p.name))}</span>
        <span class="ep">${esc(p.name)}${p.lock ? " · locked" : ""}</span>
        <span class="ee">last opened ${new Date(p.lastSeen).toLocaleDateString()}</span>
        <span class="ex">${p.id === (me && me.id) ? `<span class="lv b2">you</span>` : ""}</span>
      </button>`).join("")}</div>
    <div class="acts">
      <button class="go" id="pf-add">Add a profile</button>
      ${PROFILES.length > 1 ? `<button class="no danger" id="pf-del">Delete this profile</button>` : ""}
      <button class="no" data-close>Close</button>
    </div>`);

  $("#detail-body").addEventListener("click", e => {
    const go = e.target.closest("[data-goprofile]");
    if(go && go.dataset.goprofile !== (me && me.id)) switchProfile(go.dataset.goprofile);
  });
  $("#pf-add").onclick = () => { closeDetail(); showWelcome({adding: true}); };
  const del = $("#pf-del");
  if(del) del.onclick = async () => {
    if(!confirm(`Delete “${me.name}” and everything in it — the deck, the review log, the shelf?\n\nThis cannot be undone.`)) return;
    await deleteProfile(me.id);
    location.reload();
  };
}

/* ---------------- the passcode ---------------- */
function askNewPasscode(){
  openDetail(`<h2>Set a passcode</h2>
    <p class="pmeta">Asked for before this profile opens. It keeps somebody else on this
      device out of your record. It is not encryption: your deck stays readable to anyone
      who opens this browser's developer tools, and if you forget it the only way back in
      is to delete the profile.</p>
    <label class="pf-field"><span class="lbl">Passcode</span>
      <input class="search" id="pc-a" type="password" autocomplete="new-password" inputmode="text"></label>
    <label class="pf-field"><span class="lbl">Again</span>
      <input class="search" id="pc-b" type="password" autocomplete="new-password"></label>
    <p class="pmeta" id="pc-msg" style="margin-top:9px"></p>
    <div class="acts">
      <button class="go" id="pc-save">Set it</button>
      <button class="no" data-close>Cancel</button>
    </div>`);
  $("#pc-a").focus();
  $("#pc-save").onclick = async () => {
    const a = $("#pc-a").value, b = $("#pc-b").value;
    const msg = $("#pc-msg");
    if(a.length < 4){ msg.textContent = "Use at least four characters."; return; }
    if(a !== b){ msg.textContent = "Those two do not match."; return; }
    await setPasscode(a);
    closeDetail();
    toast("Passcode set");
    renderProfile();
  };
}

async function clearPasscode(){
  const me = activeProfile();
  const given = prompt("Enter the current passcode to remove it:");
  if(given === null) { renderProfile(); return; }
  if(!await checkPasscode(me.id, given)){ toast("That is not the passcode"); renderProfile(); return; }
  await setPasscode("");
  toast("Passcode removed");
  renderProfile();
}

/* The font pickers: every face drawn in itself. The web faces are fetched
   for the previews here — a picker whose samples are all the same face would
   be choosing blind — and are cached from then on. */
function renderFonts(){
  const card = (kind, f, sample) => `
    <button class="fontcard" data-font="${esc(f.id)}" aria-pressed="${f.id === (kind === "zh" ? S.fontZh : S.fontEn)}"
      title="${esc(f.name)}">
      <span class="fsample" style="font-family:${esc(kind === "en" ? `${f.stack},sans-serif` : f.stack)}">${sample}</span>
      <span class="fname">${esc(f.name)}</span>
      ${f.note ? `<small>${esc(f.note)}</small>` : ""}
    </button>`;
  FONTS.zh.forEach(loadWebFont); FONTS.en.forEach(loadWebFont);
  $("#font-zh").innerHTML = FONTS.zh.map(f => card("zh", f, "汉字 漢字")).join("");
  $("#font-en").innerHTML = FONTS.en.map(f => card("en", f, "Aa Bb Qg")).join("");
}
