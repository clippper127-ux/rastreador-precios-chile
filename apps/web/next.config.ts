import { config } from "dotenv";
import type { NextConfig } from "next";

// Un solo `.env` en la raíz del monorepo para web, worker y db. En Vercel se usan sus Environment Variables.
config({ path: "../../.env", quiet: true });

// Cabeceras de seguridad para todas las páginas (HSTS ya lo pone Vercel).
const SECURITY_HEADERS = [
  // Nadie puede mostrar la app dentro de un iframe (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Al abrir un link de tienda no se envía la ruta interna de la app.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  transpilePackages: ["@rastreador/core", "@rastreador/db"],
  // Búsqueda por foto: la imagen ya viene reducida (~1280 px), pero se deja margen.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  images: {
    // Imágenes de producto de las tiendas. Se amplía al agregar adaptadores.
    remotePatterns: [
      { protocol: "https", hostname: "**.mlstatic.com" },
      { protocol: "https", hostname: "**.falabella.com" },
      { protocol: "https", hostname: "**.paris.cl" },
      { protocol: "https", hostname: "**.ripley.cl" },
    ],
  },
};

export default nextConfig;
