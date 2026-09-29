export const studyModes = [
  { id: "explain", title: "Entender", description: "Explicação, exemplo e compreensão" },
  { id: "practice", title: "Praticar", description: "Um exercício por vez, com feedback" },
  { id: "review", title: "Revisar", description: "Recordar e trabalhar suas dificuldades" },
  { id: "plan", title: "Planejar", description: "Um plano para seu objetivo e seu tempo" },
] as const;
export type StudyMode = typeof studyModes[number]["id"];
export type ContextMenu = "main" | "mentions" | "modes" | null;
