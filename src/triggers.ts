import { type TriggerContext } from '@devvit/public-api';
import type * as protos from '@devvit/protos';
import { scoreContent } from './gemini.js';
import {
  saveScore,
  getSubredditConfig,
  getUserReputation,
  recordViolation,
  isOnWatchlist,
} from './kvStore.js';
import type { ContentScore, LiveScoreEvent } from './types.js';

const REALTIME_CHANNEL = 'modsentinel_scores'; // must be [a-zA-Z0-9_] only

/** Fire-and-forget push to all open dashboard windows. Never throws. */
async function broadcastScore(event: LiveScoreEvent, context: TriggerContext): Promise<void> {
  try {
    await context.realtime.send(REALTIME_CHANNEL, event);
  } catch (err) {
    console.log('[ModSentinel] Realtime broadcast failed (non-fatal):', err);
  }
}

const DEFAULT_RULES = ['Be respectful', 'No spam', 'Stay on topic'];

function toPostId(id: string): string {
  return id.startsWith('t3_') ? id : `t3_${id}`;
}
function toCommentId(id: string): string {
  return id.startsWith('t1_') ? id : `t1_${id}`;
}

async function isModerator(
  username: string,
  subredditName: string,
  context: TriggerContext
): Promise<boolean> {
  try {
    for await (const mod of context.reddit.getModerators({ subredditName })) {
      if (mod.username === username) return true;
    }
    return false;
  } catch (err) {
    console.error('[ModSentinel] isModerator check failed:', err);
    return false;
  }
}

