import type { ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export interface DragHandleProps {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
}

export function DragHandle({ handle, label = "Drag to reorder" }: { handle: DragHandleProps; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="cursor-grab touch-none rounded p-1 text-subtle hover:bg-elevated hover:text-text active:cursor-grabbing"
      {...handle.attributes}
      {...handle.listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

function SortableRow<T>({ id, item, render }: { id: string; item: T; render: (item: T, handle: DragHandleProps, dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: "relative" }}
    >
      {render(item, { attributes: attributes as unknown as Record<string, unknown>, listeners }, isDragging)}
    </div>
  );
}

/**
 * A list reordered by dragging a handle (or with the keyboard: focus the
 * handle, press Space, move with arrows, Space again to drop).
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  render,
  horizontal,
  className,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder: (items: T[]) => void;
  render: (item: T, handle: DragHandleProps, dragging: boolean) => ReactNode;
  horizontal?: boolean;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item, i) => (
            <SortableRow key={ids[i]} id={ids[i]!} item={item} render={render} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
