import { Devvit } from '@devvit/public-api';
import { handlePostCreate, handleCommentCreate } from './triggers.js';
import { Dashboard } from './dashboard.js';
import { updateStatus, getQueue, addToWatchlist, removeFromWatchlist } from './kvStore.js';

console.log('[ModSentinel] App module loaded');

// Scheduler jobs receive JobContext (no UI), which Devvit defines as:
//   Omit<Devvit.Context, 'ui' | 'dimensions' | 'modLog' | 'uiEnvironment'>
type SchedulerContext = Omit<Devvit.Context, 'ui' | 'dimensions' | 'modLog' | 'uiEnvironment'>;

Devvit.configure({
  redditAPI: true,
  kvStore: true,
  http: true,
  media: false,
});

// ─── App Settings ────────────────────────────────────────────────────────────

Devvit.addSettings([
  {
    type: 'string',
    name: 'geminiApiKey',
    label: 'Gemini API Key',
    helpText: 'Get a free key at aistudio.google.com (1M tokens/month free)',
    isSecret: true,
    scope: 'app',
  },
  {
    type: 'number',
    name: 'autoRemoveThreshold',
    label: 'Auto-remove threshold (0–100)',
    helpText:
      'Content scoring above this is automatically removed. Default: 95. Set to 100 to disable.',
    defaultValue: 95,
    scope: 'installation',
  },
  {
    type: 'number',
    name: 'autoFlairThreshold',
    label: 'Auto-flair threshold (0–100)',
    helpText: 'Content above this score gets a "Needs Review" flair. Default: 80.',
    defaultValue: 80,
    scope: 'installation',
  },
  {
    type: 'number',
    name: 'notifyThreshold',
    label: 'Mod-mail notify threshold (0–100)',
    helpText: 'Content above this score triggers an instant mod-mail alert. Default: 90.',
    defaultValue: 90,
    scope: 'installation',
  },
  {
    type: 'paragraph',
    name: 'subredditRules',
    label: 'Subreddit rules (one per line)',
    helpText:
      'ModSentinel scores every post and comment against these rules. Copy them from your sub rules page.',
    scope: 'installation',
  },
  {
    type: 'select',
    name: 'autoReplyOnRemoval',
    label: 'Auto-reply on removal',
    helpText:
      'When content is auto-removed, post a mod comment explaining the AI reasoning. Default: Disabled.',
    options: [
      { label: 'Disabled', value: 'disabled' },
      { label: 'Enabled — post removal reason as comment', value: 'enabled' },
    ],
    defaultValue: ['disabled'],
    multiSelect: false,
    scope: 'installation',
  },
]);

// ─── Custom Post Type ─────────────────────────────────────────────────────────

Devvit.addCustomPostType({
  name: 'ModSentinel Dashboard',
  description: 'AI-powered mod queue — sorted by Gemini priority score.',
  height: 'tall',
  render: Dashboard,
});

// ─── Scheduler: Daily Summary ─────────────────────────────────────────────────

Devvit.addSchedulerJob({
  name: 'daily-summary',
  onRun: async (_event, context) => {
    try {
      await sendDailySummary(context);
    } catch (err) {
      console.error('[ModSentinel] Daily summary job failed:', err);
    }
  },
});

// ─── App Lifecycle: Schedule daily summary on install ─────────────────────────

Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event, context) => {
    try {
      await context.scheduler.runJob({
        name: 'daily-summary',
        cron: '0 9 * * *', // 9:00 AM UTC every day
      });
      console.log('[ModSentinel] Daily summary job scheduled (9 AM UTC)');
    } catch (err) {
      console.error('[ModSentinel] Failed to schedule daily summary:', err);
    }
  },
});

// ─── Triggers ────────────────────────────────────────────────────────────────

Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: handlePostCreate,
});

Devvit.addTrigger({
  event: 'CommentCreate',
  onEvent: handleCommentCreate,
});

// ─── Menu: Open Dashboard ────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '🛡️ ModSentinel — Open Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      title: '🛡️ ModSentinel — AI Mod Queue',
      subredditName: subreddit.name,
      preview: (
        <vstack alignment="center middle" height="100%">
          <text size="large" weight="bold">
            🛡️ ModSentinel
          </text>
          <text color="secondary-plain">Loading mod queue…</text>
        </vstack>
      ),
    });
    context.ui.showToast('ModSentinel dashboard created!');
  },
});

// ─── Menu: Approve ───────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '✅ ModSentinel: Approve',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    await context.reddit.approve(event.targetId);
    await updateStatus(event.targetId, 'approved', context);
    context.ui.showToast('Approved and marked in ModSentinel');
  },
});

// ─── Menu: Remove ────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '🗑️ ModSentinel: Remove',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    await context.reddit.remove(event.targetId, false);
    await updateStatus(event.targetId, 'removed', context);
    context.ui.showToast('Removed and marked in ModSentinel');
  },
});

