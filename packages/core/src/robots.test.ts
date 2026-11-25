import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

const ROBOTS = `
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /checkout
Disallow: /*?*srule=
Allow: /checkout/help
Disallow: /search$
Crawl-delay: 2
`;

describe("robots.txt", () => {
  const rules = parseRobots(ROBOTS, "RastreadorPreciosPersonal/0.1");

  it("usa el grupo * cuando no hay uno específico", () => {
    expect(rules.crawlDelaySec).toBe(2);
    expect(isAllowed(rules, "/producto-123.html")).toBe(true);
  });

  it("respeta Disallow, comodines y $", () => {
    expect(isAllowed(rules, "/checkout/pago")).toBe(false);
    expect(isAllowed(rules, "/tecnologia?srule=price")).toBe(false);
    expect(isAllowed(rules, "/search")).toBe(false);
    expect(isAllowed(rules, "/search?q=tv")).toBe(true);
  });

  it("la regla más larga gana (Allow sobre Disallow)", () => {
    expect(isAllowed(rules, "/checkout/help")).toBe(true);
  });

  it("aplica el grupo específico si coincide el agente", () => {
    const g = parseRobots(ROBOTS, "Mozilla/5.0 (compatible; Googlebot/2.1)");
    expect(isAllowed(g, "/cualquier-cosa")).toBe(false);
  });

  it("robots vacío permite todo", () => {
    expect(isAllowed(parseRobots("", "x"), "/a")).toBe(true);
  });
});
