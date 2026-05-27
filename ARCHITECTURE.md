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
          │         │YES → override score = 85 (flags+notifies, does NOT auto-remove)
          │         │      skip Gemini call entirely (saves API quota)
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
          │                                  overall = max(
          │                                    violation×0.5 + spam×0.3 + toxicity×0.2,
          │                                    maxSingleScore×0.85 if maxSingle≥85
          │                                  )
          │
          ├─► saveScore(ContentScore) → KV: modsentinel:queue:v1
          │       • Deduped by contentId
          │       • Max 200 items (oldest evicted)
          │       • Includes: autoRemoved?, authorViolations, authorIsWatched
          │       • url = canonical Reddit URL (constructed, not from proto)
          │
          ├─► realtime.send(REALTIME_CHANNEL, LiveScoreEvent)
          │       Live push to all open dashboard windows (non-fatal if fails)
          │
          ├─► recordViolation(author, isViolation=false)
          │       KV: modsentinel:rep:<username>
          │
          └─► Auto-actions (skipped for mod posts):
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
                 │  Realtime subscription (live updates):   │
                 │    useChannel(REALTIME_CHANNEL)          │
                 │    → increments refreshKey on receive    │
                 │                                          │
                 │  Render:                                 │
                 │    Header: title | health | ? | ↻        │
                 │    Tabs: All N | 🔴 | ⏳ | 🤖 | 👁       │
                 │    Items: sorted by score desc,          │
                 │           pending first                  │
                 │    Pagination: ← Prev  N/total  Next →   │
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
2. Check if author is a moderator (mod posts are scored but skip auto-actions)
3. Parallel fetch: [isOnWatchlist, getUserReputation]
4. getSubredditConfig (thresholds + rules)
5. Score content (Gemini or watchlist override at 85)
6. Construct canonical URL:
     posts   → https://www.reddit.com/r/{sub}/comments/{id}/
     comments → https://reddit.com{comment.permalink}
7. Build ContentScore with reputation snapshot
8. saveScore → KV queue
9. realtime.send → live push to open dashboards
10. recordViolation(author, false)  [increment totalScored]
11. If not a mod:
      └─ overall ≥ autoRemoveThreshold → remove + recordViolation(true)
           └─ autoReplyOnRemoval → submitComment(reasoning)
      └─ overall ≥ autoFlairThreshold → setPostFlair
      └─ overall ≥ notifyThreshold → sendPrivateMessage
```

**Watchlist override:** Watched users skip Gemini entirely and receive score `{spam:85, violation:85, toxicity:0, overall:85}`. Score 85 is deliberately below the default auto-remove threshold (95) so watchlisted users are flagged for manual review without automatic removal — preventing false positive auto-removes for legitimate users who happen to be monitored.

**URL construction:** `PostV2.url` in the Devvit proto is `undefined` for text/self-posts (only populated for link posts pointing to external URLs). The canonical Reddit URL is always constructed from subreddit name + post ID to ensure reliable deep-linking from the dashboard.

---

### `gemini.ts` — AI Scoring

Single exported function: `scoreContent(content, type, rules, context)`.

- Reads `geminiApiKey` from Devvit app settings
- Constructs a structured JSON prompt with: content text, content type, subreddit rules
- Parses the Gemini response into `GeminiScore`
- **Recomputes `overall` independently** — does not trust Gemini's calculation
- Returns `SAFE_DEFAULT = {0, 0, 0, 0, ''}` on any error (fail-safe, never throws)

**Overall score formula:**
```
raw   = round(violation×0.5 + spam×0.3 + toxicity×0.2)
floor = maxSingle >= 85 ? round(maxSingle × 0.85) : 0
overall = min(100, max(raw, floor))
```

The floor prevents high-confidence single-dimension hits from being diluted. For example, Spam=95 + Violation=90 + Toxicity=0 would yield raw=73 (WARNING), but floor=round(95×0.85)=81, so overall=81 (CRITICAL).

**Prompt strategy:** The model is instructed to output strict JSON with integer scores 0–100. Each dimension is independently scored. Reasoning is requested only for `overall > 50` to keep response sizes small.

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
queueJson       string    '[]'     Serialized ContentScore[] (JSONValue constraint)
watchlistJson   string    '[]'     Serialized string[] (usernames)
healthScore     number    100      % of queue items scoring < 40 or mod-approved
filter          string    'all'    Active tab: all|critical|pending|shadow|watched
page            number    0        Current pagination page (0-indexed)
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

**Pagination:** Devvit Blocks has no native scroll or overflow support. The dashboard uses client-side pagination with `PAGE_SIZE = 2` items per page (chosen so both items + the pagination bar fit in the desktop viewport; mobile shows the same). Filter tab changes reset `page` to 0. The pagination bar (`← Prev  N / total  Next →`) only renders when `totalPages > 1`.

**Live updates:** `useChannel(REALTIME_CHANNEL)` subscribes to the `modsentinel_scores` realtime channel. When a new score is broadcast by a trigger, the channel callback increments `refreshKey`, causing `useAsync` to re-fetch the queue — the dashboard updates automatically without manual refresh.

**Loading animation:** `useInterval` at 100 ms cycles `spinnerFrame` through 10 braille spinner characters (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`). The animation runs only while `loading === true`; on load completion the interval is stopped, preventing infinite re-render loops.

