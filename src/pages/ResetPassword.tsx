import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, CheckCircle2, ShieldCheck } from "lucide-react";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Senha muito curta", description: "Mínimo de 6 caracteres.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Senhas não coincidem", description: "Confirme sua nova senha corretamente.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate("/"), 3000);
    } catch (error: any) {
      toast({ title: "Erro ao redefinir senha", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left Side */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-zinc-950">
        <div className="absolute inset-0 bg-gradient-to-br from-red-950/60 via-zinc-950 to-zinc-900" />
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "40px 40px",
          }}
        />
        <motion.div
          className="relative z-10 flex flex-col justify-between p-12 text-white w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <div>
            <span className="text-2xl font-bold tracking-tight">
              Classfy<span className="text-red-500">.</span>
            </span>
          </div>

          <div className="space-y-6">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 inline-block">
              <ShieldCheck className="w-10 h-10 text-red-400" />
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-bold leading-tight">
                Redefinir
                <br />
                <span className="text-red-400">sua senha</span>
              </h1>
              <p className="text-white/60 text-base max-w-xs">
                Escolha uma senha forte e segura para proteger sua conta.
              </p>
            </div>
            <div className="space-y-3">
              {[
                "Mínimo de 6 caracteres",
                "Use letras, números e símbolos",
                "Não reutilize senhas antigas",
              ].map((tip) => (
                <div key={tip} className="flex items-center gap-2 text-sm text-white/50">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {tip}
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/30">© 2025 Classfy. Todos os direitos reservados.</p>
        </motion.div>
      </div>

      {/* Right Side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <motion.div
          className="w-full max-w-md space-y-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden text-center">
            <span className="text-3xl font-bold tracking-tight">
              Classfy<span className="text-red-500">.</span>
            </span>
          </div>

          {done ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-4 rounded-full bg-green-500/10">
                  <CheckCircle2 className="w-12 h-12 text-green-500" />
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Senha redefinida!</h2>
                <p className="text-muted-foreground text-sm">
                  Sua senha foi alterada com sucesso. Redirecionando...
                </p>
              </div>
            </div>
          ) : !ready ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-4 rounded-full bg-muted">
                  <Lock className="w-10 h-10 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">Aguardando verificação...</h2>
                <p className="text-muted-foreground text-sm">
                  Abrindo o link de redefinição. Se a página não carregar, verifique se o link é válido.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">Criar nova senha</h2>
                <p className="text-muted-foreground text-sm">
                  Escolha uma senha segura para sua conta.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10 h-12"
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmar senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirm"
                      type={showConfirm ? "text" : "password"}
                      placeholder="Repita a senha"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="pl-10 pr-10 h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {password && confirm && (
                  <div className={`flex items-center gap-2 text-sm ${password === confirm ? "text-green-500" : "text-red-500"}`}>
                    <CheckCircle2 className="w-4 h-4" />
                    {password === confirm ? "Senhas coincidem" : "Senhas não coincidem"}
                  </div>
                )}

                <Button type="submit" className="w-full h-12 font-semibold" disabled={loading}>
                  {loading ? "Salvando..." : "Salvar nova senha"}
                </Button>
              </form>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
