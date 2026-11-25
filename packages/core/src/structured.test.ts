import { describe, expect, it } from "vitest";
import {
  availabilityToStock,
  extractJsonLd,
  extractNextData,
  findJsonLdOfType,
  itemListUrls,
  parseJsonLdProduct,
} from "./structured";

const PRODUCT_HTML = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList","itemListElement":[]},
  {"@type":"Product","name":"Audífonos X &amp; Y","sku":"123","gtin13":"7801234567890",
   "brand":{"@type":"Brand","name":"Sony"},"image":["https://img/1.jpg"],
   "offers":{"@type":"AggregateOffer","offers":[
     {"@type":"Offer","price":"49990","priceCurrency":"CLP","availability":"https://schema.org/InStock",
      "priceSpecification":{"@type":"UnitPriceSpecification","priceType":"https://schema.org/ListPrice","price":69990}},
     {"@type":"Offer","price":52990,"priceCurrency":"CLP","availability":"https://schema.org/InStock"}
   ]}}
]}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"id":1}}}</script>
</head></html>`;

describe("JSON-LD", () => {
  const nodes = extractJsonLd(PRODUCT_HTML);

  it("aplana @graph", () => {
    expect(findJsonLdOfType(nodes, "Product")).toHaveLength(1);
  });

  it("lee producto, precio mínimo CLP y precio de lista", () => {
    const p = parseJsonLdProduct(findJsonLdOfType(nodes, "Product")[0]!);
    expect(p).toMatchObject({
      title: "Audífonos X & Y",
      brand: "Sony",
      sku: "123",
      ean: "7801234567890",
      imageUrl: "https://img/1.jpg",
      price: 49990,
      listPrice: 69990,
      stockStatus: "in_stock",
    });
  });

  it("ignora JSON inválido sin romper", () => {
    expect(extractJsonLd('<script type="application/ld+json">{malo</script>')).toEqual([]);
  });

  it("lee URLs de ItemList", () => {
    const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
      {"@type":"ListItem","position":1,"url":"https://t.cl/a"},
      {"@type":"ListItem","position":2,"item":{"@type":"Product","url":"https://t.cl/b"}}]}</script>`;
    expect(itemListUrls(extractJsonLd(html))).toEqual(["https://t.cl/a", "https://t.cl/b"]);
  });
});

describe("otros", () => {
  it("__NEXT_DATA__", () => {
    expect(extractNextData(PRODUCT_HTML)?.props).toBeDefined();
    expect(extractNextData("<html></html>")).toBeUndefined();
  });

  it("disponibilidad", () => {
    expect(availabilityToStock("https://schema.org/OutOfStock")).toBe("out_of_stock");
    expect(availabilityToStock("http://schema.org/PreOrder")).toBe("preorder");
    expect(availabilityToStock(undefined)).toBe("unknown");
  });
});
