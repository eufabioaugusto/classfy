import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Radio, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PublicLive = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  started_at: string;
  viewer_count: number;
  creator_name: string;
  creator_avatar_url: string | null;
};

export function HomeLiveSection({ authenticated }: { authenticated: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: lives = [] } = useQuery({
    queryKey: ["public-home-lives"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_home_lives");
      if (error) throw error;
      return (data || []) as PublicLive[];
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!authenticated) return;
    const channel = supabase.channel("home-live-status").on("postgres_changes", {
      event: "*", schema: "public", table: "lives",
    }, () => { void queryClient.invalidateQueries({ queryKey: ["public-home-lives"] }); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [authenticated, queryClient]);

  if (!lives.length) return null;

  return <section className="cf2-home-lives" aria-labelledby="home-lives-title">
    <div className="cf2-home-section__header">
      <div><span className="cf2-home-section__eyebrow">Acontecendo agora</span><h2 id="home-lives-title"><Radio /> Lives ao vivo</h2></div>
      <span className="cf2-home-lives__count">{lives.length} {lives.length === 1 ? "transmissão" : "transmissões"}</span>
    </div>
    <div className="cf2-home-lives__grid">
      {lives.map((live) => <button type="button" className="cf2-home-live" key={live.id}
        onClick={() => navigate(authenticated ? `/live/${live.id}` : "/auth", authenticated ? undefined : { state: { from: `/live/${live.id}` } })}>
        <div className="cf2-home-live__visual">
          {live.thumbnail_url && <img src={live.thumbnail_url} alt="" loading="lazy" />}
          <span className="cf2-home-live__badge"><span /> AO VIVO</span>
          <Radio className="cf2-home-live__radio" aria-hidden="true" />
        </div>
        <div className="cf2-home-live__body">
          <div className="cf2-home-live__creator">
            {live.creator_avatar_url ? <img src={live.creator_avatar_url} alt="" loading="lazy" /> : <span>{live.creator_name.charAt(0)}</span>}
            <span>{live.creator_name}</span>
          </div>
          <strong>{live.title}</strong>
          {live.description && <p>{live.description}</p>}
          <div className="cf2-home-live__footer"><span><Users /> {live.viewer_count || 0} assistindo</span><span>Assistir <ArrowUpRight /></span></div>
        </div>
      </button>)}
    </div>
  </section>;
}
