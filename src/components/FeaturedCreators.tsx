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

  const isCarousel = creators.length > 6;

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg sm:text-2xl font-bold text-foreground">Creators em Destaque</h2>
      </div>

      {isCarousel ? (
        <Carousel className="w-full">
          <CarouselContent className="-ml-2 sm:-ml-4">
            {creators.map((creator) => (
              <CarouselItem
                key={creator.id}
                className="pl-2 sm:pl-4 basis-1/2 sm:basis-1/2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
              >
                <CreatorCard creator={creator} onClick={() => handleClick(creator)} />
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="-left-2 sm:-left-4 hidden sm:flex" />
          <CarouselNext className="-right-2 sm:-right-4 hidden sm:flex" />
        </Carousel>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-4">
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
      className="group relative rounded-lg sm:rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-2xl h-[240px] sm:h-[340px] md:h-[440px] w-auto text-center"
    >
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-110"
        style={{ backgroundImage: `url(${creator.background_image_url})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
      </div>

      {/* Badge */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-10">
        <Badge variant="secondary" className="bg-background/90 backdrop-blur-sm text-foreground font-semibold text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5">
          {creator.badge_text}
        </Badge>
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-3 sm:p-6 z-10">
        {/* Featured Image/Logo */}
        <div className="mb-2 sm:mb-4 flex justify-center">
          <img
            src={creator.featured_image_url}
            alt={creator.creator_name}
            className="h-12 sm:h-16 md:h-24 w-auto object-contain drop-shadow-2xl"
          />
        </div>

        {/* Separator */}
        <div className="w-full h-px bg-white/20 mb-2 sm:mb-4" />

        {/* Description */}
        <p className="text-white font-semibold text-[10px] sm:text-xs md:text-sm line-clamp-2 mb-1 sm:mb-2 leading-tight">{creator.description}</p>

        {/* Duration */}
        <div className="flex items-center gap-1 text-white/80 text-[9px] sm:text-xs justify-center">
          <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          <span>{creator.total_duration}</span>
        </div>
      </div>
    </div>
  );
};
