import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DraggableLessonProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function DraggableLesson({ id, children, className }: DraggableLessonProps) {
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
        isDragging && "opacity-50 z-50 ring-2 ring-primary",
        "transition-all duration-200",
        className
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="absolute left-2 top-4 cursor-grab active:cursor-grabbing z-10 p-1 hover:bg-accent rounded transition-colors"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="pl-6">
        {children}
      </div>
    </div>
  );
}