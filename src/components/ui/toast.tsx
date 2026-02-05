import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      // Centralizado no rodapé, acima do bottom nav no mobile
      "fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] flex max-h-screen w-full max-w-[min(520px,calc(100vw-2rem))] flex-col gap-2 px-4",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  // Estilo glassmorphism Instagram-style com animações suaves
  cn(
    "group pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden rounded-2xl p-4 pr-10 shadow-xl",
    // Glassmorphism base
    "backdrop-blur-xl backdrop-saturate-150",
    // Border sutil
    "border border-white/10",
    // Swipe gestures
    "data-[swipe=cancel]:translate-y-0 data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none",
    // Animações de entrada e saída (de baixo para cima)
    "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out data-[swipe=end]:animate-toast-out"
  ),
  {
    variants: {
      variant: {
        // Tema claro: toast preto com glass
        default: "bg-black/80 text-white dark:bg-white/90 dark:text-black",
        // Destructive: vermelho com glass
        destructive: "bg-destructive/90 text-destructive-foreground border-destructive/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium transition-all",
      "bg-white/20 hover:bg-white/30 dark:bg-black/20 dark:hover:bg-black/30",
      "focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-0",
      "disabled:pointer-events-none disabled:opacity-50",
      "group-[.destructive]:bg-white/20 group-[.destructive]:hover:bg-white/30",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 transition-all",
      "text-white/60 hover:text-white hover:bg-white/10",
      "dark:text-black/60 dark:hover:text-black dark:hover:bg-black/10",
      "group-[.destructive]:text-white/60 group-[.destructive]:hover:text-white",
      "focus:outline-none focus:ring-2 focus:ring-white/30",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-[15px] font-semibold leading-tight", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-[14px] opacity-80 leading-normal", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
