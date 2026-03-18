'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, ChevronRight } from 'lucide-react'
import { SORA } from '@/lib/styles'

interface FGEntry {
  value: number
  label: string
}

interface FGData {
  now: FGEntry
  yesterday: FGEntry
  weekAgo: FGEntry
  monthAgo: FGEntry
}

function getColor(v: number): string {
  if (v <= 25) return '#ef4444'   // Extreme Fear — vermelho
  if (v <= 45) return '#f97316'   // Fear — laranja
  if (v <= 55) return '#eab308'   // Neutral — amarelo
  if (v <= 75) return '#22c55e'   // Greed — verde
  return '#10b981'                 // Extreme Greed — verde escuro
}

function getMiniLabel(v: number): string {
  if (v <= 25) return 'Ext. Fear'
  if (v <= 45) return 'Fear'
  if (v <= 55) return 'Neutral'
  if (v <= 75) return 'Greed'
  return 'Ext. Greed'
}

// Arco SVG semi-circular para o gauge
function GaugeArc({ value }: { value: number }) {
  const color = getColor(value)

  // Semi-círculo: de 180° a 0° (esquerda para direita)
  // Usamos um path de arco em SVG
  const R = 70
  const cx = 90
  const cy = 85
  const totalAngle = Math.PI // 180°
  const angle = (value / 100) * totalAngle

  // Ponto de início (esquerda) e ponto atual
  const startX = cx - R
  const startY = cy
  const endX = cx + Math.cos(Math.PI - angle) * R
  const endY = cy - Math.sin(angle) * R
  const largeArc = angle > Math.PI / 2 ? 1 : 0

  // Posição do ponteiro
  const needleAngle = Math.PI - angle
  const needleX = cx + Math.cos(needleAngle) * (R - 8)
  const needleY = cy - Math.sin(Math.PI - needleAngle) * (R - 8)

  return (
    <svg width="180" height="100" viewBox="0 0 180 100">
      {/* Faixas coloridas de fundo do arco */}
      {[
        { from: 0, to: 20, color: '#fecaca' },
        { from: 20, to: 40, color: '#fed7aa' },
        { from: 40, to: 60, color: '#fef08a' },
        { from: 60, to: 80, color: '#bbf7d0' },
        { from: 80, to: 100, color: '#6ee7b7' },
      ].map((seg) => {
        const a1 = Math.PI - (seg.from / 100) * Math.PI
        const a2 = Math.PI - (seg.to / 100) * Math.PI
        const x1 = cx + Math.cos(a1) * R
        const y1 = cy - Math.sin(a1) * R
        const x2 = cx + Math.cos(a2) * R
        const y2 = cy - Math.sin(a2) * R
        return (
          <path
            key={seg.from}
            d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`}
            fill="none"
            stroke={seg.color}
            strokeWidth="14"
            strokeLinecap="butt"
          />
        )
      })}

      {/* Arco de progresso colorido */}
      {value > 0 && (
        <path
          d={`M ${startX} ${startY} A ${R} ${R} 0 ${largeArc} 1 ${endX} ${endY}`}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          style={{ transition: 'all 1s ease' }}
        />
      )}

      {/* Valor central */}
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        fontSize="26"
        fontWeight="700"
        fill={color}
        fontFamily="Sora, sans-serif"
        style={{ transition: 'fill 0.5s ease' }}
      >
        {value}
      </text>

      {/* Labels extremos */}
      <text x="10" y="98" fontSize="8" fill="#9ca3af" textAnchor="middle">Fear</text>
      <text x="170" y="98" fontSize="8" fill="#9ca3af" textAnchor="middle">Greed</text>
    </svg>
  )
}

export default function FearAndGreed() {
  const [data, setData] = useState<FGData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchData = async () => {
    try {
      setError(false)
      const res = await fetch('/api/fear-greed')
      if (!res.ok) throw new Error('fetch failed')
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800" style={SORA}>
          Fear & Greed
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-all"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <a
            href="https://alternative.me/crypto/fear-and-greed-index/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-0.5"
          >
            Source <ChevronRight size={11} />
          </a>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <div className="skeleton w-40 h-24 rounded-xl" />
          <div className="skeleton w-24 h-4 rounded" />
          <div className="grid grid-cols-2 gap-2 w-full mt-2">
            <div className="skeleton h-14 rounded-xl" />
            <div className="skeleton h-14 rounded-xl" />
            <div className="skeleton h-14 rounded-xl" />
            <div className="skeleton h-14 rounded-xl" />
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <p className="text-sm text-gray-400">Could not load index</p>
          <button onClick={fetchData} className="btn-primary text-xs px-4 py-2">
            Try again
          </button>
        </div>
      )}

      {/* Data */}
      {!loading && !error && data && (
        <div className="flex flex-col items-center">
          {/* Gauge */}
          <GaugeArc value={data.now.value} />

          {/* Label */}
          <div className="mt-1 mb-4 text-center">
            <span
              className="text-base font-bold"
              style={{ ...SORA, color: getColor(data.now.value) }}
            >
              {data.now.label}
            </span>
            <p className="text-xs text-gray-400 mt-0.5">Updated daily</p>
          </div>

          {/* Historical grid */}
          <div className="w-full grid grid-cols-2 gap-2">
            {[
              { label: 'Yesterday', entry: data.yesterday },
              { label: 'Last Week', entry: data.weekAgo },
              { label: 'Last Month', entry: data.monthAgo },
              { label: 'Now', entry: data.now },
            ].map(({ label, entry }) => (
              <div
                key={label}
                className="rounded-xl p-3 text-center"
                style={{ background: `${getColor(entry.value)}11`, border: `1px solid ${getColor(entry.value)}33` }}
              >
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className="font-bold text-gray-800 text-lg" style={SORA}>
                  {entry.value}
                </p>
                <p className="text-xs font-medium" style={{ color: getColor(entry.value) }}>
                  {getMiniLabel(entry.value)}
                </p>
              </div>
            ))}
          </div>

          {/* Source credit */}
          <p className="text-xs text-gray-400 mt-4">
            Data via{' '}
            <a
              href="https://alternative.me/crypto/fear-and-greed-index/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-500 hover:text-violet-700"
            >
              Alternative.me
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
