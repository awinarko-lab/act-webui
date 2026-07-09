import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/db/types";

interface StatusStyle {
  label: string;
  /** Tinted background + text color overlaid on the Badge shape. */
  className: string;
  /** Small leading dot color. */
  dot: string;
}

// Color per status (R12): running=blue, passed=green, failed=red, cancelled=gray.
// These overlay the Badge's base pill via twMerge (bg-*/text-* win over variants).
const STATUS_STYLES: Record<RunStatus, StatusStyle> = {
  running: {
    label: "Running",
    className:
      "bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  passed: {
    label: "Passed",
    className:
      "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    className:
      "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    dot: "bg-red-500",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "bg-zinc-400/20 text-zinc-600 dark:bg-zinc-500/25 dark:text-zinc-300",
    dot: "bg-zinc-400",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="secondary" className={cn(style.className, className)}>
      <span
        className={cn("size-1.5 rounded-full", style.dot)}
        aria-hidden="true"
      />
      {style.label}
    </Badge>
  );
}
