import { useState, useEffect, useRef, useCallback } from "react";
// Community acquisition data (drop rates, paths, steps). The Manifest gives us
// the canonical item identity; dropRates.json supplies the farming metadata.
import dropRates from "../../data/dropRates.json";

/* ── Palette ──────────────────────────────────────────────────────── */
const C = {
  bg: "#05080F", panel: "#091420", panelAlt: "#0C1B2A",
  border: "#142840", borderHi: "#1E3D5C",
  orange: "#F07030", orangeLo: "#5A2510",
  gold: "#C09030",   goldLo: "#3A2A08",
  blue: "#38AACE",   blueLo: "#0E2F40",
  text: "#C8D8E8",   sub: "#4A6880", muted: "#1E3048",
  green: "#3AAA60",  greenLo: "#0E2A18",
  red: "#C83030",    redLo: "#3A0E0E",
  purple: "#8A5ABE", purpleLo: "#1E1030",
};

const PATH_TYPE = {
  secret_chest:   { icon:"◈", label:"Secret Chest",   color:C.gold,   bg:C.goldLo   },
  encounter_drop: { icon:"◆", label:"Encounter Drop", color:C.blue,   bg:C.blueLo   },
  boss_drop:      { icon:"◆", label:"Boss Drop",      color:C.blue,   bg:C.blueLo   },
  craftable:      { icon:"⊕", label:"Craftable",      color:C.green,  bg:C.greenLo  },
  vendor:         { icon:"⊕", label:"Vendor",         color:C.green,  bg:C.greenLo  },
  quest:          { icon:"▷", label:"Quest Reward",   color:C.purple, bg:C.purpleLo },
  other:          { icon:"◉", label:"Other",          color:C.sub,    bg:C.muted    },
};
const pt  = (t) => PATH_TYPE[t] || PATH_TYPE.other;

const RARITY = {
  Exotic:    { color:C.gold,   bg:C.goldLo   },
  Legendary: { color:C.purple, bg:C.purpleLo },
  Rare:      { color:C.blue,   bg:C.blueLo   },
};
const rar = (r) => RARITY[r] || { color:C.sub, bg:C.muted };

/* ── Math ─────────────────────────────────────────────────────────── */
const probN    = (rate,runs) => runs > 0 ? (1 - Math.pow(1 - Math.max(0.001,rate), runs)) * 100 : 0;
const expRuns  = (rate)      => Math.round(1 / Math.max(0.001,rate));

function combinedProb(paths, pathRuns) {
  if (!paths?.length) return 0;
  let p = 1;
  for (const path of paths) {
    const r = pathRuns[path.id] || 0;
    if (r > 0) p *= Math.pow(1 - Math.max(0.001, path.dropRate || 0.05), r);
  }
  return (1 - p) * 100;
}

function bestPathId(paths) {
  if (!paths?.length) return null;
  return paths.reduce((best,p) => {
    const eff  = (p.estimatedMinutesPerRun||10) / (p.dropRate||0.05);
    const bEff = (best.estimatedMinutesPerRun||10) / (best.dropRate||0.05);
    return eff < bEff ? p : best;
  }).id;
}

/* ── Shared atoms ─────────────────────────────────────────────────── */
function Brackets({ color=C.orange, pad=8, size=10 }) {
  const b = { position:"absolute", width:size, height:size, borderColor:color, borderStyle:"solid", borderWidth:0 };
  return (<>
    <div style={{ ...b, top:pad, left:pad,  borderTopWidth:1.5, borderLeftWidth:1.5  }}/>
    <div style={{ ...b, top:pad, right:pad, borderTopWidth:1.5, borderRightWidth:1.5 }}/>
    <div style={{ ...b, bottom:pad, left:pad,  borderBottomWidth:1.5, borderLeftWidth:1.5  }}/>
    <div style={{ ...b, bottom:pad, right:pad, borderBottomWidth:1.5, borderRightWidth:1.5 }}/>
  </>);
}

function Panel({ children, style={}, bc=C.orange, noBrackets=false }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`, position:"relative", padding:14, ...style }}>
      {!noBrackets && <Brackets color={bc}/>}
      {children}
    </div>
  );
}

function Lbl({ children, color=C.sub, mb=4 }) {
  return <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.18em", textTransform:"uppercase", color, marginBottom:mb }}>{children}</div>;
}

function Badge({ label, color, bg }) {
  return (
    <div style={{ padding:"2px 7px", background:bg, border:`1px solid ${color}`,
      fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700,
      letterSpacing:"0.12em", color, display:"inline-block" }}>
      {label}
    </div>
  );
}

function Ghost({ size=28, color=C.blue, spin=false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32"
      style={{ display:"block", ...(spin ? { animation:"ghostSpin 8s linear infinite" } : {}) }}>
      <polygon points="16,2 30,16 16,30 2,16"  fill="none" stroke={color} strokeWidth="1.5"/>
      <polygon points="16,6 26,16 16,26 6,16"  fill={color} opacity="0.12"/>
      <polygon points="16,10 22,16 16,22 10,16" fill="none" stroke={color} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="16" cy="16" r="2.8" fill={color}/>
      <circle cx="16" cy="16" r="1.2" fill="#fff" opacity="0.6"/>
    </svg>
  );
}

function Diamond({ n, color=C.orange, bg=C.orangeLo }) {
  return (
    <div style={{ width:26, height:26, transform:"rotate(45deg)", background:bg,
      border:`1.5px solid ${color}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <span style={{ transform:"rotate(-45deg)", fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700, color }}>{n}</span>
    </div>
  );
}

/* ── Account panel (Bungie OAuth via main process) ────────────────────
   Replaces the old Anthropic API-key Settings panel: we no longer call an LLM,
   but we DO need a Bungie session for auto-tracking. */
