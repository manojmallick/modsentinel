import { Devvit, useState, useAsync, useInterval, useChannel } from '@devvit/public-api';
import { getQueue, updateStatus, clearActioned, getWatchlist } from './kvStore.js';
import type { ContentScore, LiveScoreEvent } from './types.js';

const REALTIME_CHANNEL = 'modsentinel:scores';

type FilterMode = 'all' | 'critical' | 'pending' | 'shadow' | 'watched';

function scoreColor(score: number): string {
  if (score >= 80) return '#FF4D6D';
  if (score >= 60) return '#F5A623';
  if (score >= 40) return '#4A90E2';
  return '#27AE60';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'WARNING';
  if (score >= 40) return 'LOW';
  return 'CLEAN';
}

function healthColor(pct: number): string {
  if (pct >= 80) return '#27AE60';
  if (pct >= 60) return '#F5A623';
  return '#FF4D6D';
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
          width={`${Math.min(value, 100)}%`}
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
  onNavigate,
}: {
  key?: string;
  item: ContentScore;
  onApprove: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onSpam: () => void | Promise<void>;
  onNavigate: () => void;
}) {
  const overallColor = scoreColor(item.scores.overall);
  const typeIcon = item.contentType === 'post' ? '📄' : '💬';
  const rawTitle = item.title ?? item.body;
  const displayTitle = rawTitle.length > 55 ? rawTitle.slice(0, 55) + '…' : rawTitle;
  const isActioned = item.status !== 'pending';
  const isWatched = item.authorIsWatched === true;
  const violations = item.authorViolations ?? 0;
  const isShadow = item.autoRemoved === true;

  return (
    <vstack
      padding="medium"
      gap="small"
      backgroundColor={isActioned ? 'neutral-background-weak' : 'neutral-background'}
      cornerRadius="medium"
      border="thin"
      borderColor={
        isWatched
          ? 'red-background'
          : isActioned
          ? 'transparent'
          : overallColor === '#FF4D6D'
          ? 'red-background'
          : 'neutral-border'
      }
    >
      {/* Header row: icon + title + score badge */}
      <hstack alignment="start middle" gap="small">
        <text size="small">{typeIcon}</text>
        <text size="small" weight="bold" grow color={isActioned ? 'secondary-plain' : 'neutral-content'}>
          {displayTitle}
        </text>
        <vstack alignment="end" gap="none">
          <hstack
            padding="xsmall"
            backgroundColor={isActioned ? 'neutral-background-weak' : overallColor}
            cornerRadius="full"
          >
            <text size="xsmall" weight="bold" color={isActioned ? 'secondary-plain' : 'white'}>
              {String(item.scores.overall)}
            </text>
          </hstack>
        </vstack>
      </hstack>

      {/* Meta row: author · badges · time · label · status */}
      <hstack gap="small" alignment="start middle">
        <text size="xsmall" color="secondary-plain">
          u/{item.authorName}
        </text>

        {/* Watchlist badge */}
        {isWatched ? (
          <hstack padding="xsmall" backgroundColor="red-background" cornerRadius="full">
            <text size="xsmall" weight="bold" color="white">
              👁 WATCHED
            </text>
          </hstack>
        ) : null}

        {/* Repeat offender badge */}
        {violations > 0 && !isWatched ? (
          <hstack padding="xsmall" backgroundColor="orangered-background" cornerRadius="full">
            <text size="xsmall" weight="bold" color="white">
              ⚠️ {String(violations)} prior
            </text>
          </hstack>
        ) : null}

        {/* Shadow (auto-removed) badge */}
        {isShadow && isActioned ? (
          <hstack padding="xsmall" backgroundColor="neutral-background-strong" cornerRadius="full">
            <text size="xsmall" color="secondary-plain">
              🤖 AUTO
            </text>
          </hstack>
        ) : null}

        <text size="xsmall" color="secondary-plain">·</text>
        <text size="xsmall" color="secondary-plain">
          {formatTimeAgo(item.createdAt)}
        </text>
        <spacer grow />
        {isActioned ? (
          <text size="xsmall" color="secondary-plain">
            [{item.status.toUpperCase()}]
          </text>
        ) : (
          <text size="xsmall" weight="bold" color={scoreColor(item.scores.overall)}>
            {scoreLabel(item.scores.overall)}
          </text>
        )}
      </hstack>

      {/* AI reasoning (only for flagged items) */}
      {item.geminiReasoning && !isActioned ? (
        <hstack padding="small" backgroundColor="neutral-background-strong" cornerRadius="small">
          <text size="xsmall" color="orangered-plain" wrap>
            ⚠️ {item.geminiReasoning}
          </text>
        </hstack>
      ) : null}

      {/* Score bars — only for non-actioned items */}
      {!isActioned ? (
        <vstack gap="small">
          <ScoreBar label="Spam" value={item.scores.spam} />
          <ScoreBar label="Rule violation" value={item.scores.violation} />
          <ScoreBar label="Toxicity" value={item.scores.toxicity} />
        </vstack>
      ) : null}

      {/* Actions */}
      {!isActioned ? (
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
          <button size="small" appearance="bordered" onPress={onNavigate}>
            ↗ View
          </button>
        </hstack>
      ) : (
        <hstack>
          <button size="small" appearance="bordered" onPress={onNavigate}>
            ↗ View Post
          </button>
        </hstack>
      )}
    </vstack>
  );
}

