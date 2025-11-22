import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Target, Users, DollarSign, Calendar, Receipt } from "lucide-react";

interface BoostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId?: string;
  contentTitle?: string;
}

type BoostObjective = 'profile' | 'content';
type AudienceType = 'automatic' | 'segmented';

export const BoostModal = ({ open, onOpenChange, contentId, contentTitle }: BoostModalProps) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1: Objective
  const [objective, setObjective] = useState<BoostObjective>('content');
  
  // Step 2: Audience
  const [audienceType, setAudienceType] = useState<AudienceType>('automatic');
  const [audienceFilters, setAudienceFilters] = useState({
    gender: 'all',
    ageMin: 18,
    ageMax: 65,
    location: ''
  });
  
  // Step 3: Budget
  const [dailyBudget, setDailyBudget] = useState([10]);
  
  // Step 4: Duration
  const [duration, setDuration] = useState([7]);

  const totalBudget = dailyBudget[0] * duration[0];

  const handleNext = () => {
    if (step < 5) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-boost-payment', {
        body: {
          boostData: {
            objective,
            contentId: objective === 'content' ? contentId : null,
            audienceType,
            audienceFilters: audienceType === 'segmented' ? audienceFilters : {},
            dailyBudget: dailyBudget[0],
            durationDays: duration[0]
          }
        }
      });

      if (error) throw error;

      // Open Stripe checkout in new tab
      if (data.url) {
        window.open(data.url, '_blank');
        toast.success('Redirecionando para pagamento...');
        onOpenChange(false);
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao criar boost');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setObjective('content');
    setAudienceType('automatic');
    setDailyBudget([10]);
    setDuration([7]);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      onOpenChange(open);
      if (!open) resetForm();
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Impulsionar Conteúdo
          </DialogTitle>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Objetivo */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Escolha seu objetivo</h3>
            </div>
            <RadioGroup value={objective} onValueChange={(v) => setObjective(v as BoostObjective)}>
              <Card 
                className={`p-4 cursor-pointer transition-colors ${objective === 'profile' ? 'border-primary' : ''}`}
                onClick={() => setObjective('profile')}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="profile" id="profile" />
                  <div className="flex-1">
                    <Label htmlFor="profile" className="font-semibold cursor-pointer">
                      Impulsionar Perfil
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      O anúncio direciona para seu perfil. Ideal para branding e ganhar seguidores.
                    </p>
                  </div>
                </div>
              </Card>
              <Card 
                className={`p-4 cursor-pointer transition-colors ${objective === 'content' ? 'border-primary' : ''}`}
                onClick={() => setObjective('content')}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="content" id="content" />
                  <div className="flex-1">
                    <Label htmlFor="content" className="font-semibold cursor-pointer">
                      Impulsionar Conteúdo
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {contentTitle ? `Impulsionar "${contentTitle}"` : 'Impulsiona este conteúdo específico para mais visualizações.'}
                    </p>
                  </div>
                </div>
              </Card>
            </RadioGroup>
          </div>
        )}

        {/* Step 2: Público */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Escolha o público</h3>
            </div>
            <RadioGroup value={audienceType} onValueChange={(v) => setAudienceType(v as AudienceType)}>
              <Card 
                className={`p-4 cursor-pointer transition-colors ${audienceType === 'automatic' ? 'border-primary' : ''}`}
                onClick={() => setAudienceType('automatic')}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="automatic" id="automatic" />
                  <div className="flex-1">
                    <Label htmlFor="automatic" className="font-semibold cursor-pointer">
                      Público Automático
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Deixe o algoritmo encontrar as pessoas certas para seu conteúdo.
                    </p>
                  </div>
                </div>
              </Card>
              <Card 
                className={`p-4 cursor-pointer transition-colors ${audienceType === 'segmented' ? 'border-primary' : ''}`}
                onClick={() => setAudienceType('segmented')}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value="segmented" id="segmented" />
                  <div className="flex-1">
                    <Label htmlFor="segmented" className="font-semibold cursor-pointer">
                      Segmentar Público
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure filtros básicos de segmentação.
                    </p>
                  </div>
                </div>
              </Card>
            </RadioGroup>

            {/* Filtros de segmentação */}
            {audienceType === 'segmented' && (
              <div className="mt-4 p-4 border rounded-lg space-y-4 bg-muted/30">
                <div className="space-y-2">
                  <Label>Gênero</Label>
                  <Select 
                    value={audienceFilters.gender} 
                    onValueChange={(v) => setAudienceFilters({...audienceFilters, gender: v})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="male">Masculino</SelectItem>
                      <SelectItem value="female">Feminino</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Faixa Etária</Label>
                  <div className="flex gap-4 items-center">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">Mínimo</Label>
                      <Input 
                        type="number" 
                        min="13" 
                        max="100"
                        value={audienceFilters.ageMin}
                        onChange={(e) => setAudienceFilters({...audienceFilters, ageMin: parseInt(e.target.value)})}
                      />
                    </div>
                    <span className="text-muted-foreground mt-5">até</span>
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground">Máximo</Label>
                      <Input 
                        type="number" 
                        min="13" 
                        max="100"
                        value={audienceFilters.ageMax}
                        onChange={(e) => setAudienceFilters({...audienceFilters, ageMax: parseInt(e.target.value)})}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Localização</Label>
                  <Input 
                    placeholder="Ex: São Paulo, Brasil"
                    value={audienceFilters.location}
                    onChange={(e) => setAudienceFilters({...audienceFilters, location: e.target.value})}
                  />
                  <p className="text-xs text-muted-foreground">
                    Deixe em branco para alcançar todas as localizações
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Orçamento */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Qual seu orçamento diário?</h3>
            </div>
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-4xl font-bold text-primary">
                  R$ {dailyBudget[0]}
                </div>
                <p className="text-sm text-muted-foreground mt-1">por dia</p>
              </div>
              <Slider
                value={dailyBudget}
                onValueChange={setDailyBudget}
                min={1}
                max={1000}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>R$ 1</span>
                <span>R$ 1000</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Duração */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Definir duração</h3>
            </div>
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-4xl font-bold text-primary">
                  {duration[0]} {duration[0] === 1 ? 'dia' : 'dias'}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Total: R$ {totalBudget}
                </p>
              </div>
              <Slider
                value={duration}
                onValueChange={setDuration}
                min={1}
                max={30}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 dia</span>
                <span>30 dias</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Resumo */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Resumo do pedido</h3>
            </div>
            <Card className="p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Objetivo:</span>
                <span className="font-medium">
                  {objective === 'profile' ? 'Impulsionar Perfil' : 'Impulsionar Conteúdo'}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Público:</span>
                <span className="font-medium">
                  {audienceType === 'automatic' ? 'Automático' : 'Segmentado'}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Orçamento diário:</span>
                <span className="font-medium">R$ {dailyBudget[0]}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duração:</span>
                <span className="font-medium">{duration[0]} dias</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total:</span>
                <span className="text-primary">R$ {totalBudget}</span>
              </div>
            </Card>
            <p className="text-sm text-muted-foreground">
              Você será redirecionado para o pagamento via Stripe.
            </p>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between gap-3 mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1 || loading}
          >
            Voltar
          </Button>
          {step < 5 ? (
            <Button onClick={handleNext}>
              Próximo
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pagar R$ {totalBudget}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};