function Account({ auth, busy, onLogin, onLogout, apiUrl, onSaveApiUrl }) {
  const [draft, setDraft] = useState(apiUrl || "");
  useEffect(() => { setDraft(apiUrl || ""); }, [apiUrl]);
  const dirty = draft.trim() !== (apiUrl || "").trim();
  return (
    <Panel bc={C.muted} style={{ marginBottom:10 }}>
      <Lbl color={C.sub}>Bungie Account</Lbl>
      {auth.loggedIn ? (
        <>
          <div style={{ fontSize:11, color:C.sub, lineHeight:1.6, marginBottom:10 }}>
            Signed in as <span style={{ color:C.text }}>{auth.displayName}</span>.<br/>
            Activity completions auto-track every 60 seconds.
          </div>
          <button onClick={onLogout} style={{
            background:C.redLo, border:`1px solid ${C.red}`, color:C.red,
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
            letterSpacing:"0.12em", padding:"6px 12px", cursor:"pointer", WebkitAppRegion:"no-drag" }}>
            SIGN OUT
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize:11, color:C.sub, lineHeight:1.6, marginBottom:10 }}>
            Sign in with Bungie.net to auto-track your loot runs from in-game activity completions.
          </div>
          <button onClick={onLogin} disabled={busy} style={{
            background:C.orangeLo, border:`1px solid ${C.orange}`, color:C.orange,
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
            letterSpacing:"0.12em", padding:"6px 12px", cursor:busy?"default":"pointer", WebkitAppRegion:"no-drag" }}>
            {busy ? "OPENING…" : "SIGN IN WITH BUNGIE.NET"}
          </button>
        </>
      )}
      {auth.loggedIn && (
        <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background:C.green }}/>
          <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.green, letterSpacing:"0.14em" }}>
            AUTO-TRACK ACTIVE
          </span>
        </div>
      )}

      {/* Data API (Railway) — drives Xûr's live stock + community paths. */}
      <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
        <Lbl color={C.sub}>Data API URL (optional)</Lbl>
        <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginBottom:8 }}>
          Railway service that serves Xûr's live exotic stock and community paths.
          Leave blank to run on bundled data only.
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="https://your-app.up.railway.app"
            style={{ ...inputStyle, marginBottom:0, flex:1, WebkitAppRegion:"no-drag" }}/>
          <button onClick={() => onSaveApiUrl?.(draft)} disabled={!dirty} style={{
            background:dirty ? C.orangeLo : C.muted, border:`1px solid ${dirty ? C.orange : C.border}`,
            color:dirty ? C.orange : C.muted, fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:11, fontWeight:700, letterSpacing:"0.12em", padding:"0 12px",
            cursor:dirty ? "pointer" : "default", flexShrink:0, WebkitAppRegion:"no-drag" }}>
            SAVE
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ── Mini probability bar ─────────────────────────────────────────── */
function MiniProb({ runs, dropRate }) {
  const dr   = Math.max(0.001, dropRate || 0.05);
  const prob = probN(dr, runs);
  const col  = prob >= 80 ? C.red : prob >= 55 ? C.gold : C.blue;
  const label =
    runs === 0 ? "NO RUNS YET" :
    prob >= 95 ? "TRAVELER OWES YOU" :
    prob >= 80 ? "WELL PAST EXPECTED" :
    prob >= 55 ? "ABOVE AVERAGE" :
    prob >= 30 ? "NORMAL RANGE" : "EARLY";

  return (
    <div style={{ marginTop:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:6 }}>
        <div>
          <Lbl>Probability</Lbl>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:700, color:col, lineHeight:1 }}>
            {prob.toFixed(1)}<span style={{ fontSize:14, opacity:.7 }}>%</span>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <Lbl>Status</Lbl>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:col, letterSpacing:"0.1em" }}>{label}</div>
        </div>
      </div>

      <div style={{ height:4, background:C.muted, position:"relative", marginBottom:8 }}>
        <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${Math.min(prob,100)}%`,
          background:`linear-gradient(90deg,${C.orangeLo},${col})`, transition:"width 0.5s ease" }}/>
        <div style={{ position:"absolute", left:"50%", top:-2, width:1, height:8, background:C.gold, opacity:.5 }}/>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
        {[
          { l:"Runs Done",     v:runs,                                              c:C.text },
          { l:"Expected ~50%", v:Math.round(Math.log(.5)/Math.log(1-dr)),           c:C.gold },
          { l:"Drop Rate",     v:`${(dr*100).toFixed(1)}%`,                         c:C.blue },
        ].map(({ l,v,c }) => (
          <div key={l} style={{ background:C.panelAlt, border:`1px solid ${C.muted}`, padding:"6px 8px" }}>
            <Lbl mb={2}>{l}</Lbl>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, color:c }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Per-path card ────────────────────────────────────────────────── */
function PathCard({ path, runs, onAdd, onSub, isBest }) {
  const [open, setOpen] = useState(true);
  const ptype        = pt(path.pathType);
  const dr           = Math.max(0.001, path.dropRate || 0.05);
  const minsPerDrop  = Math.round((path.estimatedMinutesPerRun || 10) / dr);
  const weeklyTotal  = path.weeklyLimitPerCharacter ? path.weeklyLimitPerCharacter * 3 : null;

  return (
    <Panel bc={ptype.color} style={{ marginBottom:10 }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor:"pointer", userSelect:"none" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:20, height:20, background:ptype.bg, border:`1px solid ${ptype.color}`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, color:ptype.color, flexShrink:0 }}>
              {ptype.icon}
            </div>
            <div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                color:ptype.color, letterSpacing:"0.07em", textTransform:"uppercase", lineHeight:1.1 }}>
                {path.method}
              </div>
              {path.location && (
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.08em", marginTop:2 }}>
                  {path.location}
                </div>
              )}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end", flexShrink:0 }}>
            {isBest && <Badge label="FASTEST ROUTE" color={C.green} bg={C.greenLo}/>}
            <Badge
              label={path.farmable === false ? (weeklyTotal ? `${weeklyTotal}/WK MAX` : "WEEKLY") : "FARMABLE"}
              color={path.farmable === false ? C.gold : C.green}
              bg={path.farmable === false ? C.goldLo : C.greenLo}
            />
          </div>
        </div>

        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.1em" }}>
            <span style={{ color:ptype.color }}>{(dr*100).toFixed(1)}%</span> drop rate
          </div>
          {path.estimatedMinutesPerRun && (
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.1em" }}>
              ~{path.estimatedMinutesPerRun} min/run
            </div>
          )}
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.1em" }}>
            ~<span style={{ color:C.text }}>{minsPerDrop}</span> min avg to drop
          </div>
          {path.weeklyLimitPerCharacter && (
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.gold, letterSpacing:"0.1em" }}>
              {path.weeklyLimitPerCharacter}/char · 3 chars
            </div>
          )}
          <div style={{ marginLeft:"auto", fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.muted }}>
            {open ? "▲" : "▼"}
          </div>
        </div>
      </div>

      {open && (
        <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
          {path.description && (
            <div style={{ fontSize:12, color:C.sub, lineHeight:1.6, marginBottom:12 }}>{path.description}</div>
          )}

          {path.steps?.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <Lbl color={ptype.color}>Steps</Lbl>
              {path.steps.map((s,i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:i < path.steps.length-1 ? 10 : 0 }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                    <Diamond n={s.step} color={ptype.color} bg={ptype.bg}/>
                    {i < path.steps.length-1 && <div style={{ width:1, flex:1, background:C.muted, margin:"3px 0" }}/>}
                  </div>
                  <div style={{ paddingTop:3, paddingBottom:i < path.steps.length-1 ? 6 : 0 }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, fontWeight:600,
                      color:C.text, letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:2 }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{s.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {path.notes && (
            <div style={{ display:"flex", gap:6, alignItems:"flex-start", marginBottom:14,
              background:C.goldLo, border:`1px solid ${C.border}`, padding:"6px 10px" }}>
              <span style={{ color:C.gold, fontSize:10, marginTop:1 }}>!</span>
              <span style={{ fontSize:11, color:C.gold, lineHeight:1.5 }}>{path.notes}</span>
            </div>
          )}

          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
            <Lbl color={ptype.color}>This Path — Runs Logged</Lbl>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={onSub} style={{ width:34, height:34, background:C.muted, border:`1px solid ${C.border}`,
                color:C.text, fontSize:20, cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif",
                display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
              <div style={{ flex:1, textAlign:"center" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:40, fontWeight:700, color:ptype.color, lineHeight:1 }}>{runs}</div>
                {weeklyTotal && (
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.muted, letterSpacing:"0.14em", marginTop:2 }}>
                    {weeklyTotal} AVAILABLE / WEEK
                  </div>
                )}
              </div>
              <button onClick={onAdd} style={{ width:34, height:34, background:ptype.bg, border:`1px solid ${ptype.color}`,
                color:ptype.color, fontSize:20, cursor:"pointer", fontFamily:"'Barlow Condensed',sans-serif",
                display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
            </div>
            <MiniProb runs={runs} dropRate={path.dropRate}/>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ── Combined summary ─────────────────────────────────────────────── */
function CombinedSummary({ paths, pathRuns, acquired, onAcquired }) {
  const prob      = combinedProb(paths, pathRuns);
  const totalRuns = Object.values(pathRuns).reduce((a,b) => a+b, 0);
  const col       = prob >= 80 ? C.red : prob >= 55 ? C.gold : C.blue;

  return (
    <Panel bc={col} style={{ marginBottom:10 }}>
      <Lbl color={col}>Combined Acquisition Probability</Lbl>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:46, fontWeight:700, color:col, lineHeight:1 }}>
          {prob.toFixed(1)}<span style={{ fontSize:20, opacity:.7 }}>%</span>
        </div>
        <div style={{ textAlign:"right" }}>
          <Lbl>Total Runs</Lbl>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:700, color:C.text }}>{totalRuns}</div>
        </div>
      </div>

      <div style={{ height:5, background:C.muted, position:"relative", marginBottom:12 }}>
        <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${Math.min(prob,100)}%`,
          background:`linear-gradient(90deg,${C.orangeLo},${col})`, transition:"width 0.6s ease" }}/>
        <div style={{ position:"absolute", left:"50%", top:-2, width:1, height:9, background:C.gold, opacity:.5 }}/>
      </div>

      {paths.map(p => {
        const r     = pathRuns[p.id] || 0;
        const pp    = probN(p.dropRate || 0.05, r);
        const ptype = pt(p.pathType);
        return (
          <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            marginBottom:5, paddingBottom:5, borderBottom:`1px solid ${C.muted}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ color:ptype.color, fontSize:10 }}>{ptype.icon}</span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.sub, letterSpacing:"0.06em" }}>
                {p.method}
              </span>
            </div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:ptype.color, letterSpacing:"0.08em" }}>
              {r} runs · {pp.toFixed(1)}%
            </div>
          </div>
        );
      })}

      <button onClick={() => onAcquired(!acquired)} style={{ width:"100%", padding:"9px 0", marginTop:6,
        background:acquired ? C.greenLo : C.muted, border:`1px solid ${acquired ? C.green : C.border}`,
        color:acquired ? C.green : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
        fontSize:11, fontWeight:700, letterSpacing:"0.16em", cursor:"pointer" }}>
        {acquired ? "◆  ITEM ACQUIRED  ◆" : "MARK AS ACQUIRED"}
      </button>
    </Panel>
  );
}

/* ── Novel Decryption fallback ────────────────────────────────────────
   Every Exotic armor piece (incl. class items) is focusable at Rahool's
   "Novel Decryption" page once unlocked, for an Exotic Cipher + Exotic engram.
   We don't enumerate the ~141 of them as data; instead any Exotic armor with
   no curated entry gets this synthetic path. */
const ARMOR_TYPE_RE = /^(Helmet|Gauntlets|Chest Armor|Leg Armor|Class Armor|Hunter Cloak|Warlock Bond|Titan Mark)$/i;
function isExoticArmor(hit) {
  return (
    (hit.tierTypeName || "").toLowerCase() === "exotic" &&
    ARMOR_TYPE_RE.test((hit.itemType || "").trim())
  );
}
function novelDecryptionPath() {
  return {
    id: "novel_decryption",
    method: "Novel Decryption — Rahool",
    pathType: "vendor",
    location: "The Tower (Rahool)",
    sourceActivityHashes: [],
    dropRate: 1.0,
    farmable: true,
    weeklyLimitPerCharacter: null,
    estimatedMinutesPerRun: 1,
    description:
      "Exotic armor. Once you've collected it once, focus it at Rahool's SECOND page → Novel Decryption with an Exotic Cipher + an Exotic engram. Re-decrypt to chase better stat rolls / higher armor tiers.",
    notes:
      "Targeted vendor pull, not a farmable drop. Cost: 1 Exotic Cipher + 1 Exotic engram. Best ways to farm Exotic engrams: Master Lost Sectors and Portal weekly rewards.",
  };
}

/* ── Helpers: build itemData from a Manifest hit + acquisition data ───
   Resolution order: user-authored (by itemHash) → community (remote) → bundled
   → Novel Decryption fallback (Exotic armor only). Earlier sources win, so
   personal entries override community, which override the data shipped in the
   app, which overrides the generic Rahool fallback. */
function buildItemData(hit, userRates = {}, communityRates = {}) {
  const entry =
    userRates[String(hit.itemHash)] ||
    communityRates[String(hit.itemHash)] ||
    communityRates[hit.name] ||
    dropRates[String(hit.itemHash)] ||
    dropRates[hit.name] ||
    null;
  let paths = (entry?.acquisitionPaths || []).map((p, i) => ({
    ...p,
    id: p.id || `path_${i}`,
  }));
  // No curated data, but it's an Exotic armor piece → it's a Rahool focus.
  if (!paths.length && isExoticArmor(hit)) paths = [novelDecryptionPath()];

  // A path is auto-trackable only if it has a source activity to watch.
  const trackable = paths.some((p) => (p.sourceActivityHashes || []).length > 0);
  let tips;
  if (!paths.length) {
    tips = [
      "No farming data for this item yet.",
      "Use “+ ADD PATH” above to attach a source activity and drop rate, then enable auto-track.",
    ];
  } else if (trackable) {
    tips = ["Counts auto-increment when the Ghost detects a matching activity completion."];
  } else {
    tips = ["Targeted vendor pull — no activity to auto-track."];
  }

  return {
    itemHash: hit.itemHash,
    itemName: hit.name,
    type: hit.itemType || "Item",
    rarity: hit.tierTypeName || "",
    description: hit.description || "",
    icon: hit.icon || null,
    prerequisites: [],
    acquisitionPaths: paths,
    tips,
    sourceActivity: hit.sources?.[0] || paths[0]?.location || "",
    lastVerified: "Manifest",
  };
}

/* ── Add-path form (user-authored acquisition data) ───────────────────
   Lets the user attach a farmable path to the on-screen item, picking the
   source activity from the Manifest so its hash is captured for auto-tracking. */
const inputStyle = {
  width:"100%", background:C.panelAlt, border:`1px solid ${C.border}`, color:C.text,
  fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, letterSpacing:"0.04em",
  padding:"7px 9px", marginBottom:8,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:2 }}>
      <Lbl mb={3}>{label}</Lbl>
      {children}
    </div>
  );
}

function AddPathForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    method:"", pathType:"encounter_drop", location:"",
    dropPercent:"8", minutes:"20", weekly:"1", farmable:false,
    description:"", notes:"", activityHash:"", activityName:"",
  });
  const [actQuery, setActQuery] = useState("");
  const [acts, setActs]         = useState([]);
  const [searching, setSearching] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Debounced Manifest activity search for the source-activity picker.
  useEffect(() => {
    if (actQuery.trim().length < 2) { setActs([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setActs(((await window.api.searchActivities(actQuery)) || []).slice(0, 8)); }
      catch { setActs([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [actQuery]);

  const pickActivity = (a) => {
    set("activityHash", a.activityHash);
    set("activityName", a.name);
    setForm(f => ({ ...f, location: f.location || a.name }));
    setActQuery(a.name);
    setActs([]);
  };

  const canSave = form.method.trim().length > 0;

  return (
    <Panel bc={C.orange} style={{ marginBottom:10 }}>
      <Lbl color={C.orange}>Add Acquisition Path</Lbl>

      <Field label="Method (what you do)">
        <input value={form.method} onChange={e => set("method", e.target.value)}
          placeholder="e.g. Final encounter chest" style={inputStyle}/>
      </Field>

      <Field label="Source Activity (Manifest — captures hash for auto-track)">
        <input value={actQuery} onChange={e => setActQuery(e.target.value)}
          placeholder="Search activities… e.g. Warlord's Ruin" style={{ ...inputStyle, marginBottom:acts.length||searching?4:8 }}/>
        {searching && (
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.1em", marginBottom:8 }}>SEARCHING…</div>
        )}
        {acts.length > 0 && (
          <div style={{ border:`1px solid ${C.border}`, marginBottom:8, maxHeight:150, overflowY:"auto" }}>
            {acts.map(a => (
              <div key={`${a.activityHash}`} onClick={() => pickActivity(a)} style={{
                padding:"6px 9px", cursor:"pointer", borderBottom:`1px solid ${C.muted}`,
                display:"flex", justifyContent:"space-between", gap:8 }}
                onMouseEnter={e => e.currentTarget.style.background = C.panelAlt}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, color:C.text, letterSpacing:"0.03em" }}>{a.name}</span>
                {a.light > 0 && <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.gold }}>⬩{a.light}</span>}
              </div>
            ))}
          </div>
        )}
        {form.activityHash && (
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.green, letterSpacing:"0.08em", marginBottom:8 }}>
            ✓ {form.activityName} · hash {form.activityHash}
          </div>
        )}
      </Field>

      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <Field label="Path Type">
            <select value={form.pathType} onChange={e => set("pathType", e.target.value)} style={inputStyle}>
              {Object.entries(PATH_TYPE).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ flex:1 }}>
          <Field label="Location / label">
            <input value={form.location} onChange={e => set("location", e.target.value)}
              placeholder="e.g. Warlord's Ruin" style={inputStyle}/>
          </Field>
        </div>
      </div>

      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <Field label="Drop rate %">
            <input type="number" value={form.dropPercent} onChange={e => set("dropPercent", e.target.value)}
              min="0.1" max="100" step="0.1" style={inputStyle}/>
          </Field>
        </div>
        <div style={{ flex:1 }}>
          <Field label="Minutes / run">
            <input type="number" value={form.minutes} onChange={e => set("minutes", e.target.value)}
              min="1" step="1" style={inputStyle}/>
          </Field>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <button onClick={() => set("farmable", !form.farmable)} style={{
          width:20, height:20, flexShrink:0, cursor:"pointer",
          background:form.farmable ? C.greenLo : C.muted,
          border:`1px solid ${form.farmable ? C.green : C.border}`,
          color:C.green, fontFamily:"'Barlow Condensed',sans-serif", fontSize:12,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          {form.farmable ? "✓" : ""}
        </button>
        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.sub, letterSpacing:"0.08em" }}>
          REPEATABLE (no weekly limit)
        </span>
        {!form.farmable && (
          <input type="number" value={form.weekly} onChange={e => set("weekly", e.target.value)}
            min="1" step="1" title="Weekly limit per character"
            style={{ ...inputStyle, width:64, marginBottom:0, marginLeft:"auto" }}/>
        )}
      </div>

      <Field label="Description (optional)">
        <input value={form.description} onChange={e => set("description", e.target.value)}
          placeholder="How this path works…" style={inputStyle}/>
      </Field>

      <div style={{ display:"flex", gap:8, marginTop:4 }}>
        <button onClick={onCancel} style={{ flex:1, padding:"8px 0",
          background:C.muted, border:`1px solid ${C.border}`, color:C.sub,
          fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
          letterSpacing:"0.14em", cursor:"pointer" }}>CANCEL</button>
        <button onClick={() => canSave && onSave(form)} disabled={!canSave} style={{ flex:1, padding:"8px 0",
          background:canSave ? C.orange : C.muted, border:"none",
          color:canSave ? "#fff" : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:11, fontWeight:700, letterSpacing:"0.14em", cursor:canSave ? "pointer" : "default" }}>
          SAVE PATH
        </button>
      </div>
    </Panel>
  );
}

/* ── Xûr panel ────────────────────────────────────────────────────────
   Xûr's live weekly exotic stock. The old Nightfall/Trials rotation was
   removed (Edge of Fate has no targetable featured weapon). XurPanel renders
   ONLY when the server reports an authoritative live read AND Xûr is verified
   present — never a possibly-stale "IN TOWN". */

function XurSection({ xur, onScan }) {
  const weapons = xur.weapons || [];
  const armorCount = (xur.armor || []).length;
  return (
    <div>
      {xur.location && (
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.12em", marginBottom:weapons.length?8:0 }}>
          {xur.location.toUpperCase()}
        </div>
      )}
      {weapons.map(w => (
        <div key={w.itemHash} onClick={() => onScan?.(w.name)} title="Scan this item"
          style={{ display:"flex", alignItems:"center", gap:9, padding:"5px 0", cursor:"pointer" }}
          onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
          onMouseLeave={e => e.currentTarget.style.opacity = 1}>
          {w.icon
            ? <img src={w.icon} alt="" width={28} height={28} style={{ border:`1px solid ${C.gold}`, flexShrink:0 }}/>
            : <div style={{ width:28, height:28, background:C.goldLo, border:`1px solid ${C.gold}`, flexShrink:0 }}/>}
          <div style={{ minWidth:0 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700,
              color:C.gold, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {w.name}
            </div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
              EXOTIC · {(w.type || "WEAPON").toUpperCase()}
            </div>
          </div>
        </div>
      ))}
      {armorCount > 0 && (
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.1em", marginTop:6 }}>
          + {armorCount} exotic armor piece{armorCount !== 1 ? "s" : ""} in stock
        </div>
      )}
      {weapons.length === 0 && armorCount === 0 && (
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.sub, letterSpacing:"0.06em" }}>
          Xûr is here, but no exotic gear could be read from his stock this refresh.
        </div>
      )}
    </div>
  );
}

function XurPanel({ data, onScan }) {
  // Only ever surface Xûr when the server gave an AUTHORITATIVE live read AND he
  // is verified present. Away or unknown (fallback) → render nothing at all.
  if (!data || data.source !== "live" || !data.xur?.present) return null;
  const week = data.weekOf ? new Date(data.weekOf).toLocaleDateString() : null;
  return (
    <Panel bc={C.gold} style={{ marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <Lbl color={C.gold} mb={0}>{data.xur.label || "Xûr"} · Exotics</Lbl>
        <Badge label="IN TOWN · LIVE" color={C.green} bg={C.greenLo}/>
      </div>
      <XurSection xur={data.xur} onScan={onScan}/>
      {week && (
        <div style={{ textAlign:"center", fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:9, color:C.muted, letterSpacing:"0.14em", marginTop:12 }}>
          WEEK OF {week} · VERIFIED LIVE
        </div>
      )}
    </Panel>
  );
}

/* ── Main App ─────────────────────────────────────────────────────── */
export default function GhostCompanion() {
  const [query,       setQuery]       = useState("");
  const [itemData,    setItemData]    = useState(null);
  const [scanning,    setScanning]    = useState(false);
  const [pathRuns,    setPathRuns]    = useState({});
  const [acquired,    setAcquired]    = useState(false);
  const [error,       setError]       = useState(null);

  // Bungie auth (replaces the old Anthropic API-key state).
  const [auth,        setAuth]        = useState({ loggedIn:false, displayName:null });
  const [authBusy,    setAuthBusy]    = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  // User-authored acquisition data (merged over bundled dropRates.json) and
  // whether the on-screen item is registered for auto-tracking.
  const [userRates,   setUserRates]   = useState({});
  const [isTracked,   setIsTracked]   = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);

  // Remote data (from the Railway data API): community paths + Xûr live stock.
  const [communityRates, setCommunityRates] = useState({});
  const [xurData,        setXurData]        = useState(null);
  const [apiUrl,         setApiUrl]         = useState("");

  // Keep a ref to the current item so the IPC event listener (registered once)
  // can always read the latest scanned item without re-subscribing.
  const itemRef = useRef(null);
  useEffect(() => { itemRef.current = itemData; }, [itemData]);
  // Merged rates ref (user over community) so handlers can resolve entries
  // without those objects in their dependency arrays.
  const ratesRef = useRef({ user: {}, community: {} });
  useEffect(() => { ratesRef.current = { user: userRates, community: communityRates }; },
    [userRates, communityRates]);

  // Load Bungie auth status + user acquisition data on mount.
  useEffect(() => { window.api?.getAuthStatus?.().then(setAuth).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getUserDropRates?.().then(setUserRates).catch(()=>{}); }, []);
  // Load remote data (no-ops gracefully if no data API URL is configured).
  useEffect(() => { window.api?.getCommunityPaths?.().then(setCommunityRates).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getXur?.().then(setXurData).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getDataApiUrl?.().then(v => setApiUrl(v || "")).catch(()=>{}); }, []);

  // Refresh whether a given itemHash is currently in the tracked list.
  const refreshTracked = useCallback(async (itemHash) => {
    const list = (await window.api?.getTrackedItems?.()) || [];
    setIsTracked(list.some(t => String(t.itemHash) === String(itemHash)));
  }, []);

  // ── IPC: auto-increment when the main process detects a completion ──────
  useEffect(() => {
    if (!window.api?.onCompletionDetected) return;
    const unsubscribe = window.api.onCompletionDetected((payload) => {
      // The ritual rotation feature was removed; ignore any legacy "ritual:*"
      // tracked-item stragglers still living in a user's store.
      if (typeof payload.itemKey === "string" && payload.itemKey.startsWith("ritual:")) return;
      const cur = itemRef.current;
      // Only react if the completion is for the item currently on screen.
      const matches =
        cur &&
        (payload.itemKey === cur.itemName ||
          String(payload.itemHash) === String(cur.itemHash));
      if (!matches) return;
      setPathRuns(r => ({
        ...r,
        // main sends the authoritative new count; fall back to +1 if absent.
        [payload.pathId]: payload.newCount ?? ((r[payload.pathId] || 0) + 1),
      }));
    });
    return unsubscribe; // preload returns an unsubscribe fn
  }, []);

  // ── Run-count mutation (persists to electron-store via IPC) ─────────────
  const persistCount = useCallback((id, value) => {
    if (itemRef.current) {
      window.api?.setRunCount?.({ itemKey: itemRef.current.itemName, pathId: id, value });
    }
  }, []);
  const addRun = (id) => setPathRuns(r => {
    const v = (r[id] || 0) + 1; persistCount(id, v); return { ...r, [id]: v };
  });
  const subRun = (id) => setPathRuns(r => {
    const v = Math.max(0, (r[id] || 0) - 1); persistCount(id, v); return { ...r, [id]: v };
  });

  // ── Auth actions ────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setAuthBusy(true); setError(null);
    try { setAuth(await window.api.login()); setShowAccount(false); }
    catch (e) { setError(`Bungie sign-in failed: ${e.message}`); }
    finally { setAuthBusy(false); }
  };
  const handleLogout = async () => {
    try { setAuth(await window.api.logout()); } catch {/* ignore */}
  };

  // ── Scan: Manifest search (replaces the old Anthropic call) ─────────────
  const scan = useCallback(async (termOverride) => {
    const raw = typeof termOverride === "string" ? termOverride : query;
    if (!raw.trim() || scanning) return;
    if (typeof termOverride === "string") setQuery(termOverride);
    setScanning(true);
    setItemData(null);
    setError(null);
    setPathRuns({});
    setAcquired(false);
    setShowAdd(false);

    try {
      const term = raw.trim();
      // A bare number is treated as a raw itemHash — lets users add/track items
      // straight from a hash they pulled off DIM / light.gg, no name needed.
      const isHash = /^\d{5,}$/.test(term);

      let hit = null;
      if (isHash) {
        hit = await window.api.getItemByHash(term);
        if (!hit) {
          setError(`No item with hash ${term} in the Manifest.`);
          return;
        }
      } else {
        // search-manifest sorts exact/prefix matches first, so take the top hit.
        const results = await window.api.searchManifest(term);
        if (!results || results.length === 0) {
          setError("Ghost found no matching item in the Manifest.");
          return;
        }
        hit = results[0];
      }

      const data = buildItemData(hit, ratesRef.current.user, ratesRef.current.community);
      setItemData(data);
      refreshTracked(hit.itemHash);

      // Hydrate any previously-logged (or auto-tracked) run counts from store.
      const counts = (await window.api.getRunCounts?.()) || {};
      const hydrated = {};
      for (const p of data.acquisitionPaths) {
        hydrated[p.id] = counts[`${data.itemName}::${p.id}`] || 0;
      }
      setPathRuns(hydrated);
    } catch (e) {
      setError(`Ghost lost signal: ${e.message || "Manifest query failed."}`);
    } finally {
      setScanning(false);
    }
  }, [query, scanning, refreshTracked]);

  // ── Auto-track registration ─────────────────────────────────────────────
  // Adds/removes the on-screen item from the tracked list so the main-process
  // poller increments run counts on matching activity completions. The tracked
  // descriptor's `key` MUST equal itemName (the run-count keying used here).
  const toggleTrack = useCallback(async () => {
    const cur = itemRef.current;
    if (!cur) return;
    const list = (await window.api.getTrackedItems()) || [];
    const exists = list.some(t => String(t.itemHash) === String(cur.itemHash));
    let next;
    if (exists) {
      next = list.filter(t => String(t.itemHash) !== String(cur.itemHash));
    } else {
      const descriptor = {
        key: cur.itemName,
        itemHash: cur.itemHash,
        name: cur.itemName,
        icon: cur.icon || null,
        paths: (cur.acquisitionPaths || []).map(p => ({
          id: p.id,
          method: p.method,
          location: p.location,
          sourceActivityHash: p.sourceActivityHash ?? null,
          sourceActivityHashes: p.sourceActivityHashes || [],
          sourceActivityName: p.location || cur.sourceActivity || "",
        })),
      };
      next = [...list, descriptor];
    }
    await window.api.setTrackedItems(next);
    setIsTracked(!exists);
  }, []);

  // ── Save a user-authored acquisition path for the on-screen item ─────────
  const saveCustomPath = useCallback(async (form) => {
    const cur = itemRef.current;
    if (!cur) return;
    const all = (await window.api.getUserDropRates()) || {};
    const existing = all[String(cur.itemHash)] || { itemHash: cur.itemHash, acquisitionPaths: [] };
    const farmable = !!form.farmable;
    const newPath = {
      id: `user_${Date.now()}`,
      method: form.method || "Custom Path",
      pathType: form.pathType || "other",
      location: form.location || form.activityName || "",
      sourceActivityHashes: form.activityHash ? [Number(form.activityHash)] : [],
      dropRate: Math.min(1, Math.max(0.001, (Number(form.dropPercent) || 5) / 100)),
      farmable,
      weeklyLimitPerCharacter: farmable ? null : (Number(form.weekly) || 1),
      estimatedMinutesPerRun: Number(form.minutes) || 10,
      description: form.description || "",
      notes: form.notes || null,
    };
    const entry = {
      ...existing,
      itemHash: cur.itemHash,
      name: cur.itemName,
      acquisitionPaths: [...(existing.acquisitionPaths || []), newPath],
    };
    const updated = await window.api.saveUserDropRate({ itemHash: cur.itemHash, entry });
    setUserRates(updated);

    // Rebuild the on-screen card from the freshly-merged data, preserving counts.
    const rebuilt = buildItemData(
      {
        itemHash: cur.itemHash, name: cur.itemName, description: cur.description,
        icon: cur.icon, itemType: cur.type, tierTypeName: cur.rarity,
        sources: cur.sourceActivity ? [cur.sourceActivity] : [],
      },
      updated,
      ratesRef.current.community
    );
    setItemData(rebuilt);
    const counts = (await window.api.getRunCounts?.()) || {};
    setPathRuns(prev => {
      const merged = { ...prev };
      for (const p of rebuilt.acquisitionPaths) {
        if (!(p.id in merged)) merged[p.id] = counts[`${rebuilt.itemName}::${p.id}`] || 0;
      }
      return merged;
    });
    setShowAdd(false);
  }, []);

  // Persist a new data API URL and immediately refresh remote data from it.
  const saveApiUrl = useCallback(async (url) => {
    const saved = await window.api.setDataApiUrl(url);
    setApiUrl(saved || "");
    window.api.getCommunityPaths?.({ force: true }).then(setCommunityRates).catch(()=>{});
    window.api.getXur?.({ force: true }).then(setXurData).catch(()=>{});
  }, []);

  const best    = itemData ? bestPathId(itemData.acquisitionPaths) : null;
  const itemRar = rar(itemData?.rarity);

  return (
    <div style={{ fontFamily:"'Barlow',sans-serif", background:C.bg, minHeight:"100vh",
      padding:16, color:C.text, maxWidth:520, margin:"0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500&display=swap');
        @keyframes ghostSpin { to { transform:rotate(360deg); } }
        @keyframes scanBeam  { 0%{top:-2px;opacity:0} 5%{opacity:1} 95%{opacity:1} 100%{top:100%;opacity:0} }
        @keyframes fadeUp    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse     { 0%,100%{opacity:.4} 50%{opacity:1} }
        * { box-sizing:border-box; }
        button:hover:not(:disabled) { filter:brightness(1.15); }
        input::placeholder { color:#1E3A50; }
        input:focus { outline:none; }
      `}</style>

      {/* ── Header (draggable region for the frameless window) ── */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16,
        paddingBottom:14, borderBottom:`1px solid ${C.border}`, WebkitAppRegion:"drag" }}>
        <Ghost size={34} color={C.blue} spin/>
        <div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:700,
            letterSpacing:"0.14em", color:C.text, lineHeight:1 }}>GHOST COMPANION</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9,
            letterSpacing:"0.22em", color:C.sub, marginTop:2 }}>LOOT ACQUISITION SYSTEM · MULTI-PATH</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:5, height:5, borderRadius:"50%",
              background: auth.loggedIn ? C.green : C.muted, animation:"pulse 2s ease infinite" }}/>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, letterSpacing:"0.18em", color:C.sub }}>
              {auth.loggedIn ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          {/* Account toggle (was the API-key button) */}
          <button onClick={() => setShowAccount(s => !s)} style={{
            background:"none", border:`1px solid ${showAccount ? C.orange : C.muted}`,
            color: showAccount ? C.orange : C.muted, padding:"3px 8px", cursor:"pointer",
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.14em",
            WebkitAppRegion:"no-drag" }}>
            {auth.loggedIn ? "ACCT ◆" : "ACCT ○"}
          </button>
        </div>
      </div>

      {/* ── Account ── */}
      {showAccount && (
        <Account auth={auth} busy={authBusy} onLogin={handleLogin} onLogout={handleLogout}
          apiUrl={apiUrl} onSaveApiUrl={saveApiUrl}/>
      )}

      {/* ── Xûr (live exotic stock from the data API; only shown when present) ── */}
      <XurPanel data={xurData} onScan={(name) => scan(name)}/>

      {/* ── Path type legend ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 }}>
        {Object.entries(PATH_TYPE).slice(0,4).map(([k,v]) => (
          <div key={k} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ color:v.color, fontSize:10 }}>{v.icon}</span>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.muted, letterSpacing:"0.1em" }}>{v.label}</span>
          </div>
        ))}
      </div>

      {/* ── Search ── */}
      <div style={{ position:"relative", marginBottom:16 }}>
        <Panel bc={scanning ? C.blue : C.orange} style={{ padding:"12px 14px", overflow:"hidden" }}>
          {scanning && (
            <div style={{ position:"absolute", left:0, right:0, height:2, pointerEvents:"none",
              background:`linear-gradient(90deg,transparent,${C.blue}AA,${C.blue},${C.blue}AA,transparent)`,
              animation:"scanBeam 1.4s ease-in-out infinite" }}/>
          )}
          <Lbl color={scanning ? C.blue : C.sub} mb={5}>{scanning ? "SEARCHING MANIFEST..." : "ITEM DESIGNATION"}</Lbl>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key==="Enter" && scan()}
              placeholder="Name or itemHash — e.g. Touch of Malice, 2575506895"
              style={{ flex:1, background:"transparent", border:"none", color:C.text,
                fontFamily:"'Barlow Condensed',sans-serif", fontSize:17, fontWeight:500, letterSpacing:"0.04em" }}/>
            <button onClick={scan} disabled={scanning} style={{ background:scanning ? C.muted : C.orange,
              border:"none", color:scanning ? C.sub : "#fff",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.14em", padding:"8px 12px", cursor:scanning ? "default" : "pointer", flexShrink:0 }}>
              {scanning ? "SCANNING" : "SCAN"}
            </button>
          </div>
        </Panel>
      </div>

      {/* ── Error ── */}
      {error && (
        <Panel bc={C.red} style={{ marginBottom:14, animation:"fadeUp 0.4s ease" }}>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <Ghost size={18} color={C.red}/>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, color:C.red, letterSpacing:"0.06em" }}>{error}</span>
          </div>
        </Panel>
      )}

      {/* ── Empty state ── */}
      {!itemData && !scanning && !error && (
        <div style={{ textAlign:"center", padding:"50px 20px", animation:"fadeUp 0.5s ease" }}>
          <Ghost size={52} color={C.muted}/>
          <div style={{ marginTop:14, fontFamily:"'Barlow Condensed',sans-serif", fontSize:12,
            color:C.muted, letterSpacing:"0.16em", lineHeight:1.8 }}>
            ENTER AN ITEM NAME TO SEARCH<br/>THE DESTINY 2 MANIFEST
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {itemData && (
        <div style={{ animation:"fadeUp 0.4s ease" }}>
          {/* Item header */}
          <Panel bc={itemRar.color} style={{ marginBottom:10, background:`linear-gradient(135deg,${C.panel} 70%,${itemRar.bg}60)` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
              <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                {itemData.icon && (
                  <img src={itemData.icon} alt="" width={42} height={42}
                    style={{ border:`1px solid ${itemRar.color}`, flexShrink:0 }}/>
                )}
                <div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:700,
                    color:itemRar.color, letterSpacing:"0.06em", textTransform:"uppercase", lineHeight:1 }}>
                    {itemData.itemName}
                  </div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.14em", marginTop:3 }}>
                    {itemData.rarity?.toUpperCase()} · {itemData.type?.toUpperCase()}
                  </div>
                </div>
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.blue,
                letterSpacing:"0.08em", textAlign:"right", flexShrink:0 }}>
                {itemData.acquisitionPaths?.length || 0} PATH{itemData.acquisitionPaths?.length !== 1 ? "S" : ""} FOUND
              </div>
            </div>
            {itemData.description && (
              <div style={{ marginTop:10, fontSize:12, color:C.sub, fontStyle:"italic", lineHeight:1.6,
                borderLeft:`2px solid ${C.border}`, paddingLeft:10 }}>
                {itemData.description}
              </div>
            )}
            {itemData.sourceActivity && (
              <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8 }}>
                <div style={{ width:5, height:5, background:C.blue, transform:"rotate(45deg)", flexShrink:0 }}/>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.blue, letterSpacing:"0.12em" }}>
                  SOURCE: {itemData.sourceActivity?.toUpperCase()}
                </span>
              </div>
            )}
          </Panel>

          {/* Auto-track + add-path controls */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <button onClick={toggleTrack} disabled={!itemData.acquisitionPaths?.length} title={
              itemData.acquisitionPaths?.length ? "" : "Add a path with a source activity first"
            } style={{ flex:1, padding:"9px 0",
              background:isTracked ? C.greenLo : C.muted,
              border:`1px solid ${isTracked ? C.green : C.border}`,
              color:isTracked ? C.green : (itemData.acquisitionPaths?.length ? C.sub : C.muted),
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.14em", cursor:itemData.acquisitionPaths?.length ? "pointer" : "default" }}>
              {isTracked ? "◆  AUTO-TRACKING  ◆" : "ENABLE AUTO-TRACK"}
            </button>
            <button onClick={() => setShowAdd(s => !s)} style={{ flex:1, padding:"9px 0",
              background:showAdd ? C.orangeLo : C.muted,
              border:`1px solid ${showAdd ? C.orange : C.border}`,
              color:showAdd ? C.orange : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
              fontSize:11, fontWeight:700, letterSpacing:"0.14em", cursor:"pointer" }}>
              {showAdd ? "CANCEL" : "+ ADD PATH"}
            </button>
          </div>

          {showAdd && (
            <AddPathForm onSave={saveCustomPath} onCancel={() => setShowAdd(false)}/>
          )}

          {/* Prerequisites */}
          {itemData.prerequisites?.length > 0 && (
            <Panel bc={C.gold} style={{ marginBottom:10 }}>
              <Lbl color={C.gold}>Prerequisites</Lbl>
              {itemData.prerequisites.map((req,i) => (
                <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:i<itemData.prerequisites.length-1?5:0 }}>
                  <span style={{ color:C.gold, fontSize:9, marginTop:3, flexShrink:0 }}>◆</span>
                  <span style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{req}</span>
                </div>
              ))}
            </Panel>
          )}

          {/* Combined summary */}
          {(itemData.acquisitionPaths?.length > 1 || Object.values(pathRuns).some(r=>r>0)) && (
            <CombinedSummary
              paths={itemData.acquisitionPaths || []}
              pathRuns={pathRuns}
              acquired={acquired}
              onAcquired={setAcquired}
            />
          )}

          {/* Path cards */}
          {itemData.acquisitionPaths?.map((path,i) => (
            <PathCard
              key={path.id || i}
              path={{ ...path, id: path.id || `path_${i}` }}
              runs={pathRuns[path.id || `path_${i}`] || 0}
              onAdd={() => addRun(path.id || `path_${i}`)}
              onSub={() => subRun(path.id || `path_${i}`)}
              isBest={best === (path.id || `path_${i}`)}
            />
          ))}

          {itemData.acquisitionPaths?.length === 1 && (
            <button onClick={() => setAcquired(a => !a)} style={{ width:"100%", padding:"9px 0", marginBottom:10,
              background:acquired ? C.greenLo : C.muted, border:`1px solid ${acquired ? C.green : C.border}`,
              color:acquired ? C.green : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
              fontSize:11, fontWeight:700, letterSpacing:"0.16em", cursor:"pointer" }}>
              {acquired ? "◆  ITEM ACQUIRED  ◆" : "MARK AS ACQUIRED"}
            </button>
          )}

          {/* Tips */}
          {itemData.tips?.length > 0 && (
            <Panel bc={C.blue} style={{ marginBottom:10 }}>
              <Lbl color={C.blue}>Ghost Recommendations</Lbl>
              {itemData.tips.map((tip,i) => (
                <div key={i} style={{ display:"flex", gap:8, marginBottom:i<itemData.tips.length-1?8:0, alignItems:"flex-start" }}>
                  <div style={{ marginTop:1, flexShrink:0 }}><Ghost size={14} color={C.blue}/></div>
                  <span style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{tip}</span>
                </div>
              ))}
            </Panel>
          )}

          <div style={{ textAlign:"center", fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:9, color:C.muted, letterSpacing:"0.14em", padding:"6px 0 16px" }}>
            DATA SOURCE · {itemData.lastVerified || "MANIFEST"}
          </div>
        </div>
      )}
    </div>
  );
}
