import { Devvit } from '@devvit/public-api';
import { handlePostCreate, handleCommentCreate } from './triggers.js';
import { Dashboard } from './dashboard.js';
import { updateStatus } from './kvStore.js';

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
    scope: 'installation',
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
]);

// ─── Custom Post Type ─────────────────────────────────────────────────────────
// The Dashboard function is the render component for the custom post.

Devvit.addCustomPostType({
  name: 'ModSentinel Dashboard',
  description: 'AI-powered mod queue — sorted by Gemini priority score.',
  height: 'tall',
  render: Dashboard,
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

export default Devvit;