**Colors:** Devvit only supports `neutral-background*` named color tokens. All other named tokens (`green-background`, `red-background`, `orangered-background`) throw a runtime parse error. All score colors and status badge backgrounds use hex codes:

| Semantic | Hex | Used for |
|----------|-----|---------|
| Critical (red) | `#7F1D1D` | Score ≥ 80 background |
| Warning (amber) | `#BF360C` / `#C0510B` | Score 60–79 background |
| Low risk (green) | `#1B5E20` | Score 0–39 background |

**Navigation (`↗ View`):** `context.ui.navigateTo(url)` is only implemented in the Reddit mobile app. On Reddit web browser, it throws `TypeError: not a function`. The handler wraps the call in try/catch — on mobile it navigates directly, on web it falls back to `context.ui.showToast(url)` displaying the full URL.

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
  url: string                // canonical Reddit URL (always absolute https://)
  createdAt: number          // Unix ms
  scores: {
    spam: number             // 0-100
    violation: number        // 0-100
    toxicity: number         // 0-100
    overall: number          // 0-100, weighted with floor
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

LiveScoreEvent {
  contentId: string
  overall: number
  contentType: 'post'|'comment'
  authorName: string
  autoRemoved: boolean
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

### 4. Watchlist short-circuit at 85
Watched users skip the Gemini API call entirely. Score 85 is chosen specifically to be above the flair threshold (80) and mod-mail threshold (90 — close enough to alert mods) but **below** the default auto-remove threshold (95). This means watchlisted users are always flagged for human review without risking false positive auto-removals for legitimate content.

### 5. Scheduler context typing
`Devvit.addSchedulerJob`'s `onRun` callback receives `JobContext = Omit<Devvit.Context, 'ui'|'dimensions'|'modLog'|'uiEnvironment'>`. Since `JobContext` is not re-exported from `@devvit/public-api`, we define a local alias `type SchedulerContext = Omit<Devvit.Context, 'ui'|'dimensions'|'modLog'|'uiEnvironment'>` for the `sendDailySummary` function parameter.

### 6. Idempotent interval start
The spinner interval calls `spinnerTicker.start()` each render while `loading === true` and `spinnerTicker.stop()` when `loading === false`. Devvit's `useInterval` is designed to be idempotent — calling `start()` on an already-running interval is a no-op.

### 7. Overall score floor prevents dilution
The weighted formula `violation×0.5 + spam×0.3 + toxicity×0.2` can under-report risk when one dimension is extremely high but others are zero (e.g. pure spam with no toxicity). The floor `max(raw, maxSingle × 0.85)` ensures that a content item with any single dimension ≥ 85 scores at least 72/100 overall, guaranteeing it surfaces as WARNING or CRITICAL in the queue.

### 8. Pagination over scroll
Devvit Blocks has no scroll or overflow primitives — the entire component must fit within a fixed viewport. Pagination (← Prev / Next →) is the only viable solution for queues longer than the viewport. PAGE_SIZE=2 was calibrated for the desktop Reddit web layout, which has a shorter effective height than the mobile app.

---

## Known Platform Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| `context.ui.navigateTo` not available in Reddit web browser | "↗ View" button cannot deep-link on desktop web | Falls back to `showToast(url)` with full URL; works correctly on mobile app |
| Only `neutral-background*` named color tokens valid | Cannot use `green-background`, `red-background` etc. | All score colors use hex codes (`#1B5E20`, `#7F1D1D`, `#BF360C`) |
| No native scroll in Devvit Blocks | Cannot show arbitrarily long lists | Pagination with PAGE_SIZE=2 |
| `PostV2.url` undefined for text posts | Cannot store post URL from event proto | URL constructed from subreddit name + post ID in trigger |
| `useState` values must be `JSONValue` | Cannot store typed objects in state directly | Queue serialized as JSON string, deserialized on each render |
| `useAsync` setState only in `finally` | Cannot call setState mid-async | All state mutations happen in the `finally` callback |

---

## Constraints & Limits

| Constraint | Value | Reason |
|-----------|-------|--------|
| Queue size | 200 items | KV value size limit (~256 KB) |
| Items per page | 2 | Desktop viewport height; pagination bar must be visible |
| Gemini free tier | ~1 M tokens/month | ~5 000 items at ~200 tokens each |
| Scheduler minimum | 100 ms | `useInterval` minimum delay |
| Trigger latency | < 3 s typical | Gemini Flash p50 latency |
| KV reads per trigger | 4 | watchlist + rep + config + queue |
| KV writes per trigger | 2–3 | queue save + rep update (+ 2nd queue save if auto-removed) |
| Watchlist flag score | 85 | Above flair/notify threshold, below auto-remove threshold |
| Auto-remove default | 95 | High confidence only; reduces false positives |
