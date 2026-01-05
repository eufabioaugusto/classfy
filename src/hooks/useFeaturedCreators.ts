import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

// Cache global para evitar múltiplas requisições
let cachedFeaturedCreatorIds: string[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

export const useFeaturedCreators = () => {
  const [featuredCreatorIds, setFeaturedCreatorIds] = useState<string[]>(cachedFeaturedCreatorIds || []);
  const [loading, setLoading] = useState(!cachedFeaturedCreatorIds);

  useEffect(() => {
    const fetchFeaturedCreators = async () => {
      // Usar cache se ainda válido
      if (cachedFeaturedCreatorIds && Date.now() - cacheTimestamp < CACHE_DURATION) {
        setFeaturedCreatorIds(cachedFeaturedCreatorIds);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("featured_creators")
          .select("creator_id");

        if (error) throw error;

        const ids = data?.map((fc) => fc.creator_id) || [];
        cachedFeaturedCreatorIds = ids;
        cacheTimestamp = Date.now();
        setFeaturedCreatorIds(ids);
      } catch (error) {
        console.error("Error fetching featured creators:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedCreators();
  }, []);

  const isCreatorFeatured = (creatorId: string): boolean => {
    return featuredCreatorIds.includes(creatorId);
  };

  return { featuredCreatorIds, isCreatorFeatured, loading };
};

// Hook simples para verificar um único creator
export const useIsCreatorFeatured = (creatorId: string | undefined): boolean => {
  const { isCreatorFeatured } = useFeaturedCreators();
  return creatorId ? isCreatorFeatured(creatorId) : false;
};
