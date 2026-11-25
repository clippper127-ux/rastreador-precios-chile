"use client";

import { ArrowRight, Link2, Loader2, Search } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { trackUrl } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { PhotoSearchButton } from "./photo-search";

const EXAMPLES = [
  "PS5 Slim con lector",
  "Airfryer Philips 4 litros",
  "Nike Pegasus 41 talla 42",
  "Monitor 27\" 144 Hz",
];

export function SearchHero({ aiEnabled = false }: { aiEnabled?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const reduce = useReducedMotion();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(q: string) {
    const value = q.trim();
    if (!value) return;
    setError(null);
    if (/^https?:\/\//i.test(value)) {
      startTransition(async () => {
        const result = await trackUrl(value);
        if (result?.error) setError(result.error);
      });
      return;
    }
    router.push(`/buscar?q=${encodeURIComponent(value)}`);
  }

  const isLink = /^https?:\/\//i.test(query.trim());

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex max-w-2xl flex-col items-center pt-8 text-center sm:pt-20"
    >
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
        ¿Qué quieres comprar?
      </h1>
      <p className="mt-4 max-w-lg text-base text-pretty text-muted-foreground sm:text-lg">
        Escríbelo como se lo dirías a alguien. Lo buscamos en las tiendas chilenas y te avisamos cuando conviene.
      </p>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(query);
        }}
        className="group mt-10 w-full"
      >
        <label htmlFor="q" className="sr-only">
          Producto o link de una tienda
        </label>
        <div className="flex items-center gap-2 rounded-2xl border bg-card p-2 pl-4 shadow-lift transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15">
          {isLink ? (
            <Link2 aria-hidden className="size-5 shrink-0 text-brand" />
          ) : (
            <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          )}
          <input
            id="q"
            name="q"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            placeholder="Ej: PS5 Slim con lector, o pega un link"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "search-error" : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none sm:text-lg"
          />
          <Button type="submit" size="lg" className="rounded-xl px-4 sm:px-6" disabled={!query.trim() || pending}>
            <span className="hidden sm:inline">{isLink ? "Seguir" : "Buscar"}</span>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : <ArrowRight aria-hidden />}
          </Button>
        </div>
        {error && (
          <p id="search-error" role="alert" className="mt-3 text-left text-sm text-danger">
            {error}
          </p>
        )}
      </form>

      <ul aria-label="Ejemplos" className="mt-5 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              onClick={() => {
                setQuery(ex);
                go(ex);
              }}
              className="rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <PhotoSearchButton aiEnabled={aiEnabled} />
      </div>
    </motion.section>
  );
}
