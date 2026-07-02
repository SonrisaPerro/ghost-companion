// =============================================================================
// GuidePanels.jsx — guide-related UI panels, extracted from GhostCompanion.jsx.
//   CommunityLibrary  — browse + one-click import curated packs from the data API
//   CreateGuideForm   — in-app guide authoring
//   GuidesPanel       — on-item card showing guides matching the scanned item
//   Guides            — full GUIDES tab listing all imported/authored walkthroughs
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { C, inputStyle } from "../theme";
import { Panel, Lbl, Badge } from "./primitives";

/* ── Community guide library browser ─────────────────────────────────────────
   Lists the curated packages served by the data API's /guides index and lets
   the user one-click import any of them. Re-importing updates existing guides
   (dedupe by id) rather than duplicating, so it doubles as an "update" button. */
export function CommunityLibrary({ onBrowse, onImport }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [list, setList]       = useState(null);   // null = not yet loaded
  const [err, setErr]         = useState(null);
  const [busyId, setBusyId]   = useState(null);
  const [results, setResults] = useState({});      // id -> status line

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const idx = await onBrowse?.();
      setList(idx?.packages || []);
      if (!idx || !idx.packages?.length) setErr("No packages available (set a Data API URL in this panel, or the library is empty).");
    } catch { setErr("Couldn't reach the library."); }
    finally { setLoading(false); }
  }, [onBrowse]);

  const toggle = useCallback(() => {
    setOpen(o => { const n = !o; if (n && list === null) load(); return n; });
  }, [list, load]);

  const doImport = useCallback(async (id) => {
    setBusyId(id);
    try {
      const r = await onImport?.(id);
      setResults(prev => ({ ...prev, [id]:
        r?.ok ? `Imported · +${r.added} new, ${r.updated} updated`
              : `Failed: ${r?.message || "unknown error"}` }));
    } finally { setBusyId(null); }
  }, [onImport]);

  return (
    <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <Lbl color={C.sub} mb={0}>Community Library</Lbl>
        <button onClick={toggle} style={{
          background:"none", border:`1px solid ${open ? C.blue : C.muted}`,
          color:open ? C.blue : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:10, fontWeight:700, letterSpacing:"0.12em", padding:"3px 9px",
          cursor:"pointer", WebkitAppRegion:"no-drag" }}>
          {open ? "HIDE" : "BROWSE"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, flex:1 }}>
              Curated guide packs. Importing again later pulls updates without duplicating.
            </div>
            <button onClick={load} disabled={loading} title="Refresh list" style={{
              background:"none", border:`1px solid ${C.muted}`, color:C.sub,
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
              letterSpacing:"0.1em", padding:"3px 8px", cursor:loading?"default":"pointer",
              WebkitAppRegion:"no-drag", flexShrink:0 }}>
              {loading ? "…" : "↻"}
            </button>
          </div>
          {err && <div style={{ fontSize:11, color:C.gold, lineHeight:1.5, marginBottom:6 }}>{err}</div>}
          {(list || []).map((p) => (
            <div key={p.id} style={{ padding:"7px 0", borderBottom:`1px solid ${C.muted}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:600,
                    color:C.text, letterSpacing:"0.03em" }}>{p.name}</div>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
                    {p.guideCount} GUIDE{p.guideCount === 1 ? "" : "S"}{p.author ? ` · ${p.author}` : ""}
                  </div>
                </div>
                <button onClick={() => doImport(p.id)} disabled={busyId === p.id} style={{ flexShrink:0,
                  background:C.blueLo, border:`1px solid ${C.blue}`, color:C.blue,
                  fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
                  letterSpacing:"0.1em", padding:"4px 10px", cursor:busyId===p.id?"default":"pointer",
                  WebkitAppRegion:"no-drag" }}>
                  {busyId === p.id ? "…" : "IMPORT"}
                </button>
              </div>
              {p.description && (
                <div style={{ fontSize:11, color:C.sub, lineHeight:1.45, marginTop:4 }}>{p.description}</div>
              )}
              {results[p.id] && (
                <div style={{ fontSize:10, color: results[p.id].startsWith("Failed") ? C.red : C.green,
                  letterSpacing:"0.04em", marginTop:4 }}>{results[p.id]}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── In-app Create Guide form ─────────────────────────────────────────────────
   Authors a single guide and saves it through the same validate+merge path as
   an imported package. Optional item search links the guide to a weapon/armour
   card (by itemHash) so it surfaces there. */
export function CreateGuideForm({ onCreate }) {
  const [open, setOpen]         = useState(false);
  const [title, setTitle]       = useState("");
  const [type, setType]         = useState("guide");
  const [activity, setActivity] = useState("");
  const [notes, setNotes]       = useState("");
  const [steps, setSteps]       = useState([{ title:"", description:"" }]);
  const [item, setItem]         = useState(null);   // { itemHash, name }
  const [itemQuery, setItemQuery] = useState("");
  const [itemHits, setItemHits] = useState([]);
  const [msg, setMsg]           = useState(null);
  const [saving, setSaving]     = useState(false);

  const searchItem = useCallback((q) => setItemQuery(q), []);

  // Debounced Manifest item search (300ms) — mirrors the activity picker so we
  // don't fire a full-table scan on every keystroke.
  useEffect(() => {
    const q = itemQuery.trim();
    if (q.length < 2) { setItemHits([]); return; }
    const t = setTimeout(async () => {
      try { setItemHits(((await window.api?.searchManifest?.(q)) || []).slice(0, 6)); }
      catch { setItemHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [itemQuery]);

  const setStep = (i, key, val) =>
    setSteps(s => s.map((st, j) => j === i ? { ...st, [key]:val } : st));
  const addStep = () => setSteps(s => s.length < 60 ? [...s, { title:"", description:"" }] : s);
  const removeStep = (i) => setSteps(s => s.length > 1 ? s.filter((_, j) => j !== i) : s);

  const reset = () => {
    setTitle(""); setType("guide"); setActivity(""); setNotes("");
    setSteps([{ title:"", description:"" }]); setItem(null); setItemQuery(""); setItemHits([]);
  };

  const save = useCallback(async () => {
    if (!title.trim()) { setMsg({ err:true, text:"A title is required." }); return; }
    setSaving(true); setMsg(null);
    const guide = {
      title: title.trim(),
      type,
      activity: activity.trim() || undefined,
      itemHash: item?.itemHash || undefined,
      item: item?.name || undefined,
      notes: notes.trim() || undefined,
      steps: steps
        .map(s => ({ title:s.title.trim(), description:s.description.trim() }))
        .filter(s => s.title || s.description),
    };
    try {
      const r = await onCreate?.(guide);
      if (r?.ok) { setMsg({ err:false, text:`Saved "${title.trim()}".` }); reset(); }
      else setMsg({ err:true, text:`Couldn't save: ${r?.message || "unknown error"}` });
    } finally { setSaving(false); }
  }, [title, type, activity, item, notes, steps, onCreate]);

  const lblBtn = (active) => ({
    background: active ? C.goldLo : "none", border:`1px solid ${active ? C.gold : C.muted}`,
    color: active ? C.gold : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
    fontSize:10, fontWeight:700, letterSpacing:"0.1em", padding:"4px 10px",
    cursor:"pointer", WebkitAppRegion:"no-drag",
  });

  return (
    <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <Lbl color={C.sub} mb={0}>Create Guide</Lbl>
        <button onClick={() => setOpen(o => !o)} style={{
          background:"none", border:`1px solid ${open ? C.green : C.muted}`,
          color:open ? C.green : C.sub, fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:10, fontWeight:700, letterSpacing:"0.12em", padding:"3px 9px",
          cursor:"pointer", WebkitAppRegion:"no-drag" }}>
          {open ? "CLOSE" : "NEW"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop:8 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
            placeholder="Guide title (e.g. Warlord's Ruin — first secret chest)"
            style={{ ...inputStyle, WebkitAppRegion:"no-drag" }}/>

          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            <button onClick={() => setType("guide")} style={lblBtn(type === "guide")}>GUIDE</button>
            <button onClick={() => setType("secret_chest")} style={lblBtn(type === "secret_chest")}>SECRET CHEST</button>
          </div>

          <input value={activity} onChange={e => setActivity(e.target.value)} maxLength={200}
            placeholder="Activity (optional, e.g. Warlord's Ruin)"
            style={{ ...inputStyle, WebkitAppRegion:"no-drag" }}/>

          {/* Optional item link */}
          {item ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8,
              padding:"5px 8px", background:C.panelAlt, border:`1px solid ${C.border}` }}>
              <span style={{ fontSize:11, color:C.sub }}>Links to</span>
              <span style={{ fontSize:12, color:C.text, fontWeight:600, flex:1, minWidth:0,
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</span>
              <button onClick={() => setItem(null)} style={{ background:"none", border:`1px solid ${C.border}`,
                color:C.sub, fontSize:10, padding:"2px 7px", cursor:"pointer", WebkitAppRegion:"no-drag" }}>✕</button>
            </div>
          ) : (
            <div style={{ position:"relative", marginBottom:8 }}>
              <input value={itemQuery} onChange={e => searchItem(e.target.value)} maxLength={60}
                placeholder="Link to an item card (optional — search a weapon/armour)"
                style={{ ...inputStyle, marginBottom:0, WebkitAppRegion:"no-drag" }}/>
              {itemHits.length > 0 && (
                <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:5,
                  background:C.panelAlt, border:`1px solid ${C.borderHi}`, maxHeight:170, overflowY:"auto" }}>
                  {itemHits.map((h) => (
                    <div key={h.itemHash} onClick={() => { setItem({ itemHash:h.itemHash, name:h.name }); setItemHits([]); setItemQuery(""); }}
                      style={{ padding:"6px 9px", cursor:"pointer", borderBottom:`1px solid ${C.muted}`,
                        display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:12, color:C.text, flex:1, minWidth:0,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{h.name}</span>
                      <span style={{ fontSize:9, color:C.sub, letterSpacing:"0.08em", flexShrink:0 }}>
                        {(h.itemType || "").toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Steps */}
          <Lbl mb={4}>Steps</Lbl>
          {steps.map((s, i) => (
            <div key={i} style={{ display:"flex", gap:6, marginBottom:6, alignItems:"flex-start" }}>
              <span style={{ color:C.gold, fontFamily:"'Barlow Condensed',sans-serif", fontSize:12,
                fontWeight:700, marginTop:7, flexShrink:0 }}>{i + 1}.</span>
              <div style={{ flex:1, minWidth:0 }}>
                <input value={s.title} onChange={e => setStep(i, "title", e.target.value)} maxLength={200}
                  placeholder="Step title" style={{ ...inputStyle, marginBottom:4, WebkitAppRegion:"no-drag" }}/>
                <textarea value={s.description} onChange={e => setStep(i, "description", e.target.value)} maxLength={2000}
                  placeholder="What to do" rows={2}
                  style={{ ...inputStyle, marginBottom:0, resize:"vertical", WebkitAppRegion:"no-drag" }}/>
              </div>
              <button onClick={() => removeStep(i)} disabled={steps.length === 1} title="Remove step" style={{
                background:"none", border:`1px solid ${C.border}`, color:C.sub, fontSize:10,
                padding:"2px 7px", marginTop:5, cursor:steps.length===1?"default":"pointer",
                WebkitAppRegion:"no-drag", flexShrink:0 }}>✕</button>
            </div>
          ))}
          <button onClick={addStep} disabled={steps.length >= 60} style={{
            background:"none", border:`1px dashed ${C.border}`, color:C.sub,
            fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
            letterSpacing:"0.1em", padding:"4px 10px", marginBottom:8, cursor:"pointer",
            WebkitAppRegion:"no-drag" }}>+ ADD STEP</button>

          <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000}
            placeholder="Notes (optional)" rows={2}
            style={{ ...inputStyle, resize:"vertical", WebkitAppRegion:"no-drag" }}/>

          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={save} disabled={saving} style={{
              background:C.greenLo, border:`1px solid ${C.green}`, color:C.green,
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
              letterSpacing:"0.12em", padding:"6px 14px", cursor:saving?"default":"pointer",
              WebkitAppRegion:"no-drag" }}>
              {saving ? "SAVING…" : "SAVE GUIDE"}
            </button>
            {msg && <span style={{ fontSize:11, color: msg.err ? C.red : C.green, lineHeight:1.4 }}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Guides / secret-chest walkthroughs for the on-screen item ────────────────
   Renders any imported guide whose itemHash matches the item. Each guide is
   an expandable card with optional ordered steps. Self-hides when none match. */
export function GuidesPanel({ guides }) {
  const [openId, setOpenId] = useState(null);
  if (!guides || !guides.length) return null;
  return (
    <Panel bc={C.gold} style={{ marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <Lbl color={C.gold} mb={0}>Guides &amp; Secret Chests</Lbl>
        <Badge label={`${guides.length}`} color={C.gold} bg={C.goldLo}/>
      </div>
      {guides.map((g) => {
        const open = openId === g.id;
        return (
          <div key={g.id} style={{ borderBottom:`1px solid ${C.muted}`, paddingBottom:open?8:0 }}>
            <div onClick={() => setOpenId(open ? null : g.id)} style={{ display:"flex", alignItems:"center",
              gap:8, padding:"7px 0", cursor:"pointer" }}>
              <span style={{ color:C.gold, fontSize:10, flexShrink:0 }}>
                {g.type === "secret_chest" ? "▣" : "◈"}
              </span>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
                  color:C.text, letterSpacing:"0.04em" }}>{g.title}</div>
                {(g.activity || g.source) && (
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9, color:C.sub, letterSpacing:"0.1em" }}>
                    {[g.activity, g.source].filter(Boolean).join(" · ").toUpperCase()}
                  </div>
                )}
              </div>
              <span style={{ color:C.sub, fontSize:11, flexShrink:0 }}>{open ? "▲" : "▼"}</span>
            </div>
            {open && (
              <div style={{ paddingLeft:18 }}>
                {g.steps?.length > 0 ? g.steps.map((s, i) => (
                  <div key={i} style={{ display:"flex", gap:8, marginBottom:7, alignItems:"flex-start" }}>
                    <span style={{ color:C.gold, fontFamily:"'Barlow Condensed',sans-serif", fontSize:11,
                      fontWeight:700, flexShrink:0, marginTop:1 }}>{i+1}.</span>
                    <div style={{ minWidth:0 }}>
                      {s.title && <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.4 }}>{s.title}</div>}
                      {s.description && <div style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{s.description}</div>}
                    </div>
                  </div>
                )) : (
                  <div style={{ fontSize:12, color:C.sub, lineHeight:1.5, paddingBottom:6 }}>
                    {g.notes || "No steps provided."}
                  </div>
                )}
                {g.steps?.length > 0 && g.notes && (
                  <div style={{ fontSize:11, color:C.sub, fontStyle:"italic", lineHeight:1.5,
                    borderLeft:`2px solid ${C.border}`, paddingLeft:8, marginTop:4 }}>{g.notes}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

/* ── Guides section (dedicated home for imported / authored walkthroughs) ─────
   Guides are grouped by activity so the list stays navigable as more packs are
   added. Within each activity group, guides expand individually as before.
   ItemHash-less secret-chest routes are readable here even without a linked item. */
export function Guides({ guides, onImportGuideFile, onExportGuides, onDeleteGuide,
  onBrowseLibrary, onImportCommunityGuide, onCreateGuide }) {
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [openId, setOpenId]         = useState(null);

  const toggleGroup = useCallback((key) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggle = (id) => setOpenId(cur => cur === id ? null : id);

  // Group by activity; guides with no activity go last under "Other"
  const groups = useMemo(() => {
    const map = new Map();
    for (const g of (guides || [])) {
      const key = g.activity || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
  }, [guides]);

  return (
    <Panel bc={C.gold} style={{ marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <Lbl color={C.gold} mb={0}>Guides &amp; Secret Chests</Lbl>
        {guides?.length ? <Badge label={`${guides.length}`} color={C.gold} bg={C.goldLo}/> : null}
      </div>
      <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, marginBottom:8 }}>
        Import shareable <span style={{ color:C.text }}>.ghostpkg.json</span> walkthroughs
        (secret-chest routes, encounter guides). Tap any guide to read its steps. Guides
        tied to a weapon also surface on that item's card. You can drag a file onto this
        window to import.
      </div>

      {/* Import / Export */}
      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <button onClick={onImportGuideFile} style={{ flex:1,
          background:C.blueLo, border:`1px solid ${C.blue}`, color:C.blue,
          fontFamily:"'Barlow Condensed',sans-serif", fontSize:11, fontWeight:700,
          letterSpacing:"0.1em", padding:"6px 10px", cursor:"pointer", WebkitAppRegion:"no-drag" }}>
          IMPORT FILE
        </button>
        <button onClick={onExportGuides} disabled={!guides?.length} style={{ flex:1,
          background:C.muted, border:`1px solid ${guides?.length ? C.border : C.muted}`,
          color:guides?.length ? C.sub : C.muted, fontFamily:"'Barlow Condensed',sans-serif",
          fontSize:11, fontWeight:700, letterSpacing:"0.1em", padding:"6px 10px",
          cursor:guides?.length ? "pointer" : "default", WebkitAppRegion:"no-drag" }}>
          EXPORT
        </button>
      </div>

      {/* Activity-grouped guide list */}
      {groups.length ? groups.map(([activity, items]) => {
        const groupOpen = openGroups.has(activity);
        return (
          <div key={activity} style={{ marginBottom:2 }}>
            <div onClick={() => toggleGroup(activity)} style={{
              display:"flex", alignItems:"center", gap:8, padding:"7px 0",
              cursor:"pointer", borderBottom:`1px solid ${groupOpen ? C.border : C.muted}`,
              WebkitAppRegion:"no-drag" }}>
              <span style={{ color:C.gold, fontSize:8, flexShrink:0, lineHeight:1 }}>
                {groupOpen ? "▼" : "▶"}
              </span>
              <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:11,
                fontWeight:700, letterSpacing:"0.12em", color:C.sub, flex:1,
                textTransform:"uppercase" }}>{activity}</span>
              <Badge label={`${items.length}`} color={C.gold} bg={C.goldLo}/>
            </div>
            {groupOpen && (
              <div style={{ paddingLeft:8, borderLeft:`2px solid ${C.muted}`, marginBottom:4 }}>
                {items.map((g) => {
                  const open = openId === g.id;
                  return (
                    <div key={g.id} style={{ borderBottom:`1px solid ${C.muted}`, paddingBottom:open?8:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 0" }}>
                        <div onClick={() => toggle(g.id)} style={{ display:"flex", alignItems:"center",
                          gap:8, minWidth:0, flex:1, cursor:"pointer" }}>
                          <span style={{ color:C.gold, fontSize:10, flexShrink:0 }}>
                            {g.type === "secret_chest" ? "▣" : "◈"}
                          </span>
                          <div style={{ minWidth:0, flex:1 }}>
                            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14,
                              fontWeight:700, color:C.text, letterSpacing:"0.04em",
                              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {g.title}
                            </div>
                            {(g.item || g.source) && (
                              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:9,
                                color:C.sub, letterSpacing:"0.1em" }}>
                                {[g.item, g.source].filter(Boolean).join(" · ").toUpperCase()}
                              </div>
                            )}
                          </div>
                          <span style={{ color:C.sub, fontSize:11, flexShrink:0 }}>{open ? "▲" : "▼"}</span>
                        </div>
                        <button onClick={() => onDeleteGuide?.(g.id)} title="Remove guide" style={{
                          background:"none", border:`1px solid ${C.border}`, color:C.sub,
                          fontFamily:"'Barlow Condensed',sans-serif", fontSize:10, fontWeight:700,
                          letterSpacing:"0.1em", padding:"3px 8px", cursor:"pointer", flexShrink:0,
                          WebkitAppRegion:"no-drag" }}>✕</button>
                      </div>
                      {open && (
                        <div style={{ paddingLeft:18 }}>
                          {g.steps?.length > 0 ? g.steps.map((s, i) => (
                            <div key={i} style={{ display:"flex", gap:8, marginBottom:7, alignItems:"flex-start" }}>
                              <span style={{ color:C.gold, fontFamily:"'Barlow Condensed',sans-serif",
                                fontSize:11, fontWeight:700, flexShrink:0, marginTop:1 }}>{i+1}.</span>
                              <div style={{ minWidth:0 }}>
                                {s.title && <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.4 }}>{s.title}</div>}
                                {s.description && <div style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{s.description}</div>}
                              </div>
                            </div>
                          )) : (
                            <div style={{ fontSize:12, color:C.sub, lineHeight:1.5, paddingBottom:6 }}>
                              {g.notes || "No steps provided."}
                            </div>
                          )}
                          {g.steps?.length > 0 && g.notes && (
                            <div style={{ fontSize:11, color:C.sub, fontStyle:"italic", lineHeight:1.5,
                              borderLeft:`2px solid ${C.border}`, paddingLeft:8, marginTop:4 }}>{g.notes}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }) : (
        <div style={{ fontSize:11, color:C.sub, lineHeight:1.5, fontStyle:"italic", padding:"4px 0 2px" }}>
          No guides yet. Import a file, browse the community library, or create one below.
        </div>
      )}

      {/* Browse + one-click import curated packs from the data API. */}
      <CommunityLibrary onBrowse={onBrowseLibrary} onImport={onImportCommunityGuide}/>

      {/* Author your own guide in-app (same limits as an imported package). */}
      <CreateGuideForm onCreate={onCreateGuide}/>
    </Panel>
  );
}
