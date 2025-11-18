import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Video, Eye, Users, TrendingUp, Plus, BookOpen, Podcast, Zap, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Studio() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  const stats = [
    { label: "Total de Conteúdos", value: "0", icon: Video, color: "text-blue-500" },
    { label: "Visualizações Totais", value: "0", icon: Eye, color: "text-green-500" },
    { label: "Seguidores", value: "0", icon: Users, color: "text-purple-500" },
    { label: "Ganhos (em dobro)", value: "R$ 0,00", icon: TrendingUp, color: "text-cinematic-accent" },
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <header className="sticky top-0 z-50 border-b border-border/20 bg-background/95 backdrop-blur-xl">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <h1 className="text-2xl font-bold text-foreground">Studio Classfy</h1>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" />
                    Criar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate('/studio/upload?type=aula')} className="gap-3 cursor-pointer">
                    <Video className="w-4 h-4" />
                    <span>Publicar Aula</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/studio/upload?type=curso')} className="gap-3 cursor-pointer">
                    <BookOpen className="w-4 h-4" />
                    <span>Criar Curso</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/studio/upload?type=podcast')} className="gap-3 cursor-pointer">
                    <Podcast className="w-4 h-4" />
                    <span>Enviar Podcast</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/studio/upload?type=short')} className="gap-3 cursor-pointer">
                    <Zap className="w-4 h-4" />
                    <span>Postar Short</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/studio/upload?type=live')} className="gap-3 cursor-pointer">
                    <Radio className="w-4 h-4" />
                    <span>Transmitir ao vivo</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 p-6 md:p-12">
            <div className="max-w-7xl mx-auto space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-2">Bem-vindo ao Studio!</h2>
                <p className="text-muted-foreground">
                  Gerencie seus conteúdos, acompanhe métricas e publique novos materiais.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat) => (
                  <Card key={stat.label} className="p-6 bg-card border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                        <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                      </div>
                      <stat.icon className={`w-8 h-8 ${stat.color}`} />
                    </div>
                  </Card>
                ))}
              </div>

              {/* Empty State */}
              <Card className="p-12 text-center bg-card border-border border-dashed">
                <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-xl font-bold text-foreground mb-2">
                  Nenhum conteúdo publicado ainda
                </h3>
                <p className="text-muted-foreground mb-6">
                  Comece criando seu primeiro conteúdo na Classfy
                </p>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
