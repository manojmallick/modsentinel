import { Devvit, useState, useAsync } from '@devvit/public-api';
import { getQueue, updateStatus } from './kvStore.js';
import type { ContentScore } from './types.js';

type FilterMode = 'all' | 'critical' | 'pending';

function scoreColor(score: number): string {
  if (score >= 80) return '#FF4D6D';
  if (score >= 60) return '#F5A623';
  if (score >= 40) return '#4A90E2';
  return '#27AE60';
}

function formatTimeAgo(timestamp: number): string {
  const diffMin = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <vstack gap="none">
      <hstack alignment="start middle" gap="small">
        <text size="xsmall" color="secondary-plain">
          {label}
        </text>
        <text size="xsmall" weight="bold" color={scoreColor(value)}>
          {String(value)}
        </text>
      </hstack>
      <hstack
        width="100%"
        height="4px"
        backgroundColor="neutral-background-weak"
        cornerRadius="full"
      >
        <hstack
          width={`${value}%`}
          height="4px"
          backgroundColor={scoreColor(value)}
          cornerRadius="full"
        />
      </hstack>
    </vstack>
  );
}

function QueueItem({
  item,
  onApprove,
  onRemove,
  onSpam,
}: {
  key?: string;
  item: ContentScore;
  onApprove: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onSpam: () => void | Promise<void>;
}) {
  const overallColor = scoreColor(item.scores.overall);
  const typeIcon = item.contentType === 'post' ? '📄' : '💬';
  const displayTitle = item.title ?? item.body.slice(0, 60) + '…';

  return (
    <vstack
      padding="medium"
      gap="small"
      backgroundColor="neutral-background"
      cornerRadius="medium"
      border="thin"
      borderColor="neutral-border"
    >
      {/* Header */}
      <hstack alignment="start middle" gap="small">
        <text size="small">{typeIcon}</text>
        <text size="small" weight="bold" grow>
          {displayTitle.length > 50 ? displayTitle.slice(0, 50) + '…' : displayTitle}
        </text>
        <hstack padding="small" backgroundColor={overallColor} cornerRadius="full">
          <text size="xsmall" weight="bold" color="white">
            {String(item.scores.overall)}
          </text>
        </hstack>
      </hstack>

      {/* Meta */}
      <hstack gap="small">
        <text size="xsmall" color="secondary-plain">
          u/{item.authorName} · {formatTimeAgo(item.createdAt)}
          {item.status !== 'pending' ? ` · [${item.status}]` : ''}
        </text>
      </hstack>

      {/* AI reasoning */}
      {item.geminiReasoning ? (
        <hstack padding="small" backgroundColor="warning-background" cornerRadius="small">
          <text size="xsmall" color="warning-plain" wrap>
            ⚠️ {item.geminiReasoning}
          </text>
        </hstack>
      ) : null}

      {/* Score bars */}
      <vstack gap="small">
        <ScoreBar label="Spam" value={item.scores.spam} />
        <ScoreBar label="Rule violation" value={item.scores.violation} />
        <ScoreBar label="Toxicity" value={item.scores.toxicity} />
      </vstack>

      {/* Actions */}
      <hstack gap="small">
        <button size="small" appearance="success" onPress={onApprove} grow>
          ✓ Approve
        </button>
        <button size="small" appearance="destructive" onPress={onRemove} grow>
          🗑 Remove
        </button>
        <button size="small" appearance="secondary" onPress={onSpam} grow>
          🚫 Spam
        </button>
      </hstack>
    </vstack>
  );
}

