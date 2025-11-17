import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Favoritos() {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
        </div>
      </header>
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Favoritos</h1>
        <p className="text-muted-foreground">Seus conteúdos favoritos aparecerão aqui.</p>
      </div>
    </div>
  );
}