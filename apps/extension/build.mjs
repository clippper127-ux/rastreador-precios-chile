// Build de la extensión: bundle con esbuild + copia de estáticos + íconos PNG generados.
// Resultado en apps/extension/dist → cargar en chrome://extensions ("Cargar descomprimida").
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync("static", outdir, { recursive: true });

// ── Íconos: cuadrado redondeado oscuro con la línea de tendencia (sin dependencias) ──
function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function icon(size) {
  const s = size / 32;
  const pts = [[8, 20.5], [13, 15.5], [17, 19], [24, 11]].map(([x, y]) => [x * s, y * s]);
  const r = 9 * s, stroke = 2.6 * s;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
      const inside = Math.hypot(px - cx, py - cy) <= r;
      let rgba = [0, 0, 0, 0];
      if (inside) {
        rgba = [30, 34, 48, 255];
        let d = Infinity;
        for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(px, py, pts[i], pts[i + 1]));
        if (d <= stroke / 2) rgba = [248, 249, 251, 255];
        if (Math.hypot(px - 24 * s, py - 11 * s) <= 2.6 * s) rgba = [47, 158, 106, 255];
      }
      raw.set(rgba, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const size of [16, 48, 128]) writeFileSync(`${outdir}/icon-${size}.png`, icon(size));

const options = {
  entryPoints: { content: "src/content.ts", background: "src/background.ts", popup: "src/popup.ts" },
  bundle: true,
  outdir,
  format: "esm",
  target: "chrome120",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

// El content script no puede ser un módulo ES: se empaqueta aparte como IIFE.
const modules = { ...options, entryPoints: { background: "src/background.ts", popup: "src/popup.ts" } };
const content = { ...options, entryPoints: { content: "src/content.ts" }, format: "iife" };

if (watch) {
  for (const o of [modules, content]) await (await context(o)).watch();
  console.log("Observando cambios… (recarga la extensión en chrome://extensions)");
} else {
  await build(modules);
  await build(content);
  console.log(`Listo: ${outdir}/ (cárgala en chrome://extensions → "Cargar descomprimida")`);
}
