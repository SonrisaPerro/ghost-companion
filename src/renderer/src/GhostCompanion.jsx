import { useState, useEffect, useRef, useCallback, useMemo } from "react";
// Community acquisition data (drop rates, paths, steps). The Manifest gives us
// the canonical item identity; dropRates.json supplies the farming metadata.
import dropRates from "../../data/dropRates.json";
import { C, inputStyle } from "./theme";
import { Panel, Lbl, Badge, Chip, Ghost, Diamond } from "./components/primitives";
import { XurSection, BansheeSection, EververseSection } from "./components/VendorPanels";
import { WeaponPerksPanel } from "./components/WeaponPerksPanel";
import { GuidesPanel, Guides } from "./components/GuidePanels";
import { ThisWeekPanel } from "./components/ThisWeekPanel";
import { costColor, formatQty } from "./format";

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

// Recognisable example searches for the empty state — gives a first-time user a
// one-tap way to see what a scan looks like instead of a blank prompt.
const QUICK_SCANS = ["Touch of Malice", "Thorn", "Gjallarhorn", "Vex Mythoclast", "The Last Word"];

/* ── Math ─────────────────────────────────────────────────────────── */
const probN    = (rate,runs) => runs > 0 ? (1 - Math.pow(1 - Math.max(0.001,rate), runs)) * 100 : 0;

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
// Brackets / Panel / Lbl / Badge / Chip / Ghost / Diamond moved to
// ./components/primitives.jsx (imported above).

// CommunityLibrary, CreateGuideForm, GuidesPanel, Guides → ./components/GuidePanels.jsx
// ThisWeekPanel + helpers → ./components/ThisWeekPanel.jsx

/* ── Account panel (Bungie OAuth via main process) ────────────────────
   Replaces the old Anthropic API-key Settings panel: we no longer call an LLM,
   but we DO need a Bungie session for auto-tracking. */
