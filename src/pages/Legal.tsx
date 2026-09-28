import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, FileText } from "lucide-react";
import { LegalLinks } from "@/components/LegalLinks";

import { contact, privacy, terms } from "@/content/legal";

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
