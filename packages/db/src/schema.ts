import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Convenciones:
 * - Precios en enteros CLP (`integer`, sin decimales).
 * - Fechas en `timestamptz`.
 * - RLS, FKs hacia auth.users y triggers están en la migración SQL custom `0001_rls_auth.sql`.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ─── Enums ────────────────────────────────────────────────────────────────────

export const priceSourceEnum = pgEnum("price_source", [
  "api",
  "feed",
  "pricto",
  "server",
  "ai",
  "extension",
  "manual",
]);
export const stockStatusEnum = pgEnum("stock_status", [
  "in_stock",
  "preorder",
  "out_of_stock",
  "discontinued",
  "unknown",
]);
export const sellerTypeEnum = pgEnum("seller_type", ["official", "store", "third_party"]);
export const storeStatusEnum = pgEnum("store_status", ["ok", "degraded", "blocked"]);
export const searchModeEnum = pgEnum("search_mode", ["server", "link"]);
export const strategyKindEnum = pgEnum("strategy_kind", [
  "schema_org",
  "next_data",
  "css",
  "xpath",
  "regex",
  "jsonpath",
]);
export const strategyStatusEnum = pgEnum("strategy_status", ["proposed", "approved", "disabled"]);
export const strategyOriginEnum = pgEnum("strategy_origin", ["builtin", "human", "ai"]);
export const listingStatusEnum = pgEnum("listing_status", ["active", "archived"]);
export const priceBasisEnum = pgEnum("price_basis", ["no_card", "with_card"]);
export const alertKindEnum = pgEnum("alert_kind", ["target", "drop_pct", "all_time_low", "restock"]);
export const alertStatusEnum = pgEnum("alert_status", ["pending", "sent", "failed"]);
export const runnerEnum = pgEnum("runner", ["gha", "local"]);

// ─── Usuarios ────────────────────────────────────────────────────────────────

/** 1:1 con auth.users (FK y trigger de creación en la migración SQL). */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  comuna: text("comuna"),
  timezone: text("timezone").notNull().default("America/Santiago"),
  telegramChatId: bigint("telegram_chat_id", { mode: "number" }),
  /** Código de un solo uso para vincular Telegram (/start <código>), con vencimiento. */
  telegramLinkCode: text("telegram_link_code"),
  telegramLinkExpiresAt: ts("telegram_link_expires_at"),
  emailAlerts: boolean("email_alerts").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(false),
  /** Hash SHA-256 del token de la extensión; el token en claro solo se muestra una vez. */
  extensionTokenHash: text("extension_token_hash"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: createdAt(),
});

// ─── Tiendas ─────────────────────────────────────────────────────────────────

/** Configuración (store_config) y salud (store_health) de cada tienda. */
export const stores = pgTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Fuentes en orden de preferencia; se usa la primera que funcione. */
  sourceChain: priceSourceEnum("source_chain").array().notNull(),
  searchMode: searchModeEnum("search_mode").notNull().default("link"),
  searchUrlTemplate: text("search_url_template"),
  minCheckIntervalMin: integer("min_check_interval_min").notNull().default(360),
  maxRequestsPerMin: integer("max_requests_per_min").notNull().default(10),
  paused: boolean("paused").notNull().default(false),
  status: storeStatusEnum("status").notNull().default("ok"),
  backoffLevel: integer("backoff_level").notNull().default(0),
  blockedUntil: ts("blocked_until"),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  notes: text("notes"),
});

/** Rate limit global por tienda, compartido entre runners (Actions + PC). */
export const storeRate = pgTable("store_rate", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  nextAllowedAt: ts("next_allowed_at").notNull().defaultNow(),
});

export const extractionStrategies = pgTable(
  "extraction_strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    kind: strategyKindEnum("kind").notNull(),
    /** Selectores / rutas por campo: { title, priceNormal, priceOffer, priceCard, stock, ... }. */
    config: jsonb("config").notNull(),
    priority: integer("priority").notNull().default(100),
    status: strategyStatusEnum("status").notNull().default("proposed"),
    origin: strategyOriginEnum("origin").notNull().default("human"),
    createdAt: createdAt(),
    approvedAt: ts("approved_at"),
  },
  (t) => [index("extraction_strategies_store_idx").on(t.storeId, t.status, t.priority)],
);

