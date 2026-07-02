// =============================================================================
// WeaponPerksPanel.jsx — factual per-weapon detail card (v1.0.7 feature).
// Renders, for the on-screen weapon: the exotic catalyst + live objective
// progress, the crafting-pattern x/N progress, and the intrinsic + full perk
// pool. `data` is the manifest-resolved shape from getWeaponPerks; `progress`
// is live Triumph-record progress keyed by recordHash (empty when logged out —
// the panel degrades to static targets + a sign-in nudge). Extracted from
// GhostCompanion.jsx; depends only on the theme + shared primitives.
// =============================================================================

import { useState } from "react";
import { C } from "../theme";
import { Panel, Lbl, Badge } from "./primitives";

export function WeaponPerksPanel({ data, progress }) {
  const [openPerks, setOpenPerks] = useState(false);
  if (!data) return null;
  const { catalyst, pattern, intrinsic, columns } = data;
  if (!catalyst && !pattern && !intrinsic && !(columns?.length)) return null;
  const hasRandom = (columns || []).some((c) => c.random);
  // Live objective progress for this catalyst (empty when logged out / uncached).
  const catRec = catalyst && progress ? progress[catalyst.recordHash] : null;
  const objProg = new Map((catRec?.objectives || []).map((o) => [o.objectiveHash, o]));
  const catDone = !!catRec?.complete;
  // Live crafting-pattern progress (single objective; empty when logged out).
  const patRec = pattern && progress ? progress[pattern.recordHash] : null;
  const patObj = patRec?.objectives?.find((o) => o.objectiveHash === pattern?.objectiveHash)
    || patRec?.objectives?.[0] || null;
  const patTarget = pattern?.target || patObj?.completionValue || 0;
  const patDone = !!patObj?.complete;
  return (
    <>
      {catalyst && (
        <Panel bc={C.gold} style={{ marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
            <Lbl color={C.gold} mb={0}>Catalyst</Lbl>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              {catDone && <Badge label="✓ COMPLETE" color={C.green} bg={C.greenLo}/>}
              <Badge label="EXOTIC" color={C.gold} bg={C.goldLo}/>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
            {catalyst.icon && (
              <img src={catalyst.icon} alt="" width={30} height={30}
                style={{ border:`1px solid ${C.gold}`, flexShrink:0 }}/>
            )}
            <div style={{ minWidth:0 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:15, fontWeight:700,
                color:C.text, letterSpacing:"0.04em" }}>{catalyst.name}</div>
              {catalyst.description && (
                <div style={{ fontSize:12, color:C.sub, fontStyle:"italic", lineHeight:1.5, marginTop:2 }}>
                  {catalyst.description}
                </div>
              )}
            </div>
          </div>
          {catalyst.objectives?.length > 0 && (
            <>
              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:5 }}>
                {catalyst.objectives.map((o, i) => {
                  const p = objProg.get(o.objectiveHash);           // live progress, if any
                  const target = o.target || p?.completionValue || 0;
                  const done = p?.complete;
                  const pct = p && !o.checkbox && target > 1
                    ? Math.max(0, Math.min(1, p.progress / target)) : null;
                  return (
                    <div key={i} style={{ background:C.panelAlt,
                      border:`1px solid ${done ? C.green : C.muted}`, padding:"4px 8px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <span style={{ display:"flex", alignItems:"center", gap:7, minWidth:0 }}>
                          {o.checkbox && (
                            <span style={{ color:done ? C.green : C.gold, fontSize:11, flexShrink:0 }}>
                              {done ? "☑" : "☐"}
                            </span>
                          )}
                          <span style={{ fontSize:12, color:C.sub, lineHeight:1.3 }}>{o.description}</span>
                        </span>
                        {!o.checkbox && target > 1 && (
                          <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700,
                            color:done ? C.green : C.gold, flexShrink:0, whiteSpace:"nowrap" }}>
                            {p ? `${p.progress.toLocaleString()} / ${target.toLocaleString()}`
                               : target.toLocaleString()}
                          </span>
                        )}
                      </div>
                      {pct !== null && (
                        <div style={{ marginTop:4, height:3, background:C.muted }}>
                          <div style={{ height:"100%", width:`${pct * 100}%`,
                            background:done ? C.green : C.gold }}/>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize:11, color:C.sub, fontStyle:"italic", lineHeight:1.5, marginTop:8,
                borderLeft:`2px solid ${C.border}`, paddingLeft:8 }}>
                Earn the catalyst in-game, then <span style={{ color:C.text }}>insert it</span> into
                the weapon's catalyst slot (☐ steps) to start tracking. Complete the remaining
                objectives to unlock the masterwork upgrade.
              </div>
            </>
          )}
        </Panel>
      )}

      {pattern && (
        <Panel bc={C.purple} style={{ marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom: patObj ? 7 : 6 }}>
            <Lbl color={C.purple} mb={0}>Craftable Pattern</Lbl>
            {patDone
              ? <Badge label="✓ UNLOCKED" color={C.green} bg={C.greenLo}/>
              : <Badge label={patObj ? `${patObj.progress.toLocaleString()} / ${patTarget}` : `${patTarget} NEEDED`}
                  color={C.purple} bg={C.purpleLo}/>}
          </div>
          {patObj && !patDone && (
            <div style={{ height:4, background:C.muted }}>
              <div style={{ height:"100%",
                width:`${Math.max(0, Math.min(1, patObj.progress / (patTarget || 1))) * 100}%`,
                background:C.purple }}/>
            </div>
          )}
          {!patObj && (
            <div style={{ fontSize:11, color:C.sub, fontStyle:"italic", lineHeight:1.5 }}>
              Extract {patTarget} Deepsight {patTarget === 1 ? "pattern" : "patterns"} to craft this at
              the Enclave{patDone ? "" : " — sign in with Bungie to track your progress"}.
            </div>
          )}
        </Panel>
      )}

      {(intrinsic || columns?.length > 0) && (
        <Panel bc={C.blue} style={{ marginBottom:10 }}>
          <div onClick={() => setOpenPerks((s) => !s)} style={{ display:"flex", alignItems:"center",
            justifyContent:"space-between", cursor:"pointer" }}>
            <Lbl color={C.blue} mb={0}>
              {hasRandom ? "Perk Pool · What Can Roll" : "Perks"}
            </Lbl>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {hasRandom && <Badge label="RANDOM ROLLS" color={C.blue} bg={C.blueLo}/>}
              <span style={{ color:C.sub, fontSize:11 }}>{openPerks ? "▲" : "▼"}</span>
            </div>
          </div>

          {intrinsic && (
            <div style={{ display:"flex", gap:9, alignItems:"flex-start", marginTop:8 }}>
              {intrinsic.icon && (
                <img src={intrinsic.icon} alt="" width={26} height={26}
                  style={{ border:`1px solid ${C.blue}`, flexShrink:0 }}/>
              )}
              <div style={{ minWidth:0 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.blue, letterSpacing:"0.14em" }}>
                  INTRINSIC
                </div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                  color:C.text, letterSpacing:"0.03em" }}>{intrinsic.name}</div>
                {openPerks && intrinsic.description && (
                  <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginTop:2 }}>{intrinsic.description}</div>
                )}
              </div>
            </div>
          )}

          {openPerks && columns?.map((col, ci) => (
            <div key={ci} style={{ marginTop:10 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub,
                letterSpacing:"0.14em", marginBottom:5 }}>
                {col.label.toUpperCase()} · {col.perks.length}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {col.perks.map((p) => (
                  <span key={p.itemHash} title={p.description || p.name}
                    style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, color:C.text,
                    background:C.panelAlt, border:`1px solid ${C.border}`, padding:"3px 7px",
                    letterSpacing:"0.02em", whiteSpace:"nowrap" }}>
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {openPerks && hasRandom && (
            <div style={{ fontSize:11, color:C.sub, fontStyle:"italic", lineHeight:1.5, marginTop:10,
              borderLeft:`2px solid ${C.border}`, paddingLeft:8 }}>
              This is the full roll pool from the Manifest — not a recommendation. For
              community god-roll picks, use the light.gg link above.
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
