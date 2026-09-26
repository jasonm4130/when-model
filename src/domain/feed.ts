import type { LabId } from './lab';

export type FeedSource = 'hn' | 'openai' | 'deepmind' | 'anthropic' | 'github' | 'xai';

/**
 * How exact `publishedAt` is. `day` means the source printed a date without a time and the
 * item is pinned to 00:00Z (Grok 4.7 sat 15h50m ahead of its own HN story that way), so lead
 * analysis must not read it as a timestamp.
 */
export type FeedPrecision = 'instant' | 'day';

/** One headline in the OSINT feed, from any source. */
export interface FeedItem {
  source: FeedSource;
  title: string;
  url: string;
  publishedAt: string;
  score?: number;
  meta?: string;
  /** Shaped like a launch announcement; counts toward DROPCON. */
  alert: boolean;
  /** Absent on items built before v3; read absent as `instant`. */
  precision?: FeedPrecision;
}

const MODEL_WORDS =
  /\b(gpt|openai|claude|anthropic|gemini|deepmind|gemma|grok|xai|deepseek|llama|qwen|alibaba|mistral|kimi|moonshot|glm|z\.ai|minimax|llm|ai model|agi|frontier model|o\d|sora|veo|arena|benchmark|weights|open.?source model|(?:opus|sonnet|haiku|fable|mythos)[\s\-‐-―]?\d|muse (?:spark|glimmer|code))\b/i;

/** Lab names alone do not count: Anthropic says "Claude" in every post. */
const RELEASE_WORDS =
  /\b(introducing|announcing|releas\w+|launch\w+|now available|new model|drops?|ships?|unveil\w*|preview|general availability|v?\d+(\.\d+)+)\b/i;

/**
 * Model talk, for keeping a Hacker News story at all. Family names that are also English words
 * need a version ("Opus 5.5", not "magnum opus"), and "Meta AI" is out: it matched glasses stories.
 */
export function mentionsModel(title: string): boolean {
  return MODEL_WORDS.test(title);
}

/** The v2 keyword test. Kept for callers that predate `isReleaseHeadline`; it flags 195 of 1,230 OpenAI posts. */
export function looksLikeRelease(title: string): boolean {
  return RELEASE_WORDS.test(title);
}

/** Hacker News stories need real traction before a launch-shaped title counts as an alert. */
export const HN_ALERT_POINTS = 150;

