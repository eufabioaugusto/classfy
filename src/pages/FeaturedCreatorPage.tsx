import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GlobalLoader } from "@/components/GlobalLoader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, Film, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Skill {
  image_url: string;
  title: string;
  description: string;
}

interface FeaturedCreatorData {
  id: string;
  creator_id: string;
  background_image_url: string;
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
  const { user } = useAuth();
  const [creator, setCreator] = useState<FeaturedCreatorData | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <GlobalLoader />;
  }

  if (!creator) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* HERO SECTION */}
      <section className="relative min-h-[90vh] flex items-center">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${creator.background_image_url})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-background/60" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>

        <div className="container relative z-10 mx-auto px-4 py-12 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Left Column - Image */}
            <div className="hidden lg:block">
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl">
                <img
                  src={creator.background_image_url}
                  alt={creator.creator_name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              </div>
            </div>

            {/* Right Column - Content */}
            <div className="space-y-6 lg:space-y-8">
              {/* Badge */}
              <Badge className="bg-primary/20 text-primary border-primary/30 px-4 py-1.5 text-sm font-semibold">
                {creator.badge_text}
              </Badge>

              {/* Featured Image/Logo */}
              <div>
                <img
                  src={creator.featured_image_url}
                  alt={creator.creator_name}
                  className="h-16 sm:h-20 lg:h-28 w-auto object-contain"
                />
              </div>

              {/* Description */}
              <p className="text-lg sm:text-xl lg:text-2xl text-foreground/90 font-medium leading-relaxed max-w-xl">
                {creator.description}
              </p>

              {/* Short Bio */}
              {creator.short_bio && (
                <p className="text-muted-foreground text-base lg:text-lg">
                  {creator.short_bio}
                </p>
              )}

              {/* Stats */}
              <div className="flex items-center gap-6 text-muted-foreground">
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
              <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 lg:p-8 max-w-md">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="w-8 h-8 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center"
                      >
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    +200 alunos já assinaram
                  </span>
                </div>

                <h3 className="text-lg font-semibold mb-2">
                  Assine e tenha acesso completo aos conteúdos de {creator.creator_name}
                </h3>

                <p className="text-muted-foreground text-sm mb-6">
                  Acesso ilimitado a todas as aulas, materiais exclusivos e certificado de conclusão.
                </p>

                <Button
                  onClick={handleSubscribe}
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg py-6"
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
        <section className="py-16 lg:py-24 bg-muted/30">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl lg:text-4xl font-bold mb-8 lg:mb-12">
              Skills que você pode aprender com {creator.creator_name}
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {creator.skills.slice(0, 4).map((skill, index) => (
                <div
                  key={index}
                  className="group relative bg-card rounded-2xl overflow-hidden border border-border/50 hover:border-primary/50 transition-all duration-300"
                >
                  {/* Number Badge */}
                  <div className="absolute top-4 left-4 z-10 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
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
                    <h3 className="font-semibold text-lg mb-2">{skill.title}</h3>
                    <p className="text-muted-foreground text-sm line-clamp-2">
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
        <section className="py-16 lg:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-3 mb-6">
                <Play className="h-6 w-6 text-primary" />
                <h2 className="text-2xl lg:text-3xl font-bold">Trailer</h2>
              </div>

              <div className="relative aspect-video rounded-2xl overflow-hidden bg-muted shadow-2xl">
                <video
                  src={creator.trailer_url}
                  controls
                  poster={creator.background_image_url}
                  className="w-full h-full object-cover"
                >
                  Seu navegador não suporta vídeos.
                </video>

                {/* CTA Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="flex items-center justify-between">
                    <span className="text-white/80 text-sm">
                      Assista o trailer completo
                    </span>
                    <Button
                      onClick={handleSubscribe}
                      variant="secondary"
                      className="bg-white/20 hover:bg-white/30 text-white border-0"
                    >
                      Assinar Agora
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* BOTTOM CTA */}
      <section className="py-16 lg:py-24 bg-primary/5 border-t border-border/50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl lg:text-4xl font-bold mb-4">
            Pronto para começar?
          </h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-2xl mx-auto">
            Tenha acesso ilimitado a todo o conteúdo de {creator.creator_name} e transforme sua carreira.
          </p>
          <Button
            onClick={handleSubscribe}
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg px-12 py-6"
          >
            Começar Agora
          </Button>
        </div>
      </section>
    </div>
  );
};

export default FeaturedCreatorPage;
