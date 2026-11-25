import { BellRing, LineChart, ShieldCheck } from "lucide-react";
import { SearchHero } from "@/components/search-hero";

const FEATURES = [
  {
    icon: LineChart,
    title: "Historial real",
    text: "Precio normal, oferta y con tarjeta, por separado y tienda por tienda.",
  },
  {
    icon: ShieldCheck,
    title: "Descuentos honestos",
    text: "Te avisamos cuando el “antes” se infló para que el descuento parezca mayor.",
  },
  {
    icon: BellRing,
    title: "Avisos a tiempo",
    text: "Por Telegram o correo cuando baja de tu precio objetivo o vuelve el stock.",
  },
];

export default function HomePage() {
  return (
    <>
      <SearchHero />
      <section aria-label="Qué hace" className="mx-auto mt-20 grid max-w-4xl gap-4 sm:mt-28 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border bg-card p-5 shadow-soft">
            <Icon aria-hidden className="size-5 text-brand" />
            <h2 className="mt-3 font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
