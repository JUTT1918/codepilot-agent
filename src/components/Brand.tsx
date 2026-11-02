export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-lockup${compact ? ' brand-lockup-compact' : ''}`} aria-label="Codepilot">
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M22.8 8.2h-7.3a7.8 7.8 0 1 0 0 15.6h7.3" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M14.4 12.4v7.2m4.2-7.2v7.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="brand-name">codepilot</span>}
    </span>
  );
}
