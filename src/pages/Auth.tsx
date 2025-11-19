import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2 } from "lucide-react";
export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const {
    signIn,
    signUp
  } = useAuth();
  const {
    toast
  } = useToast();
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const {
          error
        } = await signIn(email, password);
        if (error) {
          toast({
            title: "Erro ao fazer login",
            description: error.message,
            variant: "destructive"
          });
        }
      } else {
        if (!displayName.trim()) {
          toast({
            title: "Nome obrigatório",
            description: "Por favor, insira seu nome completo.",
            variant: "destructive"
          });
          setLoading(false);
          return;
        }
        const {
          error
        } = await signUp(email, password, displayName);
        if (error) {
          toast({
            title: "Erro ao criar conta",
            description: error.message,
            variant: "destructive"
          });
        } else {
          toast({
            title: "Conta criada!",
            description: "Bem-vindo à Classfy! 🎉"
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };
  return <div className="min-h-screen flex items-center justify-center bg-cinematic-black p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo & Title */}
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-5 rounded-2xl bg-cinematic-accent/10 backdrop-blur-sm border border-cinematic-accent/20">
              <Sparkles className="w-14 h-14 text-cinematic-accent" />
            </div>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-white">
            CLASSFY
          </h1>
          <p className="text-white/70 text-lg">
            Aprenda, evolua e ganhe com conhecimento
          </p>
        </div>

        {/* Auth Card */}
        <Card className="p-8 backdrop-blur-sm border-white/10 bg-zinc-900">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              {!isLogin && <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-white/90">Nome Completo</Label>
                  <Input id="displayName" type="text" placeholder="Seu nome" value={displayName} onChange={e => setDisplayName(e.target.value)} required={!isLogin} disabled={loading} className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/15 focus:border-white/30" />
                </div>}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-white/90">Email</Label>
                <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/15 focus:border-white/30" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-white/90">Senha</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required disabled={loading} className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:bg-white/15 focus:border-white/30" />
              </div>
            </div>

            <Button type="submit" className="w-full bg-cinematic-accent hover:bg-cinematic-accent/90 text-white h-12 text-base font-semibold" disabled={loading}>
              {loading ? <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processando...
                </> : <>{isLogin ? "Entrar" : "Criar Conta"}</>}
            </Button>

            <div className="text-center">
              <button type="button" onClick={() => setIsLogin(!isLogin)} className="text-sm text-white/70 hover:text-white transition-colors" disabled={loading}>
                {isLogin ? <>
                    Não tem uma conta?{" "}
                    <span className="font-semibold text-cinematic-accent">Cadastre-se</span>
                  </> : <>
                    Já tem uma conta?{" "}
                    <span className="font-semibold text-cinematic-accent">Faça login</span>
                  </>}
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>;
}