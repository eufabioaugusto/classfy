import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies } from "@/hooks/useStudies";
import { BecomeCreatorModal } from "@/components/BecomeCreatorModal";
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
  ChevronRight,
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const mainItems = [
  { title: "Início", url: "/", icon: Home },
  { title: "Histórico", url: "/historico", icon: Clock },
  { title: "Favoritos", url: "/favoritos", icon: Star },
  { title: "Salvos", url: "/salvos", icon: Bookmark },
];

const categories = [
  { title: "Programação", icon: Code },
  { title: "Marketing", icon: Megaphone },
  { title: "Idiomas", icon: Languages },
  { title: "Negócios", icon: DollarSign },
  { title: "Criatividade", icon: Palette },
  { title: "Tecnologia", icon: Cpu },
];

const studioItems = [
  { title: "Dashboard", url: "/studio", icon: BarChart },
  { title: "Meus Conteúdos", url: "/studio/contents", icon: Video },
  { title: "Publicar Novo", url: "/studio/new", icon: Upload },
];

const adminItems = [
  { title: "Aprovar Creators", url: "/admin/creators", icon: CheckSquare },
  { title: "Gerenciar Usuários", url: "/admin/users", icon: Users },
  { title: "Configurações", url: "/admin/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, role, profile } = useAuth();
  const { activeStudies, activeCount, limit, canCreateMore } = useStudies();
  const [studiesOpen, setStudiesOpen] = useState(true);
  const [creatorModalOpen, setCreatorModalOpen] = useState(false);
  const collapsed = state === "collapsed";
  const limitText = limit === Infinity ? 'Ilimitado' : `${activeCount}/${limit}`;
  
  // Visibilidade dos itens do menu
  const showBecomeCreator = user && role !== 'creator' && role !== 'admin' && (profile?.creator_status === 'none' || profile?.creator_status === 'rejected');
  const showStudio = user && (role === 'creator' || role === 'admin');
  const showAdmin = user && role === 'admin';

  const isActive = (path: string) => location.pathname === path;

  return (
    <Sidebar className="border-r border-border/20 bg-background">
      <SidebarContent>
        {/* Logo/Brand */}
        <div className="p-6 flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <Sparkles className="w-6 h-6 text-cinematic-accent" />
          {!collapsed && <span className="text-xl font-bold text-foreground">CLASSFY</span>}
        </div>

        <Separator className="bg-border/10" />

        {/* Main Navigation */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Menu</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="text-foreground/80 hover:bg-muted hover:text-foreground"
                      activeClassName="bg-muted text-cinematic-accent font-medium"
                    >
                      <item.icon className="w-4 h-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="bg-border my-2" />

        {/* Studies Section */}
        {user && (
          <Collapsible open={studiesOpen} onOpenChange={setStudiesOpen}>
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="flex w-full items-center justify-between hover:bg-muted rounded-md px-2 py-1">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {!collapsed && <span>Estudos</span>}
                  </div>
                  {!collapsed && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{limitText}</span>
                      <ChevronRight className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
                    </div>
                  )}
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
                            {!collapsed && <span className="truncate max-w-[160px]">{study.title}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                    {!collapsed && activeStudies.length === 0 && (
                      <div className="px-4 py-2 text-sm text-muted-foreground">
                        Nenhum estudo ativo
                      </div>
                    )}
                    {!collapsed && canCreateMore && (
                      <SidebarMenuItem>
                        <SidebarMenuButton onClick={() => navigate("/")}>
                          <Plus className="h-4 w-4" />
                          <span>Novo Estudo</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )}
                    {!collapsed && !canCreateMore && (
                      <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50 rounded-md mx-2 mb-2">
                        Limite atingido. Arquive estudos ou faça upgrade.
                      </div>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )}

        <Separator className="bg-border my-2" />

        {/* Categories */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="text-muted-foreground">Categorias</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {categories.map((category) => (
                <SidebarMenuItem key={category.title}>
                  <SidebarMenuButton className="text-foreground/80 hover:bg-muted hover:text-foreground">
                    <category.icon className="w-4 h-4" />
                    {!collapsed && <span>{category.title}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <Separator className="bg-border my-2" />

        {/* Become Creator (Users only) */}
        {showBecomeCreator && (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setCreatorModalOpen(true)} className="text-foreground/80 hover:bg-muted hover:text-foreground">
                      <Sparkles className="w-4 h-4" />
                      {!collapsed && <span>Torne-se Creator</span>}
                    </SidebarMenuButton>
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
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                          activeClassName="bg-muted text-cinematic-accent font-medium"
                        >
                          <item.icon className="w-4 h-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
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
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="text-foreground/80 hover:bg-muted hover:text-foreground"
                          activeClassName="bg-muted text-cinematic-accent font-medium"
                        >
                          <item.icon className="w-4 h-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
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
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/conta"
                        className="text-foreground/80 hover:bg-muted hover:text-foreground"
                        activeClassName="bg-muted text-cinematic-accent"
                      >
                        <User className="w-4 h-4" />
                        {!collapsed && <span>Minha Conta</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={signOut} className="text-foreground/80 hover:bg-muted hover:text-foreground">
                      <LogOut className="w-4 h-4" />
                      {!collapsed && <span>Sair</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* Become Creator Modal */}
      <BecomeCreatorModal open={creatorModalOpen} onOpenChange={setCreatorModalOpen} />
    </Sidebar>
  );
}
