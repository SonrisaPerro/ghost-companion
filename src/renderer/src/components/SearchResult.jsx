// A single Bungie manifest search hit with a "Track" action.
import React from 'react'

export default function SearchResult({ item, onTrack }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '8px',
        borderRadius: 8,
        border: '1px solid var(--line)',
        marginBottom: 6,
        background: 'var(--bg-soft)'
      }}
    >
      {item.icon ? (
        <img src={item.icon} alt="" width={36} height={36} style={{ borderRadius: 4 }} />
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: 4, background: 'var(--line)' }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {item.itemType || 'Item'}
          {item.sources?.length ? ` · ${item.sources[0]}` : ''}
        </div>
      </div>
      <button className="btn primary" onClick={() => onTrack(item)}>
        Track
      </button>
    </div>
  )
}