export const fetchRuns = pgTable("fetch_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runner: runnerEnum("runner").notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  listingsChecked: integer("listings_checked").notNull().default(0),
  snapshotsInserted: integer("snapshots_inserted").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  summary: jsonb("summary"),
});

/** Límite de requests por ventana (p. ej. la API de la extensión), sin Redis. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ─── Catálogo (compartido entre usuarios) ────────────────────────────────────

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    brand: text("brand"),
    model: text("model"),
    /** Capacidad, color, talla... */
    variant: jsonb("variant"),
    ean: text("ean"),
    category: text("category"),
    imageUrl: text("image_url"),
    unitQty: numeric("unit_qty"),
    unit: text("unit"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_ean_uq").on(t.ean).where(sql`${t.ean} is not null`)],
);

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    /** Normalizada con `normalizeListingUrl`. */
    url: text("url").notNull(),
    externalId: text("external_id"),
    ean: text("ean"),
    title: text("title").notNull(),
    imageUrl: text("image_url"),
    seller: text("seller"),
    sellerType: sellerTypeEnum("seller_type"),
    sellerReputation: text("seller_reputation"),

    // Estado actual (desnormalizado para el dashboard).
    priceNormal: integer("price_normal"),
    priceOffer: integer("price_offer"),
    priceCard: integer("price_card"),
    cardName: text("card_name"),
    stockStatus: stockStatusEnum("stock_status").notNull().default("unknown"),
    shippingInfo: text("shipping_info"),
    lastSource: priceSourceEnum("last_source"),
    lastChangedAt: ts("last_changed_at"),
    lastCheckedAt: ts("last_checked_at"),

    // Cola de trabajo (sin Redis).
    nextCheckAt: ts("next_check_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),

    status: listingStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("listings_url_uq").on(t.url),
    index("listings_product_idx").on(t.productId),
    index("listings_queue_idx").on(t.nextCheckAt).where(sql`${t.status} = 'active'`),
  ],
);

/** Historial: solo se inserta cuando cambia el precio o el stock. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    observedAt: ts("observed_at").notNull().defaultNow(),
    priceNormal: integer("price_normal"),
    priceOffer: integer("price_offer"),
    priceCard: integer("price_card"),
    cardName: text("card_name"),
    stockStatus: stockStatusEnum("stock_status").notNull(),
    source: priceSourceEnum("source").notNull(),
    /** Usuario que lo reportó (extensión o ingreso manual). */
    reportedBy: uuid("reported_by"),
  },
  (t) => [index("price_snapshots_listing_time_idx").on(t.listingId, t.observedAt.desc())],
);

// ─── Lo personal ─────────────────────────────────────────────────────────────

export const watches = pgTable(
  "watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    targetPrice: integer("target_price"),
    dropPct: numeric("drop_pct"),
    notifyAllTimeLow: boolean("notify_all_time_low").notNull().default(true),
    notifyRestock: boolean("notify_restock").notNull().default(true),
    priceBasis: priceBasisEnum("price_basis").notNull().default("no_card"),
    excludeThirdParty: boolean("exclude_third_party").notNull().default(false),
    channels: text("channels").array().notNull().default(sql`'{telegram}'::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("watches_user_product_uq").on(t.userId, t.productId)],
);

/** Qué tiendas sigue el usuario para ese producto. */
export const watchListings = pgTable(
  "watch_listings",
  {
    watchId: uuid("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    /** Para no repetir "bajo el objetivo": se rearma cuando el precio vuelve a subir. */
    targetArmed: boolean("target_armed").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.watchId, t.listingId] }), index("watch_listings_listing_idx").on(t.listingId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    watchId: uuid("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    snapshotId: bigint("snapshot_id", { mode: "number" }).references(() => priceSnapshots.id, {
      onDelete: "set null",
    }),
    kind: alertKindEnum("kind").notNull(),
    /** Único: evita avisar dos veces por el mismo evento. */
    dedupeKey: text("dedupe_key").notNull(),
    channel: text("channel").notNull(),
    status: alertStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload"),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey, t.channel),
    index("alerts_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/** Estado del bot de Telegram (último update leído con getUpdates). Una sola fila: id = 'telegram'. */
export const botState = pgTable("bot_state", {
  id: text("id").primaryKey(),
  lastUpdateId: bigint("last_update_id", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
