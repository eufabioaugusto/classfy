import { Button } from "@/components/ui/button";

export function PlansCTA() {
  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4 text-center max-w-2xl">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
          Pronto para começar?
        </h2>
        <p className="text-muted-foreground mb-8">
          Cancele a qualquer momento
        </p>
        <Button
          size="lg"
          className="h-12 px-10 rounded-full text-base font-medium bg-accent hover:bg-accent/90 text-accent-foreground"
          onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}
        >
          Escolher meu plano
        </Button>
      </div>
    </section>
  );
}
