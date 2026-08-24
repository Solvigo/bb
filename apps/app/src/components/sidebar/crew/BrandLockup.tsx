/**
 * The Solvigo Airways mark, at the top of the rail. Renders the glyph inline
 * rather than through an <img> so it inherits the sidebar's own rendering and
 * cannot flash an empty box while a file loads.
 */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-1 pt-0.5">
      <svg
        viewBox="0 0 64 64"
        className="size-[22px] shrink-0"
        role="img"
        aria-label="Solvigo Airways"
      >
        <g transform="translate(2.85 -2.85) rotate(45 32 32)">
          <polygon points="32,4 32,52 38,44 56,48" fill="#C23E00" />
          <polygon points="32,4 8,48 26,44 32,52" fill="#F54E00" />
        </g>
      </svg>
      <span className="truncate text-[13.5px] font-semibold text-foreground">
        Solvigo Airways
      </span>
    </div>
  );
}

export default BrandLockup;
