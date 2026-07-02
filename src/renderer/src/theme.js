// =============================================================================
// theme.js — shared color palette for the renderer UI.
// Single source of truth for the overlay's colors; imported as `C` everywhere.
// =============================================================================

export const C = {
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

export const inputStyle = {
  width:"100%", background:C.panelAlt, border:`1px solid ${C.border}`, color:C.text,
  fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, letterSpacing:"0.04em",
  padding:"7px 9px", marginBottom:8,
};
