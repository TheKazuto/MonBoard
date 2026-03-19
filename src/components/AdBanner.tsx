'use client'

/**
 * AdBanner — área de banner para anúncios de parceiros.
 *
 * O sistema AdsTerra foi removido. Esta área exibe agora um placeholder
 * estático onde banners de imagem de parceiros serão inseridos manualmente.
 *
 * Para adicionar um banner de parceiro:
 *   1. Coloca a imagem em /public/banners/nome-parceiro.png
 *   2. Substitui o conteúdo interno por um <a> com <img>:
 *
 *   <a href="https://parceiro.com" target="_blank" rel="noopener noreferrer"
 *      style={{ display: 'block', width: '100%', height: '100%' }}>
 *     <img src="/banners/nome-parceiro.png" alt="Parceiro" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
 *   </a>
 */
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

      {/* Placeholder estático — substituir pelo banner do parceiro */}
      <a
        href="https://docs.google.com/forms/d/e/1FAIpQLSc4HmUzes30tavHHsK_4SHa9V3ksPIrXXkwQcjx1Cn9eZZhgQ/viewform"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          minHeight: 90,
          border: '1px dashed #e8e0fe',
          borderRadius: 12,
          background: 'transparent',
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(131,110,249,0.04)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <p style={{ fontSize: 12, color: '#c4b5fd', fontWeight: 500, letterSpacing: '0.02em' }}>
          Advertise here → Become a partner
        </p>
      </a>
    </div>
  )
}
