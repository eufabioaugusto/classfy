import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requestAiTextCompletion } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, description, contentType } = await req.json();

    if (!title) {
      throw new Error("Título é obrigatório");
    }

    const contentTypeMap: Record<string, string> = {
      aula: "aula educacional",
      short: "vídeo curto",
      podcast: "podcast",
      curso: "curso",
      live: "live stream",
    };

    const prompt = `Você é um especialista em SEO e marketing de conteúdo educacional. Analise o seguinte conteúdo e gere 5-8 tags relevantes em português que ajudarão a melhorar a descoberta e relevância deste conteúdo.

Tipo de conteúdo: ${contentTypeMap[contentType] || "conteúdo"}
Título: ${title}
${description ? `Descrição: ${description}` : ""}

Regras:
- Gere entre 5 e 8 tags
- Use palavras-chave relevantes para o conteúdo
- Inclua termos técnicos quando apropriado
- Pense em termos de busca que usuários usariam
- Mantenha as tags em português
- Cada tag deve ter no máximo 3 palavras
- Não repita palavras já presentes no título

Responda APENAS com as tags separadas por vírgula, sem numeração ou formatação adicional.`;

    const { response, text } = await requestAiTextCompletion({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      maxTokens: 200,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns instantes." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos insuficientes no provider de IA." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("Erro da API de IA:", response.status, errorText);
      throw new Error("Erro ao gerar tags com IA");
    }

    // Parse tags from the response
    const tags = text
      .split(",")
      .map((tag: string) => tag.trim())
      .filter((tag: string) => tag.length > 0 && tag.length <= 50);

    return new Response(JSON.stringify({ tags }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro ao gerar tags:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
