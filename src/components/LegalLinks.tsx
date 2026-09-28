import { Link } from "react-router-dom";

export function LegalLinks() {
  return (
    <nav aria-label="Informações legais" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <Link to="/privacidade" className="hover:text-foreground hover:underline">Política de Privacidade</Link>
      <Link to="/termos" className="hover:text-foreground hover:underline">Termos de Uso</Link>
    </nav>
  );
}
