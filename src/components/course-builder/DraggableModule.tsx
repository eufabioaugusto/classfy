import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DraggableModuleProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function DraggableModule({ id, children, className }: DraggableModuleProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        isDragging && "opacity-50 z-50",
        className
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-6 cursor-grab active:cursor-grabbing z-10 p-1 hover:bg-accent rounded transition-colors"
      >
        <GripVertical className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="pl-8">
        {children}
      </div>
    </div>
  );
}