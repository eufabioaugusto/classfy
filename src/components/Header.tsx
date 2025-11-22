import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { Moon, Sun, Menu, Plus, BookOpen, Podcast, Zap, Radio, GraduationCap, LogIn, LogOut, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStudies } from "@/hooks/useStudies";
import { useNotificationToasts } from "@/hooks/useNotificationToasts";

interface HeaderProps {
  variant?: "home" | "studio";
  title?: string;
}

export function Header({ variant = "home", title }: HeaderProps) {
  const { user, signOut, profile, role } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { activeCount, limit } = useStudies();
  
  useNotificationToasts();
  
  const currentPlan = profile?.plan || 'free';
  const limitText = limit === Infinity ? 'ilimitados' : `${activeCount}/${limit}`;

  return (
    <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          {title && <h1 className="text-2xl font-bold text-foreground">{title}</h1>}
        </div>

        {/* User Actions */}
        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="text-foreground"
          >
            {theme === "dark" ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </Button>

          {/* Notification Bell */}
          <NotificationBell />

          {/* Creator Create Button - Shows for creators and admins on all pages */}
          {(role === 'creator' || role === 'admin') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Criar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-background border-border z-50">
                <DropdownMenuItem onClick={() => navigate('/studio/upload/curso')} className="gap-3 cursor-pointer">
                  <GraduationCap className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Curso</div>
                    <div className="text-xs text-muted-foreground">Série de aulas</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/studio/upload?type=aula')} className="gap-3 cursor-pointer">
                  <BookOpen className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Aula</div>
                    <div className="text-xs text-muted-foreground">Vídeo educacional</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/studio/upload?type=podcast')} className="gap-3 cursor-pointer">
                  <Podcast className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Podcast</div>
                    <div className="text-xs text-muted-foreground">Áudio longo</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/studio/upload?type=short')} className="gap-3 cursor-pointer">
                  <Zap className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Short</div>
                    <div className="text-xs text-muted-foreground">Vídeo curto</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/studio/upload?type=live')} className="gap-3 cursor-pointer">
                  <Radio className="w-4 h-4" />
                  <div>
                    <div className="font-medium">Live</div>
                    <div className="text-xs text-muted-foreground">Transmissão ao vivo</div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* User Menu */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-foreground">
                  <Menu className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5 text-sm">
                  <div className="font-medium">{profile?.display_name || 'Usuário'}</div>
                  <div className="text-xs text-muted-foreground">
                    Plano: {currentPlan.toUpperCase()} • Estudos: {limitText}
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/conta")} className="cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Minha Conta
                </DropdownMenuItem>
                {(role === 'creator' || role === 'admin') && variant === "home" && (
                  <DropdownMenuItem onClick={() => navigate("/studio")} className="cursor-pointer">
                    <BookOpen className="w-4 h-4 mr-2" />
                    Studio
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => navigate("/auth")}>
              <LogIn className="w-4 h-4 mr-2" />
              Entrar
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
