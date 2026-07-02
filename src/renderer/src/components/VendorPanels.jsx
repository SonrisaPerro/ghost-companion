// =============================================================================
// VendorPanels.jsx — live vendor display cluster (Xûr, Banshee-44, Eververse).
// Pure presentation: each takes already-resolved data + an onScan callback and
// depends only on the theme + shared primitives. Extracted from GhostCompanion.jsx.
// =============================================================================

import { useState } from "react";
import { C } from "../theme";
import { Panel, Lbl, Badge } from "./primitives";
import { costColor, formatQty } from "../format";

export function XurSection({ xur, onScan }) {
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

// Banshee-44's live weekly weapon rotation (legendary buyables). Same row idiom
// as XurSection but blue, and each weapon is scannable.
export function BansheeSection({ weapons, location, onScan }) {
  return (
    <div>
      {location && (
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.12em", marginBottom:weapons.length?8:0 }}>
          {location.toUpperCase()}
        </div>
      )}
      {weapons.map(w => (
        <div key={w.itemHash} onClick={() => onScan?.(w.name)} title="Scan this item"
          style={{ display:"flex", alignItems:"center", gap:9, padding:"5px 0", cursor:"pointer" }}
          onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
          onMouseLeave={e => e.currentTarget.style.opacity = 1}>
          {w.icon
            ? <img src={w.icon} alt="" width={26} height={26} style={{ border:`1px solid ${C.blue}`, flexShrink:0 }}/>
            : <div style={{ width:26, height:26, background:C.blueLo, border:`1px solid ${C.blue}`, flexShrink:0 }}/>}
          <div style={{ minWidth:0 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700,
              color:C.blue, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {w.name}
            </div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
              {(w.tier || "LEGENDARY").toUpperCase()} · {(w.type || "WEAPON").toUpperCase()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function XurPanel({ data, onScan }) {
  // Only ever surface Xûr when the server gave an AUTHORITATIVE live read AND he
  // is verified present. Away or unknown (fallback) → render nothing at all.
  // Starts COLLAPSED — the header still shows the count so it stays discoverable.
  const [open, setOpen] = useState(false);
  if (!data || data.source !== "live" || !data.xur?.present) return null;
  const week = data.weekOf ? new Date(data.weekOf).toLocaleDateString() : null;
  const n = (data.xur.weapons || []).length + (data.xur.armor || []).length;
  return (
    <Panel bc={C.gold} style={{ marginBottom:14 }}>
      <div onClick={() => setOpen(o => !o)} title={open ? "Collapse" : "Expand"}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, cursor:"pointer", userSelect:"none", marginBottom:open ? 8 : 0 }}>
        <Lbl color={C.gold} mb={0}>{data.xur.label || "Xûr"} · {n} Exotic{n !== 1 ? "s" : ""} In Stock</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <Badge label="IN TOWN · LIVE" color={C.green} bg={C.greenLo}/>
          <span style={{ color:C.gold, fontSize:11, fontFamily:"'Barlow Condensed',sans-serif" }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <>
          <XurSection xur={data.xur} onScan={onScan}/>
          {week && (
            <div style={{ textAlign:"center", fontFamily:"'Barlow Condensed',sans-serif",
              fontSize:9, color:C.muted, letterSpacing:"0.14em", marginTop:12 }}>
              WEEK OF {week} · VERIFIED LIVE
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ── Eververse panel ──────────────────────────────────────────────────
   Surfaces tracked weapon ornaments that are FOR SALE in Tess Everis' shop
   right now, so the user can go buy them before they rotate out. Mirrors the
   XurPanel discipline: render ONLY on an authoritative live read with at least
   one tracked ornament actually in stock — never on a fallback/unknown read. */

export function EververseSection({ items, onScan }) {
  return (
    <div>
      {items.map((o) => {
        const cost = (o.cost || [])[0]; // ornaments cost a single currency
        const col = costColor(cost?.kind);
        return (
          <div key={o.itemHash} onClick={() => onScan?.(o.weapon)} title={`Scan ${o.weapon}`}
            style={{ display:"flex", alignItems:"center", gap:9, padding:"6px 0", cursor:"pointer",
              borderBottom:`1px solid ${C.muted}` }}
            onMouseEnter={e => e.currentTarget.style.opacity = 0.8}
            onMouseLeave={e => e.currentTarget.style.opacity = 1}>
            <div style={{ width:26, height:26, background:C.purpleLo, border:`1px solid ${C.purple}`,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, color:C.purple }}>◈</div>
            <div style={{ minWidth:0, flex:1 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                color:C.text, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {o.name}
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
                {(o.weapon || "ORNAMENT").toUpperCase()} · ORNAMENT
              </div>
            </div>
            {cost && (
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, color:col, lineHeight:1 }}>
                  {formatQty(cost.quantity)}
                </div>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:8, color:col, letterSpacing:"0.1em" }}>
                  {(cost.name || "").toUpperCase()}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EverversePanel({ items, location, onScan }) {
  // `items` is the already-merged in-shop list (curated registry + the user's own
  // tracked ornaments matched against the live sales). The parent only builds it
  // from an AUTHORITATIVE live read, so an empty list here means nothing to show.
  // Starts COLLAPSED — the header still shows the count so it stays discoverable.
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  const n = items.length;
  return (
    <Panel bc={C.purple} style={{ marginBottom:14 }}>
      <div onClick={() => setOpen(o => !o)} title={open ? "Collapse" : "Expand"}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, cursor:"pointer", userSelect:"none", marginBottom:open ? 6 : 0 }}>
        <Lbl color={C.purple} mb={0}>🛒 Eververse · {n} Suggested Ornament{n !== 1 ? "s" : ""} In Stock</Lbl>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <Badge label="IN SHOP · LIVE" color={C.green} bg={C.greenLo}/>
          <span style={{ color:C.purple, fontSize:11, fontFamily:"'Barlow Condensed',sans-serif" }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <>
          <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginBottom:8 }}>
            {n === 1 ? "A suggested ornament is" : `${n} suggested ornaments are`} for sale at Tess Everis right now —
            grab {n === 1 ? "it" : "them"} before the shop rotates.
          </div>
          <EververseSection items={items} onScan={onScan}/>
          <div style={{ textAlign:"center", fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:9, color:C.muted, letterSpacing:"0.14em", marginTop:10 }}>
            {(location || "THE TOWER").toUpperCase()} · VERIFIED LIVE
          </div>
        </>
      )}
    </Panel>
  );
}
