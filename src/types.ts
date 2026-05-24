export interface ContentScore {
  contentId: string;
  contentType: 'post' | 'comment';
  authorName: string;
  title?: string;
  body: string;
  url: string;
  createdAt: number;
  scores: {
    spam: number;       // 0-100
    violation: number;  // 0-100 — breaks subreddit rules
    toxicity: number;   // 0-100 — hostile/harassing language
    overall: number;    // 0-100 — weighted overall priority
  };
  status: 'pending' | 'approved' | 'removed' | 'spam';
  geminiReasoning: string;
  // ── Reputation snapshot (captured at score time) ──────────────────────────
  autoRemoved?: boolean;       // true when removed automatically by trigger
  authorViolations?: number;   // prior violation count at time of scoring
  authorIsWatched?: boolean;   // true if author was on watchlist at score time
}

export interface SubredditConfig {
  rules: string[];
  keywords: string[];
  autoRemoveThreshold: number;   // default 95
  autoFlairThreshold: number;    // default 80
  notifyThreshold: number;       // default 90
  autoReplyOnRemoval: boolean;   // post mod comment explaining removal, default false
}

// ── Realtime push event (trigger → dashboard) ─────────────────────────────────
// Must satisfy JSONObject (index signature required by Devvit realtime API).
// All fields are JSON primitives so the constraint is safe to express inline.
export interface LiveScoreEvent {
  contentId: string;
  overall: number;
  contentType: string;   // 'post' | 'comment' — kept as string for JSONObject compat
  authorName: string;
  autoRemoved: boolean;
  [key: string]: string | number | boolean | null;
}

// ── User Reputation ───────────────────────────────────────────────────────────
export interface UserReputation {
  username: string;
  totalScored: number;
  totalViolations: number;   // auto-removed count
  lastViolationAt?: number;
  isWatched: boolean;
}
