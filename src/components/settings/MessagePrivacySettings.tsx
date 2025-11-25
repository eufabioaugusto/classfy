import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Lock, UserCheck, Users } from "lucide-react";

type PrivacyMode = 'open' | 'followers' | 'request' | 'closed';

interface PrivacyOption {
  value: PrivacyMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const privacyOptions: PrivacyOption[] = [
  {
    value: 'open',
    label: 'Mensagens Abertas',
    description: 'Qualquer pessoa pode enviar mensagens para você',
    icon: <MessageCircle className="h-5 w-5" />,
  },
  {
    value: 'followers',
    label: 'Apenas Seguidores',
    description: 'Somente pessoas que você segue podem enviar mensagens',
    icon: <Users className="h-5 w-5" />,
  },
  {
    value: 'request',
    label: 'Aprovar Contato',
    description: 'As pessoas precisam enviar uma solicitação que você pode aprovar ou recusar',
    icon: <UserCheck className="h-5 w-5" />,
  },
  {
    value: 'closed',
    label: 'Não Permitir Envio',
    description: 'Ninguém pode enviar mensagens para você',
    icon: <Lock className="h-5 w-5" />,
  },
];

export const MessagePrivacySettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("message_settings")
        .select("privacy_mode")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setPrivacyMode(data.privacy_mode as PrivacyMode);
      }
    } catch (error) {
      console.error("Error loading message settings:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar as configurações",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (newMode: PrivacyMode) => {
    if (!user || saving) return;

    try {
      setSaving(true);
      setPrivacyMode(newMode);

      // Use upsert to insert or update automatically
      const { error } = await supabase
        .from("message_settings")
        .upsert({
          user_id: user.id,
          privacy_mode: newMode,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      toast({
        title: "Configurações atualizadas",
        description: "Suas preferências de privacidade foram salvas",
      });
    } catch (error) {
      console.error("Error updating message settings:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar as configurações",
        variant: "destructive",
      });
      // Revert on error
      loadSettings();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Privacidade de Mensagens</CardTitle>
          <CardDescription>Carregando configurações...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacidade de Mensagens</CardTitle>
        <CardDescription>
          Escolha quem pode enviar mensagens diretas para você
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          value={privacyMode}
          onValueChange={(value) => updateSettings(value as PrivacyMode)}
          disabled={saving}
          className="space-y-4"
        >
          {privacyOptions.map((option) => (
            <div
              key={option.value}
              className={`flex items-start space-x-3 p-4 rounded-lg border-2 transition-colors cursor-pointer ${
                privacyMode === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => !saving && updateSettings(option.value)}
            >
              <RadioGroupItem value={option.value} id={option.value} className="mt-1" />
              <Label
                htmlFor={option.value}
                className="flex-1 cursor-pointer space-y-1"
              >
                <div className="flex items-center gap-2">
                  {option.icon}
                  <span className="font-semibold">{option.label}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
};
