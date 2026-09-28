import { ShoppingCart, Lock } from "lucide-react";
import { PlanCrown } from "@/components/plans/PlanCrown";
import { Button } from "@/components/ui/button";

interface AccessBlockedOverlayProps {
  compact?: boolean;
  reason: "plan" | "purchase";
  requiredPlan?: "pro" | "premium";
  price?: number;
  onUpgradeClick: () => void;
  onPurchaseClick: () => void;
  thumbnail?: string;
}

export const AccessBlockedOverlay = ({
  compact = false,
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
    <div className={`relative aspect-video bg-black overflow-hidden ${compact ? "min-h-[220px]" : "rounded-lg"}`}>
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
      <div className={`absolute inset-0 flex flex-col items-center justify-center text-center ${compact ? "px-8 py-3 gap-2" : "p-6"}`}>
        <div className={compact ? "" : "mb-4"}>
          {reason === "plan" ? (
            <div className={`${compact ? "w-9 h-9" : "w-16 h-16"} rounded-full flex items-center justify-center ${isPremium ? "bg-red-500/20" : "bg-yellow-500/20"}`}>
              <PlanCrown plan={isPremium ? "premium" : "pro"} className={compact ? "h-5 w-5" : "h-8 w-8"} />
            </div>
          ) : (
            <div className={`${compact ? "w-9 h-9" : "w-16 h-16"} rounded-full flex items-center justify-center bg-white/10`}>
              <Lock className={`${compact ? "h-5 w-5" : "h-8 w-8"} text-white`} />
            </div>
          )}
        </div>

        <h2 className={compact ? "text-base font-semibold leading-tight text-white max-w-[280px]" : "text-xl sm:text-2xl font-bold text-white mb-2"}>
          {reason === "plan" 
            ? `${compact ? "Exclusivo para assinantes" : "Conteúdo exclusivo para assinantes"} ${isPremium ? "Premium" : "Pro"}`
            : "Conteúdo Pago"
          }
        </h2>
        
        <p className={compact ? "text-xs leading-relaxed text-gray-300 max-w-[280px]" : "text-sm sm:text-base text-gray-300 mb-6 max-w-md"}>
          {reason === "plan"
            ? compact ? `Desbloqueie este conteúdo com o plano ${isPremium ? "Premium" : "Pro"}.` : `Assine o plano ${isPremium ? "Premium" : "Pro"} para desbloquear este conteúdo e muito mais.`
            : `Compre este conteúdo por R$ ${price.toFixed(2)} para assistir agora.`
          }
        </p>

        <Button
          size="lg"
          onClick={reason === "plan" ? onUpgradeClick : onPurchaseClick}
          className={`gap-2 ${compact ? "h-9 px-4 text-xs mt-1 shrink-0" : ""} ${
            reason === "plan" && isPremium 
              ? "bg-red-600 hover:bg-red-700" 
              : reason === "plan" && isPro 
                ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                : ""
          }`}
        >
          {reason === "plan" ? (
            <>
              <span className="grid h-6 w-6 place-items-center rounded-md bg-white" aria-hidden="true">
                <PlanCrown plan={isPremium ? "premium" : "pro"} className="h-4 w-4" />
              </span>
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
