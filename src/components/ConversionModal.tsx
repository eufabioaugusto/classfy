import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Sparkles, Lock, TrendingUp } from "lucide-react";

interface ConversionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: "premium" | "rewards" | "save" | "progress";
}

export const ConversionModal = ({ open, onOpenChange, reason = "premium" }: ConversionModalProps) => {
  const navigate = useNavigate();

  const messages = {
    premium: {
      title: "Conteúdo Premium",
      description: "Este conteúdo está disponível para assinantes. Crie sua conta gratuita e descubra como acessar conteúdos exclusivos.",
      icon: Lock,
    },
    rewards: {
      title: "Ganhe Recompensas",
      description: "Você já aprende. Agora também ganha por isso! Crie sua conta e comece a ganhar dinheiro por cada vídeo, curso e interação.",
      icon: TrendingUp,
    },
    save: {
      title: "Salve seus Favoritos",
      description: "Crie sua conta para salvar conteúdos, acompanhar seu progresso e ganhar pontos por tudo que você aprende.",
      icon: Sparkles,
    },
    progress: {
      title: "Acompanhe seu Progresso",
      description: "Entre na Classfy para continuar de onde parou, salvar seu histórico e ganhar recompensas por concluir cursos.",
      icon: TrendingUp,
    },
  };

  const message = messages[reason];
  const Icon = message.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-4">
          <div className="mx-auto p-4 rounded-full bg-accent/10">
            <Icon className="w-8 h-8 text-accent" />
          </div>
          <DialogTitle className="text-2xl text-center">{message.title}</DialogTitle>
          <DialogDescription className="text-center text-base">
            {message.description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-4">
          <Button
            onClick={() => {
              onOpenChange(false);
              navigate("/auth");
            }}
            className="w-full"
          >
            Criar Conta Grátis
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              navigate("/auth");
            }}
            className="w-full"
          >
            Já tenho conta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};