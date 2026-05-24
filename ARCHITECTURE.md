# ModSentinel — Architecture

## System Overview

ModSentinel is a **server-side Devvit application** that intercepts Reddit content at creation time, scores it with an external AI model, and surfaces a prioritized review queue to moderators through a custom post UI.

There are three independent subsystems:
1. **Ingest pipeline** — trigger → score → persist → auto-act
2. **Dashboard UI** — custom post that reads + acts on the queue
3. **Scheduler** — daily summary mod-mail at 9 AM UTC

---

## Data Flow

```
Reddit creates a Post or Comment
          │
          ▼
  PostCreate / CommentCreate trigger
          │
          ├─► isOnWatchlist(author)?
          │         │YES → override score = 100, skip Gemini call
          │         │NO  ─────────────────────────────┐
          │                                           │
          ├─► getUserReputation(author)               │
          │       (prior violation count)             │
          │                                           ▼
          │                              scoreContent(text, rules)
          │                                  Gemini 2.0 Flash API
          │                                  returns { spam, violation,
          │                                            toxicity, overall,
          │                                            reasoning }
          │
          ├─► saveScore(ContentScore) → KV: modsentinel:queue:v1
          │       • Deduped by contentId
          │       • Max 200 items (oldest evicted)
          │       • Includes: autoRemoved?, authorViolations, authorIsWatched
          │
          ├─► recordViolation(author, isViolation=false)
          │       KV: modsentinel:rep:<username>
          │
          └─► Auto-actions (mod posts only):
                  ├─► score ≥ autoRemoveThreshold (95)?
                  │       reddit.remove()
                  │       saveScore({ status: 'removed', autoRemoved: true })
                  │       recordViolation(author, isViolation=true)
                  │       if autoReplyOnRemoval: submitComment(reasoning)
                  │
                  ├─► score ≥ autoFlairThreshold (80)?
                  │       reddit.setPostFlair("⚠️ Needs Review")
                  │
                  └─► score ≥ notifyThreshold (90)?
                          reddit.sendPrivateMessage → /r/subredditName


                 ┌─────────────────────────────────────────┐
                 │           Dashboard (Custom Post)        │
                 │                                          │
                 │  useAsync() on mount + refreshKey        │
                 │    ├─ getCurrentUser()                   │
                 │    ├─ getModerators()  ←── mod gate      │
                 │    ├─ getQueue()                         │
                 │    ├─ getWatchlist()                     │
                 │    └─ compute healthScore                │
                 │                                          │
                 │  Render:                                 │
                 │    Header: title | health | refresh      │
                 │    Tabs: All | Critical | Pending |      │
                 │          Shadow | Watched                │
                 │    Items: sorted by score desc,          │
                 │           pending first                  │
                 │    Actions: Approve | Remove | Spam | ↗  │
                 └─────────────────────────────────────────┘


                 ┌──────────────────────────────────────┐
                 │       Daily Summary Scheduler         │
                 │  Cron: 0 9 * * * (9:00 AM UTC)       │
                 │                                       │
                 │  getQueue() → filter last 24 h        │
                 │  Compute: scored, autoRemoved,        │
                 │           pending, avgScore, health%  │
                 │  Top violators by removal count       │
                 │  sendPrivateMessage → /r/subreddit    │
                 └──────────────────────────────────────┘
```

---

## Component Descriptions

### `main.tsx` — Devvit Entry Point

Registers everything with the Devvit runtime:

| Registration | Type | Purpose |
|-------------|------|---------|
| `Devvit.addSettings` | Settings | 6 configurable fields (API key, thresholds, rules, auto-reply) |
| `Devvit.addCustomPostType` | UI | Mounts the Dashboard component |
| `Devvit.addSchedulerJob('daily-summary')` | Scheduler | Defines the daily summary job handler |
| `Devvit.addTrigger('AppInstall')` | Lifecycle | Schedules daily summary cron on first install |
| `Devvit.addTrigger('PostCreate')` | Trigger | Routes to `handlePostCreate` |
| `Devvit.addTrigger('CommentCreate')` | Trigger | Routes to `handleCommentCreate` |
| `Devvit.addMenuItem` × 6 | Menu | Open Dashboard, Approve, Remove, Spam, Add/Remove Watchlist |

