import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
  variant?: "default" | "gradient";
  indeterminate?: boolean;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indicatorClassName, variant = "default", indeterminate = false, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative w-full overflow-hidden bg-secondary",
      variant === "gradient" ? "h-1 rounded-none" : "h-4 rounded-full",
      className
    )}
    {...props}
  >
    {indeterminate ? (
      <div 
        className={cn(
          "h-full w-1/3 animate-progress-indeterminate",
          variant === "gradient" 
            ? "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500" 
            : "bg-primary"
        )}
      />
    ) : (
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full w-full flex-1 transition-all duration-300 ease-out",
          variant === "gradient" 
            ? "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500" 
            : "bg-primary",
          indicatorClassName
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    )}
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
