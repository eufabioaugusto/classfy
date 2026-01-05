import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FollowButton } from "@/components/FollowButton";
import { ContentCard } from "@/components/ContentCard";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { Trophy, Users, Video, Headphones, Zap, GraduationCap, Share2, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CreatorProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  creator_channel_name: string | null;
  creator_bio: string | null;
  cover_image_url: string | null;
  created_at: string;
}

interface CreatorStats {
  totalPoints: number;
  level: number;
  followersCount: number;
  contentCount: number;
}

export default function CreatorProfile() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [contents, setContents] = useState<any[]>([]);
  const [filteredContents, setFilteredContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    if (username) {
      loadCreatorProfile();
    }
  }, [username]);

  useEffect(() => {
    filterContents();
  }, [activeTab, contents]);

  const loadCreatorProfile = async () => {
    if (!username) {
      navigate("/404");
      return;
    }

    try {
      setLoading(true);

      // Extrair o channel_name removendo o @ inicial
      const rawUsername = username as string;
      if (!rawUsername.startsWith("@")) {
        navigate("/404");
        return;
      }
      const channelName = rawUsername.slice(1);

      // Buscar perfil do creator pelo channel_name (sem @)
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("creator_channel_name", channelName)
        .eq("creator_status", "approved")
        .maybeSingle();

      if (profileError) throw profileError;
      
      if (!profileData) {
        navigate("/404");
        return;
      }

      setCreator(profileData);

      // Buscar estatísticas
      const [pointsData, followersData, contentsData] = await Promise.all([
        supabase
          .from("reward_events")
          .select("points")
          .eq("user_id", profileData.id),
        supabase
          .from("follows")
          .select("id", { count: "exact" })
          .eq("following_id", profileData.id),
        supabase
          .from("contents")
          .select(`
            *,
            profiles:creator_id (
              display_name,
              avatar_url
            )
          `)
          .eq("creator_id", profileData.id)
          .eq("status", "approved")
          .order("published_at", { ascending: false })
      ]);

      const totalPoints = pointsData.data?.reduce((sum, event) => sum + event.points, 0) || 0;
      const level = Math.floor(totalPoints / 1000) + 1;

      setStats({
        totalPoints,
        level,
        followersCount: followersData.count || 0,
        contentCount: contentsData.data?.length || 0
      });

      setContents(contentsData.data || []);
    } catch (error) {
      console.error("Error loading creator profile:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar o perfil do creator.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filterContents = () => {
    if (activeTab === "all") {
      setFilteredContents(contents);
    } else {
      const filtered = contents.filter(content => {
        switch (activeTab) {
          case "videos":
            return content.content_type === "aula";
          case "podcasts":
            return content.content_type === "podcast";
          case "shorts":
            return content.content_type === "short";
          case "courses":
            return content.content_type === "curso";
          default:
            return true;
        }
      });
      setFilteredContents(filtered);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/@${username}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copiado!",
        description: "O link do perfil foi copiado para a área de transferência.",
      });
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível copiar o link.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <div className="flex-1 flex flex-col w-full">
          <Header />
          <main className="flex-1 overflow-y-auto">
            <div className="container mx-auto px-4 py-6">
              <Skeleton className="w-full h-48 rounded-lg mb-4" />
              <Skeleton className="w-32 h-32 rounded-full mx-auto -mt-16 mb-4" />
              <Skeleton className="w-48 h-6 mx-auto mb-2" />
              <Skeleton className="w-64 h-4 mx-auto mb-6" />
            </div>
          </main>
        </div>
      </SidebarProvider>
    );
  }

  if (!creator) {
    return null;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex-1 flex flex-col w-full">
        <Header />
        <main className="flex-1 overflow-y-auto">
          {/* Cover Image */}
          <div className="w-full h-48 bg-gradient-to-r from-primary/20 via-primary/10 to-background relative overflow-hidden">
            {creator?.cover_image_url ? (
              <img src={creator.cover_image_url} alt="Capa do canal" className="w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiMwMDAiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItMnptMC0ydjItMnptMCAyaDJ2LTJoLTJ6bTAgMGgydi0yaC0yem0tMiAwaDJ2LTJoLTJ6bTAgMGgydi0yaC0yem0wLTJoMnYtMmgtMnptMCAwaDJ2LTJoLTJ6bS0yIDBoMnYtMmgtMnptMCAwaDJ2LTJoLTJ6bTAgMmgydi0yaC0yem0wIDBoMnYtMmgtMnptMiAwaDJ2LTJoLTJ6bTAgMGgydi0yaC0yem0wIDJoMnYtMmgtMnptMCAwaDJ2LTJoLTJ6bS0yIDBoMnYtMmgtMnptMCAwaDJ2LTJoLTJ6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
            )}
          </div>

          <div className="container mx-auto px-4">
            {/* Profile Header */}
            <div className="relative mb-6">
              <div className="flex flex-col md:flex-row gap-6 md:gap-8 -mt-16">
                {/* Coluna Esquerda - Avatar, Nome, Nível, @, Bio */}
                <div className="flex flex-col gap-4">
                  <Avatar className="w-32 h-32 border-4 border-background shadow-lg">
                    <AvatarImage src={creator.avatar_url || undefined} />
                    <AvatarFallback className="text-3xl">
                      {creator.display_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="space-y-2 max-w-sm">
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                      {creator.display_name}
                      <FeaturedBadge creatorId={creator.id} size="lg" />
                    </h1>
                    
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-muted-foreground">@{creator.creator_channel_name}</p>
                      {stats && (
                        <Badge variant="secondary" className="gap-1">
                          <Trophy className="w-3 h-3" />
                          Nível {stats.level}
                        </Badge>
                      )}
                    </div>
                    
                    {creator.creator_bio && (
                      <p className="text-sm text-muted-foreground">{creator.creator_bio}</p>
                    )}
                  </div>
                </div>

                {/* Coluna Direita - Stats e Botões */}
                <div className="flex flex-col justify-end gap-4 md:ml-auto md:pt-20">
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <div className="flex items-baseline gap-1">
                        <span className="font-semibold text-base">{stats?.followersCount || 0}</span>
                        <span className="text-muted-foreground">seguidores</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-muted-foreground" />
                      <div className="flex items-baseline gap-1">
                        <span className="font-semibold text-base">{stats?.contentCount || 0}</span>
                        <span className="text-muted-foreground">conteúdos</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-muted-foreground" />
                      <div className="flex items-baseline gap-1">
                        <span className="font-semibold text-base">{stats?.totalPoints || 0}</span>
                        <span className="text-muted-foreground">pontos</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {user?.id !== creator.id && (
                      <>
                        <FollowButton creatorId={creator.id} size="default" variant="default" />
                        <Button variant="outline" size="default" onClick={() => {
                          // Open DM modal with this creator
                          const event = new CustomEvent('openDirectMessage', { detail: { recipientId: creator.id } });
                          window.dispatchEvent(event);
                        }}>
                          <MessageCircle className="w-4 h-4 mr-2" />
                          Mensagem
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="default" onClick={handleShare}>
                      <Share2 className="w-4 h-4 mr-2" />
                      Compartilhar
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-8">
              <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
                <TabsTrigger 
                  value="all" 
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  Todos
                </TabsTrigger>
                <TabsTrigger 
                  value="videos"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <Video className="w-4 h-4 mr-2" />
                  Aulas
                </TabsTrigger>
                <TabsTrigger 
                  value="podcasts"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <Headphones className="w-4 h-4 mr-2" />
                  Podcasts
                </TabsTrigger>
                <TabsTrigger 
                  value="shorts"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Shorts
                </TabsTrigger>
                <TabsTrigger 
                  value="courses"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                >
                  <GraduationCap className="w-4 h-4 mr-2" />
                  Cursos
                </TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab} className="mt-6">
                {filteredContents.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredContents.map((content) => (
                      <ContentCard
                        key={content.id}
                        content={content}
                        aspectRatio="default"
                      />
                    ))}
                  </div>
                ) : (
                  <Card className="p-12 text-center">
                    <p className="text-muted-foreground">
                      {activeTab === "all" 
                        ? "Nenhum conteúdo publicado ainda." 
                        : "Nenhum conteúdo deste tipo encontrado."}
                    </p>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
