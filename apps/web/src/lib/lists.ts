import "server-only";
import { schema } from "@rastreador/db";
import { collectionTotals, type CollectionTotal } from "@rastreador/db/collections";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { listWatchCards, type WatchCard } from "./watches";

export async function getLists(userId: string): Promise<CollectionTotal[]> {
  return collectionTotals(db(), userId);
}

export async function getList(userId: string, listId: string) {
  const d = db();
  const list = await d.query.collections.findFirst({
    where: and(eq(schema.collections.id, listId), eq(schema.collections.userId, userId)),
  });
  if (!list) return null;
  const items = await d.select().from(schema.collectionItems).where(eq(schema.collectionItems.collectionId, listId));
  const ids = new Set(items.map((i) => i.watchId));
  const cards: WatchCard[] = (await listWatchCards(userId)).filter((c) => ids.has(c.watchId));
  const [total] = await collectionTotals(d, userId).then((t) => t.filter((x) => x.id === listId));
  return { list, cards, total };
}
