/* Profile identity in the top navigation. */
/* Shared statistics used by the reader and profile settings. Values may
   contain trusted, locally generated formatting such as a percent suffix. */
const kpi = (v, k, sub = "") =>
  `<div class="kpi"><span class="v">${typeof v === "number" ? num(v) : v}</span>
   <span class="k">${esc(k)}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
const bar = (name, value, frac, colour = "var(--acc)") =>
  `<div class="brow"><span class="bn">${name}</span><span class="bv">${value}</span>
   <span class="btrack"><i class="bfill" style="width:${clamp(frac * 100, 0, 100)}%;--bc:${colour}"></i></span></div>`;
async function renderRail(){
  const me = typeof activeProfile === "function" ? activeProfile() : null;
  $("#rc-face").textContent = me ? initialOf(me.name) : levelLabel(S.level);
  $("#rc-face").style.background = me ? me.hue : "";
  $("#rc-name").textContent = me ? me.name : `HSK ${levelLabel(S.level)}`;
  $("#rc-sub").textContent = me
    ? `HSK ${levelLabel(S.level)} · ${bandName(S.level)}`
    : bandName(S.level);
}