// ─── Menu: Spam ──────────────────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '🚫 ModSentinel: Mark as Spam',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    await context.reddit.remove(event.targetId, true);
    await updateStatus(event.targetId, 'spam', context);
    context.ui.showToast('Marked as spam in ModSentinel');
  },
});

// ─── Menu: Add to Watchlist ───────────────────────────────────────────────────

Devvit.addMenuItem({
  label: '👁️ ModSentinel: Add to Watchlist',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    try {
      const targetId = event.targetId;
      let authorName: string | undefined;

      if (targetId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(targetId);
        authorName = post.authorName;
      } else {
        const comment = await context.reddit.getCommentById(targetId);
        authorName = comment.authorName;
      }

      if (!authorName || authorName === '[deleted]') {
        context.ui.showToast('Cannot watch deleted/unknown user');
        return;
      }

      await addToWatchlist(authorName, context);
      context.ui.showToast(`👁️ u/${authorName} added to watchlist — future posts will be flagged`);
    } catch (err) {
      console.error('[ModSentinel] Add to watchlist failed:', err);
      context.ui.showToast('Failed to add to watchlist');
    }
  },
});

// ─── Menu: Remove from Watchlist ─────────────────────────────────────────────

Devvit.addMenuItem({
  label: '✋ ModSentinel: Remove from Watchlist',
  location: ['post', 'comment'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    try {
      const targetId = event.targetId;
      let authorName: string | undefined;

      if (targetId.startsWith('t3_')) {
        const post = await context.reddit.getPostById(targetId);
        authorName = post.authorName;
      } else {
        const comment = await context.reddit.getCommentById(targetId);
        authorName = comment.authorName;
      }

      if (!authorName || authorName === '[deleted]') {
        context.ui.showToast('Cannot identify user');
        return;
      }

      await removeFromWatchlist(authorName, context);
      context.ui.showToast(`✋ u/${authorName} removed from watchlist`);
    } catch (err) {
      console.error('[ModSentinel] Remove from watchlist failed:', err);
      context.ui.showToast('Failed to update watchlist');
    }
  },
});

// ─── Daily Summary Helper ─────────────────────────────────────────────────────

async function sendDailySummary(context: SchedulerContext): Promise<void> {
  const queue = await getQueue(context);

  let subredditName: string;
  try {
    const subreddit = await context.reddit.getCurrentSubreddit();
    subredditName = subreddit.name;
  } catch {
    console.error('[ModSentinel] Could not get subreddit for daily summary');
    return;
  }

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const todayItems = queue.filter((i) => i.createdAt >= oneDayAgo);
  const totalScored = todayItems.length;

  if (totalScored === 0) {
    console.log('[ModSentinel] No items in last 24h — skipping daily summary');
    return;
  }

  const autoRemoved = todayItems.filter((i) => i.autoRemoved === true).length;
  const modActioned = todayItems.filter(
    (i) => (i.status === 'removed' || i.status === 'spam' || i.status === 'approved') && !i.autoRemoved
  ).length;
  const pending = todayItems.filter((i) => i.status === 'pending').length;
  const avgScore = Math.round(
    todayItems.reduce((s, i) => s + i.scores.overall, 0) / totalScored
  );
  const cleanCount = todayItems.filter((i) => i.scores.overall < 40).length;
  const healthPct = Math.round((cleanCount / totalScored) * 100);

  // Top violators (removed/spam)
  const violatorMap = new Map<string, number>();
  todayItems.forEach((i) => {
    if (i.status === 'removed' || i.status === 'spam') {
      violatorMap.set(i.authorName, (violatorMap.get(i.authorName) ?? 0) + 1);
    }
  });
  const topViolators = Array.from(violatorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [
    `📊 **ModSentinel Daily Summary** — ${date}`,
    ``,
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Items scored | ${totalScored} |`,
    `| Auto-removed by AI | ${autoRemoved} |`,
    `| Mod-actioned | ${modActioned} |`,
    `| Awaiting review | ${pending} |`,
    `| Average risk score | ${avgScore}/100 |`,
    ``,
    `🏥 **Community Health:** ${healthPct}% of content was clean`,
    ``,
  ];

  if (topViolators.length > 0) {
    lines.push('**Top Risk Users (last 24h):**');
    topViolators.forEach(([name, count]) => {
      lines.push(`• u/${name} — ${count} item(s) removed`);
    });
    lines.push('');
  }

  lines.push(
    `*Powered by ModSentinel + Gemini 2.0 Flash*`,
    `*Adjust settings: r/${subredditName} → Mod Tools → Apps → ModSentinel*`
  );

  await context.reddit.sendPrivateMessage({
    to: `/r/${subredditName}`,
    subject: `📊 ModSentinel Daily Report — ${totalScored} items scored, health ${healthPct}%`,
    text: lines.join('\n'),
  });

  console.log(`[ModSentinel] Daily summary sent to r/${subredditName}`);
}

export default Devvit;
