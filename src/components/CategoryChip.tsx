import { cn } from "@/lib/utils";

interface CategoryChipProps {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export const CategoryChip = ({ label, icon, active, onClick }: CategoryChipProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-5 py-2.5 rounded-full cursor-pointer transition-all duration-300 text-sm font-medium whitespace-nowrap",
        "flex items-center gap-2",
        active
          ? "bg-white text-cinematic-black"
          : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
      )}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
      {label}
    </button>
  );
};