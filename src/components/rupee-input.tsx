import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";

/** Rupee amount text field (numeric keypad on phones). Value is the raw string; parse with rupeesToPaise. */
export function RupeeInput({ className, onChange, ...props }: Omit<ComponentProps<typeof Input>, "onChange"> & { onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">₹</span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        className={cn("h-11 pl-7 tabular-nums md:h-9", className)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        {...props}
      />
    </div>
  );
}
