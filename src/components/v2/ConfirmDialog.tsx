import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface V2ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  summary?: string;
  items?: string[];
  hiddenItemCount?: number;
  confirmLabel: string;
  workingLabel?: string;
  cancelLabel?: string;
  isWorking?: boolean;
  confirmDisabled?: boolean;
  tone?: "danger" | "accent";
  layer?: "default" | "nested";
  onConfirm: () => void | Promise<void>;
}

export function V2ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  summary,
  items = [],
  hiddenItemCount = 0,
  confirmLabel,
  workingLabel = "Processando...",
  cancelLabel = "Cancelar",
  isWorking = false,
  confirmDisabled = false,
  tone = "danger",
  layer = "default",
  onConfirm,
}: V2ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isWorking) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent
        className={cn(
          "cf-v2 cf2-confirm-dialog",
          layer === "nested" && "z-[101]",
        )}
        overlayClassName={layer === "nested" ? "z-[100]" : undefined}
        data-tone={tone}
      >
        <div className="cf2-confirm-dialog__top">
          <span className="cf2-confirm-dialog__icon" aria-hidden="true">
            <Trash2 />
          </span>
          <AlertDialogHeader className="cf2-confirm-dialog__header">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        {(summary || items.length > 0) && (
          <div className="cf2-confirm-dialog__summary">
            {summary && <strong>{summary}</strong>}
            {items.length > 0 && (
              <ul>
                {items.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
                {hiddenItemCount > 0 && (
                  <li className="cf2-confirm-dialog__more">
                    mais {hiddenItemCount}{" "}
                    {hiddenItemCount === 1 ? "item" : "itens"}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        <AlertDialogFooter className="cf2-confirm-dialog__footer">
          <AlertDialogCancel
            className="cf2-button cf2-button--secondary"
            disabled={isWorking}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              "cf2-button",
              tone === "danger" ? "cf2-button--danger" : "cf2-button--primary",
            )}
            disabled={isWorking || confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
          >
            {isWorking ? workingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
