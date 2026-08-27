import { cn } from "@bb/shared-ui/lib/utils";
import { AIRWAYS_BRAND_ASSETS } from "@/lib/brand-assets";
import { PRODUCT_NAME } from "@/lib/product";

export function AirwaysMark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={
        size < 18
          ? AIRWAYS_BRAND_ASSETS.smallMark
          : AIRWAYS_BRAND_ASSETS.largeMark
      }
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
    <div className="flex h-[60px] items-center justify-center overflow-hidden px-2">
      <img
        src={AIRWAYS_BRAND_ASSETS.sidebarLockup}
        alt={PRODUCT_NAME}
        className="block h-auto w-[240px] max-w-none shrink-0 select-none object-contain"
        draggable={false}
      />
    </div>
  );
}

export default BrandLockup;
