/* Small, profile-local learning quests. Results travel with existing backups.
   XP records practice milestones, not mastery or a spaced-repetition grade. */
let questRun = null;
let questSaving = false;
/* What the quests have earned, for the skill tree (tree.js): the XP, the
   scholar level, and which characters have been recognised and written. */
let questInfo = {xp: 0, rank: 1, recognised: new Set(), written: new Set()};
async function questRecords(){
  return (await dbAll("results")).filter(r => r.kind === "character-quest");
}
function questStats(records){
  const unique = new Map(records.map(r => [`${r.char}:${r.skill}`, r]));
  const xp = [...unique.values()].reduce((n,r) => n + (r.skill === "write" ? 20 : 10), 0);
  return {xp, rank: Math.floor(xp / 150) + 1, unique};
}
/* @param paint  draw the tree again with what has changed (the tree asks
   first and draws once itself) */
async function questRefresh(paint = true){
  const {xp,rank,unique} = questStats(await questRecords());
  const done = [...unique.values()];
  questInfo = {xp, rank,
    recognised: new Set(done.filter(r => r.skill === "recognize").map(r => r.char)),
    written: new Set(done.filter(r => r.skill === "write").map(r => r.char))};
  if(paint && CT.tree) ctRefresh();
}
async function questStart(target){
  const all = await getChars(), stats = questStats(await questRecords());
  const parts=new Set([...(CT.makes || new Map()).values()].flat());
  const family = all.filter(c => c.h === CT.root || CT.tree?.parent.has(c.h) || parts.has(c.h));
  const pool = family.length ? family : all.filter(c => c.lv <= Number(C.level));
  pool.sort((a,b) => Number(stats.unique.has(`${a.h}:write`)) - Number(stats.unique.has(`${b.h}:write`)) || a.lv - b.lv);
  const selected = pool.find(c => c.h === CT.sel && !stats.unique.has(`${c.h}:write`));
  /* asked for by name; or else the tree's next quest, then the skill picked */
  const next = CT.tree && typeof ctNextQuest === "function" ? ctNextQuest() : "";
  const c = (typeof target === "string" && all.find(c=>c.h===target)) || (next && all.find(c => c.h === next))
    || selected || pool.find(c => !stats.unique.has(`${c.h}:write`)) || pool[0];
  if(!c) return;
  /* the tree as it stood, so what the quest opens is shown opening once it closes */
  questRun = {c, all, pool, stats, initialRank:stats.rank, stage:"study", token:{}, seen: CT.seen};
  questRender();
  if(!$("#quest").open) $("#quest").showModal();
}
function questMeaning(c){ return (c.en || []).slice(0,2).join("; ") || c.h; }
function questShuffle(list){
  for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  return list;
}
function questRender(){
  const q = questRun, c = q.c, {xp,rank} = q.stats;
  $("#quest-title").textContent = q.stage === "done" ? "Quest complete" : `A new skill: ${c.h}`;
  const steps = ["Study", "Recognise", "Write"];
  const step = ["study","recall","write","done"].indexOf(q.stage);
  $("#quest-body").innerHTML = `<div class="quest-progress"><b>Scholar level ${rank}</b><span>${xp} XP · ${150 - xp % 150} to next level</span><progress max="150" value="${xp % 150}" aria-label="Progress to next level"></progress></div>
    <ol class="quest-steps">${steps.map((s,i)=>`<li class="${i < step ? "done" : i === step ? "current" : ""}">${i < step ? "✓" : i+1} ${s}</li>`).join("")}</ol><div id="quest-task"></div><p class="quest-note">10 XP for first recognition · 20 XP for first writing completion. Practice is always open; XP is not a mastery score.</p>`;
  const task = $("#quest-task");
  if(q.stage === "study"){
    const parts=(c.comp || []).filter(p=>p.c!==c.h);
    const completed=q.pool.filter(x=>q.stats.unique.has(`${x.h}:write`)).length;
    task.innerHTML = `<div class="quest-glyph hz" lang="zh-Hans">${esc(c.h)}</div><p class="quest-pinyin">${pinyinHTML(c.p)}</p><h3>${esc(questMeaning(c))}</h3>${parts.length ? `<p class="quest-parts">Built from ${parts.map(p=>`<span><b class="hz">${esc(p.c)}</b> ${esc(p.g || "")}</span>`).join(" + ")}</p>` : ""}<p>Say the reading aloud and connect the shape to its meaning. Then try without the hint.</p><button class="btn" id="quest-next">Ready to recognise</button>`;
    task.insertAdjacentHTML('beforeend',`${characterGuideHTML(c,true)}<div class="quest-route"><b>Your path through this family &amp; its parts</b><p>${completed} of ${q.pool.length} writing quests complete · HSK ${esc(levelLabel(c.lv))}${+c.lv>+S.level ? " · exploring ahead" : ""}</p><div>${[c,...q.pool.filter(x=>x.h!==c.h)].slice(0,6).map(x=>`<button class="ghost hz ${x.h===c.h ? "current" : ""}" data-quest-char="${esc(x.h)}" title="${esc(x.p)} · ${esc(questMeaning(x))}">${esc(x.h)}${q.stats.unique.has(`${x.h}:write`) ? '<small>✦</small>' : ''}</button>`).join('')}</div></div>`);
    for(const b of task.querySelectorAll('[data-quest-char]')) b.onclick=()=>questStart(b.dataset.questChar);
    $("#quest-next").onclick = () => { q.stage="recall"; questRender(); };
  } else if(q.stage === "recall"){
    const meaning = questMeaning(c);
    const distractors = [...new Set(q.all.filter(x=>x.h!==c.h && x.lv<=Math.max(1,c.lv)).map(questMeaning))].filter(m=>m!==meaning);
    const choices = questShuffle([meaning, ...questShuffle(distractors).slice(0,3)]);
    task.innerHTML = `<div class="quest-glyph hz" lang="zh-Hans">${esc(c.h)}</div><h3>Which meaning belongs to this character?</h3><div class="quest-choices">${choices.map(m=>`<button class="ghost">${esc(m)}</button>`).join("")}</div><p id="quest-feedback" role="status"></p><button class="btn" id="quest-next" hidden>Continue to writing</button>`;
    for(const b of task.querySelectorAll(".quest-choices button")) b.onclick = async () => {
      if(b.textContent !== meaning){ b.disabled=true; $("#quest-feedback").textContent="Not quite. Look again and try another meaning. No points lost."; return; }
      for(const other of task.querySelectorAll(".quest-choices button")) other.disabled=true;
      const gained = await questAward("recognize", q);
      if(questRun !== q || !$("#quest").open) return;
      $("#quest-feedback").textContent=`Correct — ${c.p}. ${gained ? "+10 XP" : "Good recall!"}`;
      $("#quest-next").hidden=false;
    };
    $("#quest-next").onclick=async()=>{
      $("#quest-next").disabled=true;
      const data=await loadStrokeData(c.h);
      if(questRun !== q || !$("#quest").open) return;
      if(!data){ $("#quest-feedback").textContent="Writing data is unavailable right now. Your recognition progress is saved. Try this quest again later."; return; }
      q.stage="write"; questRender();
    };
  } else if(q.stage === "write"){
    task.innerHTML=`<h3>Write ${esc(c.h)} · ${esc(c.p)}</h3><p>Trace each stroke in order. Hints are welcome — every attempt helps.</p><div id="quest-writer"></div><button class="ghost" id="quest-watch">Watch stroke order</button><button class="btn" id="quest-practise">Practise</button><p id="quest-feedback" role="status">Draw in the square to begin.</p>`;
    const writer=mountWriter("quest-writer",c.h,{mode:"quiz",size:240,onComplete:async mistakes=>{
      if(questRun!==q || !$("#quest").open || q.stage!=="write") return;
      q.stage="saving";
      q.gained=await questAward("write",q); q.mistakes=mistakes;
      if(questRun!==q || !$("#quest").open) return;
      q.stage="done"; questRender();
    }});
    $("#quest-watch").onclick=()=>{writer.writer.cancelQuiz();writer.animate();$("#quest-feedback").textContent="Watch carefully, then choose Practise to try it yourself.";};
    $("#quest-practise").onclick=()=>writer.quiz();
  } else if(q.stage === "done"){
    const remaining=q.pool.filter(x=>!q.stats.unique.has(`${x.h}:write`)).length;
    const opened = q.gained && CT.tree && CT.tree.branches.get(c.h) ? CT.tree.branches.get(c.h).filter(h => ctState(h) === "ready") : [];
    task.innerHTML=`<div class="quest-glyph hz">${esc(c.h)}</div><h3>${q.gained ? "+20 XP · Skill learned" : "Practice complete"}</h3>${rank>q.initialRank ? `<p class="quest-levelup">Level up! You are now a level ${rank} ${esc(ctTitle(rank).toLowerCase())}.</p>` : ""}${opened.length ? `<p class="quest-unlocked">Unlocked ${opened.length} new character${opened.length === 1 ? "" : "s"}: <span class="hz">${esc(opened.slice(0, 10).join(" "))}</span>${opened.length > 10 ? " …" : ""}</p>` : ""}<p>You recognised ${esc(c.h)} and completed its strokes.</p><p>${q.mistakes ? `${q.mistakes} stroke corrections — keep practising to build fluency.` : "No stroke corrections this time. Nicely done."}</p><p>${remaining ? `${remaining} writing quests left in this family and its parts.` : "Family complete! Revisit these characters to keep them fresh, or explore another tree."}</p><button class="btn" id="quest-next">${remaining ? "Next character quest" : "Choose a radical"}</button><button class="ghost" id="quest-return">Back to tree</button>`;
    $("#quest-next").onclick=remaining ? questStart : ()=>{$("#quest").close();if(S.charIdxCollapsed) $("#radical-picker").click();};
    $("#quest-return").onclick=()=>$("#quest").close();
  }
}
async function questAward(skill,q){
  if(questSaving) return false;
  questSaving=true;
  try{
    const records=await questRecords();
    const existing=records.some(r=>r.char===q.c.h && r.skill===skill);
    if(!existing){
      const record={kind:"character-quest",char:q.c.h,skill,at:Date.now()};
      await dbAdd("results",record); records.push(record);
    }
    q.stats=questStats(records); await questRefresh(); return !existing;
  } finally {questSaving=false;}
}
$("#quest-open").onclick=()=>questStart($("#quest-open").dataset.arg || undefined);
$("#quest-close").onclick=()=>$("#quest").close();
/* Back on the tree, what the quest opened opens in front of the reader. */
$("#quest").addEventListener("close",()=>{
  const q = questRun;
  questRun=null;
  if(q && q.seen && CT.tree && CT.seen !== q.seen){ CT.seen = q.seen; ctRefresh(); }
});
$("#quest").addEventListener("keydown",e=>e.stopPropagation());
