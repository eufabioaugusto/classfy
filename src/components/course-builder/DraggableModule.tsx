import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ReactNode } from "react";

interface DraggableModuleWrapperProps {
  id: string;
  children: (props: {
    ref: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    isDragging: boolean;
    handleProps: any;
  }) => ReactNode;
}

export function DraggableModuleWrapper({ id, children }: DraggableModuleWrapperProps) {
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
    <>
      {children({
        ref: setNodeRef,
        style,
        isDragging,
        handleProps: { ...attributes, ...listeners },
      })}
    </>
  );
}

export function DragHandle({ handleProps }: { handleProps: any }) {
  return (
    <div
      {...handleProps}
      className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded transition-colors"
    >
      <GripVertical className="w-5 h-5 text-muted-foreground" />
    </div>
  );
}