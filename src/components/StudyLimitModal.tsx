import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Archive, Plus, Zap, MessageSquare, GitBranch } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface StudyLimitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limitType: 'messages' | 'deviations';
  current: number;
  max: number;
  plan: string;
  suggestedTopic?: string;
  onArchiveAndNew: () => void;
}

export function StudyLimitModal({
  open,
  onOpenChange,
  limitType,
  current,
  max,
  plan,
  suggestedTopic,
  onArchiveAndNew,
}: StudyLimitModalProps) {
  const navigate = useNavigate();

  const isMessageLimit = limitType === 'messages';
  const Icon = isMessageLimit ? MessageSquare : GitBranch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-full bg-amber-500/10">
              <Icon className="w-6 h-6 text-amber-600" />
            </div>
            <DialogTitle className="text-xl">
              {isMessageLimit ? 'Limite de mensagens atingido' : 'Novo tema detectado'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-base">
            {isMessageLimit ? (
              <>
                Você usou <strong>{current}</strong> de <strong>{max}</strong> mensagens 
                neste estudo. Para continuar sua jornada de aprendizado:
              </>
            ) : (
              <>
                Parece que você quer explorar um tema diferente
                {suggestedTopic && <strong>: "{suggestedTopic}"</strong>}.
                Este estudo atingiu o limite de {max} desvios de tema.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <Button 
            variant="outline" 
            className="w-full justify-start h-auto py-4 px-4"
            onClick={onArchiveAndNew}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Archive className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <div className="font-medium">Arquivar e criar novo</div>
                <div className="text-sm text-muted-foreground">
                  Salve este estudo e comece um novo para {suggestedTopic || 'o novo tema'}
                </div>
              </div>
            </div>
          </Button>

          {plan !== 'premium' && (
            <Button 
              variant="default"
              className="w-full justify-start h-auto py-4 px-4 bg-gradient-to-r from-primary to-primary/80"
              onClick={() => navigate('/planos')}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white/20">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Fazer upgrade</div>
                  <div className="text-sm opacity-90">
                    {plan === 'free' 
                      ? 'Pro: 200 msgs/estudo • Premium: Ilimitado'
                      : 'Premium: Mensagens e estudos ilimitados'
                    }
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
