import React, { useEffect, useState } from 'react';

const NEW_URL = 'https://p2r3.github.io/convert/';

/** A closable notice shown on every visit: this site is no longer maintained, the original converter is the one to use. */
export default function MovedNotice() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: '#07080Fcc',
        backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: "'Space Grotesk','Segoe UI',sans-serif",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="moved-notice-title"
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', maxWidth: 420, width: '100%', background: '#0C0D1A',
          border: '1px solid #ffffff14', borderRadius: 16, padding: '28px 24px 24px',
          color: '#E8E8FF', textAlign: 'center', boxShadow: '0 20px 60px #000a',
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute', top: 10, right: 12, width: 32, height: 32, cursor: 'pointer',
            fontSize: 22, lineHeight: '32px', color: '#ffffff66', borderRadius: 8,
          }}
        >
          ×
        </button>
        <h2 id="moved-notice-title" style={{ fontSize: 20, fontWeight: 700, color: '#FF6B9D', marginBottom: 10 }}>
          This site is no longer maintained
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: '#E8E8FFcc', marginBottom: 22 }}>
          FCO.TOOLS is no longer maintained and might stop working at any time. Please use the original converter instead.
        </p>
        <a
          href={NEW_URL}
          style={{
            display: 'inline-block', background: 'linear-gradient(135deg,#FF6B9D,#C77DFF)', borderRadius: 12,
            padding: '11px 28px', fontSize: 14, fontWeight: 700, color: '#07080F', textDecoration: 'none',
          }}
        >
          Go to the original converter
        </a>
      </div>
    </div>
  );
}