function Account({ auth, busy, onLogin, onLogout, apiUrl, onSaveApiUrl,
  notifyEnabled, onToggleNotifications }) {
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

      {/* Desktop notifications — tracked items/ornaments + weekly reset. */}
      <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
        <Lbl color={C.sub}>Desktop Notifications</Lbl>
        <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginBottom:8 }}>
          Alerts when a tracked ornament hits Tess' shop, a tracked item enters Xûr's
          stock, or the Tuesday weekly reset lands.
        </div>
        <button onClick={onToggleNotifications} style={{
          background:notifyEnabled ? C.greenLo : C.muted,
          border:`1px solid ${notifyEnabled ? C.green : C.border}`,
          color:notifyEnabled ? C.green : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:11, fontWeight:700, letterSpacing:"0.12em", padding:"6px 12px",
          cursor:"pointer", WebkitAppRegion:"no-drag" }}>
          {notifyEnabled ? "◆  NOTIFICATIONS ON" : "NOTIFICATIONS OFF"}
        </button>
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
              <button onClick={onSub} title="Remove one run" aria-label="Remove one run" style={{ width:34, height:34, background:C.muted, border:`1px solid ${C.border}`,
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
              <button onClick={onAdd} title="Log one run" aria-label="Log one run" style={{ width:34, height:34, background:ptype.bg, border:`1px solid ${ptype.color}`,
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

/* ── New Hunt confirmation — two-step reset so no accidental wipe ─── */
function ResetConfirm({ onReset }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} style={{ width:"100%", padding:"7px 0", marginTop:6,
        background:"none", border:`1px solid ${C.muted}`, color:C.sub,
        fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
        letterSpacing:"0.14em", cursor:"pointer" }}>
        NEW HUNT — RESET RUNS
      </button>
    );
  }
  return (
    <div style={{ display:"flex", gap:6, marginTop:6 }}>
      <button onClick={onReset} style={{ flex:1, padding:"7px 0",
        background:C.redLo, border:`1px solid ${C.red}`, color:C.red,
        fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
        letterSpacing:"0.14em", cursor:"pointer" }}>
        CONFIRM RESET
      </button>
      <button onClick={() => setArmed(false)} style={{ flex:1, padding:"7px 0",
        background:"none", border:`1px solid ${C.border}`, color:C.sub,
        fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
        letterSpacing:"0.14em", cursor:"pointer" }}>
        CANCEL
      </button>
    </div>
  );
}

/* ── Combined summary ─────────────────────────────────────────────── */
function CombinedSummary({ paths, pathRuns, acquired, onAcquired, onResetHunt }) {
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
      {acquired && onResetHunt && <ResetConfirm onReset={onResetHunt}/>}
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
    collectibleHash: hit.collectibleHash || null,
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

// XurSection / BansheeSection / EververseSection → ./components/VendorPanels.jsx


/* ── Ornaments-on-card panel ──────────────────────────────────────────
   On a scanned weapon, lists its Eververse-sourced ornaments with a "track
   any?" checklist. Tracking an ornament persists it locally (electron-store)
   so it lights up the Eververse panel whenever it rotates into Tess' shop.
   Self-hides when the weapon has no Eververse ornaments (incl. non-weapons). */
function OrnamentsPanel({ ornaments, trackedSet, shopCostByHash, live, onToggle }) {
  const evv = (ornaments || []).filter((o) => o.eververse);
  if (!evv.length) return null;
  return (
    <Panel bc={C.purple} style={{ marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <Lbl color={C.purple} mb={0}>Eververse Ornaments · Track For Shop Alerts</Lbl>
        <Badge label={`${evv.length}`} color={C.purple} bg={C.purpleLo}/>
      </div>
      <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginBottom:10 }}>
        These ornaments only sell at Eververse. Track any and the Ghost will surface them
        at the top whenever they're in Tess' shop.
      </div>
      {evv.map((o) => {
        const tracked = trackedSet.has(o.itemHash);
        const cost = live ? shopCostByHash.get(o.itemHash) : null;
        const inShop = !!cost;
        const c0 = (cost || [])[0];
        const col = costColor(c0?.kind);
        return (
          <div key={o.itemHash} onClick={() => onToggle(o)} title={tracked ? "Stop tracking" : "Track this ornament"}
            style={{ display:"flex", alignItems:"center", gap:9, padding:"6px 0", cursor:"pointer",
              borderBottom:`1px solid ${C.muted}` }}
            onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
            onMouseLeave={e => e.currentTarget.style.opacity = 1}>
            <div style={{ width:20, height:20, flexShrink:0,
              background: tracked ? C.purpleLo : C.muted,
              border:`1px solid ${tracked ? C.purple : C.border}`,
              color:C.purple, fontFamily:"'Barlow Condensed',sans-serif", fontSize:12,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {tracked ? "✓" : ""}
            </div>
            {o.icon
              ? <img src={o.icon} alt="" width={26} height={26} style={{ border:`1px solid ${C.purple}`, flexShrink:0 }}/>
              : <div style={{ width:26, height:26, background:C.purpleLo, border:`1px solid ${C.purple}`, flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, color:C.purple }}>◈</div>}
            <div style={{ minWidth:0, flex:1 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                color:C.text, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {o.name}
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
                {tracked ? "TRACKED" : "TAP TO TRACK"} · EVERVERSE
              </div>
            </div>
            {inShop && (
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <Badge label="IN SHOP" color={C.green} bg={C.greenLo}/>
                {c0 && (
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
                    color:col, letterSpacing:"0.06em", marginTop:3 }}>
                    {formatQty(c0.quantity)} {(c0.name || "").toUpperCase()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

/* ── Deep links out (light.gg / DIM / Bungie) ─────────────────────────
   A small row of external links for the on-screen item. Opens in the user's
   default browser via the main process (http(s)-only). DIM needs a Bungie
   membership context, so we use its armory route which works from an itemHash. */
function DeepLinks({ itemHash }) {
  if (!itemHash) return null;
  const links = [
    { label: "light.gg", color: C.gold,
      url: `https://www.light.gg/db/items/${itemHash}/` },
    { label: "DIM", color: C.blue,
      url: `https://app.destinyitemmanager.com/armory/${itemHash}` },
    { label: "Bungie", color: C.purple,
      url: `https://www.bungie.net/7/en/Destiny/Items?itemHash=${itemHash}` },
  ];
  const open = (url) => window.api?.openExternal?.(url);
  return (
    <div style={{ display:"flex", gap:8, marginBottom:10 }}>
      {links.map((l) => (
        <button key={l.label} onClick={() => open(l.url)} title={`Open in ${l.label}`}
          style={{ flex:1, padding:"7px 0", background:C.muted, border:`1px solid ${l.color}`,
            color:l.color, fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
            letterSpacing:"0.1em", cursor:"pointer" }}>
          {l.label.toUpperCase()} ↗
        </button>
      ))}
    </div>
  );
}

/* ── Guides / secret-chest walkthroughs for the on-screen item ────────

// WeaponPerksPanel moved to ./components/WeaponPerksPanel.jsx (imported above).

/* ── My Hunts panel (empty-state farming queue) ───────────────────── */
function MyHuntsPanel({ items, allRunCounts, userRates, communityRates, onScan }) {
  return (
    <Panel bc={C.border} style={{ marginBottom:14, animation:"fadeUp 0.4s ease" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <Lbl color={C.sub} mb={0}>My Hunts</Lbl>
        <Badge label={`${items.length} ACTIVE`} color={C.sub} bg={C.muted}/>
      </div>
      {items.map((item, idx) => {
        const entry =
          userRates[String(item.itemHash)] ||
          communityRates[String(item.itemHash)] ||
          communityRates[item.name] ||
          dropRates[String(item.itemHash)] ||
          dropRates[item.name];
        const catalogPaths = (entry?.acquisitionPaths || []).map((p, i) => ({ ...p, id: p.id || `path_${i}` }));
        const pathRuns = {};
        let totalRuns = 0;
        for (const p of (item.paths || [])) {
          const n = allRunCounts[`${item.name}::${p.id}`] || 0;
          pathRuns[p.id] = n;
          totalRuns += n;
        }
        const prob = catalogPaths.length && totalRuns > 0
          ? combinedProb(catalogPaths, pathRuns)
          : null;
        const probCol = prob == null ? C.muted
          : prob >= 80 ? C.red : prob >= 55 ? C.gold : C.blue;
        return (
          <div key={item.itemHash} onClick={() => onScan(item.name)}
            title={`Scan ${item.name}`}
            style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px 0", cursor:"pointer", WebkitAppRegion:"no-drag",
              borderTop:`1px solid ${C.border}`,
              marginTop: idx === 0 ? 0 : 0 }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.72"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            {item.icon
              ? <img src={item.icon} alt="" width={32} height={32}
                  style={{ border:`1px solid ${C.border}`, flexShrink:0 }}/>
              : <div style={{ width:32, height:32, background:C.muted, flexShrink:0 }}/>}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                color:C.text, letterSpacing:"0.04em",
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {item.name}
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9,
                color:C.sub, letterSpacing:"0.1em", marginTop:1 }}>
                {totalRuns} RUN{totalRuns !== 1 ? "S" : ""} LOGGED
              </div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              {prob != null ? (
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:18,
                  fontWeight:700, color:probCol, lineHeight:1 }}>
                  {prob.toFixed(1)}<span style={{ fontSize:10, opacity:0.7 }}>%</span>
                </div>
              ) : (
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif",
                  fontSize:9, color:C.muted, letterSpacing:"0.1em" }}>
                  {totalRuns === 0 ? "NO RUNS YET" : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

/* ── Tab navigation bar ───────────────────────────────────────────── */
function TabBar({ active, onSelect, weekBadge, guideCount }) {
  const tabs = [
    { id:"scan",   label:"SCAN",   color:C.orange },
    { id:"week",   label:"WEEK",   color:C.blue,   badge:weekBadge },
    { id:"guides", label:"GUIDES", color:C.gold,   count:guideCount },
    { id:"acct",   label:"ACCT",   color:C.sub },
  ];
  return (
    <div style={{ display:"flex", marginBottom:14 }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} style={{
            flex:1, padding:"8px 0", background:"none", border:"none",
            borderBottom:`2px solid ${on ? t.color : C.border}`,
            color: on ? t.color : C.sub, cursor:"pointer", position:"relative",
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
            letterSpacing:"0.14em", WebkitAppRegion:"no-drag" }}>
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft:4, fontSize:8, color: on ? t.color : C.muted }}>{t.count}</span>
            )}
            {t.badge && !t.count && (
              <span style={{ position:"absolute", top:5, right:"18%", width:5, height:5,
                borderRadius:"50%", background:t.color }}/>
            )}
          </button>
        );
      })}
    </div>
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
  const [activeTab,   setActiveTab]   = useState("scan"); // 'scan' | 'week' | 'guides' | 'acct'

  // Overlay window controls (frameless window — its own pin/tray buttons).
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  // User-authored acquisition data (merged over bundled dropRates.json) and
  // whether the on-screen item is registered for auto-tracking.
  const [userRates,   setUserRates]   = useState({});
  const [isTracked,   setIsTracked]   = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);

  // Eververse ornaments: the on-screen weapon's ornaments (fetched per scan) and
  // the user's persisted set of tracked ornaments (drives the shop-alert merge).
  const [weaponOrnaments,  setWeaponOrnaments]  = useState([]);
  const [trackedOrnaments, setTrackedOrnaments] = useState([]);
  // Persisted tracked farm items (drives the WEEK tab's "chase weapons" join).
  const [trackedItems,     setTrackedItems]     = useState([]);

  // Factual catalyst + per-column perk pool for the on-screen weapon (per scan).
  const [weaponPerks,      setWeaponPerks]      = useState(null);
  // Live Triumph-record progress (catalyst % + pattern x/N), keyed by recordHash.
  const [recordProgress,   setRecordProgress]   = useState({});

  // Collection ownership: a Set of owned collectibleHashes (from Bungie, when
  // logged in) so item cards can show a COLLECTED / MISSING badge.
  const [ownedHashes,      setOwnedHashes]      = useState(() => new Set());
  // Guide / secret-chest packages (loaded from the local store).
  const [guides,           setGuides]           = useState([]);
  // Desktop notifications master toggle.
  const [notifyEnabled,    setNotifyEnabled]    = useState(true);
  // All persisted run counts (keyed "itemName::pathId") — drives the My Hunts panel.
  const [allRunCounts,     setAllRunCounts]     = useState({});

  // Remote data (from the Railway data API): community paths + Xûr live stock.
  const [communityRates, setCommunityRates] = useState({});
  const [xurData,        setXurData]        = useState(null);
  const [eververseData,  setEververseData]  = useState(null);
  const [weeklyData,     setWeeklyData]     = useState(null);
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
  useEffect(() => { window.api?.getWeekly?.().then(setWeeklyData).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getEververse?.().then(setEververseData).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getDataApiUrl?.().then(v => setApiUrl(v || "")).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getAlwaysOnTop?.().then(v => setAlwaysOnTop(v !== false)).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getTrackedOrnaments?.().then(v => setTrackedOrnaments(v || [])).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getTrackedItems?.().then(v => setTrackedItems(v || [])).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getGuides?.().then(v => setGuides(v || [])).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getNotificationsEnabled?.().then(v => setNotifyEnabled(v !== false)).catch(()=>{}); }, []);
  useEffect(() => { window.api?.getRunCounts?.().then(v => setAllRunCounts(v || {})).catch(()=>{}); }, []);

  // Load collection ownership whenever auth state flips to logged-in (cached
  // first for instant paint, then a live refresh). No-op when logged out.
  useEffect(() => {
    if (!auth.loggedIn || !window.api?.getCollectionStatus) return;
    let alive = true;
    window.api.getCollectionStatus({ force: false })
      .then(res => { if (alive && res?.hashes) setOwnedHashes(new Set(res.hashes)); })
      .catch(()=>{});
    window.api.getCollectionStatus({ force: true })
      .then(res => { if (alive && res?.hashes) setOwnedHashes(new Set(res.hashes)); })
      .catch(()=>{});
    return () => { alive = false; };
  }, [auth.loggedIn]);

  // Flip always-on-top (main persists it; reflect the authoritative new value).
  const togglePin = useCallback(async () => {
    try { setAlwaysOnTop(await window.api.toggleAlwaysOnTop()); } catch {/* ignore */}
  }, []);

  // Add/remove an Eververse ornament from the persisted tracked set. We store a
  // small descriptor (not just the hash) so the Eververse merge can render the
  // ornament's name/weapon even when its weapon card isn't currently on screen.
  const toggleOrnamentTrack = useCallback(async (orn) => {
    const cur = itemRef.current;
    const list = (await window.api.getTrackedOrnaments()) || [];
    const exists = list.some(t => t.itemHash === orn.itemHash);
    const next = exists
      ? list.filter(t => t.itemHash !== orn.itemHash)
      : [...list, {
          itemHash: orn.itemHash,
          name: orn.name,
          icon: orn.icon || null,
          weapon: cur?.itemName || null,
          weaponHash: cur?.itemHash || null,
          source: orn.source || "Eververse",
          plugCategory: orn.plugCategory || null,
        }];
    setTrackedOrnaments(await window.api.setTrackedOrnaments(next));
  }, []);

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
      setAllRunCounts(c => {
        const key = `${cur.itemName}::${payload.pathId}`;
        return { ...c, [key]: payload.newCount ?? ((c[key] || 0) + 1) };
      });
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
    const v = (r[id] || 0) + 1;
    persistCount(id, v);
    if (itemRef.current) setAllRunCounts(c => ({ ...c, [`${itemRef.current.itemName}::${id}`]: v }));
    return { ...r, [id]: v };
  });
  const subRun = (id) => setPathRuns(r => {
    const v = Math.max(0, (r[id] || 0) - 1);
    persistCount(id, v);
    if (itemRef.current) setAllRunCounts(c => ({ ...c, [`${itemRef.current.itemName}::${id}`]: v }));
    return { ...r, [id]: v };
  });
  // Zeros out all path run counts and un-marks acquired — starts a fresh hunt.
  const resetHunt = useCallback(() => {
    const cur = itemRef.current;
    if (!cur) return;
    const zeroed = {};
    const countUpdates = {};
    for (const p of (cur.acquisitionPaths || [])) {
      zeroed[p.id] = 0;
      persistCount(p.id, 0);
      countUpdates[`${cur.itemName}::${p.id}`] = 0;
    }
    setPathRuns(zeroed);
    setAllRunCounts(c => ({ ...c, ...countUpdates }));
    setAcquired(false);
  }, [persistCount]);

  // ── Auth actions ────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setAuthBusy(true); setError(null);
    try { setAuth(await window.api.login()); setActiveTab("scan"); }
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
    setWeaponOrnaments([]);
    setWeaponPerks(null);

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

      // Walk the weapon's Eververse ornaments (empty for non-weapons → panel hides).
      window.api?.getWeaponOrnaments?.(hit.itemHash)
        .then(o => setWeaponOrnaments(o || []))
        .catch(() => setWeaponOrnaments([]));

      // Walk the weapon's catalyst + perk pool (null/empty for non-weapons → panel hides).
      // Then pull LIVE record progress for its catalyst + pattern (no-op when logged out).
      window.api?.getWeaponPerks?.(hit.itemHash)
        .then(p => {
          setWeaponPerks(p || null);
          const hashes = [p?.catalyst?.recordHash, p?.pattern?.recordHash].filter(Boolean);
          if (hashes.length) {
            window.api?.getRecordProgress?.({ hashes })
              .then(r => setRecordProgress(r?.records || {}))
              .catch(() => setRecordProgress({}));
          } else setRecordProgress({});
        })
        .catch(() => { setWeaponPerks(null); setRecordProgress({}); });

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

  // ── IPC: a clicked desktop notification asks us to scan an item ─────────
  useEffect(() => {
    if (!window.api?.onNotificationScan) return;
    const unsubscribe = window.api.onNotificationScan((q) => {
      if (typeof q === "string" && q.trim()) { setActiveTab("scan"); scan(q.trim()); }
    });
    return unsubscribe;
  }, [scan]);

  // ── Notifications master toggle ─────────────────────────────────────────
  const toggleNotifications = useCallback(async () => {
    try {
      const next = !notifyEnabled;
      setNotifyEnabled(next);
      await window.api?.setNotificationsEnabled?.(next);
    } catch {/* ignore */}
  }, [notifyEnabled]);

  // ── Guide / secret-chest package management ─────────────────────────────
  const importGuideFile = useCallback(async () => {
    try {
      const res = await window.api?.importGuideFile?.();
      if (res?.ok) {
        setGuides((await window.api.getGuides()) || []);
        setError(null);
      } else if (res && res.message) {
        setError(`Import failed: ${res.message}`);
      }
    } catch (e) { setError(`Import failed: ${e.message}`); }
  }, []);
  const importGuideText = useCallback(async (text) => {
    try {
      const res = await window.api?.importGuideText?.(text);
      if (res?.ok) { setGuides((await window.api.getGuides()) || []); setError(null); }
      else if (res && res.message) setError(`Import failed: ${res.message}`);
      return res;
    } catch (e) { setError(`Import failed: ${e.message}`); return { ok:false }; }
  }, []);
  const exportGuides = useCallback(async () => {
    try { await window.api?.exportGuides?.(); } catch {/* ignore */}
  }, []);
  const deleteGuide = useCallback(async (id) => {
    try { setGuides((await window.api?.deleteGuide?.(id)) || []); } catch {/* ignore */}
  }, []);

  // Community library: browse the curated index + one-click import (re-import
  // updates via id merge). Refresh the local guide list after a successful pull.
  const browseLibrary = useCallback(async () => {
    try { return await window.api?.getCommunityGuides?.(); }
    catch { return { count:0, packages:[] }; }
  }, []);
  const importCommunityGuide = useCallback(async (id) => {
    try {
      const r = await window.api?.importCommunityGuide?.(id);
      if (r?.ok) setGuides((await window.api.getGuides()) || []);
      return r;
    } catch (e) { return { ok:false, message:e.message }; }
  }, []);
  // Create a guide in-app, then refresh the local list.
  const createGuide = useCallback(async (guide) => {
    try {
      const r = await window.api?.addGuide?.(guide);
      if (r?.ok) setGuides((await window.api.getGuides()) || []);
      return r;
    } catch (e) { return { ok:false, message:e.message }; }
  }, []);

  // Drag a .ghostpkg.json / .json onto the window to import it.
  const [dragOver, setDragOver] = useState(false);
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e) => {
    // Only clear when the pointer actually leaves the window, not a child.
    if (e.relatedTarget === null) setDragOver(false);
  }, []);
  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.(ghostpkg(\.json)?|json)$/i.test(file.name)) {
      setError("Drop a .ghostpkg.json guide package.");
      return;
    }
    // Cheap pre-read guard so a giant dropped file is rejected before we slurp
    // it into memory (the main process re-checks the byte cap authoritatively).
    if (file.size > 512 * 1024) {
      setError("That file is too large to be a guide package.");
      return;
    }
    try { await importGuideText(await file.text()); }
    catch (err) { setError(`Import failed: ${err.message}`); }
  }, [importGuideText]);

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
    setTrackedItems(next); // keep the WEEK-tab chase join in sync
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
    window.api.getEververse?.({ force: true }).then(setEververseData).catch(()=>{});
    window.api.getWeekly?.({ force: true }).then(setWeeklyData).catch(()=>{});
  }, []);

  // Live shop state derived once from the Eververse payload. `shopCostByHash` maps
  // EVERY current sale (server's additive `shopSales`) to its cost, so we can match
  // the user's own tracked ornaments — not just the curated registry — against the
  // shop. Falls back to the curated `inShop` costs if an older server omits shopSales.
  const eververseLive = eververseData?.source === "live";
  const shopCostByHash = useMemo(() => {
    const m = new Map();
    for (const s of eververseData?.shopSales || []) m.set(s.itemHash, s.cost);
    for (const o of eververseData?.inShop || []) if (!m.has(o.itemHash)) m.set(o.itemHash, o.cost);
    return m;
  }, [eververseData]);

  // The list the Eververse panel renders: server-curated in-shop ornaments merged
  // with the user's tracked ornaments that match a live sale (dedupe by itemHash).
  const eververseInShop = useMemo(() => {
    if (!eververseLive) return [];
    const map = new Map();
    for (const o of eververseData?.inShop || []) map.set(o.itemHash, o);
    for (const t of trackedOrnaments) {
      if (map.has(t.itemHash)) continue;
      const cost = shopCostByHash.get(t.itemHash);
      if (cost) map.set(t.itemHash, { ...t, cost });
    }
    return [...map.values()];
  }, [eververseLive, eververseData, trackedOrnaments, shopCostByHash]);

  const trackedOrnamentSet = useMemo(
    () => new Set(trackedOrnaments.map(t => t.itemHash)), [trackedOrnaments]);
  // Names of tracked farm items, for the WEEK-tab featured-activity join.
  const trackedItemNames = useMemo(
    () => new Set(trackedItems.map(t => t.name || t.key).filter(Boolean)), [trackedItems]);

  const best    = itemData ? bestPathId(itemData.acquisitionPaths) : null;
  const itemRar = rar(itemData?.rarity);

  // Ownership of the on-screen item: known only when logged in AND the item has a
  // collectible. `null` → unknown (don't show a badge); true/false → COLLECTED/MISSING.
  const owned = useMemo(() => {
    if (!auth.loggedIn || !itemData?.collectibleHash) return null;
    return ownedHashes.has(itemData.collectibleHash >>> 0);
  }, [auth.loggedIn, itemData, ownedHashes]);

  // Guides whose itemHash matches the on-screen item (surface on its card).
  const itemGuides = useMemo(() => {
    if (!itemData?.itemHash || !guides.length) return [];
    return guides.filter(g => Number(g.itemHash) === Number(itemData.itemHash));
  }, [itemData, guides]);

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{ fontFamily:"'Barlow',sans-serif", background:C.bg, minHeight:"100vh",
      padding:16, color:C.text, maxWidth:520, margin:"0 auto",
      outline:dragOver ? `2px dashed ${C.blue}` : "none", outlineOffset:-6 }}>
      {dragOver && (
        <div style={{ position:"fixed", inset:0, zIndex:50, pointerEvents:"none",
          display:"flex", alignItems:"center", justifyContent:"center",
          background:"rgba(5,8,15,0.82)" }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700,
            color:C.blue, letterSpacing:"0.14em", border:`1px dashed ${C.blue}`, padding:"16px 24px" }}>
            DROP GUIDE PACKAGE TO IMPORT
          </div>
        </div>
      )}
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
        .hunt-strip::-webkit-scrollbar { display:none; }
      `}</style>

      {/* ── Header (draggable region for the frameless window) ── */}
      {/* Wraps: at the locked sidebar width the button cluster drops to its own
          row (right-aligned) instead of clipping — robust as more buttons land. */}
      <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:12, rowGap:10, marginBottom:16,
        paddingBottom:14, borderBottom:`1px solid ${C.border}`, WebkitAppRegion:"drag" }}>
        <Ghost size={34} color={C.blue} spin/>
        <div style={{ flex:"1 1 auto", minWidth:0 }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:700,
            letterSpacing:"0.14em", color:C.text, lineHeight:1 }}>GHOST COMPANION</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9,
            letterSpacing:"0.22em", color:C.sub, marginTop:2 }}>LOOT ACQUISITION SYSTEM · MULTI-PATH</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", justifyContent:"flex-end",
          flexWrap:"wrap", gap:8, rowGap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}
            title={auth.loggedIn
              ? `Signed in as ${auth.displayName || "Guardian"} — auto-tracking active`
              : "Not signed in — searching still works; sign in to auto-track runs"}>
            <div style={{ width:5, height:5, borderRadius:"50%",
              background: auth.loggedIn ? C.green : C.muted, animation:"pulse 2s ease infinite" }}/>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, letterSpacing:"0.18em", color:C.sub }}>
              {auth.loggedIn ? "BUNGIE" : "GUEST"}
            </span>
          </div>
          {/* Always-on-top pin toggle (keeps the overlay above the game). */}
          <button onClick={togglePin} title={alwaysOnTop ? "Unpin (allow other windows on top)" : "Pin always-on-top"} style={{
            background:"none", border:`1px solid ${alwaysOnTop ? C.gold : C.muted}`,
            color: alwaysOnTop ? C.gold : C.muted, padding:"3px 8px", cursor:"pointer",
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.14em",
            WebkitAppRegion:"no-drag" }}>
            {alwaysOnTop ? "PIN ◆" : "PIN ○"}
          </button>
          {/* Hide the overlay to the system tray (tray icon / menu restores it). */}
          <button onClick={() => window.api?.hideWindow?.()} title="Hide to tray" style={{
            background:"none", border:`1px solid ${C.muted}`,
            color:C.muted, padding:"3px 8px", cursor:"pointer",
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.14em",
            WebkitAppRegion:"no-drag" }}>
            TRAY ▾
          </button>
        </div>
      </div>

      {/* ── Tab navigation ── */}
      <TabBar
        active={activeTab}
        onSelect={setActiveTab}
        weekBadge={(xurData?.source === "live" && xurData?.xur?.present) || eververseInShop.length > 0}
        guideCount={guides.length}
      />

      {/* ── WEEK tab ── */}
      {activeTab === "week" && (
        <ThisWeekPanel data={weeklyData} onScan={(name) => scan(name)} trackedNames={trackedItemNames}
          apiUrl={apiUrl} onOpenAccount={() => setActiveTab("acct")}
          onRefresh={() => window.api.getWeekly?.({ force: true }).then(setWeeklyData).catch(()=>{})}/>
      )}

      {/* ── GUIDES tab ── */}
      {activeTab === "guides" && (
        <Guides guides={guides} onImportGuideFile={importGuideFile}
          onExportGuides={exportGuides} onDeleteGuide={deleteGuide}
          onBrowseLibrary={browseLibrary} onImportCommunityGuide={importCommunityGuide}
          onCreateGuide={createGuide}/>
      )}

      {/* ── ACCT tab ── */}
      {activeTab === "acct" && (
        <Account auth={auth} busy={authBusy} onLogin={handleLogin} onLogout={handleLogout}
          apiUrl={apiUrl} onSaveApiUrl={saveApiUrl}
          notifyEnabled={notifyEnabled} onToggleNotifications={toggleNotifications}/>
      )}

      {/* ── SCAN tab ── */}
      {activeTab === "scan" && <>

      {/* Slim passive alert — Xûr in town */}
      {xurData?.source === "live" && xurData?.xur?.present && (
        <button onClick={() => setActiveTab("week")} style={{
          display:"flex", alignItems:"center", gap:8, width:"100%", marginBottom:8,
          padding:"5px 10px", background:C.goldLo, border:`1px solid ${C.gold}`,
          color:C.gold, cursor:"pointer", textAlign:"left",
          fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
          letterSpacing:"0.12em", WebkitAppRegion:"no-drag" }}>
          <span>◆</span> XÛR IS IN TOWN — SEE WEEK TAB
          <span style={{ marginLeft:"auto" }}>→</span>
        </button>
      )}
      {/* Slim passive alert — tracked ornaments in Eververse shop */}
      {eververseInShop.length > 0 && (
        <button onClick={() => setActiveTab("week")} style={{
          display:"flex", alignItems:"center", gap:8, width:"100%", marginBottom:8,
          padding:"5px 10px", background:C.purpleLo, border:`1px solid ${C.purple}`,
          color:C.purple, cursor:"pointer", textAlign:"left",
          fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
          letterSpacing:"0.12em", WebkitAppRegion:"no-drag" }}>
          <span>◆</span>
          {(() => {
            const nTracked = eververseInShop.filter(o =>
              trackedOrnaments.some(t => t.itemHash === o.itemHash)
            ).length;
            return nTracked > 0
              ? `${nTracked} TRACKED ORNAMENT${nTracked !== 1 ? "S" : ""} IN SHOP — SEE WEEK TAB`
              : `${eververseInShop.length} NEW ORNAMENT${eververseInShop.length !== 1 ? "S" : ""} IN SHOP — SEE WEEK TAB`;
          })()}
          <span style={{ marginLeft:"auto" }}>→</span>
        </button>
      )}

      {/* ── Quick-jump hunt strip — always visible when tracking items ── */}
      {trackedItems.length > 0 && (
        <div className="hunt-strip" style={{
          display:"flex", gap:6, overflowX:"auto", marginBottom:8,
          scrollbarWidth:"none", msOverflowStyle:"none" }}>
          {trackedItems.map(item => {
            const active = itemData?.itemName === item.name;
            return (
              <button key={item.itemHash} onClick={() => scan(item.name)} title={item.name}
                style={{ display:"flex", alignItems:"center", gap:5, flexShrink:0,
                  padding:"3px 8px 3px 4px",
                  background: active ? C.orangeLo : C.panelAlt,
                  border:`1px solid ${active ? C.orange : C.border}`,
                  color: active ? C.orange : C.sub,
                  cursor:"pointer", WebkitAppRegion:"no-drag",
                  fontFamily:"'Barlow Condensed',sans-serif", fontSize:10,
                  fontWeight:700, letterSpacing:"0.06em" }}>
                {item.icon && (
                  <img src={item.icon} alt="" width={18} height={18}
                    style={{ border:`1px solid ${active ? C.orange : C.border}`, flexShrink:0 }}/>
                )}
                <span style={{ maxWidth:90, whiteSpace:"nowrap",
                  overflow:"hidden", textOverflow:"ellipsis" }}>
                  {item.name.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
              onKeyDown={e => { if (e.key==="Enter") scan(); else if (e.key==="Escape") { setQuery(""); e.target.blur(); } }}
              placeholder="Name or itemHash — e.g. Touch of Malice, 2575506895"
              style={{ flex:1, minWidth:0, background:"transparent", border:"none", color:C.text,
                fontFamily:"'Barlow Condensed',sans-serif", fontSize:17, fontWeight:500, letterSpacing:"0.04em" }}/>
            {query && !scanning && (
              <button onClick={() => setQuery("")} title="Clear" aria-label="Clear search" style={{
                background:"none", border:"none", color:C.sub, fontSize:18, lineHeight:1,
                cursor:"pointer", padding:"0 2px", flexShrink:0 }}>×</button>
            )}
            <button onClick={scan} disabled={scanning} title="Search the Destiny 2 Manifest (Enter)" style={{ background:scanning ? C.muted : C.orange,
              border:"none", color:scanning ? C.sub : "#fff",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.14em", padding:"8px 12px", cursor:scanning ? "default" : "pointer", flexShrink:0 }}>
              {scanning ? "SCANNING" : "SCAN"}
            </button>
          </div>
          {!scanning && (
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.muted,
              letterSpacing:"0.1em", marginTop:7 }}>
              PRESS ENTER TO SCAN · PASTE AN ITEMHASH FROM DIM OR LIGHT.GG
            </div>
          )}
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
        trackedItems.length > 0 ? (
          <>
            <MyHuntsPanel
              items={trackedItems}
              allRunCounts={allRunCounts}
              userRates={userRates}
              communityRates={communityRates}
              onScan={scan}
            />
            {!auth.loggedIn && (
              <div style={{ textAlign:"center", paddingBottom:16 }}>
                <div style={{ fontSize:11, color:C.sub, lineHeight:1.6, marginBottom:10 }}>
                  Sign in with Bungie.net to auto-count runs from activity completions.
                </div>
                <Chip color={C.orange} onClick={() => setActiveTab("acct")}>
                  SIGN IN WITH BUNGIE →
                </Chip>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign:"center", padding:"36px 16px 24px", animation:"fadeUp 0.5s ease" }}>
            <Ghost size={48} color={C.muted}/>
            <div style={{ marginTop:14, fontFamily:"'Barlow Condensed',sans-serif", fontSize:13,
              color:C.sub, letterSpacing:"0.1em", lineHeight:1.7, maxWidth:300, margin:"14px auto 0" }}>
              SEARCH ANY DESTINY 2 WEAPON OR ARMOR TO SEE EVERY WAY TO FARM IT —
              WITH LIVE DROP-CHANCE MATH AND AUTO-TRACKED RUN COUNTS.
            </div>

            <div style={{ marginTop:18 }}>
              <Lbl color={C.muted} mb={8}>Try an example</Lbl>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center" }}>
                {QUICK_SCANS.map(name => (
                  <Chip key={name} color={C.gold} title={`Scan ${name}`} onClick={() => scan(name)}>
                    {name}
                  </Chip>
                ))}
              </div>
            </div>

            {!auth.loggedIn && (
              <div style={{ marginTop:20, paddingTop:18, borderTop:`1px solid ${C.border}`, maxWidth:320, margin:"20px auto 0" }}>
                <div style={{ fontSize:11, color:C.sub, lineHeight:1.6, marginBottom:10 }}>
                  Sign in with Bungie.net and the Ghost will auto-count your runs from in-game
                  activity completions — no manual tallying.
                </div>
                <Chip color={C.orange} onClick={() => setActiveTab("acct")}>
                  SIGN IN WITH BUNGIE →
                </Chip>
              </div>
            )}
          </div>
        )
      )}

      {/* ── Results ── */}
      {itemData && (
        <div style={{ animation:"fadeUp 0.4s ease" }}>
          {/* Path type legend — only shown when results are present */}
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14 }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700,
              color:C.sub, letterSpacing:"0.16em" }}>PATH TYPES</span>
            {Object.entries(PATH_TYPE).slice(0,4).map(([k,v]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:4 }} title={`${v.label} acquisition`}>
                <span style={{ color:v.color, fontSize:10 }}>{v.icon}</span>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.muted, letterSpacing:"0.1em" }}>{v.label}</span>
              </div>
            ))}
          </div>

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
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5, flexShrink:0 }}>
                {owned !== null && (
                  <div title={owned
                    ? "You've already collected this (per your Bungie collections)."
                    : "Not yet in your Bungie collections."}
                    style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
                    letterSpacing:"0.12em", padding:"2px 7px", whiteSpace:"nowrap",
                    background:owned ? C.greenLo : C.orangeLo,
                    border:`1px solid ${owned ? C.green : C.orange}`,
                    color:owned ? C.green : C.orange }}>
                    {owned ? "◆ COLLECTED" : "○ MISSING"}
                  </div>
                )}
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.blue,
                  letterSpacing:"0.08em", textAlign:"right" }}>
                  {itemData.acquisitionPaths?.length || 0} PATH{itemData.acquisitionPaths?.length !== 1 ? "S" : ""} FOUND
                </div>
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

          {/* Deep links out (light.gg / DIM / Bungie) */}
          <DeepLinks itemHash={itemData.itemHash}/>

          {/* Auto-track + add-path controls */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <button onClick={toggleTrack} disabled={!itemData.acquisitionPaths?.length} title={
              !itemData.acquisitionPaths?.length ? "Add a path with a source activity first"
                : auth.loggedIn ? "Auto-count runs when the Ghost detects a matching activity"
                : "Tracks this item now; sign in with Bungie to auto-count runs"
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

          {/* Eververse ornaments for this weapon — "track any?" checklist */}
          <OrnamentsPanel
            ornaments={weaponOrnaments}
            trackedSet={trackedOrnamentSet}
            shopCostByHash={shopCostByHash}
            live={eververseLive}
            onToggle={toggleOrnamentTrack}
          />

          {/* Catalyst + factual perk pool for this weapon */}
          <WeaponPerksPanel data={weaponPerks} progress={recordProgress}/>

          {/* Imported guides / secret-chest walkthroughs for this item */}
          <GuidesPanel guides={itemGuides}/>

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
              onResetHunt={resetHunt}
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
            <div style={{ marginBottom:10 }}>
              <button onClick={() => setAcquired(a => !a)} style={{ width:"100%", padding:"9px 0",
                background:acquired ? C.greenLo : C.muted, border:`1px solid ${acquired ? C.green : C.border}`,
                color:acquired ? C.green : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
                fontSize:11, fontWeight:700, letterSpacing:"0.16em", cursor:"pointer" }}>
                {acquired ? "◆  ITEM ACQUIRED  ◆" : "MARK AS ACQUIRED"}
              </button>
              {acquired && <ResetConfirm onReset={resetHunt}/>}
            </div>
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

      </>}
    </div>
  );
}
