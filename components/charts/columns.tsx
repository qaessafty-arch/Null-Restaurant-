'use client'

import { useMemo, useState } from 'react'

/**
 * Single-series column chart (SVG). One hue (the brand accent, validated against light and dark
 * surfaces), so no legend: the card title names the series. Marks: columns <= 24px wide with a 4px
 * rounded data end, square at the baseline; hairline gridlines; per-column hover tooltip on a hit
 * target the full width of the band; a table view of the same numbers.
 */
export type Point = { key: string; label: string; value: number; detail?: string; title?: string }

function niceTicks(max: number) {
  if (max <= 0) return [0]
  const raw = max / 3
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}
const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(0)}K` : n.toLocaleString('en-US'))

export function Columns({ data, format, height = 200, labelEvery = 1, ariaLabel }: {
  data: Point[]; format: (n: number) => string; height?: number; labelEvery?: number; ariaLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const W = 720, H = height, padL = 44, padR = 8, padT = 12, padB = 26
  const max = Math.max(0, ...data.map((d) => d.value))
  const ticks = useMemo(() => niceTicks(max), [max])
  const top = ticks[ticks.length - 1] || 1
  const band = (W - padL - padR) / Math.max(1, data.length)
  const bw = Math.min(24, Math.max(3, band - 2))
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top)
  const empty = data.every((d) => d.value === 0)

  return (
    <div className="chart">
      {empty ? <p className="chart-empty">No sales in this period yet.</p> : (
        <div className="chart-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">{compact(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = padL + band * i + (band - bw) / 2
              const h = Math.max(0, y(0) - y(d.value))
              const r = Math.min(4, bw / 2, h)
              return (
                <g key={d.key}>
                  {h > 0 && <path className={`chart-bar ${hover === i ? 'on' : ''}`}
                    d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${y(0)} Z`} />}
                  {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="chart-tick">{d.label}</text>}
                  <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
                </g>
              )
            })}
            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="chart-axis" />
          </svg>
          {hover !== null && data[hover] && (
            <div className="chart-tip" style={{ left: `${((padL + band * hover + band / 2) / W) * 100}%` }} role="status">
              <b>{data[hover].title ?? data[hover].label}</b><span>{format(data[hover].value)}</span>{data[hover].detail && <small>{data[hover].detail}</small>}
            </div>
          )}
        </div>
      )}
      <button type="button" className="chart-toggle" onClick={() => setTable(!table)} aria-expanded={table}>{table ? 'Hide table' : 'Show as table'}</button>
      {table && (
        <table className="chart-table">
          <tbody>{data.map((d) => <tr key={d.key}><th scope="row">{d.label}</th><td>{format(d.value)}</td>{d.detail !== undefined && <td>{d.detail}</td>}</tr>)}</tbody>
        </table>
      )}
    </div>
  )
}

/** Horizontal share bars: each row is labelled, so identity never relies on colour. */
export function ShareBars({ rows, format }: { rows: Array<{ key: string; label: string; value: number; note?: string }>; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((a, r) => a + r.value, 0) || 1
  if (!rows.length) return <p className="chart-empty">Nothing yet.</p>
  return (
    <ul className="share">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="share-label">{r.label}{r.note && <small>{r.note}</small>}</span>
          <span className="share-track" aria-hidden><i style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} /></span>
          <span className="share-value">{format(r.value)}<small>{Math.round((r.value / total) * 100)}%</small></span>
        </li>
      ))}
    </ul>
  )
}
