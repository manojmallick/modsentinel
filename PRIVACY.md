# ModSentinel — Privacy Policy

_Last updated: May 2026_

## What ModSentinel does with data

ModSentinel is a Reddit moderation tool built on the Devvit platform. It processes post and comment content to help moderators prioritize their review queue.

---

## Data collected and processed

| Data | Purpose | Stored where |
|------|---------|-------------|
| Post title + body | Sent to Google Gemini API for risk scoring | Devvit KV Store (subreddit-scoped) |
| Comment body | Sent to Google Gemini API for risk scoring | Devvit KV Store (subreddit-scoped) |
| Reddit username (author) | Used for reputation tracking and watchlist | Devvit KV Store (subreddit-scoped) |
| Content ID (fullname) | Used to deduplicate the mod queue | Devvit KV Store (subreddit-scoped) |
| AI score + reasoning | Shown in the moderator dashboard | Devvit KV Store (subreddit-scoped) |

**ModSentinel does not collect, store, or transmit:**
- Passwords or authentication tokens
- Private messages or direct messages
- User profile data beyond usernames
- IP addresses or device information
- Any data to third parties other than Google Gemini (see below)

---

## Google Gemini API

Post and comment text is sent to the **Google Gemini 2.0 Flash API** for AI-based content scoring. This is done using the API key provided by the moderator during app setup.

- The API key is stored as a Devvit app secret (encrypted at rest, never logged)
- Google's data handling is governed by the [Google AI Studio Terms of Service](https://ai.google.dev/terms) and [Google Privacy Policy](https://policies.google.com/privacy)
- Content sent to Gemini is used only for scoring and is not retained by ModSentinel

---

## Data retention

All data is stored in Devvit's KV Store, which is scoped to the installed subreddit. The queue holds a maximum of **200 items**. Older items are automatically evicted when new content arrives. Moderators can manually clear actioned items at any time using the "Clear actioned" button.

User reputation records (`modsentinel:rep:<username>`) persist as long as the app is installed on the subreddit.

---

## Who can access the data

- **Subreddit moderators only.** The dashboard verifies moderator status on every load. Regular users see a lock screen and cannot access any queue data.
- **No other parties** have access to the stored data. Devvit's KV Store is subreddit-scoped and not accessible to other apps or users.

---

## Data deletion

To delete all ModSentinel data:
1. Uninstall the app from your subreddit via Mod Tools → Apps
2. Devvit's KV Store data is deleted when the app is uninstalled

---

## Changes to this policy

If this policy changes materially, the "Last updated" date will be updated. Continued use of the app after changes constitutes acceptance of the revised policy.

---

## Contact

For privacy questions or data removal requests, open an issue at [github.com/manojmallick/modsentinel](https://github.com/manojmallick/modsentinel/issues).
