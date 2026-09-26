import { useEffect, useState } from "react";
import { Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { V2Card, V2CardContent, V2CardHeader } from "@/components/v2";

interface UserBadge {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
}

export function UserAchievementsCard({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);

    void (async () => {
      const { data, error } = await supabase
        .from("user_badges")
        .select("id, badges(name, description, icon_url)")
        .eq("user_id", userId)
        .order("earned_at", { ascending: false });

      if (!active) return;
      if (error) {
        console.error("Error fetching user achievements:", error);
        setFailed(true);
        setLoading(false);
        return;
      }
      setBadges(
        (data || []).flatMap((entry) =>
          entry.badges
            ? [{
                id: entry.id,
                name: entry.badges.name,
                description: entry.badges.description,
                iconUrl: entry.badges.icon_url,
              }]
            : [],
        ),
      );
      setLoading(false);
    })();

    return () => { active = false; };
  }, [userId]);

  return (
    <V2Card className="economy-panel">
      <V2CardHeader>
        <div className="economy-panel-heading">
          <span className="economy-icon"><Award aria-hidden="true" /></span>
          <div>
            <h2 className="economy-panel-title">Suas conquistas</h2>
            <p className="economy-panel-copy">
              {loading ? "Carregando conquistas..." : failed ? "Não foi possível carregar" : `${badges.length} ${badges.length === 1 ? "conquista desbloqueada" : "conquistas desbloqueadas"}`}
            </p>
          </div>
        </div>
      </V2CardHeader>
      <V2CardContent>
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : failed ? (
          <p className="economy-panel-copy py-8 text-center">Não foi possível carregar suas conquistas agora.</p>
        ) : badges.length ? (
          <div className="economy-user-achievements">
            {badges.map((badge) => (
              <div className="economy-user-achievement" key={badge.id}>
                <span className="economy-user-achievement__icon">
                  {badge.iconUrl ? <img src={badge.iconUrl} alt="" /> : <Award aria-hidden="true" />}
                </span>
                <div>
                  <strong>{badge.name}</strong>
                  {badge.description && <p>{badge.description}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="economy-user-achievements__empty">
            <span className="economy-user-achievements__empty-icon"><Award aria-hidden="true" /></span>
            <strong>Suas conquistas aparecem aqui</strong>
            <p>Quando você desbloquear uma conquista, poderá vê-la neste espaço.</p>
          </div>
        )}
      </V2CardContent>
    </V2Card>
  );
}
