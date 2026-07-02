// =============================================================================
// primitives.jsx — small presentational building blocks shared across panels.
// Each depends only on the `C` palette + props (no app state), so they're safe
// to reuse anywhere. Extracted from GhostCompanion.jsx.
// =============================================================================

import { C } from "../theme";

// Four corner brackets — the overlay's signature "targeting reticle" frame.
export function Brackets({ color=C.orange, pad=8, size=10 }) {
  const b = { position:"absolute", width:size, height:size, borderColor:color, borderStyle:"solid", borderWidth:0 };
  return (<>
    <div style={{ ...b, top:pad, left:pad,  borderTopWidth:1.5, borderLeftWidth:1.5  }}/>
    <div style={{ ...b, top:pad, right:pad, borderTopWidth:1.5, borderRightWidth:1.5 }}/>
    <div style={{ ...b, bottom:pad, left:pad,  borderBottomWidth:1.5, borderLeftWidth:1.5  }}/>
    <div style={{ ...b, bottom:pad, right:pad, borderBottomWidth:1.5, borderRightWidth:1.5 }}/>
  </>);
}

export function Panel({ children, style={}, bc=C.orange, noBrackets=false }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`, position:"relative", padding:14, ...style }}>
      {!noBrackets && <Brackets color={bc}/>}
      {children}
    </div>
  );
}

export function Lbl({ children, color=C.sub, mb=4 }) {
  return <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700, letterSpacing:"0.18em", textTransform:"uppercase", color, marginBottom:mb }}>{children}</div>;
}

export function Badge({ label, color, bg }) {
  return (
    <div style={{ padding:"2px 7px", background:bg, border:`1px solid ${color}`,
      fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, fontWeight:700,
      letterSpacing:"0.12em", color, display:"inline-block" }}>
      {label}
    </div>
  );
}

// Clickable pill — used for the empty-state example searches and the sign-in nudge.
export function Chip({ children, onClick, color=C.blue, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background:C.panelAlt, border:`1px solid ${color}`, color,
      fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:600,
      letterSpacing:"0.06em", padding:"5px 11px", cursor:"pointer", WebkitAppRegion:"no-drag" }}>
      {children}
    </button>
  );
}

export function Ghost({ size=28, color=C.blue, spin=false }) {
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

export function Diamond({ n, color=C.orange, bg=C.orangeLo }) {
  return (
    <div style={{ width:26, height:26, transform:"rotate(45deg)", background:bg,
      border:`1.5px solid ${color}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <span style={{ transform:"rotate(-45deg)", fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700, color }}>{n}</span>
    </div>
  );
}
