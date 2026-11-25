/** Precios siempre en pesos chilenos enteros (sin decimales). */
export type CLP = number;

export const PRICE_SOURCES = ["api", "feed", "pricto", "server", "ai", "extension", "manual"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const STOCK_STATUSES = ["in_stock", "preorder", "out_of_stock", "discontinued", "unknown"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const SELLER_TYPES = ["official", "store", "third_party"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

/** Los tres precios que muestran las tiendas chilenas, siempre por separado. */
export interface PriceFields {
  /** Precio "antes" / normal. */
  priceNormal?: CLP;
  /** Precio oferta / internet. */
  priceOffer?: CLP;
  /** Precio con tarjeta de la tienda (CMR, Ripley, Cencosud...). */
  priceCard?: CLP;
  cardName?: string;
}

export interface ProductSnapshot extends PriceFields {
  url: string;
  title: string;
  brand?: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  stockStatus: StockStatus;
  seller?: string;
  sellerType?: SellerType;
  isOfficialStore?: boolean;
  sellerReputation?: string;
  shippingInfo?: string;
  source: PriceSource;
  fetchedAt: Date;
}

export interface SearchResult extends PriceFields {
  storeId: string;
  url: string;
  title: string;
  brand?: string;
  sku?: string;
  ean?: string;
  imageUrl?: string;
  stockStatus: StockStatus;
  seller?: string;
  sellerType?: SellerType;
  /** Si el precio vino de SoloTodo: id de la publicación allá (para actualizarlo después). */
  solotodoEntityId?: number;
  /** Producto de SoloTodo: publicaciones con el mismo id son el mismo producto (y distinto id = distinta versión). */
  solotodoProductId?: number;
}
