const metrics = {
  playSeconds: ["Play time", (v) => `${Math.floor(v / 3600)}h ${Math.floor(v % 3600 / 60)}m`],
  deaths: ["Deaths", Number], blocksMined: ["Blocks mined", Number],
  mobKills: ["Mob kills", Number], distanceMeters: ["Distance", (v) => `${(v / 1000).toFixed(1)} km`],
  jumps: ["Jumps", Number], looted: ["Loot chests", Number], itemsCrafted: ["Items crafted", Number],
  damageDealt: ["Damage dealt", Number], damageTaken: ["Taken", Number],
  damageBlocked: ["Blocked", Number], damageAbsorbed: ["Absorbed", Number],
  fishCaught: ["Fish caught", Number], animalsBred: ["Animals bred", Number],
  waystones: ["Waystones", Number], timesSlept: ["Times slept", Number],
};
const compact = new Intl.NumberFormat("en", { notation:"compact", maximumFractionDigits:1 });
const integer = new Intl.NumberFormat();
const format = (key, value) => metrics[key][1] === Number ? integer.format(value) : metrics[key][1](value);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

function card(player, rank, selected) {
  const causes = [...player.deathCauses];
  if (player.environmentalDeaths) causes.push({ label:"Environment / unknown", count:player.environmentalDeaths });
  const initial = player.name.slice(0, 1).toUpperCase();
  const skin = `/minecraft/skins/${encodeURIComponent(player.uuid)}.png`;
  return `<article class="player"><div class="player-head"><div class="identity"><span class="avatar" aria-hidden="true" style="--skin:url('${skin}')">${esc(initial)}<i class="skin-face"></i><i class="skin-hat"></i></span><h2><span class="rank">#${rank}</span>${esc(player.name)}</h2></div><div class="primary"><strong>${esc(format(selected,player[selected]))}</strong><span>${metrics[selected][0]}</span></div></div>
    <div class="stats"><div class="stat"><span>Play time</span><strong>${format("playSeconds",player.playSeconds)}</strong></div><div class="stat"><span>Deaths</span><strong>${player.deaths}</strong></div><div class="stat"><span>Mobs killed</span><strong>${integer.format(player.mobKills)}</strong></div><div class="stat"><span>Travelled</span><strong>${format("distanceMeters",player.distanceMeters)}</strong></div><div class="stat"><span>Blocks mined</span><strong>${integer.format(player.blocksMined)}</strong></div><div class="stat"><span>Crafted</span><strong>${integer.format(player.itemsCrafted)}</strong></div><div class="stat"><span>Loot chests</span><strong>${integer.format(player.looted)}</strong></div><div class="stat"><span>Jumps</span><strong>${integer.format(player.jumps)}</strong></div><div class="stat"><span>Damage dealt</span><strong>${integer.format(player.damageDealt)}</strong></div><div class="stat"><span>Taken</span><strong>${integer.format(player.damageTaken)}</strong></div><div class="stat"><span>Blocked</span><strong>${integer.format(player.damageBlocked)}</strong></div><div class="stat"><span>Absorbed</span><strong>${integer.format(player.damageAbsorbed)}</strong></div><div class="stat"><span>Fish caught</span><strong>${integer.format(player.fishCaught)}</strong></div><div class="stat"><span>Animals bred</span><strong>${integer.format(player.animalsBred)}</strong></div><div class="stat"><span>Waystones</span><strong>${integer.format(player.waystones)}</strong></div><div class="stat"><span>Times slept</span><strong>${integer.format(player.timesSlept)}</strong></div></div>
    <div class="causes"><span class="cause-title">Cause of death</span><div class="cause-list">${causes.length ? causes.map(c=>`<span class="cause">${esc(c.label)} <b>×${c.count}</b></span>`).join("") : '<span class="cause">Still undefeated</span>'}</div></div></article>`;
}

try {
  const response = await fetch("/minecraft-stats", { cache:"no-store" });
  if (!response.ok) throw new Error(`Stats request failed (${response.status})`);
  const { players } = await response.json();
  const selector=document.querySelector("#sort"), target=document.querySelector("#players");
  const render=(key)=>{ const sorted=[...players].sort((a,b)=>b[key]-a[key]||a.name.localeCompare(b.name)); target.innerHTML=sorted.map((p,i)=>card(p,i+1,key)).join(""); };
  selector.innerHTML=Object.entries(metrics).map(([key,[label]])=>`<option value="${key}">${label}</option>`).join("");
  selector.disabled=false;
  selector.addEventListener("change",()=>render(selector.value));
  selector.value="playSeconds"; render(selector.value);
} catch (error) { const node=document.querySelector("#error"); node.hidden=false; node.textContent=`Could not load player stats: ${error.message}`; document.querySelector("#sort").innerHTML="<option>Unavailable</option>"; }
