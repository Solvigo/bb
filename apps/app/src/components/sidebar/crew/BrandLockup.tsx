import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { PRODUCT_NAME } from "@/lib/product";

const DEPTH_MARK_SRC = "/brand/jet-depth-mono.svg";
const SMALL_MARK_SRC = "/brand/mark-white.svg";

export function AirwaysMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={size < 18 ? SMALL_MARK_SRC : DEPTH_MARK_SRC}
      alt=""
      width={size}
      height={size}
      className={cn("block shrink-0 select-none object-contain", className)}
      role="img"
      aria-label={PRODUCT_NAME}
      draggable={false}
    />
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
      {PRODUCT_NAME}
    </span>
  );
}

export function BrandLockup() {
  return (
    <div className="flex h-8 items-center gap-2 px-4 text-sidebar-foreground">
      <AirwaysMark size={20} />
      <AirwaysWordmark className="min-w-0 truncate text-sm" />
      <Icon
        name="ChevronDown"
        className="size-3 shrink-0 text-subtle-foreground"
        aria-hidden
      />
    </div>
  );
}

export default BrandLockup;
