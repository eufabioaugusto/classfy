import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-center"
      offset={80} // Acima do bottom nav no mobile
      gap={8}
      toastOptions={{
        classNames: {
          toast:
            "group toast backdrop-blur-xl backdrop-saturate-150 border border-white/10 rounded-2xl shadow-xl " +
            "bg-black/80 text-white dark:bg-white/90 dark:text-black " +
            "data-[type=error]:bg-destructive/90 data-[type=error]:text-destructive-foreground",
          description: "group-[.toast]:opacity-80 text-sm",
          actionButton: 
            "group-[.toast]:bg-white/20 group-[.toast]:hover:bg-white/30 " +
            "dark:group-[.toast]:bg-black/20 dark:group-[.toast]:hover:bg-black/30 " +
            "rounded-lg px-3 text-sm font-medium",
          cancelButton: 
            "group-[.toast]:bg-white/10 group-[.toast]:text-white/70 " +
            "dark:group-[.toast]:bg-black/10 dark:group-[.toast]:text-black/70",
          closeButton:
            "group-[.toast]:text-white/60 group-[.toast]:hover:text-white " +
            "dark:group-[.toast]:text-black/60 dark:group-[.toast]:hover:text-black",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
