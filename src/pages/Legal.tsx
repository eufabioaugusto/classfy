import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, FileText } from "lucide-react";
import { LegalLinks } from "@/components/LegalLinks";

type Section = { title: string; paragraphs: string[] };
const contact = "classfy.oficial@gmail.com";
const privacy: Section[] = [
  { title: "Quem somos e como falar com a gente", paragraphs: ["A Classfy é uma plataforma de conteúdo, aprendizado e interação entre usuários e creators. Esta política descreve o tratamento de dados nos serviços da Classfy.", `Para questões de privacidade ou solicitações sobre seus dados, entre em contato com a equipe Classfy pelo email ${contact}.`] },
  { title: "Dados que recebemos", paragraphs: ["Recebemos os dados que você fornece ao cadastrar e editar seu perfil, como nome, email, foto, interesses e informações de creator. Também tratamos conteúdos publicados, comentários, mensagens, estudos, conversas com a Classy e registros de participação e recompensas.", "O uso do serviço pode gerar registros de acesso, endereço IP, informações de dispositivo e navegador, histórico de reprodução, interações e registros técnicos necessários à segurança e ao funcionamento. Quando você utiliza recursos pagos, são tratados dados da transação e os dados necessários ao pagamento ou recebimento pelo prestador responsável."] },
  { title: "Login com Google", paragraphs: ["Ao escolher entrar com Google, recebemos seu identificador de conta, nome, email e foto de perfil, conforme a autorização apresentada pelo Google. Utilizamos esses dados para autenticar você, criar ou vincular sua conta e preencher seu perfil na Classfy. Esses dados são armazenados no serviço de autenticação e no cadastro da plataforma.", "Este login não solicita acesso ao Gmail, Drive, contatos ou à senha da sua conta Google. Você pode revogar a conexão nas configurações de segurança da sua conta Google. Revogar a conexão não exclui automaticamente sua conta Classfy; a exclusão pode ser solicitada pelo nosso canal de contato."] },
  { title: "Finalidades e fundamentos do tratamento", paragraphs: ["Usamos os dados para fornecer a plataforma, autenticar contas, salvar seu progresso, personalizar conteúdos a partir dos interesses e interações na Classfy, permitir comunicação e publicações, processar transações e recompensas e atender solicitações de suporte.", "Conforme a finalidade, o tratamento se apoia na execução do serviço solicitado, no cumprimento de obrigações legais, em interesses legítimos relacionados à segurança e melhoria do serviço ou no consentimento, quando necessário. Você pode solicitar informações sobre a finalidade e a base aplicável ao seu caso."] },
  { title: "Conteúdos públicos e inteligência artificial", paragraphs: ["Informações de perfil e conteúdos que você publica podem ser vistos por outras pessoas conforme a visibilidade do recurso. Evite inserir dados pessoais de terceiros ou informações confidenciais em publicações e conversas.", "Para gerar respostas, resumos e exercícios, as solicitações feitas à Classy e o contexto necessário do estudo são processados por serviços de inteligência artificial, incluindo serviços do Google. Esses prestadores recebem os dados necessários ao recurso solicitado. As respostas podem conter erros; revise as informações antes de utilizá-las."] },
  { title: "Compartilhamento e armazenamento", paragraphs: ["Utilizamos prestadores de infraestrutura, autenticação, armazenamento, entrega de mídia, inteligência artificial e processamento de pagamentos para operar os recursos, incluindo Supabase e Google. Eles recebem dados conforme a função desempenhada. Dados podem ser processados fora do Brasil, observadas as exigências legais aplicáveis às transferências internacionais.", "Dados também podem ser disponibilizados para cumprir obrigações legais, ordens de autoridades e proteger direitos e a segurança do serviço. Os dados recebidos pelo login Google não são vendidos nem usados para publicidade direcionada."] },
  { title: "Sessões, segurança e prazo de conservação", paragraphs: ["Usamos armazenamento do navegador e tecnologias de sessão para manter seu acesso e lembrar preferências. Você pode gerenciar esses recursos no navegador; desativá-los pode afetar o login e outras funcionalidades.", "Adotamos controles de acesso e medidas técnicas de proteção. Conservamos os dados enquanto necessários às finalidades descritas, à manutenção da conta e às obrigações legais. Após uma solicitação de exclusão, certos registros podem ser mantidos quando houver fundamento legal, prevenção de fraude ou exercício de direitos; cópias de segurança seguem seus ciclos de conservação."] },
  { title: "Seus direitos e alterações desta política", paragraphs: ["Você pode solicitar confirmação de tratamento, acesso, correção, informação sobre compartilhamento, portabilidade quando aplicável, revogação de consentimento e exclusão ou anonimização nas hipóteses previstas em lei. Envie sua solicitação ao email de contato; podemos pedir informações para verificar sua identidade e proteger sua conta.", "Esta política pode ser atualizada para refletir mudanças no serviço. Alterações relevantes serão comunicadas pela plataforma ou pelo canal cadastrado. Quando uma mudança exigir novo consentimento, ele será solicitado antes do novo uso dos dados."] },
];
const terms: Section[] = [
  { title: "A experiência Classfy", paragraphs: ["Estes termos regulam o uso da Classfy, uma plataforma para descobrir conteúdos, aprender, estudar com a Classy e participar como usuário ou creator. Ao criar uma conta ou utilizar os serviços, você deve observar estas condições e as regras apresentadas em cada recurso."] },
  { title: "Sua conta", paragraphs: ["Forneça informações corretas, mantenha seus dados de acesso protegidos e comunique suspeitas de uso indevido. Não utilize a conta de outra pessoa nem se passe por terceiros. O uso por menores deve observar a legislação e a participação de seu responsável legal quando necessária."] },
  { title: "Conteúdos e convivência", paragraphs: ["Respeite outras pessoas e os direitos autorais, de imagem e de privacidade. Não publique conteúdo ilegal, discriminatório, ameaçador, enganoso, exploratório, spam ou material para o qual você não tenha autorização. Não tente invadir sistemas, burlar controles ou manipular métricas, recompensas ou pagamentos.", "Podemos analisar denúncias, remover conteúdos ou limitar contas diante de violações, fraude ou riscos à segurança. Você pode solicitar esclarecimentos e revisão pelo canal de contato."] },
  { title: "Creators e propriedade intelectual", paragraphs: ["Os creators mantêm seus direitos sobre os conteúdos que publicam e são responsáveis por obter as autorizações necessárias. Ao publicar, você permite à Classfy armazenar, processar, adaptar tecnicamente e exibir o material na medida necessária ao funcionamento e à divulgação do conteúdo dentro da plataforma, conforme sua visibilidade.", "O acesso a um conteúdo não transfere sua propriedade nem autoriza reprodução, redistribuição ou exploração comercial sem permissão do titular. A marca, o software e os elementos da Classfy também são protegidos."] },
  { title: "Planos, compras e cancelamento", paragraphs: ["Recursos gratuitos e pagos podem ter limites diferentes. Preço, período de cobrança, renovação e condições aplicáveis devem ser apresentados antes da contratação. Assinaturas e compras dependem de uma confirmação específica; usar a plataforma ou aceitar estes termos não contrata um plano pago.", "Cancelamentos, reembolsos e o direito de arrependimento seguem as condições informadas na contratação e a legislação aplicável. Para solicitar atendimento, utilize o email de contato. Condições de monetização para creators podem ser apresentadas separadamente."] },
  { title: "Points, recompensas e ganhos", paragraphs: ["Points e níveis representam participação conforme as regras de cada recurso ou campanha. Não representam, por si só, dinheiro, investimento ou promessa de remuneração. Recompensas, conversões e saques, quando disponíveis, dependem das condições, elegibilidade e verificações informadas na plataforma.", "Participações fraudulentas podem ser desconsideradas. Alterações nas regras devem respeitar os direitos aplicáveis e as condições já assumidas."] },
  { title: "Estudos com a Classy", paragraphs: ["A Classy utiliza inteligência artificial para apoiar seus estudos. As respostas podem ser incompletas ou incorretas e devem ser verificadas. Conteúdos educacionais e respostas da Classy não substituem orientação individual de profissionais habilitados em temas de saúde, direito, finanças ou outras áreas especializadas."] },
  { title: "Disponibilidade, privacidade e encerramento", paragraphs: ["A plataforma pode passar por manutenção e mudanças de recursos. Trabalhamos para preservar seu funcionamento, mas interrupções podem ocorrer. Estes termos não excluem responsabilidades ou direitos que a legislação assegura ao usuário.", "O tratamento de dados está descrito na Política de Privacidade. Você pode deixar de usar a plataforma e solicitar exclusão da conta pelo canal de contato, observadas obrigações legais e pendências aplicáveis."] },
  { title: "Atualizações e contato", paragraphs: ["Podemos atualizar estes termos, informando alterações relevantes pela plataforma ou pelo canal cadastrado. As relações com usuários no Brasil observam a legislação brasileira, preservados os direitos do consumidor e de proteção de dados.", `Para dúvidas, denúncias ou solicitações, fale com a equipe Classfy: ${contact}.`] },
];

