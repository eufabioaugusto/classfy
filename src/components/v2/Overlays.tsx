import * as React from "react";
import {
  Dialog as BaseDialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogContent as BaseDialogContent,
} from "@/components/ui/dialog";
import {
  Sheet as BaseSheet,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetContent as BaseSheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Dialog = BaseDialog;
export { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger };

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof BaseDialogContent>,
  React.ComponentPropsWithoutRef<typeof BaseDialogContent>
>(({ className, ...props }, ref) => (
  <BaseDialogContent ref={ref} className={cn("cf-v2 cf2-dialog-surface", className)} {...props} />
));
DialogContent.displayName = "DialogContent";

export const Sheet = BaseSheet;
export { SheetClose, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger };

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof BaseSheetContent>,
  React.ComponentPropsWithoutRef<typeof BaseSheetContent>
>(({ className, ...props }, ref) => (
  <BaseSheetContent ref={ref} className={cn("cf-v2 cf2-sheet-surface", className)} {...props} />
));
SheetContent.displayName = "SheetContent";
