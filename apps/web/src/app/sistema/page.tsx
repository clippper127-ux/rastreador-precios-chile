import { AlertTriangle, ExternalLink, Plus, Store, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PriceBlock } from "@/components/price-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Sistema de diseño", robots: { index: false } };

const SWATCHES = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["muted", "bg-muted"],
  ["primary", "bg-primary"],
  ["brand", "bg-brand"],
  ["deal", "bg-deal"],
  ["caution", "bg-caution"],
  ["danger", "bg-danger"],
  ["card-price", "bg-card-price"],
] as const;

export default function SistemaPage() {
  return (
    <>
      <PageHeader
        title="Sistema de diseño"
        description="Tokens y componentes base. Cambia entre modo claro y oscuro con el botón de la cabecera."
      />

      <div className="flex flex-col gap-10">
        <Section title="Color">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {SWATCHES.map(([name, cls]) => (
              <div key={name} className="flex flex-col gap-2">
                <div className={`${cls} h-16 rounded-lg border`} />
                <code className="text-xs text-muted-foreground">{name}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Tipografía">
          <div className="flex flex-col gap-3">
            <p className="text-5xl font-semibold tracking-tight">Título display</p>
            <p className="text-3xl font-semibold tracking-tight">Título de página</p>
            <p className="text-lg font-semibold tracking-tight">Título de tarjeta</p>
            <p>Texto de cuerpo. Las cifras usan números tabulares: <span className="tabular">$1.299.990</span></p>
            <p className="text-sm text-muted-foreground">Texto secundario</p>
          </div>
        </Section>

        <Section title="Botones">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Principal</Button>
            <Button variant="brand">
              <Plus aria-hidden />
              Seguir precio
            </Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Pequeño</Button>
            <Button disabled>Deshabilitado</Button>
          </div>
        </Section>

        <Section title="Badges de precio">
          <div className="flex flex-wrap gap-2">
            <Badge variant="deal">
              <TrendingDown aria-hidden />
              Buen momento para comprar
            </Badge>
            <Badge variant="deal">Mínimo histórico</Badge>
            <Badge variant="caution">
              <AlertTriangle aria-hidden />
              Descuento dudoso
            </Badge>
            <Badge variant="danger">Sin stock</Badge>
            <Badge variant="card">Precio con CMR</Badge>
            <Badge variant="outline">Vendedor tercero</Badge>
            <Badge>Faltan datos</Badge>
          </div>
        </Section>

        <Section title="Formulario">
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="demo-target">Precio objetivo</Label>
            <Input id="demo-target" inputMode="numeric" placeholder="$450.000" />
          </div>
        </Section>

        <Section title="Tarjeta de producto (borrador)">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="transition-shadow hover:shadow-lift">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">PlayStation 5 Slim con lector</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-1.5">
                      <Store aria-hidden className="size-3.5" />
                      Más barato en Paris · actualizado hace 2 h
                    </CardDescription>
                  </div>
                  <Badge variant="deal">−12%</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <PriceBlock
                  size="lg"
                  prices={{ priceNormal: 599990, priceOffer: 529990, priceCard: 499990, cardName: "Tarjeta Cencosud" }}
                />
                <div className="flex flex-wrap gap-2">
                  <Badge variant="deal">Buen precio</Badge>
                  <Badge variant="outline">3 tiendas</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Airfryer Philips 4,1 L</CardTitle>
                <CardDescription className="mt-1">Falabella · último precio conocido hace 3 días</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <PriceBlock prices={{ priceNormal: 89990, priceOffer: 69990 }} />
                <Badge variant="caution">
                  <AlertTriangle aria-hidden />
                  El “antes” subió hace 5 días
                </Badge>
                <Button variant="outline" size="sm" className="self-start">
                  <ExternalLink aria-hidden />
                  Abrir para actualizar
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-1 h-4 w-1/2" />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-5 w-24" />
              </CardContent>
            </Card>
          </div>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}
