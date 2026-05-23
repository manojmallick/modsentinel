export interface ContentScore {
  contentId: string;
  contentType: 'post' | 'comment';
  authorName: string;
  title?: string;
  body: string;
  url: string;
  createdAt: number;
  scores: {
    spam: number;       // 0-100
    violation: number;  // 0-100 — breaks subreddit rules
    toxicity: number;   // 0-100 — hostile/harassing language
    overall: number;    // 0-100 — weighted overall priority
  };
  status: 'pending' | 'approved' | 'removed' | 'spam';
  geminiReasoning: string;
}

export interface SubredditConfig {
  rules: string[];
  keywords: string[];
  autoRemoveThreshold: number;  // default 95
  autoFlairThreshold: number;   // default 80
  notifyThreshold: number;      // default 90
}
