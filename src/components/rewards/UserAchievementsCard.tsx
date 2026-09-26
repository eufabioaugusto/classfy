import { useEffect, useState } from "react";
import { Award, BookOpenCheck, Flame, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { V2Card, V2CardContent, V2CardHeader } from "@/components/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildUserMilestones, type UserMilestone, type UserMilestoneStats } from "@/lib/rewards/userMilestones";

interface UserBadge {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
}

const emptyStats: UserMilestoneStats = { totalPoints: 0, completedContents: 0, longestStreak: 0 };

function MilestoneCard({ milestone }: { milestone: UserMilestone }) {
  const Icon = milestone.kind === "content" ? BookOpenCheck : milestone.kind === "streak" ? Flame : Star;
  const progress = Math.min(100, (milestone.current / milestone.target) * 100);
  const targetLabel = milestone.kind === "level" ? "N2" : milestone.target.toLocaleString("pt-BR");

  return (
    <div className={`economy-achievement economy-achievement--user${milestone.unlocked ? "" : " economy-achievement--locked"}`}>
      <div className="economy-achievement__mark">
        <Icon aria-hidden="true" />
        <strong>{targetLabel}</strong>
      </div>
      <div className="economy-achievement__copy">
        <span title={milestone.title}>{milestone.title}</span>
        <small>{milestone.description}</small>
        <small>{milestone.unlocked ? "Conquistado" : `${milestone.current.toLocaleString("pt-BR")} de ${milestone.target.toLocaleString("pt-BR")}`}</small>
      </div>
      {!milestone.unlocked && (
        <div className="economy-achievement__progress" role="progressbar" aria-label={milestone.title} aria-valuemin={0} aria-valuemax={milestone.target} aria-valuenow={Math.min(milestone.current, milestone.target)}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function UserAchievementsCard({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [stats, setStats] = useState<UserMilestoneStats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);

    void (async () => {
      const [eventsResult, streakResult, badgesResult] = await Promise.all([
        supabase.from("reward_events").select("id, action_key, content_id, points").eq("user_id", userId).eq("point_type", "user"),
        supabase.from("user_login_streaks").select("current_streak, longest_streak").eq("user_id", userId).maybeSingle(),
        supabase.from("user_badges").select("id, badges(name, description, icon_url)").eq("user_id", userId).order("earned_at", { ascending: false }),
      ]);

      if (!active) return;
      if (eventsResult.error || streakResult.error) {
        console.error("Error fetching user milestone progress:", eventsResult.error || streakResult.error);
        setFailed(true);
        setLoading(false);
        return;
      }

      const events = eventsResult.data || [];
      setStats({
        totalPoints: events.reduce((sum, event) => sum + event.points, 0),
        completedContents: new Set(events.filter((event) => event.action_key === "WATCH_100").map((event) => event.content_id || event.id)).size,
        longestStreak: Math.max(streakResult.data?.longest_streak || 0, streakResult.data?.current_streak || 0),
      });

      if (badgesResult.error) console.error("Error fetching user badges:", badgesResult.error);
      setBadges(
        (badgesResult.data || []).flatMap((entry) =>
          entry.badges
            ? [{ id: entry.id, name: entry.badges.name, description: entry.badges.description, iconUrl: entry.badges.icon_url }]
            : [],
        ),
      );
      setLoading(false);
    })();

    return () => { active = false; };
  }, [userId]);

  const milestones = buildUserMilestones(stats);
  const unlocked = milestones.filter((milestone) => milestone.unlocked);
  const inProgress = milestones.filter((milestone) => !milestone.unlocked);

  return (
    <V2Card className="economy-panel">
      <V2CardHeader>
        <div className="economy-panel-heading">
          <span className="economy-icon"><Award aria-hidden="true" /></span>
          <div>
            <h2 className="economy-panel-title">Conquistas de aprendizado</h2>
            <p className="economy-panel-copy">
              {loading ? "Carregando seu progresso..." : failed ? "Não foi possível carregar" : `${unlocked.length} de ${milestones.length} marcos alcançados`}
            </p>
          </div>
        </div>
      </V2CardHeader>
      <V2CardContent>
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando conquistas...</div>
        ) : failed ? (
          <p className="economy-panel-copy py-8 text-center">Não foi possível carregar seu progresso agora.</p>
        ) : (
          <Tabs defaultValue="progress">
            <TabsList className="economy-tabs-list">
              <TabsTrigger value="unlocked">Desbloqueadas · {unlocked.length}</TabsTrigger>
              <TabsTrigger value="progress">Em progresso · {inProgress.length}</TabsTrigger>
            </TabsList>
            <TabsContent value="unlocked" className="mt-5">
              {unlocked.length ? <div className="economy-achievement-grid">{unlocked.map((milestone) => <MilestoneCard key={milestone.id} milestone={milestone} />)}</div> : <p className="economy-panel-copy py-8 text-center">Seu primeiro marco está próximo.</p>}
            </TabsContent>
            <TabsContent value="progress" className="mt-5">
              {inProgress.length ? <div className="economy-achievement-grid">{inProgress.map((milestone) => <MilestoneCard key={milestone.id} milestone={milestone} />)}</div> : <p className="economy-panel-copy py-8 text-center">Você alcançou todos os marcos desta etapa.</p>}
            </TabsContent>
            {badges.length > 0 && (
              <div className="economy-user-achievements mt-5">
                {badges.map((badge) => (
                  <div className="economy-user-achievement" key={badge.id}>
                    <span className="economy-user-achievement__icon">{badge.iconUrl ? <img src={badge.iconUrl} alt="" /> : <Award aria-hidden="true" />}</span>
                    <div><strong>{badge.name}</strong>{badge.description && <p>{badge.description}</p>}</div>
                  </div>
                ))}
              </div>
            )}
          </Tabs>
        )}
      </V2CardContent>
    </V2Card>
  );
}