export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const isPrivacy = kind === "privacy";
  const title = isPrivacy ? "Política de Privacidade" : "Termos de Uso";
  const sections = isPrivacy ? privacy : terms;
  const Icon = isPrivacy ? ShieldCheck : FileText;
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | Classfy`;
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, [title]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between border-b px-6 py-6">
        <Link to="/" className="text-2xl font-bold tracking-tight">Classfy</Link>
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Voltar à Classfy</Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <Icon className="mb-5 text-primary" size={32} aria-hidden="true" />
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">Transparência e confiança</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">Última atualização: 28 de setembro de 2026</p>
        <div className="mt-10 space-y-9">
          {sections.map((section, i) => <section key={section.title} aria-labelledby={`legal-${i}`}>
            <h2 id={`legal-${i}`} className="mb-3 text-xl font-semibold">{i + 1}. {section.title}</h2>
            <div className="space-y-3 text-base leading-7 text-muted-foreground">{section.paragraphs.map(p => <p key={p}>{p}</p>)}</div>
          </section>)}
        </div>
        <div className="mt-10 rounded-xl border bg-muted/30 p-6">
          <h2 className="font-semibold">Fale com a Classfy</h2>
          <a className="mt-2 inline-block break-all text-primary underline underline-offset-4" href={`mailto:${contact}`}>{contact}</a>
        </div>
      </main>
      <footer className="border-t px-6 py-8"><LegalLinks /></footer>
    </div>
  );
}