// Registered as a Devvit custom post type — context is injected by the framework.
export function Dashboard(context: Devvit.Context): JSX.Element {
  const [queueJson, setQueueJson] = useState('[]');
  const [watchlistJson, setWatchlistJson] = useState('[]');
  const [healthScore, setHealthScore] = useState(100);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [clearing, setClearing] = useState(false);
  const [isMod, setIsMod] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // ── Loading animation ────────────────────────────────────────────────────
  const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const spinnerTicker = useInterval(() => {
    setSpinnerFrame((f) => (f + 1) % SPINNER.length);
  }, 100);
  // Drive the interval based on loading state
  if (loading) {
    spinnerTicker.start();
  } else {
    spinnerTicker.stop();
  }

  // ── Realtime live updates ─────────────────────────────────────────────────
  const [newItemCount, setNewItemCount] = useState(0);
  const [peakNewScore, setPeakNewScore] = useState(0);

  const liveChannel = useChannel<LiveScoreEvent>({
    name: REALTIME_CHANNEL,
    onMessage(msg) {
      setNewItemCount((c) => c + 1);
      setPeakNewScore((s) => Math.max(s, msg.overall));
    },
  });

  // Subscribe once mod status is confirmed — non-mods stay unsubscribed
  if (isMod && !loading) {
    liveChannel.subscribe();
  }

  // Fetch queue + watchlist + verify mod status — re-runs whenever refreshKey changes
  useAsync(
    async () => {
      // Run the mod check, queue fetch, and watchlist fetch in parallel
      const [currentUser, data, watchlist, subreddit] = await Promise.all([
        context.reddit.getCurrentUser(),
        getQueue(context),
        getWatchlist(context),
        context.reddit.getCurrentSubreddit(),
      ]);

      // Verify the viewing user is actually a moderator
      let modConfirmed = false;
      if (currentUser) {
        try {
          for await (const mod of context.reddit.getModerators({
            subredditName: subreddit.name,
          })) {
            if (mod.username === currentUser.username) {
              modConfirmed = true;
              break;
            }
          }
        } catch (err) {
          console.error('[ModSentinel] Mod-check failed:', err);
          // Fail closed — if we can't verify, deny access
          modConfirmed = false;
        }
      }

      // Non-mods get an empty payload; the UI will show the lock screen
      if (!modConfirmed) {
        return JSON.stringify({ queue: [], watchlist: [], health: 100, isMod: false });
      }

      const sorted = data.sort((a, b) => {
        // Pending first, then sort by overall score descending
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return b.scores.overall - a.scores.overall;
      });

      // Compute community health score from the full queue
      const total = sorted.length;
      const cleanCount = sorted.filter((i) => i.scores.overall < 40).length;
      const health = total > 0 ? Math.round((cleanCount / total) * 100) : 100;

      return JSON.stringify({ queue: sorted, watchlist, health, isMod: true });
    },
    {
      depends: refreshKey,
      finally: (data, error) => {
        if (!error && data != null) {
          try {
            const parsed = JSON.parse(data) as {
              queue: ContentScore[];
              watchlist: string[];
              health: number;
              isMod: boolean;
            };
            setIsMod(parsed.isMod);
            setQueueJson(JSON.stringify(parsed.queue));
            setWatchlistJson(JSON.stringify(parsed.watchlist));
            setHealthScore(parsed.health);
            setLastUpdated(Date.now());
          } catch {
            // parse failure — keep stale data
          }
        }
        setLoading(false);
      },
    }
  );

  const queue: ContentScore[] = JSON.parse(queueJson);
  const watchlist: string[] = JSON.parse(watchlistJson);

  function updateQueue(id: string, status: ContentScore['status']): void {
    const updated = queue.map((q) => (q.contentId === id ? { ...q, status } : q));
    setQueueJson(JSON.stringify(updated));
  }

  async function handleApprove(item: ContentScore): Promise<void> {
    try {
      await context.reddit.approve(item.contentId);
    } catch {
      // best-effort — post may already be approved
    }
    await updateStatus(item.contentId, 'approved', context);
    updateQueue(item.contentId, 'approved');
    setStatusMsg('✓ Approved');
  }

  async function handleRemove(item: ContentScore): Promise<void> {
    try {
      await context.reddit.remove(item.contentId, false);
    } catch {
      // best-effort
    }
    await updateStatus(item.contentId, 'removed', context);
    updateQueue(item.contentId, 'removed');
    setStatusMsg('🗑 Removed');
  }

  async function handleSpam(item: ContentScore): Promise<void> {
    try {
      await context.reddit.remove(item.contentId, true);
    } catch {
      // best-effort
    }
    await updateStatus(item.contentId, 'spam', context);
    updateQueue(item.contentId, 'spam');
    setStatusMsg('🚫 Marked as spam');
  }

  function handleNavigate(item: ContentScore): void {
    // Always construct a canonical Reddit URL from the content ID so we never
    // try to navigate to an external link (link-post `url` can be off-Reddit).
    const bareId = item.contentId.replace(/^t[13]_/, '');
    const redditUrl =
      item.contentType === 'post'
        ? `https://www.reddit.com/comments/${bareId}/`
        : item.url; // comment URLs are already stored as reddit.com permalinks
    try {
      context.ui.navigateTo(redditUrl);
    } catch {
      // navigateTo is unsupported in some Devvit environments — fall back to
      // copying the URL to the mod's clipboard via a toast they can tap/copy.
      context.ui.showToast(redditUrl);
    }
  }

  async function handleClearActioned(): Promise<void> {
    setClearing(true);
    try {
      const removed = await clearActioned(context);
      const kept = queue.filter((i) => i.status === 'pending');
      setQueueJson(JSON.stringify(kept));
      setStatusMsg(`🗑 Cleared ${removed} actioned item${removed !== 1 ? 's' : ''}`);
    } catch {
      setStatusMsg('Clear failed');
    } finally {
      setClearing(false);
    }
  }

  // ── Filter logic ────────────────────────────────────────────────────────────
  const filteredQueue = queue.filter((item) => {
    if (filter === 'critical') return item.scores.overall >= 80;
    if (filter === 'pending') return item.status === 'pending';
    if (filter === 'shadow') return item.autoRemoved === true;
    if (filter === 'watched') return item.authorIsWatched === true;
    return true;
  });

  const criticalCount = queue.filter(
    (i) => i.scores.overall >= 80 && i.status === 'pending'
  ).length;
  const actionedCount = queue.filter((i) => i.status !== 'pending').length;

  const counts: Record<FilterMode, number> = {
    all: queue.length,
    critical: queue.filter((i) => i.scores.overall >= 80).length,
    pending: queue.filter((i) => i.status === 'pending').length,
    shadow: queue.filter((i) => i.autoRemoved === true).length,
    watched: queue.filter((i) => i.authorIsWatched === true).length,
  };

  const filters: FilterMode[] = ['all', 'critical', 'pending', 'shadow', 'watched'];
  const filterLabels: Record<FilterMode, string> = {
    all: 'All',
    critical: '🔴 Critical',
    pending: 'Pending',
    shadow: '🤖 Shadow',
    watched: '👁 Watched',
  };

  const updatedText = lastUpdated > 0 ? `Updated ${formatTimeAgo(lastUpdated)}` : 'Loading…';

  // ── Moderator gate ────────────────────────────────────────────────────────
  // All hooks have been called above — safe to early-return now.
  if (!loading && !isMod) {
    return (
      <blocks height="tall">
        <vstack alignment="center middle" grow gap="medium" padding="large">
          <text size="xxlarge">🔒</text>
          <text size="xlarge" weight="bold">Moderators Only</text>
          <text color="secondary-plain" size="small" alignment="center" wrap>
            This dashboard is restricted to subreddit moderators.
          </text>
          <text size="xsmall" color="secondary-plain" alignment="center">
            If you are a moderator and see this message, try refreshing the page.
          </text>
        </vstack>
      </blocks>
    );
  }

  // ── In-app Help Guide ────────────────────────────────────────────────────
  if (showHelp) {
    return (
      <blocks height="tall">
        <vstack padding="medium" gap="small" grow>

          {/* Help header */}
          <hstack alignment="start middle" gap="small">
            <text size="xlarge" weight="bold">❓ ModSentinel Guide</text>
            <spacer grow />
            <button size="small" appearance="primary" onPress={() => setShowHelp(false)}>
              ✕ Back to Queue
            </button>
          </hstack>

          <vstack gap="medium" grow>

            {/* Score Colors */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">🎨 Score Colors</text>
              <hstack gap="small" alignment="start middle">
                <text size="xsmall" color="#27AE60" weight="bold">● 0–39</text>
                <text size="xsmall" color="secondary-plain">Clean — no action needed</text>
              </hstack>
              <hstack gap="small" alignment="start middle">
                <text size="xsmall" color="#4A90E2" weight="bold">● 40–59</text>
                <text size="xsmall" color="secondary-plain">Low risk — worth a glance</text>
              </hstack>
              <hstack gap="small" alignment="start middle">
                <text size="xsmall" color="#F5A623" weight="bold">● 60–79</text>
                <text size="xsmall" color="secondary-plain">Warning — likely needs review</text>
              </hstack>
              <hstack gap="small" alignment="start middle">
                <text size="xsmall" color="#FF4D6D" weight="bold">● 80–100</text>
                <text size="xsmall" color="secondary-plain">Critical — high-confidence violation</text>
              </hstack>
            </vstack>

            {/* Score Dimensions */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">📊 What Each Score Measures</text>
              <text size="xsmall" color="secondary-plain" wrap>
                Spam — Promo content, crypto schemes, fake engagement, link farms
              </text>
              <text size="xsmall" color="secondary-plain" wrap>
                Rule Violation — Breaks one or more of YOUR subreddit rules
              </text>
              <text size="xsmall" color="secondary-plain" wrap>
                Toxicity — Hostile, harassing, or hateful language
              </text>
              <text size="xsmall" color="secondary-plain" wrap>
                Overall = Violation×0.5 + Spam×0.3 + Toxicity×0.2
              </text>
            </vstack>

            {/* Filter Tabs */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">🗂 Filter Tabs</text>
              <text size="xsmall" color="secondary-plain" wrap>All — Full queue (max 200 items)</text>
              <text size="xsmall" color="secondary-plain" wrap>🔴 Critical — Items scoring 80+</text>
              <text size="xsmall" color="secondary-plain" wrap>Pending — Awaiting your action</text>
              <text size="xsmall" color="secondary-plain" wrap>🤖 Shadow — AI auto-removed items. Review for false positives, approve to restore.</text>
              <text size="xsmall" color="secondary-plain" wrap>👁 Watched — Content from users on your watchlist</text>
            </vstack>

            {/* Actions */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">⚡ Action Buttons</text>
              <text size="xsmall" color="secondary-plain" wrap>✓ Approve — Approves on Reddit + marks reviewed</text>
              <text size="xsmall" color="secondary-plain" wrap>🗑 Remove — Removes from Reddit + updates queue</text>
              <text size="xsmall" color="secondary-plain" wrap>🚫 Spam — Spam-removes (account-level impact) + updates queue</text>
              <text size="xsmall" color="secondary-plain" wrap>↗ View — Opens original post or comment in Reddit</text>
            </vstack>

            {/* Auto-Actions */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">🤖 Auto-Actions (configure in App Settings)</text>
              <text size="xsmall" color="secondary-plain" wrap>Auto-remove (default 95) — Content is removed instantly, no mod needed. Set to 100 to disable.</text>
              <text size="xsmall" color="secondary-plain" wrap>Auto-flair (default 80) — Gets "⚠️ Needs Review" flair. Visible to community.</text>
              <text size="xsmall" color="secondary-plain" wrap>Mod-mail notify (default 90) — Instant mod-mail for high-confidence violations.</text>
              <text size="xsmall" color="secondary-plain" wrap>Auto-reply — When enabled, posts a mod comment with AI reasoning when content is removed.</text>
            </vstack>

            {/* Watchlist */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">👁 Watchlist</text>
              <text size="xsmall" color="secondary-plain" wrap>Add: Right-click any post/comment → ModSentinel: Add to Watchlist</text>
              <text size="xsmall" color="secondary-plain" wrap>Remove: Right-click → ModSentinel: Remove from Watchlist</text>
              <text size="xsmall" color="secondary-plain" wrap>Effect: Watched users skip AI scoring — their content is auto-flagged at score 100 immediately.</text>
              <text size="xsmall" color="secondary-plain" wrap>Badges: "👁 WATCHED" (red) = on watchlist. "⚠️ N prior" (orange) = N past auto-removes.</text>
            </vstack>

            {/* Daily Report */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">📅 Daily Summary</text>
              <text size="xsmall" color="secondary-plain" wrap>Sent automatically to mod-mail at 9:00 AM UTC every day.</text>
              <text size="xsmall" color="secondary-plain" wrap>Includes: items scored, auto-removed, pending, avg score, community health %, top risk users.</text>
            </vstack>

            {/* Health Score */}
            <vstack gap="small" padding="small" backgroundColor="neutral-background" cornerRadius="medium">
              <text size="small" weight="bold">🏥 Community Health</text>
              <text size="xsmall" color="secondary-plain" wrap>Shown in the header. = % of queued items scoring below 40 (clean content).</text>
              <text size="xsmall" color="secondary-plain" wrap>Green ≥ 80% · Orange 50–79% · Red &lt; 50%. Refreshes on every ↻ Refresh.</text>
            </vstack>

          </vstack>

          <text size="xsmall" color="secondary-plain" alignment="center">
            ModSentinel v1.1 · Powered by Gemini 2.0 Flash
          </text>

        </vstack>
      </blocks>
    );
  }

  return (
    <blocks height="tall">
      <vstack padding="medium" gap="small" grow>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <hstack alignment="start middle" gap="small">
          <text size="xlarge" weight="bold">🛡️ ModSentinel</text>

          {criticalCount > 0 ? (
            <hstack padding="xsmall" backgroundColor="red-background" cornerRadius="full">
              <text size="xsmall" weight="bold" color="white">
                {String(criticalCount)} critical
              </text>
            </hstack>
          ) : null}

          <spacer grow />

          {/* Community health score */}
          <hstack
            padding="xsmall"
            backgroundColor={healthScore >= 80 ? 'green-background' : 'orangered-background'}
            cornerRadius="full"
          >
            <text size="xsmall" weight="bold" color="white">
              🏥 {String(healthScore)}% healthy
            </text>
          </hstack>

          {/* Help button */}
          <button
            size="small"
            appearance={showHelp ? 'primary' : 'bordered'}
            onPress={() => setShowHelp(!showHelp)}
          >
            {showHelp ? '✕ Close' : '? Help'}
          </button>

          {/* Refresh button — lights up when realtime pushes arrive */}
          <button
            size="small"
            appearance={
              newItemCount > 0
                ? peakNewScore >= 80
                  ? 'destructive'
                  : 'primary'
                : 'bordered'
            }
            onPress={() => {
              setLoading(true);
              setShowHelp(false);
              setNewItemCount(0);
              setPeakNewScore(0);
              setRefreshKey(refreshKey + 1);
            }}
          >
            {newItemCount > 0
              ? `↻ ${String(newItemCount)} new${peakNewScore >= 80 ? ` 🔴${String(peakNewScore)}` : ''}`
              : '↻ Refresh'}
          </button>
        </hstack>

        {/* Last updated + watchlist summary + status message */}
        <hstack alignment="start middle" gap="medium">
          <text size="xsmall" color="secondary-plain">
            {updatedText}
          </text>
          {watchlist.length > 0 ? (
            <text size="xsmall" color="secondary-plain">
              · 👁 {String(watchlist.length)} watched
            </text>
          ) : null}
          {statusMsg ? (
            <text size="xsmall" color="secondary-plain">
              · {statusMsg}
            </text>
          ) : null}
        </hstack>

        {/* ── Filter tabs ──────────────────────────────────────────────────── */}
        <hstack gap="small">
          {filters.map((f) => (
            <button
              key={f}
              size="small"
              appearance={filter === f ? 'primary' : 'secondary'}
              onPress={() => setFilter(f)}
            >
              {`${filterLabels[f]} ${counts[f]}`}
            </button>
          ))}
          <spacer grow />
          {actionedCount > 0 ? (
            <button
              size="small"
              appearance="secondary"
              onPress={handleClearActioned}
              disabled={clearing}
            >
              {clearing ? '…' : `Clear ${actionedCount}`}
            </button>
          ) : null}
        </hstack>

        {/* ── Filter context hints ─────────────────────────────────────────── */}
        {filter === 'shadow' ? (
          <hstack padding="small" backgroundColor="neutral-background-strong" cornerRadius="small">
            <text size="xsmall" color="secondary-plain" wrap>
              🤖 Shadow queue — AI auto-removed items. Review for false positives and approve to restore.
            </text>
          </hstack>
        ) : null}
        {filter === 'watched' && watchlist.length > 0 ? (
          <hstack padding="small" backgroundColor="neutral-background-strong" cornerRadius="small">
            <text size="xsmall" color="secondary-plain" wrap>
              👁 Watching: {watchlist.slice(0, 8).map((u) => `u/${u}`).join(', ')}
              {watchlist.length > 8 ? ` +${watchlist.length - 8} more` : ''}
            </text>
          </hstack>
        ) : null}

        {/* ── Queue items ──────────────────────────────────────────────────── */}
        {loading ? (
          <vstack alignment="center middle" grow gap="small">
            <text size="large" color="secondary-plain">
              {SPINNER[spinnerFrame % SPINNER.length]}
            </text>
            <text size="small" weight="bold" color="secondary-plain">
              Analyzing queue…
            </text>
            <text size="xsmall" color="secondary-plain">
              Verifying mod status · fetching scores
            </text>
          </vstack>
        ) : filteredQueue.length === 0 ? (
          <vstack alignment="center middle" grow gap="small">
            <text size="xxlarge">
              {filter === 'shadow'
                ? '🤖'
                : filter === 'watched'
                ? '👁'
                : filter === 'critical'
                ? '✅'
                : '✅'}
            </text>
            <text weight="bold">
              {filter === 'shadow'
                ? 'Shadow queue is empty'
                : filter === 'watched'
                ? 'No content from watched users'
                : filter === 'critical'
                ? 'No critical items right now'
                : filter === 'pending'
                ? 'All clear — nothing pending'
                : 'Queue is empty'}
            </text>
            <text color="secondary-plain" size="small">
              {filter === 'shadow'
                ? 'AI auto-removed items will appear here for false-positive review'
                : filter === 'watched'
                ? watchlist.length === 0
                  ? 'Right-click any post/comment → ModSentinel: Add to Watchlist'
                  : 'Watched users have no recent content in queue'
                : 'New posts and comments are scored automatically'}
            </text>
          </vstack>
        ) : (
          <vstack gap="small" grow>
            {filteredQueue.map((item) => (
              <QueueItem
                key={item.contentId}
                item={item}
                onApprove={() => handleApprove(item)}
                onRemove={() => handleRemove(item)}
                onSpam={() => handleSpam(item)}
                onNavigate={() => handleNavigate(item)}
              />
            ))}
          </vstack>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <hstack alignment="center" gap="small">
          <text size="xsmall" color="secondary-plain" alignment="center">
            Powered by Gemini 2.0 Flash · ModSentinel v1.1
          </text>
          <spacer grow />
          <text size="xsmall" color="secondary-plain">
            {String(queue.length)}/200 items
          </text>
        </hstack>

      </vstack>
    </blocks>
  );
}
