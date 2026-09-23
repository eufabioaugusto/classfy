import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToRewardEarned, type RewardEarnedDetail } from "@/lib/rewards/events";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { ProfileAvatar } from "@/components/ProfileAvatar";

interface RewardAvatarProps {
  collapsed?: boolean;
  placement?: "sidebar" | "header";
}

export function RewardAvatar({ collapsed = false, placement = "sidebar" }: RewardAvatarProps) {
  const { user } = useAuth();
  const [gain, setGain] = useState<(RewardEarnedDetail & { key: number }) | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeToRewardEarned((reward) => {
      if (reward.userId !== user?.id || reward.points <= 0) return;
      window.clearTimeout(timer);
      setGain({ ...reward, key: Date.now() + Math.random() });
      timer = window.setTimeout(() => setGain(null), 1750);
    }, user?.id);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  const label = gain?.pointType === "creator" ? "Creator Points" : "Points";
  return (
    <span className={`cf2-reward-avatar ${collapsed ? "cf2-reward-avatar--collapsed" : ""} ${placement === "header" ? "cf2-reward-avatar--header" : ""}`}>
      {gain && <span key={`ring-${gain.key}`} className="cf2-reward-avatar__ring" data-type={gain.pointType} aria-hidden="true" />}
      <ProfileAvatar size="sm" className="cf2-reward-avatar__image" />
      <ParticleBurst key={`burst-${gain?.key ?? "idle"}`} isActive={Boolean(gain)} color={gain?.pointType === "creator" ? "gold" : "primary"} particleCount={6} />
      {gain && (
        <span key={`gain-${gain.key}`} className="cf2-reward-avatar__gain" data-type={gain.pointType} role="status" aria-label={`Mais ${gain.points.toLocaleString("pt-BR")} ${label}`}>
          +{gain.points.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
          {!collapsed && <small>{label}</small>}
        </span>
      )}
    </span>
  );
}
