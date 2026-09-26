export interface UserMilestoneStats {
  totalPoints: number;
  completedContents: number;
  longestStreak: number;
}

export interface UserMilestone {
  id: string;
  title: string;
  description: string;
  kind: "content" | "streak" | "level";
  current: number;
  target: number;
  unlocked: boolean;
}

export function buildUserMilestones(stats: UserMilestoneStats): UserMilestone[] {
  const definitions: Array<Omit<UserMilestone, "current" | "unlocked">> = [
    { id: "first-content", title: "Primeiro conteúdo", description: "Conclua seu primeiro conteúdo", kind: "content", target: 1 },
    { id: "five-contents", title: "Explorador", description: "Conclua 5 conteúdos", kind: "content", target: 5 },
    { id: "twenty-contents", title: "Estudioso", description: "Conclua 20 conteúdos", kind: "content", target: 20 },
    { id: "seven-days", title: "Ritmo de estudo", description: "Acesse a Classfy por 7 dias seguidos", kind: "streak", target: 7 },
    { id: "thirty-days", title: "Constância", description: "Acesse a Classfy por 30 dias seguidos", kind: "streak", target: 30 },
    { id: "level-two", title: "Novo nível", description: "Alcance o Nível 2", kind: "level", target: 500 },
  ];

  return definitions.map((definition) => {
    const current = Math.max(0, stats[
      definition.kind === "content" ? "completedContents"
        : definition.kind === "streak" ? "longestStreak" : "totalPoints"
    ]);

    return { ...definition, current, unlocked: current >= definition.target };
  });
}
