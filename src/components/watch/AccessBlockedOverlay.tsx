import { Crown, ShoppingCart, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccessBlockedOverlayProps {
  reason: "plan" | "purchase";
  requiredPlan?: "pro" | "premium";
  price?: number;
  onUpgradeClick: () => void;
  onPurchaseClick: () => void;
  thumbnail?: string;
}

export const AccessBlockedOverlay = ({
  reason,
  requiredPlan = "pro",
  price = 0,
  onUpgradeClick,
  onPurchaseClick,
  thumbnail,
}: AccessBlockedOverlayProps) => {
  const isPro = requiredPlan === "pro";
  const isPremium = requiredPlan === "premium";

  return (
    <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
      {/* Background thumbnail with blur */}
      {thumbnail && (
        <img
          src={thumbnail}
          alt="Thumbnail"
          className="absolute inset-0 w-full h-full object-cover blur-md opacity-30"
        />
      )}
      
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/70" />
      
      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
        <div className="mb-4">
          {reason === "plan" ? (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isPremium ? "bg-red-500/20" : "bg-yellow-500/20"}`}>
              <Crown className={`h-8 w-8 ${isPremium ? "text-red-500" : "text-yellow-400"}`} fill="currentColor" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary/20">
              <Lock className="h-8 w-8 text-primary" />
            </div>
          )}
        </div>

        <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
          {reason === "plan" 
            ? `Conteúdo exclusivo para assinantes ${isPremium ? "Premium" : "Pro"}`
            : "Conteúdo Pago"
          }
        </h2>
        
        <p className="text-sm sm:text-base text-gray-300 mb-6 max-w-md">
          {reason === "plan"
            ? `Assine o plano ${isPremium ? "Premium" : "Pro"} para desbloquear este conteúdo e muito mais.`
            : `Compre este conteúdo por R$ ${price.toFixed(2)} para assistir agora.`
          }
        </p>

        <Button
          size="lg"
          onClick={reason === "plan" ? onUpgradeClick : onPurchaseClick}
          className={`gap-2 ${
            reason === "plan" && isPremium 
              ? "bg-red-600 hover:bg-red-700" 
              : reason === "plan" && isPro 
                ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                : ""
          }`}
        >
          {reason === "plan" ? (
            <>
              <Crown className="h-4 w-4" />
              Assinar {isPremium ? "Premium" : "Pro"}
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              Comprar por R$ {price.toFixed(2)}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
