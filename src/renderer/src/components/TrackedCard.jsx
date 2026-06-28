// A tracked farm target showing each acquisition path, its drop rate, and an
// auto-incrementing run counter. Counts update live when the auto-tracker fires.
import React from 'react'

function percent(rate) {
  return `${Math.round(rate * 1000) / 10}%`
}

// Probability of at least one drop after N runs at rate p: 1 - (1 - p)^N.
function chanceByNow(rate, runs) {
  if (!rate) return 0
  return 1 - Math.pow(1 - rate, runs)
}

export default function TrackedCard({ item, paths, counts, onAdjust, onUntrack }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: 10,
        marginBottom: 10,
        background: 'var(--bg-soft)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {item.icon && <img src={item.icon} width={28} height={28} style={{ borderRadius: 4 }} alt="" />}
        <strong style={{ flex: 1 }}>{item.name || item.key}</strong>
        <button className="btn" onClick={() => onUntrack(item)}>
          ✕
        </button>
      </div>

      {paths.map((p) => {
        const key = `${item.key}::${p.id}`
        const runs = counts[key] || 0
        return (
          <div
            key={p.id}
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--line)'
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.method}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {p.location} · drop {percent(p.dropRate)} ·{' '}
              {p.farmable ? 'farmable' : `${p.weeklyLimitPerCharacter}/wk per char`}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <button className="btn" onClick={() => onAdjust(item.key, p.id, Math.max(0, runs - 1))}>
                −
              </button>
              <span style={{ minWidth: 42, textAlign: 'center', fontWeight: 700 }}>{runs}</span>
              <button className="btn" onClick={() => onAdjust(item.key, p.id, runs + 1)}>
                +
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                {percent(chanceByNow(p.dropRate, runs))} odds by now
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
