/* Learning explanations derived from the bundled dictionary and decomposition.
   A modern pronunciation resemblance is a study clue, not proven etymology. */
function characterGuideHTML(c, compact = false){
  const op = [...String(c.dec || "")].find(x => IDS[x]);
  const parts = (c.comp || []).filter(p => p.c !== c.h);
  const sound = parts.filter(p => ctRole(c.h,p.c) === "sound");
  const radical = c.r || c.rad;
  const shape = op ? `The parts are arranged ${IDS[op]}.` : parts.length ? "Use the visible parts as landmarks when you read and write." : "Study this character as a whole shape before practising its strokes.";
  const structure = `<p>${esc(shape)}${c.sc ? ` The dictionary lists <b>${c.sc} strokes</b> for <span class="hz">${esc(c.h)}</span>.` : ""}</p>`;
  const radicalNote = radical ? `<p><b>Dictionary radical:</b> <span class="hz">${esc(radical)}</span>${c.rad && c.rad!==radical ? `, a form of <span class="hz">${esc(c.rad)}</span>` : ""}. A radical helps you group and look up characters; it does not always explain their modern meaning.</p>` : "";
  const soundNote = sound.length ? `<p><b>Sound clue:</b> ${sound.map(p=>{
    const pc=CT.g.by.get(p.c);
    const pair=[c.p,...c.pAlt].flatMap(a=>[pc.p,...pc.pAlt].map(b=>({a,b}))).find(({a,b})=>ctRhymes(a,b));
    return `<span class="hz">${esc(p.c)}</span> (${esc(pair.b)}) resembles the reading ${esc(pair.a)}`;
  }).join("; ")}. Use this modern sound resemblance as a memory prompt, and learn the actual pronunciation and tone separately.</p>` : "";
  const reading = `<p><b>Read it:</b> <span class="py">${pinyinHTML(c.p)}</span>${c.pAlt?.length ? `. Other readings in the dictionary: ${c.pAlt.map(p=>pinyinHTML(p)).join(", ")}. Check the word and sentence to choose the reading` : ""}.</p>`;
  const content = `${structure}${reading}${radicalNote}${soundNote}${!compact && c.t && c.t!==c.h ? `<p><b>Traditional form:</b> <span class="hz">${esc(c.t)}</span>. Compare the forms, then practise the script you use.</p>` : ""}<p class="learning-prompt"><b>Try this:</b> ${parts.length ? `Find ${parts.map(p=>`<span class="hz">${esc(p.c)}</span>`).join(" and ")} in the full character. Hide the reading, say it aloud, then write the character from memory.` : "Look at the shape, hide the reading, and say it aloud. Then write it and check the stroke order."}</p>`;
  return compact ? `<details class="character-guide"><summary>Understand this character</summary>${content}</details>` : `<section class="character-guide"><h3>A closer look</h3>${content}</section>`;
}
