import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Tag, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface PurchaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: {
    id: string;
    title: string;
    thumbnail_url: string;
    price: number;
    discount?: number;
    creator_name: string;
  };
  onPurchaseComplete?: () => void;
}

export const PurchaseModal = ({ open, onOpenChange, content, onPurchaseComplete }: PurchaseModalProps) => {
  const { user } = useAuth();
  const [purchasing, setPurchasing] = useState(false);
  
  const discount = content.discount || 0;
  const finalPrice = content.price * (1 - discount / 100);
  const savings = content.price - finalPrice;

  const handlePurchase = async () => {
    if (!user) {
      toast.error("Você precisa estar logado para comprar");
      return;
    }

    setPurchasing(true);
    try {
      // TODO: Integrar com gateway de pagamento (Stripe/outros)
      // Por enquanto, vamos simular a compra direta
      
      const { error } = await supabase
        .from('purchased_contents')
        .insert({
          user_id: user.id,
          content_id: content.id,
          price_paid: finalPrice,
          discount_applied: discount
        });

      if (error) {
        if (error.code === '23505') {
          toast.error("Você já possui este conteúdo!");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Compra realizada com sucesso!");
      onOpenChange(false);
      onPurchaseComplete?.();
    } catch (error: any) {
      console.error('Purchase error:', error);
      toast.error("Erro ao processar compra. Tente novamente.");
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-primary" />
            Comprar Conteúdo
          </DialogTitle>
          <DialogDescription>
            Complete sua compra para ter acesso permanente a este conteúdo
          </DialogDescription>
        </DialogHeader>

        <Card className="overflow-hidden">
          <div className="aspect-video relative">
            <img 
              src={content.thumbnail_url} 
              alt={content.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-2 left-2 right-2">
              <h3 className="font-semibold text-white line-clamp-2">{content.title}</h3>
              <p className="text-xs text-white/80">por {content.creator_name}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {discount > 0 && (
            <div className="bg-accent/50 p-3 rounded-lg border border-accent">
              <div className="flex items-center gap-2 text-sm">
                <Tag className="w-4 h-4 text-primary" />
                <span className="font-semibold">Desconto especial de {discount}%</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Preço original:</span>
              <span className={discount > 0 ? "line-through text-muted-foreground" : "font-semibold"}>
                R$ {content.price.toFixed(2)}
              </span>
            </div>
            
            {discount > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Desconto:</span>
                  <span>- R$ {savings.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total:</span>
                  <span className="text-primary">R$ {finalPrice.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          <div className="bg-muted/50 p-3 rounded-lg space-y-1">
            <div className="flex items-start gap-2 text-xs">
              <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-muted-foreground">
                Acesso vitalício após a compra. Assista quantas vezes quiser.
              </span>
            </div>
          </div>

          <Button 
            className="w-full"
            size="lg"
            onClick={handlePurchase}
            disabled={purchasing}
          >
            {purchasing ? "Processando..." : `Comprar por R$ ${finalPrice.toFixed(2)}`}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Pagamento seguro e protegido
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
