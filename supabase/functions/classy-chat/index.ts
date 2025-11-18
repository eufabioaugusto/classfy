import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { studyId, message } = await req.json();

    // Get authenticated user from JWT
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Não autorizado' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Verify study ownership with retries for consistency
    let study = null;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts && !study) {
      const { data, error } = await supabaseClient
        .from("studies")
        .select("*")
        .eq("id", studyId)
        .eq("user_id", user.id)
        .single();
      
      if (data) {
        study = data;
        break;
      }
      
      if (attempts < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      attempts++;
    }

    if (!study) {
      console.error('Study not found after retries:', { studyId, userId: user.id });
      return new Response(
        JSON.stringify({ error: 'Estudo não encontrado ou acesso negado' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Use service role key for AI operations
    const supabaseServiceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch conversation history
    const { data: messages } = await supabaseServiceClient
      .from("study_messages")
      .select("*")
      .eq("study_id", studyId)
      .order("created_at", { ascending: true })
      .limit(20);

    const conversationHistory = messages?.map((m: any) => ({
      role: m.role,
      content: m.content,
    })) || [];

    const isFirstMessage = !messages || messages.length === 0;

    // Search for related content if this is the first message
    let relatedContents = [];
    if (isFirstMessage) {
      const searchQuery = study.title.toLowerCase();
      const { data: contents } = await supabaseServiceClient
        .from("contents")
        .select("id, title, description, content_type, thumbnail_url, visibility, required_plan")
        .eq("status", "approved")
        .limit(10);

      if (contents && contents.length > 0) {
        // Calculate match score for each content
        relatedContents = contents
          .map((content: any) => {
            const titleLower = content.title.toLowerCase();
            const descLower = (content.description || "").toLowerCase();
            
            // Simple matching algorithm
            let score = 0;
            const searchWords = searchQuery.split(" ");
            
            searchWords.forEach((word: string) => {
              if (word.length < 3) return; // Skip very short words
              if (titleLower.includes(word)) score += 3;
              if (descLower.includes(word)) score += 1;
            });

            // Exact title match bonus
            if (titleLower.includes(searchQuery)) score += 5;
            
            return { ...content, matchScore: score };
          })
          .filter((c: any) => c.matchScore > 0)
          .sort((a: any, b: any) => b.matchScore - a.matchScore)
          .slice(0, 5);
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    let systemPrompt = `Você é a Classy, uma assistente de estudos inteligente e amigável da plataforma Classfy.

Contexto do Estudo: ${study?.title || "Sem título"}
${study?.description ? `Descrição: ${study.description}` : ""}

Seu papel:
- Ajudar o usuário a aprender sobre o tema do estudo
- Responder dúvidas de forma clara e didática
- Sugerir conteúdos e exercícios relevantes
- Manter o foco no tema do estudo
- Ser sempre encorajadora e motivadora

Diretrizes:
- Respostas em português brasileiro
- Tom amigável e acessível
- Explicações claras e objetivas
- Use exemplos quando apropriado
- Incentive o aprendizado contínuo`;

    // Add content recommendations to system prompt if available
    if (isFirstMessage && relatedContents.length > 0) {
      systemPrompt += `\n\nCONTEÚDOS DISPONÍVEIS NA PLATAFORMA (recomende estes para o usuário):\n`;
      relatedContents.forEach((content: any, index: number) => {
        const matchPercent = Math.min(100, Math.round((content.matchScore / 10) * 100));
        systemPrompt += `\n${index + 1}. "${content.title}" (Match: ${matchPercent}%)`;
        systemPrompt += `\n   Tipo: ${content.content_type === 'aula' ? 'Aula' : content.content_type === 'podcast' ? 'Podcast' : 'Short'}`;
        if (content.description) {
          systemPrompt += `\n   Descrição: ${content.description.substring(0, 100)}${content.description.length > 100 ? '...' : ''}`;
        }
        systemPrompt += `\n   ID: ${content.id}\n`;
      });
      systemPrompt += `\n\nIMPORTANTE: Na sua primeira resposta, cumprimente o usuário, faça uma breve introdução sobre o tema "${study.title}" e SEMPRE recomende os conteúdos acima com uma breve explicação de cada um. Mencione a porcentagem de match e explique por que cada conteúdo é relevante para o estudo deles.`;
    }

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationHistory,
            { role: "user", content: message },
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error:
              "Limite de requisições atingido. Tente novamente em alguns instantes.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error:
              "Créditos de IA esgotados. Entre em contato com o suporte.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiMessage = data.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua mensagem.";

    return new Response(
      JSON.stringify({ message: aiMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in classy-chat:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Erro ao processar mensagem" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
