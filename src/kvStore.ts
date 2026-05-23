import { type TriggerContext } from '@devvit/public-api';
import type { ContentScore, SubredditConfig } from './types.js';

const QUEUE_KEY = 'modsentinel:queue:v1';
const CONFIG_KEY = 'modsentinel:config';
const MAX_QUEUE_SIZE = 200;

export async function saveScore(
  score: ContentScore,
  context: TriggerContext
): Promise<void> {
  const existing = await getQueue(context);
  const updated = [score, ...existing.filter((i) => i.contentId !== score.contentId)].slice(
    0,
    MAX_QUEUE_SIZE
  );
  await context.kvStore.put(QUEUE_KEY, JSON.stringify(updated));
}

export async function getQueue(context: TriggerContext): Promise<ContentScore[]> {
  const raw = await context.kvStore.get<string>(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ContentScore[];
  } catch {
    return [];
  }
}

export async function updateStatus(
  contentId: string,
  status: ContentScore['status'],
  context: TriggerContext
): Promise<void> {
  const queue = await getQueue(context);
  const updated = queue.map((item) =>
    item.contentId === contentId ? { ...item, status } : item
  );
  await context.kvStore.put(QUEUE_KEY, JSON.stringify(updated));
}

export async function getSubredditConfig(
  context: TriggerContext
): Promise<SubredditConfig | null> {
  const raw = await context.kvStore.get<string>(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubredditConfig;
  } catch {
    return null;
  }
}

export async function saveSubredditConfig(
  config: SubredditConfig,
  context: TriggerContext
): Promise<void> {
  await context.kvStore.put(CONFIG_KEY, JSON.stringify(config));
}
