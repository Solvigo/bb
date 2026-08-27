import { Button } from "@bb/shared-ui/button";
import { stopAutomationTarget } from "@/components/desktop-automation/DesktopAutomationBridge";

interface AutomationControlBannerProps {
  targetId: string;
}

export function AutomationControlBanner({
  targetId,
}: AutomationControlBannerProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        Agent or CLI is controlling this browser tab
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void stopAutomationTarget(targetId);
        }}
      >
        Stop
      </Button>
    </div>
  );
}
