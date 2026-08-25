/**
 * The Solvigo Airways lockup: the plateless mark plus the wordmark.
 *
 * The artwork is copied from the brand sheet, not redrawn — the sheet
 * designates this plateless variant for PRODUCT surfaces (the plated lockups
 * are for docs and marketing) and its scale ramp is proven down to 16px, so a
 * hand-rewritten polygon would be a different mark that merely looked similar.
 * Painting order is part of it: the left wing goes down first and the darker
 * right wing over it.
 *
 * The wordmark is the sheet's own spec — Jost 600, tracking 0.012em, sentence
 * case, never all-caps — which is why it does not inherit the app's body font.
 */
export function AirwaysMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="block shrink-0"
      role="img"
      aria-label="Solvigo Airways"
    >
      <polygon
        points="32,4 8,48 26,44 32,52"
        fill="#F54E00"
        transform="translate(2.85 -2.85) rotate(45 32 32)"
      />
      <polygon
        points="32,4 32,52 38,44 56,48"
        fill="#C23E00"
        transform="translate(2.85 -2.85) rotate(45 32 32)"
      />
    </svg>
  );
}

export function AirwaysWordmark({ className }: { className?: string }) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-tower-wordmark)",
        fontWeight: 600,
        letterSpacing: "0.012em",
      }}
    >
      Solvigo Airways
    </span>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-1 pt-0.5">
      <AirwaysMark size={22} />
      <AirwaysWordmark className="truncate text-[14px] text-foreground" />
    </div>
  );
}

export default BrandLockup;
