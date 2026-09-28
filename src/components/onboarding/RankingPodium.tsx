import { Crown, Sparkles, Trophy, TrendingUp } from "lucide-react";

export function RankingPodium({ name }: { name: string }) {
  const firstName = name.trim().split(/\s+/)[0] || "Você";
  return (
    <aside className="ob-ranking" aria-label="Exemplo de ranking da Classfy">
      <div className="ob-ranking-heading">
        <span className="ob-ranking-kicker"><Trophy /> SUAS PRÓXIMAS CONQUISTAS</span>
        <h2>Seu lugar entre<br /><em>quem vai além.</em></h2>
        <p>Aprender também pode levar você ao topo.</p>
      </div>
      <div className="ob-ranking-scene">
        <div className="ob-ranking-halo" />
        <Sparkles className="ob-ranking-spark ob-ranking-spark--one" />
        <Sparkles className="ob-ranking-spark ob-ranking-spark--two" />
        <div className="ob-ranking-lane ob-ranking-lane--silver">
          <div className="ob-ranking-person">
            <span className="ob-ranking-avatar">AC</span>
            <strong>Ana Clara</strong><small>1.180 Points</small>
          </div>
          <div className="ob-ranking-block"><span>2</span></div>
        </div>
        <div className="ob-ranking-lane ob-ranking-lane--gold">
          <div className="ob-ranking-person">
            <Crown className="ob-ranking-crown" />
            <span className="ob-ranking-avatar">{firstName.charAt(0).toUpperCase()}</span>
            <strong>{firstName}</strong><small>1.250 Points</small>
          </div>
          <div className="ob-ranking-block"><Trophy /><span>1</span></div>
        </div>
        <div className="ob-ranking-lane ob-ranking-lane--bronze">
          <div className="ob-ranking-person">
            <span className="ob-ranking-avatar">LP</span>
            <strong>Lucas Prado</strong><small>1.050 Points</small>
          </div>
          <div className="ob-ranking-block"><span>3</span></div>
        </div>
      </div>
      <div className="ob-ranking-caption"><TrendingUp /><span>Cada descoberta conta.<strong>Continue construindo sua evolução.</strong></span></div>
      <small className="ob-ranking-example">Ranking ilustrativo</small>
    </aside>
  );
}
