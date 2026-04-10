import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

export interface FeaturedCreator {
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
  slug?: string | null;
}

interface FeaturedCreatorsProps {
  creators: FeaturedCreator[];
}

export const FeaturedCreators = ({ creators }: FeaturedCreatorsProps) => {
  const navigate = useNavigate();

  const handleClick = (creator: FeaturedCreator) => {
    // Redirect to dedicated page if slug exists, otherwise fallback to link_url
    if (creator.slug) {
      navigate(`/creators/destaque/${creator.slug}`);
    } else {
      navigate(creator.link_url);
    }
  };

  if (creators.length === 0) return null;

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg sm:text-2xl font-bold text-foreground">Creators em Destaque</h2>
      </div>

      <Carousel className="w-full">
        <CarouselContent className="-ml-2 sm:-ml-4">
          {creators.map((creator) => (
            <CarouselItem
              key={creator.id}
              className="pl-2 sm:pl-4 basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/5 xl:basis-1/6"
            >
              <CreatorCard creator={creator} onClick={() => handleClick(creator)} />
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="-left-2 sm:-left-4 hidden sm:flex" />
        <CarouselNext className="-right-2 sm:-right-4 hidden sm:flex" />
      </Carousel>
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
      className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-2xl h-[380px] sm:h-[400px] md:h-[480px] w-auto text-center"
    >
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
        style={{ backgroundImage: `url(${creator.background_image_url})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      </div>

      {/* Badge */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-10">
        <Badge variant="secondary" className="bg-background/95 backdrop-blur-sm text-foreground font-semibold text-xs px-3 py-1 rounded-full">
          {creator.badge_text}
        </Badge>
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 z-10">
        {/* Featured Image/Logo */}
        <div className="mb-3 sm:mb-4 flex justify-center">
          <img
            src={creator.featured_image_url}
            alt={creator.creator_name}
            className="h-16 sm:h-20 md:h-24 w-auto object-contain drop-shadow-2xl"
          />
        </div>

        {/* Separator */}
        <div className="w-12 h-0.5 bg-white/40 mb-3 sm:mb-4 mx-auto" />

        {/* Description */}
        <p className="text-white font-semibold text-sm sm:text-base md:text-lg line-clamp-2 mb-2 sm:mb-3 leading-snug">{creator.description}</p>

        {/* Duration */}
        <div className="flex items-center gap-1.5 text-white/80 text-xs sm:text-sm justify-center">
          <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span>{creator.total_duration}</span>
        </div>
      </div>
    </div>
  );
};