export function newestFirst(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/**
 * `day` when the raw date string carries no clock time, or only midnight: OpenAI's RSS stamps
 * date-only posts 00:00:00 GMT (350 of 1,230, "Introducing GPT-Live" 17 h before its HN story).
 */
export function precisionOf(raw: string): FeedPrecision {
  const clock = raw.match(/\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?/)?.[0];
  return clock && !/^0?0:00(?::00(?:\.0+)?)?$/.test(clock) ? 'instant' : 'day';
}

// ─── Versioned model ids ─────────────────────────────────────────────────────

/** Headlines hyphenate with anything: ASCII, U+2010–U+2015 (U+2011 no-break, en and em dash), minus. */
const D = '[\\s\\-_\\u2010-\\u2015\\u2212]';
const V = '\\d+(?:\\.\\d+)*';
/** Anthropic API ids write 5.5 as `5-5`; a single digit after the hyphen keeps dated snapshots out. */
const VA = '\\d+(?:\\.\\d+|[\\-\\u2010-\\u2015]\\d(?!\\d))?';
const SUFFIX =
  '(?:sol|luna|astra|terra|pro|flash|lite|mini|nano|max|plus|ultra|turbo|omni|codex|spark|fast|heavy|thinking|instant|exp|preview|prime|vision|cyber|coder|air|next|live|\\d+(?:\\.\\d+)?[bt]|[01]\\d[0-3]\\d)';
const FAMILIES = [
  `gpt${D}?(?:(?:image|live|realtime|audio)${D})?${V}(?:o(?![a-z]))?`,
  `claude${D}(?:opus|sonnet|haiku|fable|mythos)${D}${VA}`,
  `claude${D}${V}(?:${D}(?:opus|sonnet|haiku))?`,
  `(?:opus|sonnet|haiku|fable|mythos)${D}${VA}`,
  `gemini${D}(?:(?:pro|flash|ultra|nano|omni|robotics|live|diffusion)${D})?${V}`,
  `(?:gemma|veo|sora|imagen|llama|glm)${D}?${V}`,
  `grok${D}?(?:code${D}fast${D})?${V}`,
  `muse${D}(?:spark|glimmer|code|video)${D}${V}`,
  `deepseek${D}?[vr]${V}`,
  `qwen${D}?(?:(?:image|vl|coder|omni|audio)${D})?${V}`,
  `kimi${D}?k${V}`,
  `minimax${D}?[mh]${V}`,
  `mimo${D}?v${V}`,
  `mistral${D}(?:large|medium|small|ocr)${D}${V}`,
  `(?:magistral|devstral|codestral|ministral)${D}?(?:(?:small|medium)${D})?${V}`,
];
// The suffix is captured (not `?:`) so `findModelIds` can read the last one consumed: that is
// the anchor for sibling expansion below. No other group in FAMILIES captures.
const MODEL_ID = new RegExp(
  `\\b(?:${FAMILIES.join('|')})(?:${D}(${SUFFIX})(?![\\w.]))*(?![\\w]|\\.\\d)`,
  'gi',
);
/** OpenAI's o-series only counts in lower case: "O2" is a phone network. */
const O_SERIES = /(?<![\w.-])o[1-9](?:-(?:mini|pro|preview))?(?![\w.-])/g;
/**
 * A sibling list after a suffixed id: "and Luna", ", Luna", "& Luna". One separator, then one
 * more SUFFIX word; `siblingSuffixes` loops this for "X, Y and Z".
 */
const SIBLING_ID_SEP = /^\s*(?:,|\band\b|&|\+|\/)\s*/i;
const SIBLING_ID_WORD = new RegExp(`^(${SUFFIX})(?![\\w.])`, 'i');

/** Lower case, one ASCII hyphen per separator run, and Anthropic's `5-5` read as `5.5`. */
function canonicalId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(new RegExp(`${D}+`, 'g'), '-')
    .replace(/\b(opus|sonnet|haiku|fable|mythos)-(\d+)-(\d)$/, '$1-$2.$3')
    .replace(/\b(opus|sonnet|haiku|fable|mythos)-(\d+)-(\d)(?=-)/, '$1-$2.$3');
}

interface IdMatch {
  id: string;
  index: number;
  end: number;
}

/**
 * Sibling suffixes sharing `id`'s family+version, read from `text` right after the match ends:
 * "GPT-6 Sol and Luna" → `luna`; "Sol, Luna and Astra" → `luna`, `astra`. Only fires past a
 * suffix already consumed by the base match (so "GPT-6 and beyond" never expands: no suffix,
 * no scan), and only on words from the same curated SUFFIX vocabulary (so "GPT-6 Pro and
 * Football" stops at "Pro": "Football" isn't a suffix word).
 */
function siblingSuffixes(text: string, from: number): { word: string; end: number }[] {
  const out: { word: string; end: number }[] = [];
  let i = from;
  for (;;) {
    const sep = SIBLING_ID_SEP.exec(text.slice(i));
    if (!sep) break;
    const after = i + sep[0].length;
    const word = SIBLING_ID_WORD.exec(text.slice(after));
    if (!word) break;
    i = after + word[1].length;
    out.push({ word: word[1].toLowerCase(), end: i });
  }
  return out;
}

