import { useLocation, useNavigate } from "react-router-dom";
import { Home, Search, Plus, MessageCircle, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  requiresAuth?: boolean;
  isCenter?: boolean;
}

const navItems: NavItem[] = [
  { icon: Home, label: "Explorar", path: "/" },
  { icon: Search, label: "Buscar", path: "/search" },
  { icon: Plus, label: "Estudar", path: "/study", requiresAuth: true, isCenter: true },
  { icon: MessageCircle, label: "Mensagens", path: "/messages", requiresAuth: true },
  { icon: Gift, label: "Recompensas", path: "/recompensas", requiresAuth: true },
];

// Routes where the bottom nav should be hidden
const hiddenRoutes = ["/watch", "/listen", "/shorts", "/auth", "/studio", "/admin", "/c/", "/messages"];

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const unreadCount = useUnreadMessages();

  // Check if current route should hide the nav
  const shouldHide = hiddenRoutes.some(route => location.pathname.startsWith(route));
  
  if (shouldHide) return null;

  const handleNavClick = (item: NavItem) => {
    if (item.requiresAuth && !user) {
      navigate("/auth");
      return;
    }
    navigate(item.path);
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/20 pb-safe md:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          const showBadge = item.path === "/messages" && unreadCount > 0;

          if (item.isCenter) {
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item)}
                className="relative -mt-4 flex flex-col items-center justify-center"
              >
                <div className={cn(
                  "flex items-center justify-center w-14 h-14 rounded-full",
                  "bg-primary text-primary-foreground shadow-lg shadow-primary/30",
                  "transition-all duration-200 active:scale-95"
                )}>
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-[10px] mt-1 font-medium text-muted-foreground">
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.path}
              onClick={() => handleNavClick(item)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 py-2 px-3 rounded-lg transition-all duration-200",
                "active:scale-95",
                active 
                  ? "text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className={cn("w-6 h-6", active && "stroke-[2.5px]")} />
                {showBadge && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] font-medium",
                active && "font-semibold"
              )}>
                {item.label}
              </span>
              {active && (
                <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
