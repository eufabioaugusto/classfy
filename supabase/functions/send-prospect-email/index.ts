import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getTemplate(tier: string, channelName: string, niche: string | null) {
  const nicheStr = niche && niche !== "geral" ? ` de ${niche}` : "";
  const templates: Record<string, { subject: string; html: string }> = {
    micro: {
      subject: `${channelName}, a Classfy quer você como Creator Fundador`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.6">
<p>Oi, tudo bem?</p>
<p>Vi o canal <strong>${channelName}</strong> e queria falar sobre algo que estamos construindo.</p>
<p>A <strong>Classfy</strong> é uma plataforma de conhecimento onde criadores ganham de verdade — <strong>40% de toda a receita da plataforma é distribuída mensalmente</strong> entre quem publica conteúdo.</p>
<p>Você estaria chegando no momento certo. Quem entra agora como <strong>Creator Fundador</strong> ajuda a moldar as regras e garante condições que não estarão disponíveis depois do lançamento público.</p>
<p>Se quiser saber mais, acesse <a href="https://classfy.com.br" style="color:#e01c4b">classfy.com.br</a> ou responda esse e-mail.</p>
<p>Abs,<br><strong>Fabio — Classfy</strong></p>
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"/>
<p style="font-size:12px;color:#999">Para não receber mais e-mails, <a href="https://classfy.com.br/unsubscribe" style="color:#999">clique aqui</a>.</p>
</div>`,
    },
    pequeno: {
      subject: `Você cria conteúdo${nicheStr} — a Classfy tem uma proposta`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.6">
<p>Oi,</p>
<p>Vi o <strong>${channelName}</strong> e queria te fazer uma pergunta direta: quanto você ganhou com seu conteúdo no último mês?</p>
<p>A maioria dos criadores${nicheStr} ganha muito menos do que merece. A <strong>Classfy</strong> funciona diferente: <strong>40% de toda a receita da plataforma vai diretamente para os criadores</strong>, todo mês, por fórmula pública.</p>
<p>Estamos convidando <strong>Creators Fundadores</strong> — pessoas que entram antes de todo mundo e ajudam a construir isso com a gente.</p>
<p>Acesse <a href="https://classfy.com.br" style="color:#e01c4b">classfy.com.br</a> ou responda aqui.</p>
<p>Abs,<br><strong>Fabio — Classfy</strong></p>
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"/>
<p style="font-size:12px;color:#999">Para não receber mais e-mails, <a href="https://classfy.com.br/unsubscribe" style="color:#999">clique aqui</a>.</p>
</div>`,
    },
    medio: {
      subject: `${channelName} — você cria bom conteúdo${nicheStr}. Vamos conversar?`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.6">
<p>Oi,</p>
<p>Acompanhei o <strong>${channelName}</strong> e você claramente sabe criar conteúdo de qualidade${nicheStr}.</p>
<p>Estamos lançando a <strong>Classfy</strong> — <strong>40% da receita total vai para criadores, por fórmula pública</strong>. Você pode calcular sua participação antes de receber. Nenhuma plataforma faz isso.</p>
<p>Estamos convidando um grupo seleto de criadores para entrar como <strong>Creators Fundadores</strong>.</p>
<p>Vale 10 minutos? <a href="https://classfy.com.br" style="color:#e01c4b">classfy.com.br</a></p>
<p>Abs,<br><strong>Fabio — Classfy</strong></p>
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"/>
<p style="font-size:12px;color:#999">Para não receber mais e-mails, <a href="https://classfy.com.br/unsubscribe" style="color:#999">clique aqui</a>.</p>
</div>`,
    },
    grande: {
      subject: `${channelName} — 40% da receita pra criadores. Sem algoritmo opaco.`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.6">
<p>Oi,</p>
<p>Você já passou pela frustração de ver seu CPM cair de um mês pro outro sem explicação?</p>
<p>Estamos construindo a <strong>Classfy</strong> exatamente por isso. <strong>40% da receita total da plataforma é distribuída todo mês entre os criadores ativos</strong>, por fórmula pública. Você acessa a fórmula, calcula sua participação estimada, e recebe exatamente isso.</p>
<p>Vi o <strong>${channelName}</strong> e acredito que você seria um dos criadores que mais se beneficia desse modelo.</p>
<p><a href="https://classfy.com.br" style="color:#e01c4b">classfy.com.br</a></p>
<p>Abs,<br><strong>Fabio — Classfy</strong></p>
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"/>
<p style="font-size:12px;color:#999">Para não receber mais e-mails, <a href="https://classfy.com.br/unsubscribe" style="color:#999">clique aqui</a>.</p>
</div>`,
    },
    bigplayer: {
      subject: `${channelName} — uma proposta diferente`,
      html: `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;line-height:1.6">
<p>Oi,</p>
<p>Direto ao ponto: estou lançando a <strong>Classfy</strong>, uma plataforma de conhecimento com modelo econômico diferente.</p>
<p><strong>40% de toda a receita da plataforma vai para criadores e alunos todo mês, por fórmula pública.</strong> Não tem ajuste discricionário, não tem corte surpresa.</p>
<p>Vi o <strong>${channelName}</strong> e acredito que faz sentido conversar.</p>
<p><a href="https://classfy.com.br" style="color:#e01c4b">classfy.com.br</a></p>
<p>Abs,<br><strong>Fabio — Classfy</strong></p>
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"/>
<p style="font-size:12px;color:#999">Para não receber mais e-mails, <a href="https://classfy.com.br/unsubscribe" style="color:#999">clique aqui</a>.</p>
</div>`,
    },
  };
  return templates[tier] || templates.pequeno;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prospectId } = await req.json();
    if (!prospectId) throw new Error("prospectId obrigatório");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: prospect, error } = await supabase
      .from("prospects")
      .select("*")
      .eq("id", prospectId)
      .single();

    if (error || !prospect) throw new Error("Prospect não encontrado");
    if (!prospect.contact_email) throw new Error("Prospect sem e-mail");
    if (prospect.status !== "pending") throw new Error(`Status inválido: ${prospect.status}`);

    const { subject, html } = getTemplate(
      prospect.size_tier || "pequeno",
      prospect.channel_name,
      prospect.niche
    );

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Classfy <contato@classfy.com.br>",
        to: prospect.contact_email,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }

    await supabase
      .from("prospects")
      .update({
        status: "contacted",
        outreach_channel: "email",
        template_used: prospect.size_tier || "pequeno",
        contacted_at: new Date().toISOString(),
      })
      .eq("id", prospectId);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
