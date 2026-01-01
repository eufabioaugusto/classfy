import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Zap, MessageSquare, GitBranch } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface StudyLimitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitType: "messages" | "deviations";
  current: number;
  max: number;
  plan: string;
  suggestedTopic?: string;
}

export function StudyLimitModal({
  open,
  onOpenChange,
  limitType,
  current,
  max,
  plan,
  suggestedTopic,
}: StudyLimitModalProps) {
  const navigate = useNavigate();

  const isMessageLimit = limitType === "messages";
  const Icon = isMessageLimit ? MessageSquare : GitBranch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2 min-w-0">
            <div className="p-3 rounded-full bg-accent/10 shrink-0">
              <Icon className="w-6 h-6 text-accent" />
            </div>
            <DialogTitle className="text-xl truncate">
              {isMessageLimit ? "Limite de mensagens atingido" : "Novo tema detectado"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-base break-words">
            {isMessageLimit ? (
              <>
                Você usou <strong>{current}</strong> de <strong>{max}</strong> mensagens
                neste estudo. Para continuar sua jornada de aprendizado:
              </>
            ) : (
              <>
                Parece que você quer explorar um tema diferente
                {suggestedTopic && <strong>: "{suggestedTopic}"</strong>}. Este estudo
                atingiu o limite de {max} desvios de tema.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {plan !== "premium" && (
            <Button
              variant="default"
              className="w-full justify-start h-auto py-4 px-4 bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => navigate("/planos")}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-accent-foreground/15 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="text-left min-w-0">
                  <div className="font-medium">Fazer upgrade</div>
                  <div className="text-sm opacity-90 whitespace-normal break-words">
                    {plan === "free"
                      ? "Pro: 30 msgs/estudo • Premium: ilimitado"
                      : "Premium: mensagens e estudos ilimitados"}
                  </div>
                </div>
              </div>
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

