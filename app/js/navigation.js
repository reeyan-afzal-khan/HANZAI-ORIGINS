/* Profile identity in the top navigation. */
async function renderRail(){
  const me = typeof activeProfile === "function" ? activeProfile() : null;
  $("#rc-face").textContent = me ? initialOf(me.name) : levelLabel(S.level);
  $("#rc-face").style.background = me ? me.hue : "";
  $("#rc-name").textContent = me ? me.name : `HSK ${levelLabel(S.level)}`;
  $("#rc-sub").textContent = me
    ? `HSK ${levelLabel(S.level)} · ${bandName(S.level)}`
    : bandName(S.level);
}
