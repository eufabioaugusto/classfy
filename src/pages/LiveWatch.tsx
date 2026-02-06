import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveChat, LiveGift } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Users, Radio, Gift, Loader2 } from "lucide-react";
import { LiveChat } from "@/components/live/LiveChat";
import { LiveGiftPanel } from "@/components/live/LiveGiftPanel";
import { FollowButton } from "@/components/FollowButton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Live {
  id: string;
  title: string;
  description: string | null;
  status: string;
  started_at: string | null;
  viewer_count: number;
  creator_id: string;
  creator?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export default function LiveWatch() {
  const { id } = useParams();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [gifts, setGifts] = useState<LiveGift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGifts, setShowGifts] = useState(false);

  const { messages, pinnedMessage, isLoading: chatLoading, isSending, sendMessage } = useLiveChat(id || null);
  const { viewerCount, joinLive, leaveLive } = useLiveViewers(id || null);

  // Fetch live data
  useEffect(() => {
    if (!id) return;

    const fetchLive = async () => {
      const { data, error } = await supabase
        .from("lives")
        .select(`*, creator:profiles!creator_id(id, display_name, avatar_url)`)
        .eq("id", id)
        .single();

      if (error || !data) {
        toast.error("Live não encontrada");
        return;
      }

      setLive(data);
      setIsLoading(false);

      // Fetch gifts
      const { data: giftsData } = await supabase
        .from("live_gifts")
        .select("*")
        .eq("active", true)
        .order("order_index");

      setGifts(giftsData || []);
    };

    fetchLive();

    // Join as viewer
    if (user) {
      joinLive();
    }

    return () => {
      if (user) {
        leaveLive();
      }
    };
  }, [id, user]);

  // Subscribe to live status changes
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`live-status-${id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "lives",
        filter: `id=eq.${id}`,
      }, (payload) => {
        if (payload.new.status === "ended") {
          toast.info("A live foi encerrada");
        }
        setLive(prev => prev ? { ...prev, ...payload.new } : null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const handleSendGift = async (gift: LiveGift, quantity: number) => {
    // For now, just send as message (real payment would go here)
    toast.success(`Você enviou ${gift.name} x${quantity}! (Integração de pagamento pendente)`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <Radio className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-bold mb-2">Live não encontrada</h2>
          <p className="text-muted-foreground mb-4">Esta transmissão pode ter sido encerrada.</p>
          <Button asChild>
            <Link to="/">Voltar ao início</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const isEnded = live.status === "ended";

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Video Area */}
        <div className="aspect-video bg-black relative flex items-center justify-center">
          {isEnded ? (
            <div className="text-center text-white">
              <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-bold">Transmissão Encerrada</h2>
              <p className="text-muted-foreground mt-2">Esta live já foi finalizada</p>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-background flex items-center justify-center">
                <div className="text-center">
                  <Radio className="w-20 h-20 mx-auto mb-4 text-accent animate-pulse" />
                  <p className="text-lg">Transmissão em andamento</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    (Integração com stream de vídeo pendente)
                  </p>
                </div>
              </div>
              
              {/* Live Badge */}
              <div className="absolute top-4 left-4 flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive rounded-full text-white">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  <span className="text-sm font-medium">AO VIVO</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 rounded-full text-white">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">{viewerCount}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold">{live.title}</h1>
          {live.description && (
            <p className="text-muted-foreground mt-1">{live.description}</p>
          )}

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={live.creator?.avatar_url || ""} />
                <AvatarFallback>{live.creator?.display_name?.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{live.creator?.display_name}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {live.creator && <FollowButton creatorId={live.creator.id} />}
              {!isEnded && (
                <Button variant="outline" onClick={() => setShowGifts(!showGifts)}>
                  <Gift className="w-4 h-4 mr-2" />
                  Enviar Presente
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Gift Panel (Mobile) */}
        {showGifts && (
          <div className="lg:hidden border-b">
            <LiveGiftPanel gifts={gifts} isLoading={false} onSendGift={handleSendGift} />
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-96 border-l flex flex-col">
        {/* Gift Panel (Desktop) */}
        <div className="hidden lg:block border-b">
          <LiveGiftPanel gifts={gifts} isLoading={false} onSendGift={handleSendGift} />
        </div>

        {/* Chat */}
        <div className="flex-1 min-h-[400px] lg:min-h-0">
          <LiveChat
            messages={messages}
            pinnedMessage={pinnedMessage}
            isLoading={chatLoading}
            isSending={isSending}
            onSendMessage={sendMessage}
            isCreator={false}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
