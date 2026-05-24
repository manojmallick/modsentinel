import { type TriggerContext } from '@devvit/public-api';
import type * as protos from '@devvit/protos';
import { scoreContent } from './gemini.js';
import { saveScore, getSubredditConfig } from './kvStore.js';
import type { ContentScore } from './types.js';

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

  const config = await getSubredditConfig(context);
  const rules = config?.rules?.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config?.autoRemoveThreshold ?? 95;
  const autoFlairThreshold = config?.autoFlairThreshold ?? 80;
  const notifyThreshold = config?.notifyThreshold ?? 90;

  console.log('[ModSentinel] Calling Gemini API to score post...');
  const contentText = `Title: ${post.title}\n\nBody: ${post.selftext ?? '(no body)'}`;
  const scores = await scoreContent(contentText, 'post', rules, context);

  console.log(
    `[ModSentinel] Scores — spam:${scores.spam} violation:${scores.violation} toxicity:${scores.toxicity} overall:${scores.overall}`
  );
  if (scores.reasoning) {
    console.log(`[ModSentinel] Reasoning: ${scores.reasoning}`);
  }

  const contentId = toPostId(post.id);
  const contentScore: ContentScore = {
    contentId,
    contentType: 'post',
    authorName,
    title: post.title,
    body: post.selftext ?? '',
    url: post.url,
    createdAt: Date.now(),
    scores,
    status: 'pending',
    geminiReasoning: scores.reasoning,
  };

  await saveScore(contentScore, context);
  console.log(`[ModSentinel] Saved score for ${contentId}`);

  if (isMod) {
    console.log('[ModSentinel] Mod post — skipping auto-actions');
    return;
  }

  if (scores.overall >= autoRemoveThreshold) {
    console.log(`[ModSentinel] Auto-removing post (score ${scores.overall} >= threshold ${autoRemoveThreshold})`);
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('[ModSentinel] Auto-remove failed:', err);
    }
    await saveScore({ ...contentScore, status: 'removed' }, context);
  } else if (scores.overall >= autoFlairThreshold) {
    console.log(`[ModSentinel] Auto-flairing post (score ${scores.overall} >= threshold ${autoFlairThreshold})`);
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

  if (scores.overall >= notifyThreshold) {
    console.log(`[ModSentinel] Sending mod-mail notification (score ${scores.overall})`);
    try {
      await context.reddit.sendPrivateMessage({
        to: `/r/${subredditName}`,
        subject: `ModSentinel: High-confidence violation — Score ${scores.overall}/100`,
        text: [
          `**Post:** "${post.title}" by u/${authorName}`,
          `**Score:** ${scores.overall}/100`,
          scores.reasoning ? `**Reason:** ${scores.reasoning}` : '',
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

  console.log(`[ModSentinel] New comment by u/${comment.author}: "${comment.body.slice(0, 60)}"`);

  const config = await getSubredditConfig(context);
  const rules = config?.rules?.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config?.autoRemoveThreshold ?? 95;

  console.log('[ModSentinel] Calling Gemini API to score comment...');
  const scores = await scoreContent(comment.body, 'comment', rules, context);

  console.log(
    `[ModSentinel] Scores — spam:${scores.spam} violation:${scores.violation} toxicity:${scores.toxicity} overall:${scores.overall}`
  );

  const contentId = toCommentId(comment.id);
  const contentScore: ContentScore = {
    contentId,
    contentType: 'comment',
    authorName: comment.author,
    body: comment.body,
    url: `https://reddit.com${comment.permalink}`,
    createdAt: Date.now(),
    scores,
    status: 'pending',
    geminiReasoning: scores.reasoning,
  };

  await saveScore(contentScore, context);
  console.log(`[ModSentinel] Saved comment score for ${contentId}`);

  if (scores.toxicity >= 90 || scores.overall >= autoRemoveThreshold) {
    console.log(`[ModSentinel] Auto-removing comment (toxicity:${scores.toxicity} overall:${scores.overall})`);
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('[ModSentinel] Auto-remove comment failed:', err);
    }
    await saveScore({ ...contentScore, status: 'removed' }, context);
  }

  console.log('[ModSentinel] CommentCreate handler complete');
}
