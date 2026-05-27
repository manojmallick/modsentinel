import { type TriggerContext } from '@devvit/public-api';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface GeminiScore {
  spam: number;
  violation: number;
  toxicity: number;
  overall: number;
  reasoning: string;
}

const SAFE_DEFAULT: GeminiScore = { spam: 0, violation: 0, toxicity: 0, overall: 0, reasoning: '' };

function clamp(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.round(Math.min(100, Math.max(0, n)));
}

export async function scoreContent(
  content: string,
  contentType: 'post' | 'comment',
  subredditRules: string[],
  context: TriggerContext
): Promise<GeminiScore> {
  const apiKey = await context.settings.get<string>('geminiApiKey');
  if (!apiKey) {
    console.error('ModSentinel: Gemini API key not configured');
    return SAFE_DEFAULT;
  }

  const rulesText = subredditRules.length
    ? subredditRules.map((r, i) => `Rule ${i + 1}: ${r}`).join('\n')
    : 'Rule 1: Be respectful\nRule 2: No spam\nRule 3: Stay on topic';

  const prompt = `You are a Reddit moderation AI. Score the following ${contentType} on three dimensions (0-100 each, where 100 = most problematic):

SUBREDDIT RULES:
${rulesText}

CONTENT TO SCORE:
${content}

Return ONLY valid JSON with this exact structure:
{
  "spam": <0-100>,
  "violation": <0-100>,
  "toxicity": <0-100>,
  "overall": <0-100>,
  "reasoning": "<one sentence max explaining the top concern if score > 50, empty string otherwise>"
}

Scoring guide:
- spam: promotional content, repetitive posts, fake engagement, cryptocurrency schemes
- violation: breaks one or more subreddit rules listed above
- toxicity: hostile, harassing, or hateful language directed at people
- overall: weighted score using violation×0.5 + spam×0.3 + toxicity×0.2
- reasoning: empty string if overall < 50

IMPORTANT: Return ONLY the JSON object. No markdown. No code blocks. No explanation.`;

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
      }),
    });
  } catch (err) {
    console.error('ModSentinel: Gemini fetch error', err);
    return SAFE_DEFAULT;
  }

  if (!response.ok) {
    console.error('ModSentinel: Gemini API error', response.status);
    return SAFE_DEFAULT;
  }

  const data = (await response.json()) as Record<string, unknown>;
  const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
  const text = (candidates?.[0]?.content as Record<string, unknown>)?.parts;
  const rawText = ((text as Array<Record<string, unknown>>)?.[0]?.text ?? '') as string;

  try {
    const cleaned = rawText.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const scores = JSON.parse(cleaned) as Record<string, unknown>;

    const spam = clamp(scores.spam);
    const violation = clamp(scores.violation);
    const toxicity = clamp(scores.toxicity);

    // Compute overall ourselves — don't trust Gemini's calculation.
    // Base: violation×0.5 + spam×0.3 + toxicity×0.2
    const raw = Math.round((violation * 0.5) + (spam * 0.3) + (toxicity * 0.2));

    // Floor: if any single dimension hits 85+ (high-confidence signal),
    // the overall risk is at least 85% of that score.
    // Rationale: Spam=95 means 95% confidence it's spam — overall should be ≥ 80.
    const maxSingle = Math.max(spam, violation, toxicity);
    const floor = maxSingle >= 85 ? Math.round(maxSingle * 0.85) : 0;

    const overall = Math.min(100, Math.max(raw, floor));

    return {
      spam,
      violation,
      toxicity,
      overall,
      reasoning: typeof scores.reasoning === 'string' ? scores.reasoning : '',
    };
  } catch {
    console.error('ModSentinel: Failed to parse Gemini response', rawText);
    return SAFE_DEFAULT;
  }
}