function findModelIds(text: string): IdMatch[] {
  const found: IdMatch[] = [];
  for (const m of text.matchAll(MODEL_ID)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const id = canonicalId(m[0]);
    found.push({ id, index, end });
    const suffix = m[1]?.toLowerCase();
    if (suffix && id.endsWith(`-${suffix}`)) {
      const prefix = id.slice(0, -(suffix.length + 1));
      for (const sib of siblingSuffixes(text, end)) {
        found.push({ id: `${prefix}-${sib.word}`, index, end: sib.end });
      }
    }
  }
  for (const m of text.matchAll(O_SERIES)) {
    const index = m.index ?? 0;
    found.push({ id: canonicalId(m[0]), index, end: index + m[0].length });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Versioned model ids named in free text, canonicalised and in order of appearance:
 * "GPT‑6 Sol and Luna" → `gpt-6-sol`, `gpt-6-luna`; "claude-opus-5-5" → `claude-opus-5.5`;
 * "Qwen3.8-27B" → `qwen3.8-27b`. A bare family name ("Gemini", "Sora") is not an id: only a
 * version pins a release. Siblings sharing a family prefix expand ("X and Y", "X & Y",
 * "X, Y and Z"); see `siblingSuffixes`.
 */
export function modelIds(text: string): string[] {
  return [...new Set(findModelIds(text).map((m) => m.id))];
}

const LAB_OF_FAMILY: readonly [RegExp, LabId][] = [
  [/^(?:gpt|o\d|sora)/, 'openai'],
  [/^(?:claude|opus|sonnet|haiku|fable|mythos)/, 'anthropic'],
  [/^(?:gemini|gemma|veo|imagen)/, 'google'],
  [/^grok/, 'xai'],
  [/^deepseek/, 'deepseek'],
  [/^qwen/, 'qwen'],
  [/^(?:llama|muse)/, 'meta'],
  [/^(?:mistral|magistral|devstral|codestral|ministral)/, 'mistral'],
  [/^kimi/, 'moonshot'],
  [/^glm/, 'zai'],
];

/** The lab behind a canonical model id, when it is one we track. */
export function labForModelId(id: string): LabId | undefined {
  return LAB_OF_FAMILY.find(([re]) => re.test(id))?.[1];
}

// ─── Release alerts ──────────────────────────────────────────────────────────

const LAUNCH_CUE =
  /^(?:introducing|announcing|meet|hello)\b|\b(?:is|are) (?:here|out|live)\b|\b(?:now|generally) available\b|\blaunch(?:es|ed)?\b|\breleas(?:e|es|ed)\b|\bunveil(?:s|ed)?\b|\bdebuts?\b|\bopen[- ]sourc(?:es|ed)\b|\bnow open[- ]weights?\b|\brolls? out\b|\brolling out\b/i;
const MODEL_WORD =
  '(?:gpt|claude|opus|sonnet|haiku|fable|mythos|gemini|gemma|grok|llama|muse|deepseek|qwen|kimi|glm|o\\d)';
/**
 * Launch-adjacent posts that are not launches: safety paperwork, customer stories ("… with
 * GPT-6 Astra"), regional or partner availability, and anything still in the future tense.
 */
const NOT_A_LAUNCH = new RegExp(
  [
    'system card',
    'model card',
    'safety overview',
    'technical report',
    'bug bounty',
    'fine[- ]?tuning',
    'addendum',
    'preferred model',
    'expands to',
    'ever released',
    'prompt caching',
    `\\b(?:with|using|powered by|built (?:on|with)|vs\\.?|versus)\\s+(?:the\\s+)?(?:\\w+'s?\\s+)?${MODEL_WORD}`,
    '\\bavailable (?:in|on|via|through)\\b',
    '\\b(?:will|to be|set to|plans? to|prepar\\w*|soon|tomorrow|next week|upcoming|imminent|rumou?r\\w*|leak\\w*|spotted|appeared|tests|testing|internal|ahead of)\\b',
    // Pre-announcements seen on HN in the 90 days measured: "Opus 5 expected to launch on July 20-21".
    '\\b(?:expected to|could be|may be|coming (?:in|on|this|next)|later today|to (?:unveil|launch|release|debut|ship|announce)|delay\\w*|postpone\\w*)\\b',
  ].join('|'),
  'i',
);
const LAB_PREFIX =
  /^\s*(?:(?:openai|anthropic|google(?: deepmind)?|deepmind|meta|xai|spacexai|deepseek|alibaba|qwen|mistral(?: ai)?|moonshot(?: ai)?|z\.ai|zhipu)(?:['’]s)?\s*[:\-\u2013\u2014]?\s*)?$/i;
const WORD = /^[-\u2010-\u2015]?[a-z0-9][\w.\-\u2010-\u2015]*$/i;
const SIBLING_SEP = /^\s*(?:,|\band\b|&|\+|\/)/i;
const SUBTITLE = /^\s*(?::|[\u2013\u2014]\s|\s-\s)/;
const MAX_HEADLINE = 300;
/** "GPT-6 Astra on OpenRouter": availability on a catalog reads as the launch itself. */
const ON_CATALOG = /^on (?:openrouter|hugging ?face|the api)$/i;

/**
 * After the model name, a bare-name title has nothing, one more word ("DeepSeek-V4-Flash Update"),
 * or a list of siblings ("GPT-6 Sol and Luna", "Gemini 3.6 Flash, 3.5 Flash-Lite, and 3.5 Flash
 * Cyber"). A sibling is one word, or up to four words carrying a version.
 */
function isBareName(rest: string): boolean {
  const r = rest.replace(/\s*(?:\[[^\]]*\]|\([^)]*\))\s*$/, '').trim();
  if (!r || WORD.test(r) || ON_CATALOG.test(r)) return true;
  if (!SIBLING_SEP.test(r)) return false;
  return r
    .split(/\s*(?:,|\band\b|&|\+|\/)\s*/i)
    .filter(Boolean)
    .every((item) => {
      const words = item.split(/\s+/);
      return (
        words.every((w) => WORD.test(w)) && (words.length === 1 || (words.length <= 4 && /\d/.test(item)))
      );
    });
}

/**
 * F8: does this headline announce a model? It needs a versioned model id and either a launch cue
 * or a title that is essentially the model's name ("Grok 4.7", "GPT-6 Sol and Luna",
 * "Kimi K3: Open Frontier Intelligence"). Measured 2026-09-26 (test/domain/feed.test.ts pins it):
 * OpenAI's 1,230-post RSS history, 32 flagged, 29 launches (precision 0.91, recall 0.52), where
 * `looksLikeRelease` flagged 195 with 38 launches (0.19); HN at 150+ points 0.98 / 0.68; the
 * held-out DeepMind blog 0.86 / 0.34. Recall misses are mostly unversioned names (Sora, Nano Banana).
 */
export function isReleaseHeadline(title: string): boolean {
  // No headline runs this long, and the bare-name regexes backtrack quadratically on long
  // whitespace runs (a 50 KB title took a second), so untrusted text past it is not a launch.
  if (title.length > MAX_HEADLINE) return false;
  const first = findModelIds(title)[0];
  if (!first || NOT_A_LAUNCH.test(title)) return false;
  if (LAUNCH_CUE.test(title)) return true;
  if (!LAB_PREFIX.test(title.slice(0, first.index))) return false;
  const rest = title.slice(first.end);
  // A subtitle naming another model is a comparison ("Kimi K3: second only to Fable 5").
  return isBareName(rest) || (SUBTITLE.test(rest) && !findModelIds(rest).length);
}

// ─── Leak Wire ───────────────────────────────────────────────────────────────

export type LeakSource = 'hn' | 'testingcatalog';

/** Who reported a leak, for attribution beside the link. */
export const LEAK_SOURCE_NAMES: Readonly<Record<LeakSource, string>> = {
  hn: 'Hacker News',
  testingcatalog: 'TestingCatalog',
};

/** A pre-release sighting of a named model: the only feed signal that can lead a launch. */
export interface LeakItem {
  source: LeakSource;
  title: string;
  url: string;
  publishedAt: string;
  labId?: LabId;
  /** Canonical ids, as `modelIds` returns them. */
  modelIds: string[];
  /** The phrase that made it a leak, lower-cased ("launching soon", "appeared"). */
  cue: string;
}

/** Leaks older than this say nothing about next week, and the precision below is measured at 14 days. */
export const LEAK_WINDOW_DAYS = 14;

const LEAK_CUE =
  /\b(launching soon|coming soon|imminent|appeared|appears (?:on|in)|spotted|leak(?:ed|s)?|internal (?:beta )?testing|in testing|testing|(?<=\b(?:openai|anthropic|google|meta|xai|spacexai|deepseek|alibaba|qwen|mistral|moonshot)\s)tests|ahead of (?:the |its )?(?:release|launch)|prepares|preparing|early outputs?|first outputs?|will (?:launch|release|ship)|releasing (?:tomorrow|today|soon|this|next|in|on|mid|early|late)|arriv(?:es|ing) (?:tomorrow|today|soon|this|next|on))\b/i;
/** Beats every "is out" below: a model "available for internal testing" has not launched. */
const PRE_RELEASE = /\binternal (?:beta )?testing\b/i;
const ALREADY_OUT =
  /\b(?:launch(?:es|ed)|releas(?:es|ed)|introduc\w+|now available|is (?:here|out|live)|rolls? out|rolling out|unveil\w*|open[- ]sourc\w+)\b/i;
/**
 * The cue belongs to something else: hands-on reviews ("Testing Claude Sonnet 5's claims"), test
 * harnesses, leaked keys or data, and comparisons where the model is only the yardstick.
 */
const NOT_A_LEAK =
  /^(?:testing|trying|tested)\b|\btesting (?:environment|harness|framework|overtraining)|\b(?:agent|unit|e2e|load|penetration) testing\b|\bleak fix|\bmemory leak|\b(?:source code|data|keys?|credentials?|password|system prompt)s? leak|\bleaked (?:keys|data|credentials|source|system prompt|emails|documents)|\b(?:on par with|beats?|beat|vs\.?|versus|compared (?:to|with)|matched|rivals?|rivaling)\b/i;

export interface LeakClass {
  modelIds: string[];
  cue: string;
  labId?: LabId;
}

/**
 * Leak Wire classifier: a versioned model id plus a pre-release cue, in a title that is not a
 * launch, a review or a comparison. Pair it with `unlistedLeaks` so models already on sale drop out.
 *
 * Measured 2026-09-26 over 90 days of HN (Algolia `search_by_date`, 0 points and up) and the 100
 * items in TestingCatalog's RSS; test/fixtures/leak-titles-labelled.ts holds the data. It flagged
 * 18 titles, all real pre-release reports (3 unversioned ones missed). 3 were already listed; of
 * the 14 other resolved ones, 11 were followed by an OpenRouter listing within 14 days (0.79;
 * HN 8/10, TestingCatalog 3/4), lead 0.2 to 10.9 days, median 1.9. The misses are Gemini 4 (twice)
 * and a delayed Gemini 3.5 Pro. Qwen3.8-Flash-Next listed 1.3 days on as `qwen/qwen3.8-flash`,
 * found only through its `hugging_face_id`, so pass that as a listing alias. These numbers are
 * in-sample: the cues were written against them.
 */
export function classifyLeak(title: string): LeakClass | undefined {
  const cue = title.match(LEAK_CUE)?.[1];
  if (!cue || NOT_A_LEAK.test(title)) return undefined;
  if (ALREADY_OUT.test(title) && !PRE_RELEASE.test(title)) return undefined;
  const ids = modelIds(title);
  if (!ids.length) return undefined;
  const labId = labForModelId(ids[0]);
  return { modelIds: ids, cue: cue.toLowerCase(), ...(labId ? { labId } : {}) };
}

/** Tokens for matching ids across spellings: "Qwen3.8-27B", "qwen/qwen3.8-27b" and "Qwen: Qwen3.8 27B" agree. */
function modelTokens(s: string): string[] {
  return canonicalId(s)
    .replace(/[/:()]+/g, '-')
    .replace(/([a-z]{2,})(\d)/g, '$1-$2')
    .split(/-+/)
    .filter(Boolean);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

/**
 * A catalog row, structurally. `aliases` holds other names the same model ships under: OpenRouter
 * listed the leaked "Qwen3.8-Flash-Next" as `qwen/qwen3.8-flash`, and only its `hugging_face_id`
 * (`Qwen/Qwen3.8-Flash-Next`) says so.
 */
export interface Listing {
  id: string;
  name: string;
  aliases?: readonly string[];
}

/** Is this model id (or a member of its line, e.g. `gpt-6` for `gpt-6-sol`) already listed? */
export function isListed(modelId: string, listings: readonly Listing[]): boolean {
  const needle = modelTokens(modelId);
  return listings.some((l) =>
    [l.id, l.name, ...(l.aliases ?? [])].some((s) => containsRun(modelTokens(s), needle)),
  );
}

/**
 * Keep the leaks that still point at something unreleased: at least one named model has no
 * listing yet. The listing shape is structural so any catalog (OpenRouter today) can feed it.
 */
export function unlistedLeaks(leaks: readonly LeakItem[], listings: readonly Listing[]): LeakItem[] {
  return leaks.filter((leak) => leak.modelIds.some((id) => !isListed(id, listings)));
}

// ─── Cross-source dedup ──────────────────────────────────────────────────────

/**
 * Distinct model ids named by alerting items, across every source: one launch that raises an
 * RSS post, an HN story and an SDK confirmation (F8+F6+F10) counts once, not three times, when
 * a caller sums this instead of counting alert rows. Reads `title`, where every alerting item
 * (RSS post, HN headline, `sdkFeedItems`' "confirms …" line) already carries its model ids.
 */
export function distinctAlertModels(feed: readonly FeedItem[]): string[] {
  const ids = new Set<string>();
  for (const item of feed) {
    if (!item.alert) continue;
    for (const id of modelIds(item.title)) ids.add(id);
  }
  return [...ids];
}