export async function handlePostCreate(
  event: protos.PostCreate,
  context: TriggerContext
): Promise<void> {
  console.log('[ModSentinel] PostCreate trigger fired');

  const post = event.post;
  if (!post) {
    console.log('[ModSentinel] No post in event, skipping');
    return;
  }

  const subredditName = event.subreddit?.name ?? '';
  const authorName = event.author?.name ?? 'unknown';

  console.log(`[ModSentinel] New post: "${post.title}" by u/${authorName} in r/${subredditName}`);

  const isMod = await isModerator(authorName, subredditName, context);
  if (isMod) {
    console.log(`[ModSentinel] u/${authorName} is a moderator — will score but skip auto-actions`);
  }

  // ── Watchlist + reputation check ─────────────────────────────────────────
  const [watched, rep] = await Promise.all([
    isOnWatchlist(authorName, context),
    getUserReputation(authorName, context),
  ]);

  const config = await getSubredditConfig(context);
  const rules = config.rules.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config.autoRemoveThreshold;
  const autoFlairThreshold = config.autoFlairThreshold;
  const notifyThreshold = config.notifyThreshold;

  // ── Score content (or override for watchlisted users) ────────────────────
  let scores;
  if (watched) {
    // Watchlisted users: score 85 — triggers flair + mod-mail but NOT auto-remove
    // (default auto-remove threshold is 95). Mods review manually from dashboard.
    console.log(`[ModSentinel] u/${authorName} is on watchlist — flagging at 85`);
    scores = {
      spam: 85,
      violation: 85,
      toxicity: 0,
      overall: 85,
      reasoning: `👁️ u/${authorName} is on the moderator watchlist — flagged for review`,
    };
  } else {
    console.log('[ModSentinel] Calling Gemini API to score post...');
    const contentText = `Title: ${post.title}\n\nBody: ${post.selftext ?? '(no body)'}`;
    scores = await scoreContent(contentText, 'post', rules, context);
  }

  console.log(
    `[ModSentinel] Scores — spam:${scores.spam} violation:${scores.violation} toxicity:${scores.toxicity} overall:${scores.overall}`
  );
  if (scores.reasoning) {
    console.log(`[ModSentinel] Reasoning: ${scores.reasoning}`);
  }

  const contentId = toPostId(post.id);
  // For self/text posts, post.url is undefined in the proto — build it from ID.
  // For link posts, post.url is the external link; store the Reddit post URL instead.
  const postRedditUrl = `https://www.reddit.com/r/${subredditName}/comments/${post.id}/`;

  const contentScore: ContentScore = {
    contentId,
    contentType: 'post',
    authorName,
    title: post.title,
    body: post.selftext ?? '',
    url: postRedditUrl,
    createdAt: Date.now(),
    scores,
    status: 'pending',
    geminiReasoning: scores.reasoning,
    authorViolations: rep.totalViolations,
    authorIsWatched: watched,
  };

  await saveScore(contentScore, context);
  console.log(`[ModSentinel] Saved score for ${contentId}`);

  // Push live update to all open dashboard windows
  await broadcastScore(
    { contentId, overall: scores.overall, contentType: 'post', authorName, autoRemoved: false },
    context
  );

  // Record this scoring event for reputation tracking
  await recordViolation(authorName, false, context);

  if (isMod) {
    console.log('[ModSentinel] Mod post — skipping auto-actions');
    return;
  }

  // ── Auto-remove ───────────────────────────────────────────────────────────
  if (scores.overall >= autoRemoveThreshold) {
    console.log(
      `[ModSentinel] Auto-removing post (score ${scores.overall} >= threshold ${autoRemoveThreshold})`
    );
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('[ModSentinel] Auto-remove failed:', err);
    }
    await saveScore({ ...contentScore, status: 'removed', autoRemoved: true }, context);
    await recordViolation(authorName, true, context);

    // ── Auto-reply with removal reason ──────────────────────────────────────
    if (config.autoReplyOnRemoval && scores.reasoning) {
      try {
        await context.reddit.submitComment({
          id: contentId,
          text: [
            `Your post was automatically removed by **ModSentinel AI**.`,
            ``,
            `**Reason:** ${scores.reasoning}`,
            ``,
            `*If you believe this is a mistake, please contact the moderators.*`,
          ].join('\n'),
        });
      } catch (err) {
        console.log('[ModSentinel] Auto-reply failed (non-fatal):', err);
      }
    }
  } else if (scores.overall >= autoFlairThreshold) {
    console.log(
      `[ModSentinel] Auto-flairing post (score ${scores.overall} >= threshold ${autoFlairThreshold})`
    );
    try {
      await context.reddit.setPostFlair({
        subredditName,
        postId: contentId,
        text: '⚠️ Needs Review',
        cssClass: 'needs-review',
      });
    } catch (err) {
      console.log('[ModSentinel] Flair not configured (non-fatal):', err);
    }
  }

  // ── Mod-mail notification ─────────────────────────────────────────────────
  if (scores.overall >= notifyThreshold) {
    console.log(`[ModSentinel] Sending mod-mail notification (score ${scores.overall})`);
    const repLine =
      rep.totalViolations > 0
        ? `⚠️ **Repeat offender:** u/${authorName} has ${rep.totalViolations} prior violation(s)`
        : '';
    try {
      await context.reddit.sendPrivateMessage({
        to: `/r/${subredditName}`,
        subject: `ModSentinel: High-confidence violation — Score ${scores.overall}/100`,
        text: [
          `**Post:** "${post.title}" by u/${authorName}`,
          `**Score:** ${scores.overall}/100`,
          scores.reasoning ? `**Reason:** ${scores.reasoning}` : '',
          repLine,
          `**Review:** ${post.url}`,
          '',
          `Spam: ${scores.spam} | Violation: ${scores.violation} | Toxicity: ${scores.toxicity}`,
          '',
          `_Adjust thresholds in ModSentinel app settings._`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (err) {
      console.log('[ModSentinel] Mod-mail failed (non-fatal):', err);
    }
  }

  console.log('[ModSentinel] PostCreate handler complete');
}

export async function handleCommentCreate(
  event: protos.CommentCreate,
  context: TriggerContext
): Promise<void> {
  console.log('[ModSentinel] CommentCreate trigger fired');

  const comment = event.comment;
  if (!comment) {
    console.log('[ModSentinel] No comment in event, skipping');
    return;
  }

  const authorName = comment.author ?? 'unknown';
  console.log(`[ModSentinel] New comment by u/${authorName}: "${comment.body.slice(0, 60)}"`);

  // ── Watchlist + reputation check ─────────────────────────────────────────
  const [watched, rep] = await Promise.all([
    isOnWatchlist(authorName, context),
    getUserReputation(authorName, context),
  ]);

  const config = await getSubredditConfig(context);
  const rules = config.rules.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config.autoRemoveThreshold;

  // ── Score content ─────────────────────────────────────────────────────────
  let scores;
  if (watched) {
    console.log(`[ModSentinel] u/${authorName} is on watchlist — flagging at 85`);
    scores = {
      spam: 85,
      violation: 85,
      toxicity: 0,
      overall: 85,
      reasoning: `👁️ u/${authorName} is on the moderator watchlist — flagged for review`,
    };
  } else {
    console.log('[ModSentinel] Calling Gemini API to score comment...');
    scores = await scoreContent(comment.body, 'comment', rules, context);
  }

  console.log(
    `[ModSentinel] Scores — spam:${scores.spam} violation:${scores.violation} toxicity:${scores.toxicity} overall:${scores.overall}`
  );

  const contentId = toCommentId(comment.id);
  const contentScore: ContentScore = {
    contentId,
    contentType: 'comment',
    authorName,
    body: comment.body,
    url: `https://reddit.com${comment.permalink}`,
    createdAt: Date.now(),
    scores,
    status: 'pending',
    geminiReasoning: scores.reasoning,
    authorViolations: rep.totalViolations,
    authorIsWatched: watched,
  };

  await saveScore(contentScore, context);
  console.log(`[ModSentinel] Saved comment score for ${contentId}`);

  // Push live update to all open dashboard windows
  await broadcastScore(
    { contentId, overall: scores.overall, contentType: 'comment', authorName, autoRemoved: false },
    context
  );

  // Record this scoring event
  await recordViolation(authorName, false, context);

  // ── Auto-remove ───────────────────────────────────────────────────────────
  if (scores.toxicity >= 90 || scores.overall >= autoRemoveThreshold) {
    console.log(
      `[ModSentinel] Auto-removing comment (toxicity:${scores.toxicity} overall:${scores.overall})`
    );
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('[ModSentinel] Auto-remove comment failed:', err);
    }
    await saveScore({ ...contentScore, status: 'removed', autoRemoved: true }, context);
    await recordViolation(authorName, true, context);
  }

  console.log('[ModSentinel] CommentCreate handler complete');
}
