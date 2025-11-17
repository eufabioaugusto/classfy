import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const collapsed = state === "collapsed";

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
    </Sidebar>
  );
}
