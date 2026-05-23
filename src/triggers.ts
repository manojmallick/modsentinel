import { type TriggerContext } from '@devvit/public-api';
import type * as protos from '@devvit/protos';
import { scoreContent } from './gemini.js';
import { saveScore, getSubredditConfig } from './kvStore.js';
import type { ContentScore } from './types.js';

const DEFAULT_RULES = ['Be respectful', 'No spam', 'Stay on topic'];

// PostV2.id / CommentV2.id from proto events are base IDs without the t3_/t1_ prefix.
// Normalise so KV store IDs always match the full thing IDs used by menu-item targetId.
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
  } catch {
    return false;
  }
}

export async function handlePostCreate(
  event: protos.PostCreate,
  context: TriggerContext
): Promise<void> {
  const post = event.post;
  if (!post) return;

  const subredditName = event.subreddit?.name ?? '';
  // Username lives on event.author.name (UserV2), not PostV2
  const authorName = event.author?.name ?? 'unknown';

  if (await isModerator(authorName, subredditName, context)) return;

  const config = await getSubredditConfig(context);
  const rules = config?.rules?.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config?.autoRemoveThreshold ?? 95;
  const autoFlairThreshold = config?.autoFlairThreshold ?? 80;
  const notifyThreshold = config?.notifyThreshold ?? 90;

  // Body is in `selftext` (proto field name), not `body`
  const contentText = `Title: ${post.title}\n\nBody: ${post.selftext ?? '(no body)'}`;
  const scores = await scoreContent(contentText, 'post', rules, context);

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

  if (scores.overall >= autoRemoveThreshold) {
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('ModSentinel: auto-remove post failed', err);
    }
    await saveScore({ ...contentScore, status: 'removed' }, context);
  } else if (scores.overall >= autoFlairThreshold) {
    try {
      await context.reddit.setPostFlair({
        subredditName,
        postId: contentId,
        text: '⚠️ Needs Review',
        cssClass: 'needs-review',
      });
    } catch {
      // Flair not configured — non-fatal
    }
  }

  if (scores.overall >= notifyThreshold) {
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
    } catch {
      // Mod mail may fail — non-fatal
    }
  }
}

export async function handleCommentCreate(
  event: protos.CommentCreate,
  context: TriggerContext
): Promise<void> {
  const comment = event.comment;
  if (!comment) return;

  const config = await getSubredditConfig(context);
  const rules = config?.rules?.length ? config.rules : DEFAULT_RULES;
  const autoRemoveThreshold = config?.autoRemoveThreshold ?? 95;

  const scores = await scoreContent(comment.body, 'comment', rules, context);
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

  if (scores.toxicity >= 90 || scores.overall >= autoRemoveThreshold) {
    try {
      await context.reddit.remove(contentId, false);
    } catch (err) {
      console.error('ModSentinel: auto-remove comment failed', err);
    }
    await saveScore({ ...contentScore, status: 'removed' }, context);
  }
}
