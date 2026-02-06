import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Gift, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveGift } from "@/hooks/useLiveChat";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LiveGiftPanelProps {
  gifts: LiveGift[];
  isLoading: boolean;
  onSendGift: (gift: LiveGift, quantity: number) => Promise<void>;
  className?: string;
}

export function LiveGiftPanel({
  gifts,
  isLoading,
  onSendGift,
  className,
}: LiveGiftPanelProps) {
  const { user } = useAuth();
  const [selectedGift, setSelectedGift] = useState<LiveGift | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isSending, setIsSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSelectGift = (gift: LiveGift) => {
    setSelectedGift(gift);
    setQuantity(1);
    setShowConfirm(true);
  };

  const handleSend = async () => {
    if (!selectedGift) return;
    
    try {
      setIsSending(true);
      await onSendGift(selectedGift, quantity);
      setShowConfirm(false);
      setSelectedGift(null);
    } catch (error) {
      console.error("Error sending gift:", error);
    } finally {
      setIsSending(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(price);
  };

  return (
    <>
      <div className={cn("p-2", className)}>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Gift className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium">Enviar Presente</span>
        </div>
        
        {!user ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Faça login para enviar presentes
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {gifts.map((gift) => (
              <motion.button
                key={gift.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleSelectGift(gift)}
                className="flex flex-col items-center p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <span className="text-2xl mb-1">{gift.icon}</span>
                <span className="text-[10px] font-medium truncate w-full text-center">
                  {gift.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatPrice(gift.price)}
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
      
      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar Presente</DialogTitle>
            <DialogDescription>
              Confirme o envio do presente para o creator
            </DialogDescription>
          </DialogHeader>
          
          {selectedGift && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-4 py-4">
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-6xl"
                >
                  {selectedGift.icon}
                </motion.span>
              </div>
              
              <div className="text-center">
                <h4 className="font-semibold">{selectedGift.name}</h4>
                <p className="text-muted-foreground text-sm">
                  {formatPrice(selectedGift.price)} por unidade
                </p>
              </div>
              
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  -
                </Button>
                <span className="w-8 text-center font-semibold">{quantity}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  +
                </Button>
              </div>
              
              <div className="border-t pt-4">
                <div className="flex justify-between mb-2">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold">
                    {formatPrice(selectedGift.price * quantity)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  70% vai para o creator ({formatPrice(selectedGift.price * quantity * 0.7)})
                </p>
                
                <Button
                  className="w-full"
                  onClick={handleSend}
                  disabled={isSending}
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Gift className="w-4 h-4 mr-2" />
                      Enviar {selectedGift.icon} x{quantity}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
