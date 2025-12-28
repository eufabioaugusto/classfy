import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GlobalLoader } from "@/components/GlobalLoader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, Film, Users, Moon, Sun, LogIn, LogOut, Settings, User, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Skill {
  image_url: string;
  title: string;
  description: string;
}

interface FeaturedCreatorData {
  id: string;
  creator_id: string;
  background_image_url: string;
  hero_image_url: string | null;
  badge_text: string;
  featured_image_url: string;
  description: string;
  link_url: string;
  slug: string;
  short_bio: string | null;
  total_videos: number;
  total_duration_seconds: number;
  commission_link: string | null;
  skills: Skill[];
  trailer_url: string | null;
  creator_name: string;
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
};

const FeaturedCreatorPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, signOut, profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [creator, setCreator] = useState<FeaturedCreatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTrailerPaused, setIsTrailerPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const fetchCreator = async () => {
      if (!slug) {
        navigate("/");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("featured_creators")
          .select(`
            *,
            profiles:creator_id (
              display_name,
              creator_channel_name
            )
          `)
          .eq("slug", slug)
          .single();

        if (error || !data) {
          console.error("Creator not found:", error);
          navigate("/");
          return;
        }

        setCreator({
          ...data,
          creator_name: data.profiles?.creator_channel_name || data.profiles?.display_name || "Creator",
          skills: Array.isArray(data.skills) ? (data.skills as unknown as Skill[]) : [],
        });
      } catch (error) {
        console.error("Error fetching creator:", error);
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    fetchCreator();
  }, [slug, navigate]);

  const handleSubscribe = () => {
    if (creator?.commission_link) {
      window.open(creator.commission_link, "_blank");
    } else {
      navigate("/planos");
    }
  };

  const handleVideoPlay = () => {
    setIsTrailerPaused(false);
  };

  const handleVideoPause = () => {
    setIsTrailerPaused(true);
  };

  const handlePlayClick = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsTrailerPaused(false);
    }
  };

  if (loading) {
    return <GlobalLoader />;
  }

  if (!creator) {
    return null;
  }

  // heroImage is no longer used as we reference fields directly

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* STANDALONE HEADER */}
      <header className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => navigate(-1)}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Link to="/" className="text-xl font-bold text-white">Classfy</Link>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="text-white hover:bg-white/10"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-white rounded-full p-0 h-9 w-9 hover:bg-white/10">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.display_name || 'Usuário'} />
                      <AvatarFallback className="bg-white/20 text-white text-xs">
                        {getInitials(profile?.display_name || 'U')}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-sm">
                    <div className="font-medium">{profile?.display_name || 'Usuário'}</div>
                  </div>
                  <DropdownMenuSeparator />
                  {profile?.creator_channel_name && (
                    <DropdownMenuItem onClick={() => navigate(`/@${profile.creator_channel_name}`)} className="cursor-pointer">
                      <User className="w-4 h-4 mr-2" />
                      Meu Perfil
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => navigate("/conta")} className="cursor-pointer">
                    <Settings className="w-4 h-4 mr-2" />
                    Configurações
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive">
                    <LogOut className="w-4 h-4 mr-2" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button size="sm" onClick={() => navigate("/auth")} className="gap-2 bg-white text-black hover:bg-white/90">
                <LogIn className="w-4 h-4" />
                Entrar
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* HERO SECTION - Full Width, Fixed Height */}
      <section className="w-full h-[700px]">
        <div className="grid lg:grid-cols-2 h-full">
          {/* Left Column - Hero Image 4:3 (uses hero_image_url) */}
          <div className="relative h-full">
            <img
              src={creator.hero_image_url || creator.background_image_url}
              alt={creator.creator_name}
              className="w-full h-full object-cover"
            />
            {/* Gradient fade to right */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/40 lg:block hidden" />
            {/* Gradient fade from bottom */}
            <div 
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.6) 25%, rgba(0,0,0,0) 45%)'
              }}
            />
          </div>

          {/* Right Column - Content Vertically & Horizontally Centered */}
          <div className="flex items-center justify-center px-8 lg:px-16 py-12 lg:py-0 bg-black h-full">
            <div className="max-w-lg w-full space-y-5 text-center">
              {/* Badge */}
              <div className="flex justify-center">
                <Badge className="bg-white/10 text-white border-white/20 px-4 py-1.5 text-sm font-semibold">
                  {creator.badge_text}
                </Badge>
              </div>

              {/* Featured Image/Logo */}
              <div className="flex justify-center">
                <img
                  src={creator.featured_image_url}
                  alt={creator.creator_name}
                  className="h-14 sm:h-16 lg:h-20 w-auto object-contain"
                />
              </div>

              {/* Description */}
              <p className="text-lg sm:text-xl text-white/90 font-medium leading-relaxed">
                {creator.description}
              </p>

              {/* Short Bio */}
              {creator.short_bio && (
                <p className="text-white/60 text-sm lg:text-base">
                  {creator.short_bio}
                </p>
              )}

              {/* Stats */}
              <div className="flex items-center justify-center gap-6 text-white/70">
                {creator.total_videos > 0 && (
                  <div className="flex items-center gap-2">
                    <Film className="h-5 w-5" />
                    <span className="font-semibold">{creator.total_videos} aulas</span>
                  </div>
                )}
                {creator.total_duration_seconds > 0 && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    <span className="font-semibold">{formatDuration(creator.total_duration_seconds)}</span>
                  </div>
                )}
              </div>

              {/* Subscription Card */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 lg:p-6 text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="flex -space-x-2">
                    {[
                      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face",
                      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face",
                      "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=100&h=100&fit=crop&crop=face",
                      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
                    ].map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Aluno ${i + 1}`}
                        className="w-7 h-7 rounded-full border-2 border-black object-cover"
                      />
                    ))}
                  </div>
                  <span className="text-xs text-white/60">
                    +200 alunos já assinaram
                  </span>
                </div>

                <h3 className="text-base font-semibold mb-2 text-white">
                  Assine e tenha acesso completo aos conteúdos de {creator.creator_name}
                </h3>

                <p className="text-white/60 text-xs mb-4">
                  Acesso ilimitado a todas as aulas, materiais exclusivos e certificado de conclusão.
                </p>

                <Button
                  onClick={handleSubscribe}
                  size="lg"
                  className="w-full bg-[#e21d48] hover:bg-[#c91a40] text-white font-semibold"
                >
                  Assinar Agora
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SKILLS SECTION */}
      {creator.skills && creator.skills.length > 0 && (
        <section className="py-16 lg:py-24 bg-black border-t border-white/10">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl lg:text-4xl font-bold mb-8 lg:mb-12 text-white">
              Skills que você pode aprender com {creator.creator_name}
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {creator.skills.slice(0, 4).map((skill, index) => (
                <div
                  key={index}
                  className="group relative bg-white/5 rounded-2xl overflow-hidden border border-white/10 hover:border-white/30 transition-all duration-300"
                >
                  {/* Number Badge */}
                  <div className="absolute top-4 left-4 z-10 w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </div>

                  {/* Image */}
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={skill.image_url || "/placeholder.svg"}
                      alt={skill.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>

                  {/* Content */}
                  <div className="p-5">
                    <h3 className="font-semibold text-lg mb-2 text-white">{skill.title}</h3>
                    <p className="text-white/60 text-sm line-clamp-2">
                      {skill.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TRAILER SECTION */}
      {creator.trailer_url && (
        <section className="py-16 lg:py-24 bg-black border-t border-white/10">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto space-y-6">
              {/* Video Container with Badge */}
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/50 shadow-2xl">
                {/* Trailer Badge - Top Right Corner */}
                <div className="absolute top-4 right-4 z-10">
                  <Badge className="bg-black/60 text-white border-white/20 px-3 py-1 text-sm font-medium backdrop-blur-sm">
                    Trailer
                  </Badge>
                </div>

                <video
                  ref={videoRef}
                  src={creator.trailer_url}
                  autoPlay
                  muted
                  playsInline
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  controls
                  poster={creator.hero_image_url || creator.background_image_url}
                  className="w-full h-full object-cover"
                >
                  Seu navegador não suporta vídeos.
                </video>

                {/* CTA Overlay when paused */}
                {isTrailerPaused && (
                  <div 
                    className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-6 cursor-pointer"
                    onClick={handlePlayClick}
                  >
                    <button 
                      className="w-20 h-20 rounded-full bg-[#e21d48] hover:bg-[#c91a40] flex items-center justify-center transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayClick();
                      }}
                    >
                      <Play className="h-10 w-10 text-white ml-1" fill="white" />
                    </button>
                    
                    <div className="text-center space-y-4">
                      <p className="text-white/80 text-lg">
                        Quer ter acesso a todo o conteúdo?
                      </p>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSubscribe();
                        }}
                        size="lg"
                        className="bg-[#e21d48] hover:bg-[#c91a40] text-white font-semibold px-8"
                      >
                        Assinar Agora
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Button below trailer */}
              <div className="flex justify-center">
                <Button
                  onClick={() => navigate(`/@${creator.creator_name}`)}
                  size="lg"
                  className="bg-[#e21d48] hover:bg-[#c91a40] text-white font-semibold px-8"
                >
                  Ver todos os conteúdos
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* BOTTOM CTA */}
      <section className="py-16 lg:py-24 bg-white/5 border-t border-white/10">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl lg:text-4xl font-bold mb-4 text-white">
            Pronto para começar?
          </h2>
          <p className="text-white/60 text-lg mb-8 max-w-2xl mx-auto">
            Tenha acesso ilimitado a todo o conteúdo de {creator.creator_name} e transforme sua carreira.
          </p>
          <Button
            onClick={handleSubscribe}
            size="lg"
            className="bg-[#e21d48] hover:bg-[#c91a40] text-white font-semibold text-lg px-12 py-6"
          >
            Começar Agora
          </Button>
        </div>
      </section>
    </div>
  );
};

export default FeaturedCreatorPage;