/**
 * Solvigo rank insignia — position on the field, not decoration.
 *
 * Lifted from the Captain's insignia sheet, which is deliberate about what each
 * mark IS: the commander is an emblem rather than an aircraft (a winged shield
 * that never flies), a lead owns a FORMATION, and a sortie is a single jet in
 * level flight. The family is held together by colour and facet, not by shape.
 *
 * Two states, and colour alone is not enough:
 *   working — brighter neutral PLUS one moving element. Motion says live.
 *   waiting — no motion at all; solid but greyed. Present but idle, never broken.
 *
 * Detail drops with size: at 16px the shield sheds a wing bar each side and the
 * formation falls to two aircraft. Silhouette survives, decoration does not.
 */

export type Rank = "commander" | "lead" | "sortie";
export type RankState = "working" | "waiting";

const WORKING = {
  primary: "var(--color-tower-fg-body)",
  secondary: "var(--color-tower-fg-dim)",
  shield: "var(--color-tower-fg-body)",
  bar: "var(--color-tower-fg-dim)",
};
const WAITING = {
  primary: "var(--color-tower-fg-dim)",
  secondary: "var(--color-tower-fg-faint)",
  shield: "var(--color-tower-fg-dim)",
  bar: "var(--color-tower-fg-faint)",
};

/** One jet, nose right — level flight. */
function Jet({ t, transform }: { t: typeof WORKING; transform?: string }) {
  const rot = "rotate(90 32 32)";
  const full = transform ? `${transform} ${rot}` : rot;
  return (
    <>
      <polygon
        points="32,4 8,48 26,44 32,52"
        fill={t.primary}
        transform={full}
      />
      <polygon
        points="32,4 32,52 38,44 56,48"
        fill={t.secondary}
        transform={full}
      />
    </>
  );
}

/**
 * The plate follows the same neutral surface and edge as the rest of the app.
 *
 * What sits ON the plate is deliberately NOT the brand mark. The sheet's plated
 * lockup is a fixed identity in white; this is a rank-and-state device, and it
 * has to say three ranks and two states. Borrowing the identity to mean "this
 * agent is working" would make the brand mean something it does not. Same
 * plate, different device. The mark occupies ~65% of the tile, as the sheet's
 * own ramp does.
 */
export function PlatedInsignia({
  plate = 34,
  className,
  ...props
}: Parameters<typeof RankInsignia>[0] & { plate?: number }) {
  return (
    <span
      className={
        "inline-grid shrink-0 place-items-center rounded-[4.5px] " +
        (className ?? "")
      }
      style={{
        width: plate,
        height: plate,
        background: "var(--color-tower-input)",
        boxShadow: "inset 0 0 0 1px var(--color-tower-border)",
      }}
    >
      <RankInsignia {...props} size={props.size ?? Math.round(plate * 0.65)} />
    </span>
  );
}

export function RankInsignia({
  rank,
  state = "waiting",
  size = 26,
  title,
  className,
}: {
  rank: Rank;
  state?: RankState;
  /** 26 is the full mark; at 16 or below the sheet's reduced detail applies. */
  size?: number;
  title?: string;
  className?: string;
}) {
  const t = state === "working" ? WORKING : WAITING;
  const live = state === "working";
  const small = size <= 16;
  // Named via aria-label only: an SVG <title> child would join the host's
  // textContent and leak the rank into the surrounding copy.
  const label = title ?? `${rank} · ${state}`;

  if (rank === "commander") {
    // A winged shield: three bars each side, two when small.
    const bars = small
      ? [
          "2,18 36,18 36,30 10,30",
          "12,38 36,38 36,50 20,50",
          "126,18 92,18 92,30 118,30",
          "116,38 92,38 92,50 108,50",
        ]
      : [
          "2,16 36,16 36,26 8,26",
          "8,32 36,32 36,42 14,42",
          "16,48 36,48 36,58 22,58",
          "126,16 92,16 92,26 120,26",
          "120,32 92,32 92,42 114,42",
          "112,48 92,48 92,58 106,58",
        ];
    return (
      <svg
        viewBox="0 0 128 88"
        width={size * 1.15}
        height={size}
        role="img"
        aria-label={label}
        className={className}
      >
        {bars.map((points) => (
          <polygon key={points} points={points} fill={t.bar} />
        ))}
        <path
          d="M 64 8 L 84 17 L 84 44 Q 84 62 64 78 Q 44 62 44 44 L 44 17 Z"
          fill={t.shield}
          className={live ? "tower-ins-pulse" : undefined}
        />
      </svg>
    );
  }

  if (rank === "lead") {
    // A formation: the lead aircraft and its wingmen — two when small.
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label={label}
        className={className}
      >
        <g className={live ? "tower-ins-climb" : undefined}>
          <Jet t={t} transform="translate(24 13) scale(0.6)" />
          <Jet
            t={t}
            transform={
              small
                ? "translate(2 19) scale(0.32)"
                : "translate(2 8.5) scale(0.3)"
            }
          />
          {small ? null : (
            <Jet t={t} transform="translate(2 38.5) scale(0.3)" />
          )}
        </g>
      </svg>
    );
  }

  // A sortie: one jet, in level flight.
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={className}
    >
      <title>{label}</title>
      <g className={live ? "tower-ins-climb" : undefined}>
        <Jet t={t} />
      </g>
    </svg>
  );
}

export default RankInsignia;
