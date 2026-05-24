import type { ContentScore, SubredditConfig, UserReputation } from './types.js';

const QUEUE_KEY = 'modsentinel:queue:v1';
const MAX_QUEUE_SIZE = 200;
const REP_PREFIX = 'modsentinel:rep:';
const WATCHLIST_KEY = 'modsentinel:watchlist:v1';

// ─── Shared context interface ─────────────────────────────────────────────────
// Both TriggerContext and Devvit.Context expose kvStore with the same JSON-value
// contract. We use `unknown` for the get return to satisfy both call sites
// without fighting Devvit's JSONValue vs. generic T mismatch.
interface KVContext {
  kvStore: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(key: string): Promise<any>;
    put(key: string, value: string): Promise<void>;
  };
  settings?: {
    get<T = string>(key: string): Promise<T | undefined>;
  };
}

// ─── Queue helpers ────────────────────────────────────────────────────────────

export async function saveScore(score: ContentScore, context: KVContext): Promise<void> {
  const existing = await getQueue(context);
  const updated = [score, ...existing.filter((i) => i.contentId !== score.contentId)].slice(
    0,
    MAX_QUEUE_SIZE
  );
  await context.kvStore.put(QUEUE_KEY, JSON.stringify(updated));
}

export async function getQueue(context: KVContext): Promise<ContentScore[]> {
  const raw: string | null | undefined = await context.kvStore.get(QUEUE_KEY);
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
  context: KVContext
): Promise<void> {
  const queue = await getQueue(context);
  const updated = queue.map((item) =>
    item.contentId === contentId ? { ...item, status } : item
  );
  await context.kvStore.put(QUEUE_KEY, JSON.stringify(updated));
}

export async function clearActioned(context: KVContext): Promise<number> {
  const queue = await getQueue(context);
  const kept = queue.filter((i) => i.status === 'pending');
  await context.kvStore.put(QUEUE_KEY, JSON.stringify(kept));
  return queue.length - kept.length;
}

// ─── User Reputation ──────────────────────────────────────────────────────────

export async function getUserReputation(
  username: string,
  context: KVContext
): Promise<UserReputation> {
  const raw = await context.kvStore.get(`${REP_PREFIX}${username}`);
  if (!raw) return { username, totalScored: 0, totalViolations: 0, isWatched: false };
  try {
    return JSON.parse(raw) as UserReputation;
  } catch {
    return { username, totalScored: 0, totalViolations: 0, isWatched: false };
  }
}

/**
 * Record a scoring event for a user.
 * @param isViolation - true if the content was auto-removed (violation flagged)
 */
export async function recordViolation(
  username: string,
  isViolation: boolean,
  context: KVContext
): Promise<void> {
  try {
    const rep = await getUserReputation(username, context);
    const updated: UserReputation = {
      ...rep,
      totalScored: rep.totalScored + 1,
      totalViolations: isViolation ? rep.totalViolations + 1 : rep.totalViolations,
      lastViolationAt: isViolation ? Date.now() : rep.lastViolationAt,
    };
    await context.kvStore.put(`${REP_PREFIX}${username}`, JSON.stringify(updated));
  } catch (err) {
    console.error('[ModSentinel] recordViolation failed (non-fatal):', err);
  }
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function getWatchlist(context: KVContext): Promise<string[]> {
  const raw = await context.kvStore.get(WATCHLIST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function addToWatchlist(username: string, context: KVContext): Promise<void> {
  const list = await getWatchlist(context);
  if (!list.includes(username)) {
    await context.kvStore.put(WATCHLIST_KEY, JSON.stringify([...list, username]));
  }
  // Mirror watched flag onto the reputation record
  const rep = await getUserReputation(username, context);
  await context.kvStore.put(
    `${REP_PREFIX}${username}`,
    JSON.stringify({ ...rep, isWatched: true })
  );
}

export async function removeFromWatchlist(username: string, context: KVContext): Promise<void> {
  const list = await getWatchlist(context);
  await context.kvStore.put(WATCHLIST_KEY, JSON.stringify(list.filter((u) => u !== username)));
  const rep = await getUserReputation(username, context);
  await context.kvStore.put(
    `${REP_PREFIX}${username}`,
    JSON.stringify({ ...rep, isWatched: false })
  );
}

export async function isOnWatchlist(username: string, context: KVContext): Promise<boolean> {
  const list = await getWatchlist(context);
  return list.includes(username);
}

// ─── Config helpers ───────────────────────────────────────────────────────────
// Reads from Devvit app settings (configured during installation).
// This is the correct pattern — settings are managed by Devvit, not KV store.

export async function getSubredditConfig(context: KVContext): Promise<SubredditConfig> {
  const settings = context.settings;
  if (!settings) {
    return defaultConfig();
  }

  const [rulesRaw, autoRemove, autoFlair, notify, autoReplyRaw] = await Promise.all([
    settings.get<string>('subredditRules'),
    settings.get<number>('autoRemoveThreshold'),
    settings.get<number>('autoFlairThreshold'),
    settings.get<number>('notifyThreshold'),
    settings.get<string[]>('autoReplyOnRemoval'),
  ]);

  const rules = rulesRaw
    ? rulesRaw
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean)
    : [];

  const autoReply = Array.isArray(autoReplyRaw) ? autoReplyRaw[0] === 'enabled' : false;

  return {
    rules,
    keywords: [],
    autoRemoveThreshold: autoRemove ?? 95,
    autoFlairThreshold: autoFlair ?? 80,
    notifyThreshold: notify ?? 90,
    autoReplyOnRemoval: autoReply,
  };
}

function defaultConfig(): SubredditConfig {
  return {
    rules: ['Be respectful', 'No spam', 'Stay on topic'],
    keywords: [],
    autoRemoveThreshold: 95,
    autoFlairThreshold: 80,
    notifyThreshold: 90,
    autoReplyOnRemoval: false,
  };
}
