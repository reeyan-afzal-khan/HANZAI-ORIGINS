/* settings.js — the controls, and the About block. */
let settingsSection = "display";
function selectSettingsSection(id, focus = false){
  const tab = document.querySelector(`[data-setting-tab="${id}"]`);
  if(!tab) return;
  settingsSection = id;
  document.querySelectorAll('[data-setting-tab]').forEach(b => {
    const active = b === tab;
    b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-setting-section]').forEach(p => { p.hidden = p.dataset.settingSection !== id; });
  if(focus){ tab.focus(); tab.scrollIntoView({block:'nearest', inline:'nearest'}); }
}
document.querySelector('.settings-tabs').addEventListener('click', e => {
  const tab = e.target.closest('[data-setting-tab]');
  if(tab) selectSettingsSection(tab.dataset.settingTab);
});
document.querySelector('.settings-tabs').addEventListener('keydown', e => {
  const tabs = [...document.querySelectorAll('[data-setting-tab]')], i = tabs.indexOf(e.target);
  if(i < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  selectSettingsSection(tabs[next].dataset.settingTab, true);
});

function renderSettings(){
  selectSettingsSection(settingsSection);
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
  renderAbout();
}


async function renderAbout(){
  const meta = await getMeta();
  const row = (k, v) => `<div><span>${esc(k)}</span><b>${v}</b></div>`;
  $("#about").innerHTML = [
    row("Version", BUILT ? `${APP_VERSION} <span class="build">· build ${APP_BUILD}</span>` : APP_VERSION),
    row("Standard", "HSK 3.0 (2021)"),
    row("Vocabulary", `${num(meta.totals.words)} words`),
    row("Characters", `${num(meta.totals.chars)} hanzi`),
    row("Data built", meta.generated),
  ].join("");
}

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

function renderFonts(){
  const card = (kind, f, sample) => `
    <button class="fontcard" data-font="${esc(f.id)}" aria-pressed="${f.id === (kind === "zh" ? S.fontZh : S.fontEn)}"
      title="${esc(f.name)}">
      <span class="fsample" style="font-family:${esc(kind === "en" ? `${f.stack},sans-serif` : f.stack)}">${sample}</span>
      <span class="fname">${esc(f.name)}</span>
      ${f.note ? `<small>${esc(f.note)}</small>` : ""}
    </button>`;
  FONTS.zh.forEach(loadWebFont); FONTS.en.forEach(loadWebFont);
  $("#font-zh").innerHTML = FONTS.zh.map(f => card("zh", f, "永 水 木 人")).join("");
}
