# 🛡️ ModSentinel

**AI-powered mod queue for Reddit** — every post and comment is scored by Gemini 2.0 Flash before a moderator reads it.

Built for the [Reddit Mod Tools Hackathon 2026](https://devpost.com) on [Devvit](https://developers.reddit.com).

---

## What it does

ModSentinel runs silently in the background. The moment a post or comment is created, it:

1. Sends the content to Gemini 2.0 Flash for analysis
2. Returns three scores (0–100 each): **Spam**, **Rule violation**, **Toxicity**
3. Computes an **Overall priority score** (violation × 0.5 + spam × 0.3 + toxicity × 0.2)
4. Stores the result in Devvit KV Store
5. Auto-acts if thresholds are crossed (remove, flair, mod-mail)

Mods open the **ModSentinel dashboard** — a custom post pinned to the subreddit — to see every item sorted by priority score with one-tap Approve / Remove / Spam actions.

---

## Features

| Feature | Detail |
|---------|--------|
| Background scoring | Runs on every PostCreate + CommentCreate trigger |
| Priority queue | Dashboard sorted by overall score, highest first |
| Auto-remove | Configurable threshold (default 95/100) |
| Auto-flair | "⚠️ Needs Review" flair at configurable threshold (default 80) |
| Mod-mail alerts | Instant notification for high-confidence violations |
| AI reasoning | One-sentence explanation for any item scoring above 50 |
| Subreddit-aware | Scores against YOUR subreddit rules, not generic guidelines |
| Free to operate | Gemini free tier covers ~1M tokens/month |
| One-tap actions | Approve, Remove, Spam directly from the dashboard |
| Filter tabs | All / Critical / Pending views |

---

## Installation

### Prerequisites
- A Reddit account with moderator access to a subreddit
- A free [Gemini API key](https://aistudio.google.com) (1M tokens/month free)

### Steps

```bash
# 1. Install Devvit CLI
npm install -g devvit

# 2. Authenticate with Reddit
devvit login

# 3. Upload to Devvit
devvit upload

# 4. Playtest on your test subreddit
devvit playtest r/your-test-subreddit

# 5. Publish
devvit publish
```

After installing on a subreddit, go to **Subreddit menu → 🛡️ ModSentinel — Open Dashboard** to create the dashboard post.

In the app settings, add:
- **Gemini API Key** (required)
- **Auto-remove threshold** (default: 95)
- **Auto-flair threshold** (default: 80)
- **Mod-mail notify threshold** (default: 90)
- **Subreddit rules** (one per line — paste from your sub's rules page)

---

## Project structure

```
src/
├── main.tsx        — Devvit entry point: settings, custom post, triggers, menu items
├── types.ts        — ContentScore and SubredditConfig interfaces
├── gemini.ts       — Gemini 2.0 Flash API integration
├── kvStore.ts      — Persistent queue (200-item cap, deduped by content ID)
├── triggers.ts     — PostCreate + CommentCreate handlers
└── dashboard.tsx   — Custom post UI component
```

---

## Scoring model

```
Overall = violation × 0.5 + spam × 0.3 + toxicity × 0.2

Spam:      Promotional content, repetitive posts, fake engagement, crypto schemes
Violation: Breaks one or more of YOUR subreddit rules
Toxicity:  Hostile, harassing, or hateful language directed at people

Score range: 0 (clean) → 100 (critical)
Color:       Green <40 | Blue 40-59 | Amber 60-79 | Red 80+
```

---

## Time savings (50K WAU subreddit)

```
Without ModSentinel:  425 items/day × 40 sec each = 283 min/day per mod team
With ModSentinel:     ~85 items need review × 40 sec = 57 min/day

Time saved: ~226 min/day (3.8 hours) per mod team
Per year:   ~1,032 hours = 43 full work days returned to mods
```

---

## Tech stack

- **[Devvit](https://developers.reddit.com)** — Reddit's developer platform (triggers, KV store, custom posts, Reddit API)
- **[Gemini 2.0 Flash](https://aistudio.google.com)** — content scoring
- **TypeScript** — fully typed codebase

---

## License

MIT