---

### `triggers.ts` — Ingest Pipeline

Two handlers: `handlePostCreate` and `handleCommentCreate`. Both follow the same flow:

```
1. Extract author name from event proto
2. Parallel fetch: [isOnWatchlist, getUserReputation, getSubredditConfig]
3. Score content (Gemini or watchlist override)
4. Build ContentScore with reputation snapshot
5. saveScore → KV queue
6. recordViolation(author, false)  [increment totalScored]
7. If not a mod:
     └─ overall ≥ autoRemoveThreshold → remove + recordViolation(true)
          └─ autoReplyOnRemoval → submitComment(reasoning)
     └─ overall ≥ autoFlairThreshold → setPostFlair
     └─ overall ≥ notifyThreshold → sendPrivateMessage
```

**Watchlist override:** Watched users skip Gemini entirely and receive score `{100, 100, 100, 100}` — saves API quota and responds instantly.

---

### `gemini.ts` — AI Scoring

Single exported function: `scoreContent(content, type, rules, context)`.

- Reads `geminiApiKey` from Devvit app settings
- Constructs a structured JSON prompt with: content text, content type, subreddit rules
- Parses the Gemini response into `GeminiScore`
- Returns `SAFE_DEFAULT = {0, 0, 0, 0, ''}` on any error (fail-safe, never throws)

**Prompt strategy:** The model is instructed to output strict JSON with integer scores 0–100. Each dimension is independently scored. The `overall` field is `violation×0.5 + spam×0.3 + toxicity×0.2`. Reasoning is requested only for `overall > 50` to keep response sizes small.

---

### `kvStore.ts` — Persistence Layer

All functions accept a `KVContext` interface (compatible with both `TriggerContext` and `Devvit.Context`):

```typescript
interface KVContext {
  kvStore: { get(key: string): Promise<any>; put(key: string, value: string): Promise<void> };
  settings?: { get<T>(key: string): Promise<T | undefined> };
}
```

| Function | KV Key | Purpose |
|----------|--------|---------|
| `saveScore` | `modsentinel:queue:v1` | Upsert item; dedupe by contentId; cap 200 |
| `getQueue` | `modsentinel:queue:v1` | Return full queue array |
| `updateStatus` | `modsentinel:queue:v1` | Patch single item status |
| `clearActioned` | `modsentinel:queue:v1` | Remove non-pending items |
| `getUserReputation` | `modsentinel:rep:<user>` | Read per-user reputation |
| `recordViolation` | `modsentinel:rep:<user>` | Increment totalScored / totalViolations |
| `getWatchlist` | `modsentinel:watchlist:v1` | Read username array |
| `addToWatchlist` | `modsentinel:watchlist:v1` + rep key | Add username + mirror isWatched flag |
| `removeFromWatchlist` | `modsentinel:watchlist:v1` + rep key | Remove username + clear isWatched flag |
| `isOnWatchlist` | `modsentinel:watchlist:v1` | Boolean membership check |
| `getSubredditConfig` | *(Devvit settings)* | Read installation settings with defaults |

---

### `dashboard.tsx` — Custom Post UI

A single-function Devvit custom post component rendered in Reddit's native block layout engine.

**State:**
```
queueJson       string    '[]'     Serialized ContentScore[]
watchlistJson   string    '[]'     Serialized string[] (usernames)
healthScore     number    100      % of queue items scoring < 40
filter          string    'all'    Active tab: all|critical|pending|shadow|watched
loading         boolean   true     Drives loading indicator
refreshKey      number    0        Incrementing to re-trigger useAsync
lastUpdated     number    0        Timestamp of last successful fetch
statusMsg       string    ''       Last action feedback (e.g. "✓ Approved")
clearing        boolean   false    Prevents double-tap on clear button
isMod           boolean   false    Set after server-side moderator verification
showHelp        boolean   false    Toggles in-app guide panel
spinnerFrame    number    0        Animation frame for loading spinner
```

