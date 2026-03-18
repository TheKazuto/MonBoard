'use client'

export default function AdBanner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative overflow-visible ${className}`}
      style={{ minHeight: 90 }}
    >
      {/* Label no canto superior direito da borda */}
      <span style={{
        position: 'absolute',
        top: -8,
        right: 8,
        fontSize: 9,
        lineHeight: 1,
        color: '#c4b5fd',
        background: 'var(--ink-bg, #FAFAFF)',
        padding: '1px 4px',
        borderRadius: 3,
        letterSpacing: '0.04em',
        pointerEvents: 'none',
        zIndex: 1,
        userSelect: 'none',
      }}>
        Ad area
      </span>

      <iframe
        src="/api/ad-frame"
        title="Advertisement"
        scrolling="no"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 90,
          border: '1px dashed #e8e0fe',
          borderRadius: 12,
          display: 'block',
          background: 'transparent',
        }}
      />
    </div>
  )
}
