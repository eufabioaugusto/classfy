import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Home, Search, Target, MessageCircle, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";

interface NavItem {
  icon: React.ElementType;
  label: string;
  action: () => void;
  requiresAuth?: boolean;
  isCenter?: boolean;
}

// Routes where the bottom nav should be hidden
const hiddenRoutes = ["/watch", "/listen", "/shorts", "/auth", "/studio", "/admin", "/c/"];

export function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const unreadCount = useUnreadMessages();

  // Check if current route should hide the nav
  const shouldHide = hiddenRoutes.some(route => location.pathname.startsWith(route));
  
  if (shouldHide) return null;

  const currentMode = searchParams.get('mode');

  const openSearch = () => {
    window.dispatchEvent(new CustomEvent('open-global-search'));
  };

  const goToExplore = () => {
    localStorage.setItem('isExploreMode', 'true');
    if (location.pathname === '/') {
      setSearchParams({ mode: 'explore' });
    } else {
      navigate('/?mode=explore');
    }
  };

  const goToFocus = () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    localStorage.setItem('isExploreMode', 'false');
    if (location.pathname === '/') {
      setSearchParams({ mode: 'focus' });
    } else {
      navigate('/?mode=focus');
    }
  };

  const goToMessages = () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    navigate('/messages');
  };

  const goToRewards = () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    navigate('/recompensas');
  };

  const navItems: NavItem[] = [
    { icon: Home, label: "Explorar", action: goToExplore },
    { icon: Search, label: "Buscar", action: openSearch },
    { icon: Target, label: "Estudo", action: goToFocus, requiresAuth: true, isCenter: true },
    { icon: MessageCircle, label: "Mensagens", action: goToMessages, requiresAuth: true },
    { icon: Gift, label: "Recompensas", action: goToRewards, requiresAuth: true },
  ];

  const isActive = (index: number) => {
    if (index === 0) {
      // Explorar - active when on home with explore mode or no mode
      return location.pathname === "/" && currentMode !== 'focus';
    }
    if (index === 2) {
      // Foco - active when on home with focus mode
      return location.pathname === "/" && currentMode === 'focus';
    }
    if (index === 3) {
      return location.pathname.startsWith('/messages');
    }
    if (index === 4) {
      return location.pathname.startsWith('/recompensas');
    }
    return false;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/20 pb-safe md:hidden">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item, index) => {
          const active = isActive(index);
          const Icon = item.icon;
          const showBadge = index === 3 && unreadCount > 0;

          if (item.isCenter) {
            return (
              <button
                key={item.label}
                onClick={item.action}
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
              key={item.label}
              onClick={item.action}
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
