// =============================================================================
// ThisWeekPanel.jsx — "This Week in Destiny" panel, extracted from GhostCompanion.jsx.
// One-glance view of Xûr, Eververse, Banshee, raid slate, and featured farmables.
// Props:
//   data          — /weekly response payload, or null when unavailable
//   onScan        — (name: string) => void  — fires when user clicks a weapon chip
//   onRefresh     — () => void              — force-refresh the weekly data
//   trackedNames  — Set<string>             — names the user is farming (for ★ tags)
//   apiUrl        — string                  — current data API URL (empty = unconfigured)
//   onOpenAccount — () => void              — open the Account panel (cold-start CTA)
// =============================================================================

import { useState } from "react";
import { C } from "../theme";
import { Panel, Lbl, Badge } from "./primitives";
import { XurSection, BansheeSection, EververseSection } from "./VendorPanels";
import dropRates from "../../../data/dropRates.json";

function resetCountdown(iso) {
  const ms = new Date(iso) - new Date();
  if (!iso || isNaN(ms) || ms <= 0) return null;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}D ${h}H`;
  if (h > 0) return `${h}H ${m}M`;
  return `${m}M`;
}

function WeekSection({ title, color, children, collapsible = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <div style={{ marginBottom:13 }}>
        <Lbl color={color} mb={6}>{title}</Lbl>
        {children}
      </div>
    );
  }
  return (
    <div style={{ marginBottom:13 }}>
      <div onClick={() => setOpen(o => !o)} title={open ? "Collapse" : "Expand"}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
          cursor:"pointer", userSelect:"none", marginBottom: open ? 6 : 0 }}>
        <Lbl color={color} mb={0}>{title}</Lbl>
        <span style={{ color, fontSize:11, fontFamily:"'Barlow Condensed',sans-serif", flexShrink:0 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && children}
    </div>
  );
}

// Normalize an activity/location string for loose matching (case, curly quotes,
// whitespace). Catalog `location` values are often "<Activity> — detail", so we
// match by substring against the canonical featured names.
function normActivity(s) {
  return String(s || "").toLowerCase().replace(/['']/g, "'").replace(/\s+/g, " ").trim();
}

// Theme 2 join: given this week's featured/farmable activity names, return the
// catalog chase items that drop in each — grouped in featured order, tracked
// items first + flagged. Pure; `catalog` defaults to the bundled dropRates so
// the whole join runs client-side with no server dependency.
function featuredChaseItems(featuredNames, trackedNames, catalog = dropRates) {
  const targets = (featuredNames || [])
    .filter(Boolean)
    .map(n => ({ name: n, norm: normActivity(n) }))
    .filter(t => t.norm);
  if (!targets.length) return [];
  const byAct = new Map(targets.map(t => [t.name, []]));
  for (const [name, entry] of Object.entries(catalog)) {
    if (name.startsWith("_") || !entry || !Array.isArray(entry.acquisitionPaths)) continue;
    for (const t of targets) {
      if (entry.acquisitionPaths.some(p => normActivity(p.location).includes(t.norm))) {
        byAct.get(t.name).push({ name, tracked: !!(trackedNames && trackedNames.has(name)) });
        break; // list an item under the first featured activity it drops in
      }
    }
  }
  return targets
    .map(t => ({
      activity: t.name,
      items: byAct.get(t.name).sort((a, b) => (b.tracked - a.tracked) || a.name.localeCompare(b.name)),
    }))
    .filter(g => g.items.length);
}

// A labeled row of featured (farmable) activity chips for the weekly rotation.
function FeaturedRow({ label, items }) {
  return (
    <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:2 }}>
      <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub,
        letterSpacing:"0.06em", minWidth:58 }}>{label.toUpperCase()}</span>
      {items.map((name) => (
        <div key={name} style={{ display:"flex", alignItems:"center", border:`1px solid ${C.greenLo}`,
          background:C.panelAlt, padding:"3px 7px", fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:11, color:C.text, letterSpacing:"0.03em" }}>
          {name}
        </div>
      ))}
    </div>
  );
}

export function ThisWeekPanel({ data, onScan, onRefresh, trackedNames, apiUrl, onOpenAccount }) {
  if (!data) {
    return (
      <Panel bc={C.blue} style={{ marginBottom:14 }}>
        <Lbl color={C.blue} mb={6}>This Week in Destiny</Lbl>
        {!apiUrl ? (
          <div>
            <div style={{ fontSize:11, color:C.sub, lineHeight:1.6 }}>
              No Data API URL configured — live vendor data, Xûr stock, raid rotations,
              and weekly resets aren't available yet.
            </div>
            {onOpenAccount && (
              <button onClick={onOpenAccount} style={{ marginTop:10, background:C.blueLo,
                border:`1px solid ${C.blue}`, color:C.blue, fontFamily:"'Barlow Condensed',sans-serif",
                fontSize:10, fontWeight:700, letterSpacing:"0.12em", padding:"6px 14px",
                cursor:"pointer", WebkitAppRegion:"no-drag" }}>
                OPEN ACCOUNT SETTINGS →
              </button>
            )}
          </div>
        ) : (
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, flex:1 }}>
              Couldn't reach the data API. Check your URL in Account, then retry.
            </div>
            {onRefresh && (
              <button onClick={onRefresh} style={{ background:"none", border:`1px solid ${C.muted}`,
                color:C.sub, fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
                letterSpacing:"0.1em", padding:"5px 10px", cursor:"pointer",
                WebkitAppRegion:"no-drag", flexShrink:0 }}>
                ↻ RETRY
              </button>
            )}
          </div>
        )}
      </Panel>
    );
  }
  const x = data.xur, xLive = x?.source === "live", xur = x?.xur;
  const e = data.eververse, eLive = e?.source === "live", inShop = e?.inShop || [];
  const b = data.banshee, bLive = b?.source === "live", bWeapons = b?.weapons || [];
  const a = data.activities, raids = a?.raids || [], dungeons = a?.dungeons || [];
  const rot = data.rotations, rotOn = rot?.source === "computed";
  const featRaids = rot?.featuredRaids || [], featDungeons = rot?.featuredDungeons || [], gm = rot?.grandmasterAlert || rot?.grandmasterNightfall;
  const hasFeatured = rotOn && (featRaids.length || featDungeons.length || gm);
  // Theme 2: which of our catalog chase weapons drop in a featured activity now.
  const chaseGroups = rotOn
    ? featuredChaseItems([...featRaids, ...featDungeons, ...(gm?.activity ? [gm.activity] : [])], trackedNames)
    : [];
  const trackedChaseCount = chaseGroups.reduce((n, g) => n + g.items.filter(i => i.tracked).length, 0);
  const countdown = resetCountdown(data.resetsAt);
  const anyLive = xLive || eLive || bLive || a?.source === "live";
  const week = data.weekOf ? new Date(data.weekOf).toLocaleDateString() : null;

  return (
    <Panel bc={C.blue} style={{ marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:11 }}>
        <Lbl color={C.blue} mb={0}>This Week in Destiny</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {countdown && <Badge label={`RESETS ${countdown}`} color={C.gold} bg={C.goldLo}/>}
          <button onClick={onRefresh} title="Refresh now" style={{ background:"none", border:`1px solid ${C.muted}`,
            color:C.sub, fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, lineHeight:1,
            padding:"3px 7px", cursor:"pointer", WebkitAppRegion:"no-drag" }}>↻</button>
        </div>
      </div>

      <WeekSection title="Xûr — Agent of the Nine" color={C.gold}>
        {xLive && xur?.present ? (
          <XurSection xur={xur} onScan={onScan}/>
        ) : (
          <div style={{ fontSize:11, color:C.sub, letterSpacing:"0.03em" }}>
            {xLive ? "Not in town right now — Xûr returns Friday." : "Status unavailable this refresh."}
          </div>
        )}
      </WeekSection>

      {bLive && bWeapons.length > 0 && (
        <WeekSection
          title={`Banshee-44 — Weapons · ${bWeapons.length}`}
          color={C.blue}
          collapsible
        >
          <BansheeSection weapons={bWeapons} location={b.location} onScan={onScan}/>
        </WeekSection>
      )}

      <WeekSection
        title={`Eververse — Tess Everis${eLive && inShop.length ? ` · ${inShop.length}` : ""}`}
        color={C.purple}
        collapsible={eLive && inShop.length > 0}
      >
        {eLive && inShop.length ? (
          <EververseSection items={inShop} onScan={onScan}/>
        ) : (
          <div style={{ fontSize:11, color:C.sub, letterSpacing:"0.03em" }}>
            {eLive ? "None of your tracked ornaments are in the shop right now." : "Shop status unavailable this refresh."}
          </div>
        )}
      </WeekSection>

      <div style={{ borderTop:`1px solid ${C.border}`, margin:"0 0 13px" }}/>

      <WeekSection title={`Raids Available${raids.length ? ` · ${raids.length}` : ""}`} color={C.blue}>
        {a?.source === "live" && raids.length ? (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {raids.map(r => (
              <div key={r.milestoneHash} title={r.master ? "Master difficulty active" : r.name}
                style={{ display:"flex", alignItems:"center", gap:5,
                  border:`1px solid ${r.master ? C.gold : C.blueLo}`, background:C.panelAlt, padding:"3px 7px",
                  fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, color:C.text, letterSpacing:"0.03em" }}>
                {r.name}
                {r.master && <span style={{ fontSize:8, color:C.gold, letterSpacing:"0.1em" }}>MASTER</span>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize:11, color:C.sub }}>Raid slate unavailable this refresh.</div>
        )}
        {dungeons.length > 0 && (
          <div style={{ marginTop:8, fontSize:10, color:C.sub, letterSpacing:"0.04em" }}>
            Dungeons: {dungeons.map(d => d.name).join(" · ")}
          </div>
        )}
      </WeekSection>

      {hasFeatured && (
        <WeekSection title="Featured · Farmable This Week" color={C.green}>
          {featRaids.length > 0 && <FeaturedRow label="Raids" items={featRaids}/>}
          {featDungeons.length > 0 && <FeaturedRow label="Dungeons" items={featDungeons}/>}
          {gm && (
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginTop:featRaids.length||featDungeons.length ? 8 : 0 }}>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub, letterSpacing:"0.06em", minWidth:58 }}>GM ALERT</span>
              <div style={{ display:"flex", alignItems:"center", gap:5, border:`1px solid ${C.greenLo}`,
                background:C.panelAlt, padding:"3px 7px", fontFamily:"'Barlow Condensed',sans-serif",
                fontSize:11, color:C.text, letterSpacing:"0.03em" }}>
                {gm.activity}
                {gm.weapon && (
                  <span onClick={() => onScan?.(gm.weapon)} title={`Look up ${gm.weapon}`}
                    style={{ fontSize:9, color:C.green, letterSpacing:"0.08em", cursor:onScan?"pointer":"default" }}>
                    · {gm.weapon.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          )}
          {chaseGroups.length > 0 && (
            <div style={{ marginTop:10, paddingTop:9, borderTop:`1px solid ${C.greenLo}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.green,
                  letterSpacing:"0.08em" }}>CHASE WEAPONS</span>
                {trackedChaseCount > 0 && <Badge label={`${trackedChaseCount} TRACKED`} color={C.gold} bg={C.goldLo}/>}
              </div>
              {chaseGroups.map(g => (
                <div key={g.activity} style={{ display:"flex", alignItems:"flex-start", flexWrap:"wrap",
                  gap:6, marginBottom:4 }}>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, color:C.sub,
                    letterSpacing:"0.04em", minWidth:96, paddingTop:3 }}>{g.activity}</span>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                    {g.items.map(it => (
                      <span key={it.name} onClick={() => onScan?.(it.name)} title={`Look up ${it.name}`}
                        style={{ display:"flex", alignItems:"center", gap:4, cursor:onScan?"pointer":"default",
                          border:`1px solid ${it.tracked ? C.gold : C.greenLo}`,
                          background:it.tracked ? C.goldLo : C.panelAlt, padding:"3px 7px",
                          fontFamily:"'Barlow Condensed',sans-serif", fontSize:11,
                          color:it.tracked ? C.gold : C.text, letterSpacing:"0.03em", WebkitAppRegion:"no-drag" }}>
                        {it.tracked && <span style={{ fontSize:9 }}>★</span>}{it.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.06em", marginTop:5,
                fontFamily:"'Barlow Condensed',sans-serif" }}>★ TRACKED · CLICK TO LOOK UP</div>
            </div>
          )}
          <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.1em", marginTop:8,
            fontFamily:"'Barlow Condensed',sans-serif" }}>COMMUNITY-TRACKED ROTATION</div>
        </WeekSection>
      )}

      {anyLive && (
        <div style={{ textAlign:"center", fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:9, color:C.muted, letterSpacing:"0.14em", marginTop:2 }}>
          {week ? `WEEK OF ${week} · ` : ""}VERIFIED LIVE
        </div>
      )}
    </Panel>
  );
}
