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
    <Sidebar className="border-r border-border/20 bg-cinematic-darker">
      <SidebarContent>
        {/* Logo/Brand */}
        <div className="p-6 flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <Sparkles className="w-6 h-6 text-cinematic-accent" />
          {!collapsed && <span className="text-xl font-bold">CLASSFY</span>}
        </div>

        <Separator className="bg-border/10" />

        {/* Main Navigation */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Menu</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-white/5"
                      activeClassName="bg-white/10 text-cinematic-accent font-medium"
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

        <Separator className="bg-border/10 my-2" />

        {/* Categories */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Categorias</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {categories.map((category) => (
                <SidebarMenuItem key={category.title}>
                  <SidebarMenuButton className="hover:bg-white/5">
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
            <Separator className="bg-border/10 mb-2" />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/conta"
                        className="hover:bg-white/5"
                        activeClassName="bg-white/10 text-cinematic-accent"
                      >
                        <User className="w-4 h-4" />
                        {!collapsed && <span>Minha Conta</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={signOut} className="hover:bg-white/5">
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
