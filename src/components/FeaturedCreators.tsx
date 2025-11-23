import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface FeaturedCreator {
  id: string;
  creator_id: string;
  background_image_url: string;
  badge_text: string;
  featured_image_url: string;
  description: string;
  link_url: string;
  order_index: number;
  creator_name: string;
  total_duration: string;
}

export const FeaturedCreators = () => {
  const [creators, setCreators] = useState<FeaturedCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchFeaturedCreators();
  }, []);

  const fetchFeaturedCreators = async () => {
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
        .order("order_index", { ascending: true });

      if (error) throw error;

      // Calculate total duration for each creator
      const creatorsWithDuration = await Promise.all(
        data.map(async (creator: any) => {
          const { data: contents } = await supabase
            .from("contents")
            .select("duration_seconds")
            .eq("creator_id", creator.creator_id)
            .eq("status", "approved");

          const totalSeconds = contents?.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) || 0;
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);

          return {
            ...creator,
            creator_name: creator.profiles?.creator_channel_name || creator.profiles?.display_name || "Creator",
            total_duration: hours > 0 ? `${hours}h ${minutes}min` : `${minutes} minutos`,
          };
        })
      );

      setCreators(creatorsWithDuration);
    } catch (error) {
      console.error("Error fetching featured creators:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (creator: FeaturedCreator) => {
    navigate(creator.link_url);
  };

  if (loading || creators.length === 0) return null;

  const isCarousel = creators.length > 6;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Creators em Destaque</h2>
      </div>

      {isCarousel ? (
        <Carousel className="w-full">
          <CarouselContent className="-ml-4">
            {creators.map((creator) => (
              <CarouselItem key={creator.id} className="pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
                <CreatorCard creator={creator} onClick={() => handleClick(creator)} />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="-left-4" />
          <CarouselNext className="-right-4" />
        </Carousel>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {creators.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} onClick={() => handleClick(creator)} />
          ))}
        </div>
      )}
    </section>
  );
};

interface CreatorCardProps {
  creator: FeaturedCreator;
  onClick: () => void;
}

const CreatorCard = ({ creator, onClick }: CreatorCardProps) => {
  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-2xl aspect-[3/4]"
    >
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-110"
        style={{ backgroundImage: `url(${creator.background_image_url})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
      </div>

      {/* Badge */}
      <div className="absolute top-4 left-4 z-10">
        <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm text-foreground font-semibold">
          {creator.badge_text}
        </Badge>
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-6 z-10">
        {/* Featured Image/Logo */}
        <div className="mb-4 flex justify-center">
          <img
            src={creator.featured_image_url}
            alt={creator.creator_name}
            className="h-24 w-auto object-contain drop-shadow-2xl"
          />
        </div>

        {/* Separator */}
        <div className="w-full h-px bg-white/20 mb-4" />

        {/* Description */}
        <p className="text-white font-semibold text-sm line-clamp-2 mb-2 leading-tight">
          {creator.description}
        </p>

        {/* Duration */}
        <div className="flex items-center gap-1 text-white/80 text-xs">
          <Clock className="h-3 w-3" />
          <span>{creator.total_duration}</span>
        </div>
      </div>
    </div>
  );
};
