import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const BoostSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const boostId = searchParams.get('boost_id');

  useEffect(() => {
    const activateBoost = async () => {
      if (!boostId) {
        toast.error('ID do boost não encontrado');
        navigate('/');
        return;
      }

      try {
        const { error } = await supabase.functions.invoke('activate-boost', {
          body: { boostId }
        });

        if (error) throw error;

        toast.success('Boost ativado com sucesso!');
      } catch (error: any) {
        console.error('Error activating boost:', error);
        toast.error('Erro ao ativar boost');
      } finally {
        setLoading(false);
      }
    };

    activateBoost();
  }, [boostId, navigate]);

  return (
    <div className="container max-w-2xl mx-auto px-4 py-20">
      <Card className="p-8 text-center">
        {loading ? (
          <>
            <Loader2 className="w-16 h-16 mx-auto mb-4 animate-spin text-primary" />
            <h1 className="text-2xl font-bold mb-2">Ativando seu boost...</h1>
            <p className="text-muted-foreground">
              Aguarde enquanto configuramos sua campanha.
            </p>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h1 className="text-2xl font-bold mb-2">Boost Ativado! 🚀</h1>
            <p className="text-muted-foreground mb-6">
              Seu conteúdo agora está sendo impulsionado e aparecerá nas primeiras posições.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate('/')}>
                Voltar para Home
              </Button>
              <Button variant="outline" onClick={() => navigate('/studio')}>
                Ver Meus Boosts
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default BoostSuccess;