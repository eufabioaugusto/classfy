import { BarChart3, LayoutDashboard, Library, Rocket, Target } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const studioRoutes = [
  { label: "Visão geral", path: "/studio", Icon: LayoutDashboard },
  { label: "Analytics", path: "/studio/analytics", Icon: BarChart3 },
  { label: "Conteúdos", path: "/studio/contents", Icon: Library },
  { label: "Metas", path: "/studio/goals", Icon: Target },
  { label: "Boosts", path: "/studio/boosts", Icon: Rocket },
];

export function StudioNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="studio-nav" aria-label="Navegação do Studio">
      {studioRoutes.map(({ label, path, Icon }) => {
        const isActive = location.pathname === path;

        return (
          <button
            key={path}
            type="button"
            className="studio-nav__item"
            data-active={isActive || undefined}
            aria-current={isActive ? "page" : undefined}
            onClick={() => navigate(path)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
