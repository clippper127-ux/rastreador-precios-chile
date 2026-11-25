import { config } from "dotenv";
import type { NextConfig } from "next";

// Un solo `.env` en la raíz del monorepo para web, worker y db. En Vercel se usan sus Environment Variables.
config({ path: "../../.env", quiet: true });

const nextConfig: NextConfig = {
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
