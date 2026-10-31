import type { ComponentProps } from "react";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";

/** Native <select>: the OS picker is the best picker on phones. */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-11 w-full appearance-none rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:h-9 md:text-sm dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-60" />
    </div>
  );
}
