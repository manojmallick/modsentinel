# ModSentinel — Demo & Screenshots

> Live on [`r/modsentinel_testing`](https://www.reddit.com/r/modsentinel_testing/comments/1tm9nud/modsentinel_ai_mod_queue/) · App page: [developers.reddit.com/apps/modsentinel-ai](https://developers.reddit.com/apps/modsentinel-ai)

---

## 1. Dashboard — Empty State
Clean start. Queue is empty, health is 100%, filter tabs ready.

![Dashboard empty state](screens/01-dashboard-empty.png)

---

## 2. Mod Gate — Non-Moderator Lock Screen
Regular users who open the dashboard see a lock screen. The queue is never exposed to the public.

![Mod gate lock screen](screens/02-mod-gate-locked.png)

---

## 3. AI Scoring in Action — Approve / Remove / Spam
Gemini 2.0 Flash scores a post in under 3 seconds. Score bars, AI reasoning, and one-tap action buttons.

![AI scoring with action buttons](screens/03-ai-scoring-approve-remove.png)

---

## 4. Context Menu Actions
Right-click any post or comment → ModSentinel actions appear inline. No need to open the dashboard.

![Context menu with ModSentinel Approve and Remove](screens/04-context-menu-actions.png)

---

## 5. First Item Scored
The dashboard immediately after the first post is created and scored. Priority sorted, pending items first.

![First item scored in queue](screens/05-first-item-scored.png)

---

## 6. Queue with Mixed Scores
Multiple posts scored — spam (🔴 81), clean posts (🟢 0). Sorted by priority automatically.

![Queue with mixed scores](screens/06-queue-mixed-scores.png)

---

## 7. Daily Mod-Mail Report
Automated 9 AM UTC summary sent to subreddit mod-mail: items scored, auto-removed, average risk, community health.

![Daily mod-mail summary report](screens/07-daily-modmail-report.png)

---

## 8. Watchlist — Flagged User
A watchlisted user's post is auto-flagged at score 85 with the 👁 WATCHED badge and a red border — no Gemini call needed.

![Watchlist flagged post](screens/08-watchlist-flagged.png)

---

## 9. Devvit App Page
The app as it appears on `developers.reddit.com` — in 2 communities, README rendered, Add to community button.

![Devvit app page](screens/09-devvit-app-page.png)

---

## 10. In-App Help Guide
The `?` button opens a built-in reference panel covering score colors, filter tabs, actions, watchlist, and daily reports.

![In-app help guide](screens/10-help-guide.png)

---

## 11. Watched Tab
The 👁 Watched filter tab shows all content from monitored users. "Watching: u/Flat_Willingness_927" shown in the context hint.

![Watched tab](screens/11-watched-tab.png)

---

## 12. Queue with WATCHED Badges
Multiple items with dark red WATCHED badges — each border highlighted in red, easy to spot at a glance.

![Queue with watched badges](screens/12-queue-watched-badges.png)

---

## 13. Clean Mobile View — 3 Items
Mobile Reddit app rendering. Header fits with `🏥 80%`, `?`, `↻`. Filter tabs show icon + count.

![Mobile queue 3 items](screens/13-queue-3items-mobile.png)

---

## 14. Desktop — Pagination Page 1 of 3
Desktop web view with 5 items, showing page 1/3. `← Prev` disabled, `Next →` active.

![Desktop pagination page 1](screens/14-desktop-pagination-p1.png)

---

## 15. Desktop — Pagination Page 2 of 3
Page 2 with `← Prev` and `Next →` both active. Items with ⚠️ 5 prior reputation badges.

![Desktop pagination page 2](screens/15-desktop-pagination-p2.png)

---

## 16. Mobile — Pagination Page 2 of 2
Mobile app showing pagination bar at the bottom: `← Prev  2 / 2  Next →`. Clean, fits within viewport.

![Mobile pagination page 2](screens/16-mobile-pagination-p2.jpeg)

---

## 17. Mobile — Full Queue Overview
Mobile overview showing All 5 tab, filter tabs with icon counts, reputation badges, and footer with item count.

![Mobile full queue overview](screens/17-mobile-full-queue.jpeg)

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Time to score a post | < 3 seconds |
| Gemini free tier | 1M tokens/month (~5,000 items) |
| Queue capacity | 200 items |
| Items per page | 2 (desktop + mobile) |
| Auto-remove default | Score ≥ 95 |
| Auto-flair default | Score ≥ 80 |
| Mod-mail alert default | Score ≥ 90 |
| Watchlist flag score | 85 (flags without auto-removing) |
| Daily report time | 9:00 AM UTC |
