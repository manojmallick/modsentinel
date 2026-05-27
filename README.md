# 🛡️ ModSentinel

> **AI-powered mod queue intelligence for Reddit** — every post and comment is scored by Gemini 2.0 Flash the instant it's created, long before a moderator ever reads it.

Built for the **[Reddit Mod Tools & Migrated Apps Hackathon 2026](https://mod-tools-migration.devpost.com)** on [Devvit 0.12](https://developers.reddit.com).

**Live demo:** [r/modsentinel_testing — ModSentinel Dashboard](https://www.reddit.com/r/modsentinel_testing/comments/1tm9nud/modsentinel_ai_mod_queue/)  
**App page:** [developers.reddit.com/apps/modsentinel-ai](https://developers.reddit.com/apps/modsentinel-ai)  
**Screenshots & demo:** [DEMO.md](https://github.com/manojmallick/modsentinel/blob/main/DEMO.md)

---

## The Problem

Moderating a mid-size subreddit (50 K+ WAU) means wading through hundreds of posts and comments every day — most of them fine, a handful genuinely harmful. There is no native Reddit way to see which items need urgent attention first. Mods read everything in reverse-chronological order, meaning rule-breaking content can sit live for hours.

## The Solution

ModSentinel runs **silently in the background**. The moment any post or comment is created, it:

1. Sends the content to **Gemini 2.0 Flash** alongside your subreddit's own rules
2. Returns three independent scores — **Spam**, **Rule Violation**, **Toxicity** (each 0–100)
3. Computes a weighted **Overall priority score**
4. Stores everything in Devvit KV Store
5. Auto-acts on high-confidence violations (remove, flair, mod-mail) before any mod has to touch it
6. Surfaces every item in a **priority-sorted dashboard** with one-tap actions

Mods spend their time reviewing the top 20% of items that actually matter, not triaging the firehose.

---

## Time Savings

```
Subreddit size:  50 000 WAU  |  ~425 items/day

Without ModSentinel:
  425 items × 40 sec triage each = 4.7 hours/day per mod team

With ModSentinel (80 % auto-triaged):
  ~85 items for human review × 40 sec = 57 min/day

Time saved: ~3.8 hours/day → 1 380 hours/year returned to mods
```

---

## Features

| Feature | Detail |
|---------|--------|
| 🤖 **AI scoring** | Gemini 2.0 Flash scores every post + comment against YOUR sub rules |
| 📊 **Priority queue** | Dashboard sorted by overall score, highest first; pending items always on top |
| 🔴 **Auto-remove** | Configurable threshold (default 95/100) — removes instantly on trigger |
| 🏷️ **Auto-flair** | "⚠️ Needs Review" flair at configurable threshold (default 80) |
| 📬 **Mod-mail alerts** | Instant notification for high-confidence violations |
| 💬 **AI reasoning** | One-sentence explanation for any item scoring above 50 |
| 📏 **Subreddit-aware** | Scores against YOUR rules, not generic content policies |
| 🆓 **Free to operate** | Gemini free tier: 1 M tokens/month, ~3 000–5 000 items |
| ✅ **One-tap actions** | Approve / Remove / Spam / View directly from dashboard |
| 🔍 **Filter tabs** | All · 🔴 Critical · Pending · 🤖 Shadow · 👁 Watched |
| 👁️ **Watchlist** | Right-click any post → add user; future content auto-flagged at 100 |
| ⚠️ **Reputation badges** | "N prior violations" shown per author — spot repeat offenders instantly |
| 🤖 **Shadow queue** | Auto-removed items shown for false-positive review before they're gone |
| 🏥 **Health score** | Live "X% healthy" community metric in the dashboard header |
| 📅 **Daily summary** | Automated mod-mail report at 9 AM UTC with stats + top risk users |
| 💬 **Auto-reply** | Optional: post AI reasoning as a mod comment when content is removed |
| 🔒 **Mod-only gate** | Dashboard verifies moderator status on load — regular users see a lock screen |
| ❓ **In-app guide** | Built-in help panel explains every score, tab, and setting |

---

## Quick Start (3 Steps)

### Prerequisites
- Reddit moderator access to a subreddit
- Free [Gemini API key](https://aistudio.google.com) (takes 30 seconds)

### 1 — Install

```bash
npm install -g devvit
devvit login
devvit upload
```

### 2 — Configure

In your subreddit: **Mod Tools → Apps → ModSentinel → Settings**

| Setting | Default | What it does |
|---------|---------|-------------|
| `Gemini API Key` | *(required)* | Your Google AI Studio key — never stored on Reddit servers |
| `Auto-remove threshold` | **95** | Content scoring ≥ this is removed immediately, no mod action needed |
| `Auto-flair threshold` | **80** | Content scoring ≥ this gets "⚠️ Needs Review" flair |
| `Mod-mail notify threshold` | **90** | Instant mod-mail alert for anything scoring ≥ this |
| `Subreddit rules` | *(paste yours)* | One rule per line — copy from your sub's rules page; Gemini scores against these |
| `Auto-reply on removal` | **Disabled** | When enabled: posts a mod comment with the AI reasoning when content is auto-removed |

### 3 — Open Dashboard

**Subreddit menu → 🛡️ ModSentinel — Open Dashboard**

This creates a pinned custom post. Bookmark it — it's your new mod queue.

---

## Dashboard Guide

### Score Colors

| Color | Range | Meaning |
|-------|-------|---------|
| 🟢 Green | 0 – 39 | Clean — no action needed |
| 🔵 Blue | 40 – 59 | Low risk — worth a glance |
| 🟡 Amber | 60 – 79 | Warning — likely needs review |
| 🔴 Red | 80 – 100 | Critical — high-confidence violation |

### Filter Tabs

| Tab | Shows |
|-----|-------|
| **All** | Everything in the queue (max 200 items) |
| **🔴 Critical** | Items scoring 80+ overall |
| **Pending** | Items awaiting mod action |
| **🤖 Shadow** | Auto-removed items — review here for false positives; approve to restore |
| **👁 Watched** | Content from users on your watchlist |

### Per-item Actions

| Button | What happens |
|--------|-------------|
| **✓ Approve** | Approves on Reddit + marks reviewed in ModSentinel |
| **🗑 Remove** | Removes from Reddit + updates queue status |
| **🚫 Spam** | Removes as spam (has account-level impact) + updates queue |
| **↗ View** | Opens the original post or comment in Reddit |

### Reputation Badges

Each queue item shows the author's history at a glance:

- **👁 WATCHED** (red) — user is on your watchlist; their content is auto-flagged at 100
- **⚠️ N prior** (orange) — user has N prior auto-removes; treat this content as higher risk

### Community Health Score

Shown in the header: **🏥 94% healthy**

Calculated as: `(items scoring < 40  OR  mod-approved) ÷ total items × 100`

Items explicitly approved by a moderator count as healthy regardless of AI score. Only removed/spam/pending-high-score content counts against the metric. Refreshes whenever you click ↻. A healthy subreddit typically sits above 80%.

### Watchlist Management

**Add:** Right-click any post or comment → **👁️ ModSentinel: Add to Watchlist**  
**Remove:** Right-click → **✋ ModSentinel: Remove from Watchlist**

Watched users have every future post and comment auto-flagged with score 100 (no Gemini API call wasted). The "👁 Watched N" line in the dashboard header shows how many users are being monitored.

### Shadow Queue

The **🤖 Shadow** tab is your safety net for false positives. Every item that was auto-removed by the AI lives here until you clear it. Approve an item to restore it on Reddit and remove it from the shadow list. This is critical for maintaining community trust when using aggressive thresholds.

### Daily Summary Email

At **9:00 AM UTC** every day, ModSentinel sends a mod-mail to your subreddit with:
- Total items scored (last 24 h)
- Auto-removed vs. mod-actioned vs. still pending
- Average risk score
- Community health percentage
- Top risk users (by removal count)

---

## Scoring Model

```
Overall = (Rule Violation × 0.5) + (Spam × 0.3) + (Toxicity × 0.2)

Spam:           Promotional content, crypto schemes, fake engagement, link farms
Rule Violation: Breaks one or more of YOUR subreddit's stated rules
Toxicity:       Hostile, harassing, hateful language directed at people

Score range: 0 (completely clean) → 100 (maximum confidence violation)
```

The prompt explicitly instructs Gemini to score against the rules you provide. A rule-abiding post promoting a product will score low on Violation but high on Spam. A heated argument that technically follows rules scores high on Toxicity but low on Violation. The **Overall** score weights accordingly.

---

## Context Menu Items

Right-clicking any post or comment in your subreddit exposes six ModSentinel actions:

| Menu Item | Where | What it does |
|-----------|-------|-------------|
| 🛡️ Open Dashboard | Subreddit | Creates a new dashboard post |
| ✅ Approve | Post / Comment | Approves + syncs to ModSentinel queue |
| 🗑️ Remove | Post / Comment | Removes + syncs to ModSentinel queue |
| 🚫 Mark as Spam | Post / Comment | Spam-removes + syncs to ModSentinel queue |
| 👁️ Add to Watchlist | Post / Comment | Adds the author to your watchlist |
| ✋ Remove from Watchlist | Post / Comment | Removes the author from your watchlist |

---

## Project Structure

```
modsentinel/
├── src/
│   ├── main.tsx        — Devvit entry point: settings, custom post type, triggers,
│   │                     menu items, scheduler, AppInstall lifecycle
│   ├── types.ts        — ContentScore, SubredditConfig, UserReputation interfaces
│   ├── gemini.ts       — Gemini 2.0 Flash API: prompt construction + response parsing
│   ├── kvStore.ts      — KV store helpers: queue (200-item cap), reputation,
│   │                     watchlist, config reader
│   ├── triggers.ts     — PostCreate + CommentCreate event handlers:
│   │                     watchlist check → score → save → auto-act → reputation update
│   └── dashboard.tsx   — Custom post UI: priority queue, filter tabs, help panel,
│                         mod gate, loading animation
├── ARCHITECTURE.md     — System design, data flow, KV schema
├── LICENSE             — MIT
└── devvit.yaml         — App name + version
```

See [ARCHITECTURE.md](https://github.com/manojmallick/modsentinel/blob/main/ARCHITECTURE.md) for the full system design.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Platform | [Devvit 0.12.24](https://developers.reddit.com) — triggers, KV store, custom posts, Reddit API, scheduler, realtime channels |
| AI | [Gemini 2.0 Flash](https://aistudio.google.com) — fast, free, 1M tokens/month |
| Language | TypeScript 5.3 — strict mode, zero `any` in application code |
| UI | Devvit Blocks — JSX-like layout with pagination, rendered natively in Reddit clients (web + mobile) |

---

## Privacy & Safety

- **No user data leaves Reddit's infrastructure** except content sent to your own Gemini API key
- The Gemini API key is stored as a secret in Devvit app settings (never in KV store or logs)
- The mod queue is gated behind a real-time moderator check — regular users see a lock screen
- Auto-reply is disabled by default to prevent unexpected community-facing behavior
- Watchlist data is stored in your subreddit's KV store, accessible only to the app

---

## FAQ

**Q: Will it cost money?**  
A: No. Gemini 2.0 Flash has a free tier of 1 million tokens/month. A typical post + comment combined is ~200 tokens. That's ~5 000 items/month at zero cost. Subreddits exceeding that can use a paid Gemini key.

**Q: What if Gemini is down or the API key is invalid?**  
A: `scoreContent` returns a safe default of `{0, 0, 0, 0}` on any error. Content is saved to the queue as-is and no auto-actions fire. No content is silently dropped.

**Q: Can I turn off auto-remove but keep the dashboard?**  
A: Yes — set the Auto-remove threshold to **100** in settings. Nothing will ever auto-remove; everything lands in the queue for manual review.

**Q: What's the queue size limit?**  
A: 200 items. New items push old ones out (FIFO after deduplication). Use the **Clear actioned** button regularly to keep the queue focused on pending items.

**Q: Will it catch everything?**  
A: No AI is perfect. ModSentinel is a triage tool that surfaces likely problems — mods still make the final call. The shadow queue exists specifically so mods can review and restore false positives.

---

## License

[MIT](https://github.com/manojmallick/modsentinel/blob/main/LICENSE) — free to use, modify, and deploy on any subreddit.
