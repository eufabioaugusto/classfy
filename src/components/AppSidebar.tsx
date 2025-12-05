import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies } from "@/hooks/useStudies";
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { CreatorStatsCard } from "@/components/CreatorStatsCard";
import { useState } from "react";
import {
  Home,
  Clock,
  Star,
  Bookmark,
  User,
  LogOut,
  Sparkles,
  Code,
  Megaphone,
  Languages,
  DollarSign,
  Palette,
  Cpu,
  Video,
  BarChart,
  Upload,
  Settings,
  Users,
  CheckSquare,
  BookOpen,
  Plus,
  Trophy,
  ChevronRight,
  FileText,
  TrendingUp,
  AlertTriangle,
  Zap,
  Crown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const mainItems = [
  { title: "Início", url: "/", icon: Home },
  { title: "Histórico", url: "/historico", icon: Clock },
  { title: "Favoritos", url: "/favoritos", icon: Star },
  { title: "Salvos", url: "/salvos", icon: Bookmark },
  { title: "Recompensas", url: "/recompensas", icon: Trophy },
  { title: "Carteira", url: "/carteira", icon: DollarSign },
  { title: "Classfy Premium", url: "/planos", icon: Crown, highlight: true },
];

const studioItems = [
  { title: "Dashboard", url: "/studio", icon: BarChart },
  { title: "Analytics", url: "/studio/analytics", icon: TrendingUp },
  { title: "Meus Conteúdos", url: "/studio/contents", icon: Video },
  { title: "Meus Boosts", url: "/studio/boosts", icon: Megaphone },
  // { title: "Publicar Novo", url: "/studio/upload", icon: Upload },
];

const adminItems = [
  { title: "Dashboard", url: "/admin", icon: BarChart },
  { title: "Aprovar Creators", url: "/admin/creators", icon: CheckSquare },
  { title: "Aprovar Conteúdos", url: "/admin/contents", icon: Video },
  { title: "Transcrições", url: "/admin/transcriptions", icon: FileText },
  { title: "Creators em Destaque", url: "/admin/featured-creators", icon: Users },
  { title: "Recompensas", url: "/admin/rewards", icon: Trophy },
  { title: "Saques", url: "/admin/withdrawals", icon: DollarSign },
  { title: "Gerenciar Usuários", url: "/admin/users", icon: Users },
  { title: "Configurações", url: "/admin/settings", icon: Settings },
];

export function AppSidebar() {
  const { state, isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, role, profile } = useAuth();
  const { activeStudies, activeCount, limit, canCreateMore } = useStudies();
  const [studiesOpen, setStudiesOpen] = useState(true);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  // No mobile, quando o sidebar abre como Sheet, sempre mostrar expandido
  const collapsed = isMobile ? false : state === "collapsed";
  const limitText = limit === Infinity ? "Ilimitado" : `${activeCount}/${limit}`;

  // Visibilidade dos itens do menu
  const showBecomeCreator =
    user &&
    role !== "creator" &&
    role !== "admin" &&
    (profile?.creator_status === "none" || profile?.creator_status === "rejected");
  const showStudio = user && (role === "creator" || role === "admin");
  const showAdmin = user && role === "admin";

  const isActive = (path: string) => location.pathname === path;

  return (
    <TooltipProvider delayDuration={0}>
      <Sidebar
        className={`border-r border-border/20 bg-background transition-all duration-300 ${collapsed ? "w-16" : "w-60"}`}
        collapsible="icon"
      >
        <SidebarContent>
          {/* Logo/Brand */}
          <div className={`p-6 space-y-4 ${collapsed ? "px-3" : ""}`}>
            <div className="flex items-center gap-2 cursor-pointer">
              {/* Mobile: Show toggle button before logo */}
              {isMobile && <SidebarTrigger className="shrink-0" />}
              <div onClick={() => navigate("/")} className="flex items-center">
                {!collapsed && <span className="text-xl font-bold text-foreground">Classfy</span>}
                {collapsed && <span className="text-xl font-bold text-foreground">C</span>}
              </div>
            </div>

            {/* User Profile in Header */}
            {user && !collapsed && (
              <>
                <div
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => navigate("/conta")}
                >
                  <ProfileAvatar size="sm" />
                  <div className="flex flex-col gap-0.5 leading-none flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">{profile?.display_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground capitalize">{profile?.plan}</span>
                      {profile?.plan && profile.plan !== "premium" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate("/planos");
                          }}
                          className="text-xs text-primary hover:underline font-medium"
                        >
                          Fazer upgrade
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Creator Stats Card */}
                {(role === "creator" || role === "admin") && (
                  <CreatorStatsCard userId={user.id} collapsed={collapsed} />
                )}
              </>
            )}

            {/* Mini avatar when collapsed */}
            {user && collapsed && (
              <div className="flex flex-col items-center gap-2 mt-4">
                <div
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => navigate("/conta")}
                  title={profile?.display_name}
                >
                  <ProfileAvatar size="sm" />
                </div>

                {/* Creator Stats Mini */}
                {(role === "creator" || role === "admin") && <CreatorStatsCard userId={user.id} collapsed={true} />}
              </div>
            )}
          </div>

          <Separator className="bg-border/10" />

          {/* Main Navigation */}
          <SidebarGroup>
            {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Menu</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {mainItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={item.url}
                              end
                              className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <item.icon className={`w-4 h-4 ${'highlight' in item && item.highlight ? 'text-red-500' : ''}`} />
                            </NavLink>
                          </SidebarMenuButton>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>{item.title}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                          activeClassName="bg-muted text-cinematic-accent font-medium"
                        >
                          <item.icon className={`w-4 h-4 ${'highlight' in item && item.highlight ? 'text-red-500' : ''}`} />
                          <span className={'highlight' in item && item.highlight ? 'font-medium' : ''}>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <Separator className="bg-border my-2" />

          {/* Studies Section */}
          {user && !collapsed && (
            <Collapsible open={studiesOpen} onOpenChange={setStudiesOpen}>
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="flex w-full items-center justify-between hover:bg-muted rounded-md px-2 py-1">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      <span>Estudos</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{limitText}</span>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </div>
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {activeStudies.map((study) => (
                        <SidebarMenuItem key={study.id}>
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={`/c/${study.id}`}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground"
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <BookOpen className="h-4 w-4" />
                              <span className="truncate max-w-[160px]">{study.title}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                      {activeStudies.length === 0 && (
                        <div className="px-4 py-2 text-sm text-muted-foreground">Nenhum estudo ativo</div>
                      )}
                      {canCreateMore && (
                        <SidebarMenuItem>
                          <SidebarMenuButton onClick={() => navigate("/")}>
                            <Plus className="h-4 w-4" />
                            <span>Novo Estudo</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      {!canCreateMore && (
                        <div className="px-3 py-3 mx-2 mb-2 rounded-lg border border-red-500/30 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent backdrop-blur-sm">
                          <div className="flex items-start gap-2">
                            <div className="p-1.5 rounded-full bg-red-500/20 shrink-0 mt-0.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-xs font-medium text-foreground leading-tight flex items-center gap-1">
                                <Zap className="h-3 w-3 text-red-500" />
                                Limite atingido!
                              </p>
                              <p className="text-xs text-muted-foreground leading-tight">
                                Arquive estudos ou{" "}
                                <button
                                  onClick={() => setUpgradeModalOpen(true)}
                                  className="font-semibold text-red-600 dark:text-red-400 hover:underline underline-offset-2 transition-all hover:text-red-700 dark:hover:text-red-300"
                                >
                                  faça upgrade
                                </button>{" "}
                                para continuar
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          )}

          {/* Studies icon when collapsed */}
          {user && collapsed && (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton className="justify-center">
                          <BookOpen className="h-4 w-4" />
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p>Estudos</p>
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {/* Become Creator (Users only) */}
          {showBecomeCreator && (
            <>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={() => setCreatorModalOpen(true)}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                            >
                              <Sparkles className="w-4 h-4" />
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Torne-se Creator</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton
                          onClick={() => setCreatorModalOpen(true)}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>Torne-se Creator</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <Separator className="bg-border my-2" />
            </>
          )}

          {/* Studio (Creator and Admin only) */}
          {showStudio && (
            <>
              <Separator className="bg-border my-2" />
              <SidebarGroup>
                {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Studio Classfy</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {studioItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild>
                                <NavLink
                                  to={item.url}
                                  className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                                  activeClassName="bg-muted text-cinematic-accent font-medium"
                                >
                                  <item.icon className="w-4 h-4" />
                                </NavLink>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p>{item.title}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={item.url}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground"
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <item.icon className="w-4 h-4" />
                              <span>{item.title}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}

          {/* Admin Panel */}
          {showAdmin && (
            <>
              <Separator className="bg-border my-2" />
              <SidebarGroup>
                {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Administração</SidebarGroupLabel>}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild>
                                <NavLink
                                  to={item.url}
                                  className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                                  activeClassName="bg-muted text-cinematic-accent font-medium"
                                >
                                  <item.icon className="w-4 h-4" />
                                </NavLink>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p>{item.title}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <SidebarMenuButton asChild>
                            <NavLink
                              to={item.url}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground"
                              activeClassName="bg-muted text-cinematic-accent font-medium"
                            >
                              <item.icon className="w-4 h-4" />
                              <span>{item.title}</span>
                            </NavLink>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}

          {/* User Actions */}
          {user && (
            <>
              <div className="mt-auto" />
              <Separator className="bg-border mb-2" />
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton asChild>
                              <NavLink
                                to="/conta"
                                className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                                activeClassName="bg-muted text-cinematic-accent"
                              >
                                <Settings className="w-4 h-4" />
                              </NavLink>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Configurações</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton asChild>
                          <NavLink
                            to="/conta"
                            className="text-foreground/80 hover:bg-muted hover:text-foreground"
                            activeClassName="bg-muted text-cinematic-accent"
                          >
                            <Settings className="w-4 h-4" />
                            <span>Configurações</span>
                          </NavLink>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={signOut}
                              className="text-foreground/80 hover:bg-muted hover:text-foreground justify-center"
                            >
                              <LogOut className="w-4 h-4" />
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p>Sair</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton
                          onClick={signOut}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Sair</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        {/* Become Creator Modal */}
        <BecomeCreatorModal open={creatorModalOpen} onOpenChange={setCreatorModalOpen} />

        {/* Upgrade Modal */}
        <UpgradeModal open={upgradeModalOpen} onOpenChange={setUpgradeModalOpen} requiredPlan="pro" />
      </Sidebar>
    </TooltipProvider>
  );
}