**Mod gate:** On every load, `useAsync` calls `getCurrentUser()` + `getModerators()` server-side. If the viewer is not a mod, the async returns `isMod: false` and the component renders a lock screen — the queue data is never sent to the client.

**Loading animation:** `useInterval` at 100 ms cycles `spinnerFrame` through 10 braille spinner characters (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`). The animation runs only while `loading === true`; on load completion the interval is stopped, preventing infinite re-render loops.

**Help panel:** A `showHelp` state toggle replaces the queue with an in-app reference guide covering: score color coding, filter tabs, action buttons, auto-action thresholds, watchlist, shadow queue, and daily reports.

---

### `types.ts` — Data Contracts

```typescript
ContentScore {
  contentId: string          // fullname (t3_xxx or t1_xxx)
  contentType: 'post'|'comment'
  authorName: string
  title?: string             // posts only
  body: string
  url: string
  createdAt: number          // Unix ms
  scores: {
    spam: number             // 0-100
    violation: number        // 0-100
    toxicity: number         // 0-100
    overall: number          // 0-100, weighted
  }
  status: 'pending'|'approved'|'removed'|'spam'
  geminiReasoning: string    // empty string if overall < 50
  autoRemoved?: boolean      // true = system removed, not a mod
  authorViolations?: number  // snapshot at score time
  authorIsWatched?: boolean  // snapshot at score time
}

UserReputation {
  username: string
  totalScored: number        // every trigger event
  totalViolations: number    // auto-remove events only
  lastViolationAt?: number
  isWatched: boolean
}

SubredditConfig {
  rules: string[]
  keywords: string[]
  autoRemoveThreshold: number   // default 95
  autoFlairThreshold: number    // default 80
  notifyThreshold: number       // default 90
  autoReplyOnRemoval: boolean   // default false
}
```

---

## Key Design Decisions

### 1. Denormalized reputation snapshot
User reputation (`authorViolations`, `authorIsWatched`) is embedded in `ContentScore` at save time rather than joined at read time. This means the dashboard only needs **one KV read** (the queue) to render full reputation badges for every item, without N+1 lookups per author.

### 2. Fail-safe scoring
`scoreContent` never throws. On network error, invalid API key, or malformed Gemini response, it returns `{0,0,0,0,''}`. This ensures every piece of content lands in the queue even when AI is unavailable.

### 3. KVContext duck-typing
Both `TriggerContext` and `Devvit.Context` expose `kvStore` but with incompatible TypeScript generics. The shared `KVContext` interface uses `get(key): Promise<any>` to satisfy both call sites without fighting Devvit's `JSONValue` type constraints.

### 4. Watchlist short-circuit
Watched users skip the Gemini API call entirely. This is important for two reasons: (a) it responds instantly regardless of API latency, (b) it preserves free-tier quota for unscored content.

### 5. Scheduler context typing
`Devvit.addSchedulerJob`'s `onRun` callback receives `JobContext = Omit<Devvit.Context, 'ui'|'dimensions'|'modLog'|'uiEnvironment'>`. Since `JobContext` is not re-exported from `@devvit/public-api`, we define a local alias `type SchedulerContext = Omit<Devvit.Context, 'ui'|'dimensions'|'modLog'|'uiEnvironment'>` for the `sendDailySummary` function parameter.

### 6. Idempotent interval start
The spinner interval calls `spinnerTicker.start()` each render while `loading === true` and `spinnerTicker.stop()` when `loading === false`. Devvit's `useInterval` is designed to be idempotent — calling `start()` on an already-running interval is a no-op.

---

## Constraints & Limits

| Constraint | Value | Reason |
|-----------|-------|--------|
| Queue size | 200 items | KV value size limit (~256 KB) |
| Gemini free tier | ~1 M tokens/month | ~5 000 items at ~200 tokens each |
| Scheduler minimum | 100 ms | `useInterval` minimum delay |
| Trigger latency | < 500 ms typical | Gemini Flash p50 latency |
| KV reads per trigger | 4 | watchlist + rep + config + queue |
| KV writes per trigger | 2 | queue save + rep update |