// Registered as a Devvit custom post type — context is injected by the framework.
export function Dashboard(context: Devvit.Context): JSX.Element {
  // Serialise queue as JSON string because useState requires JSONValue-compatible types
  const [queueJson, setQueueJson] = useState('[]');
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Fetch queue on mount — must call setState only inside `finally`
  useAsync(
    async () => {
      const data = await getQueue(context);
      const sorted = data.sort((a, b) => b.scores.overall - a.scores.overall);
      return JSON.stringify(sorted);
    },
    {
      finally: (data, error) => {
        if (!error && data != null) {
          setQueueJson(data);
        }
        setLoading(false);
      },
    }
  );

  const queue: ContentScore[] = JSON.parse(queueJson);

  function updateQueue(id: string, status: ContentScore['status']): void {
    const updated = queue.map((q) =>
      q.contentId === id ? { ...q, status } : q
    );
    setQueueJson(JSON.stringify(updated));
  }

  async function handleApprove(item: ContentScore): Promise<void> {
    try {
      await context.reddit.approve(item.contentId);
    } catch {
      // best-effort
    }
    await updateStatus(item.contentId, 'approved', context);
    updateQueue(item.contentId, 'approved');
  }

  async function handleRemove(item: ContentScore): Promise<void> {
    try {
      await context.reddit.remove(item.contentId, false);
    } catch {
      // best-effort
    }
    await updateStatus(item.contentId, 'removed', context);
    updateQueue(item.contentId, 'removed');
  }

  async function handleSpam(item: ContentScore): Promise<void> {
    try {
      await context.reddit.remove(item.contentId, true);
    } catch {
      // best-effort
    }
    await updateStatus(item.contentId, 'spam', context);
    updateQueue(item.contentId, 'spam');
  }

  const filteredQueue = queue.filter((item) => {
    if (filter === 'critical') return item.scores.overall >= 80;
    if (filter === 'pending') return item.status === 'pending';
    return true;
  });

  const criticalCount = queue.filter(
    (i) => i.scores.overall >= 80 && i.status === 'pending'
  ).length;

  const counts = {
    all: queue.length,
    critical: queue.filter((i) => i.scores.overall >= 80).length,
    pending: queue.filter((i) => i.status === 'pending').length,
  };

  const filters: FilterMode[] = ['all', 'critical', 'pending'];

  return (
    <blocks height="tall">
      <vstack padding="medium" gap="medium" grow>
        {/* Header */}
        <hstack alignment="start middle" gap="small">
          <text size="xlarge" weight="bold">
            🛡️ ModSentinel
          </text>
          {criticalCount > 0 ? (
            <hstack padding="small" backgroundColor="#FF4D6D" cornerRadius="full">
              <text size="small" weight="bold" color="white">
                {String(criticalCount)} critical
              </text>
            </hstack>
          ) : null}
          <spacer grow />
          <text size="xsmall" color="secondary-plain">
            AI Mod Queue
          </text>
        </hstack>

        {/* Filter tabs */}
        <hstack gap="small">
          {filters.map((f) => (
            <button
              key={f}
              size="small"
              appearance={filter === f ? 'primary' : 'secondary'}
              onPress={() => setFilter(f)}
            >
              {`${f.charAt(0).toUpperCase() + f.slice(1)} ${counts[f]}`}
            </button>
          ))}
        </hstack>

        {/* Queue content */}
        <vstack gap="small" grow>
          {loading ? (
            <vstack alignment="center middle" grow>
              <text color="secondary-plain">Loading queue…</text>
            </vstack>
          ) : filteredQueue.length === 0 ? (
            <vstack alignment="center middle" grow>
              <text size="large">✅</text>
              <text color="secondary-plain">Queue is clear!</text>
            </vstack>
          ) : (
            filteredQueue.slice(0, 10).map((item) => (
              <QueueItem
                key={item.contentId}
                item={item}
                onApprove={() => handleApprove(item)}
                onRemove={() => handleRemove(item)}
                onSpam={() => handleSpam(item)}
              />
            ))
          )}
        </vstack>

        {/* Footer */}
        <text size="xsmall" color="secondary-plain" alignment="center">
          Powered by Gemini 2.0 Flash · ModSentinel v1.0
        </text>
      </vstack>
    </blocks>
  );
}
