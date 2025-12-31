import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { DirectMessagesButton } from "@/components/DirectMessagesButton";
import { AffiliateModal } from "@/components/AffiliateModal";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useState } from "react";
import { Moon, Sun, Plus, BookOpen, Podcast, Zap, Radio, GraduationCap, LogIn, LogOut, Settings, Gift, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  showSearch?: boolean;
  isExploreMode?: boolean;
  onModeChange?: (isExplore: boolean) => void;
}

export function Header({ variant = "home", title, showSearch = false, isExploreMode = false, onModeChange }: HeaderProps) {
  const { user, signOut, profile, role } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { activeCount, limits } = useStudies();
  const [affiliateModalOpen, setAffiliateModalOpen] = useState(false);
  
  useNotificationToasts();
  
  const currentPlan = profile?.plan || 'free';
  const limitText = limits.studies === Infinity ? 'ilimitados' : `${activeCount}/${limits.studies}`;

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <SidebarTrigger />
          {/* Logo visible only on mobile when menu is closed */}
          <span className="text-xl font-bold text-foreground sm:hidden">Classfy</span>
          {title && <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate max-w-[150px] sm:max-w-none hidden sm:block">{title}</h1>}
        </div>

        {/* Global Search - Only on home variant */}
        {showSearch && variant === "home" && (
          <GlobalSearch 
            isExploreMode={isExploreMode} 
            onModeChange={onModeChange || (() => {})} 
          />
        )}

        {/* User Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* Theme Toggle - Hidden on mobile */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="text-foreground hidden sm:flex"
          >
            {theme === "dark" ? (
              <Sun className="w-5 h-5" />
            ) : (
              <Moon className="w-5 h-5" />
            )}
          </Button>

          {/* Affiliate Program - Hidden on mobile */}
          {user && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setAffiliateModalOpen(true)}
              title="Programa de Afiliados"
              className="text-foreground hidden sm:flex"
            >
              <Gift className="w-5 h-5" />
            </Button>
          )}

          {/* Notification Bell - Hidden on mobile */}
          <div className="hidden sm:block">
            <NotificationBell />
          </div>

          {/* Direct Messages - Hidden on mobile */}
          {user && (
            <div className="hidden sm:block">
              <DirectMessagesButton />
            </div>
          )}

          {/* Creator Create Button - Shows for creators and admins on all pages */}
          {(role === 'creator' || role === 'admin') && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1 sm:gap-2 px-2 sm:px-4">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Criar</span>
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
                <Button variant="ghost" size="icon" className="text-foreground rounded-full p-0 h-9 w-9">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.display_name || 'Usuário'} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(profile?.display_name || 'U')}
                    </AvatarFallback>
                  </Avatar>
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
                {/* Mobile-only items */}
                <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer sm:hidden">
                  {theme === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                  {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAffiliateModalOpen(true)} className="cursor-pointer sm:hidden">
                  <Gift className="w-4 h-4 mr-2" />
                  Programa de Afiliados
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden" />
                {profile?.creator_channel_name && (
                  <DropdownMenuItem onClick={() => navigate(`/@${profile.creator_channel_name}`)} className="cursor-pointer">
                    <User className="w-4 h-4 mr-2" />
                    Meu Perfil Público
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate("/conta")} className="cursor-pointer">
                  <Settings className="w-4 h-4 mr-2" />
                  Configurações
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
            <Button size="sm" onClick={() => navigate("/auth")} className="gap-1 sm:gap-2 px-2 sm:px-4">
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">Entrar</span>
            </Button>
          )}
        </div>
      </div>

      {user && (
        <AffiliateModal
          open={affiliateModalOpen}
          onOpenChange={setAffiliateModalOpen}
        />
      )}
    </header>
  );
}
