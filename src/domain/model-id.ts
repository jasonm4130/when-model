/**
 * One spelling per model across sources: OpenRouter's `qwen/qwen3.8-max-prime`, chat.qwen.ai's
 * `qwen3.8-max-prime`, Hugging Face's `Qwen/Qwen3.8-Max-Prime` and the post "Introducing
 * Qwen3.8-Max-Prime" are one model to the availability ledger. Pure; built on the headline grammar
 * in feed.ts (`findModelIds`), so a title and a listing read a model id the same way.
 */
import { findModelIds, labForModelId, type IdMatch } from './feed';
import { labForHuggingFaceOrg, labForOpenRouterId, type LabId } from './lab';

/** Where an id came from, which decides the namespace to strip and where the lab comes from. */
export type IdSource = 'openrouter' | 'huggingface' | 'id' | 'title';

export interface ModelHint {
  source: IdSource;
  /** The display name, read when the id itself carries no versioned model ("DeepSeek: DeepSeek V3.1"). */
  name?: string;
  /** The lab when the source says so: chat.qwen.ai is Qwen's, a first-party feed is its lab's. */
  labId?: LabId;
}

export interface CanonicalModel {
  labId: LabId;
  /** `base`, plus `@snapshot` when the id carries a date: the ledger's identity for one model. */
  sku: string;
  /** The model without its snapshot date: `claude-opus-5.5` for `claude-opus-5-5-20260922`. */
  base: string;
  /** A trailing date as the id wrote it: `20260420`, `2025-07-28`, `09-2025` or the grammar's `0731`. */
  snapshot?: string;
  /** The leading word of the base: `gpt`, `claude`, `qwen` … */
  family: string;
  /** The version the grammar matched (`3.8` for `qwen3.8-27b`); absent on an unversioned id. */
  version?: string;
  /** No versioned id matched, so `base` is the stripped slug (`gpt-chat-latest`, `grok-build-0.1`). */
  unversioned?: true;
  /**
   * A tier word the grammar stopped at ("contributor" in `muse-spark-1.2-contributor`). It is not part
   * of the sku, so the tier rules read it separately: that listing is Muse Spark 1.2's cheaper tier.
   */
  variant?: string;
}

/** A trailing date on a bare id: YYYYMMDD, YYYY-MM-DD or MM-YYYY. The grammar's MMDD is read after it. */
const ID_DATE = /[-_](\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{4})$/;
const GRAMMAR_DATE = /-([01]\d[0-3]\d)$/;
/** OpenRouter's routing variants of one model: `:free`, `:batch`, `:thinking`, `:extended`. */
const ROUTE_VARIANT = /:[a-z0-9-]+$/i;
/**
 * Tier words the flagship rules read (the labelled review's small and special tiers). Only the
 * ones the grammar does not already keep can end up here: contributor, guard, tts, oss, chat ….
 */
const TIER_WORDS: ReadonlySet<string> = new Set([
  'mini',
  'nano',
  'lite',
  'haiku',
  'luna',
  'contributor',
  'omni',
  'vl',
  'code',
  'coder',
  'codex',
  'image',
  'audio',
  'tts',
  'embed',
  'guard',
  'safeguard',
  'oss',
  'cyber',
  'vision',
  'build',
  'chat',
  'latest',
]);
/** Generators and encoders, not chat models: an image, speech or video model is never a text release. */
const NON_TEXT =
  /(?:^|-)(?:image|imagen|veo|sora|lyria|video|audio|speech|tts|asr|embed|embedding|reranker)(?:-|$)/;

/** Family rewrites so every source spells a model one way: `opus-5.5` and `claude-4.5-sonnet` → `claude-…`. */
function rewriteFamily(id: string): string {
  return id
    .replace(/^(opus|sonnet|haiku|fable|mythos)-/, 'claude-$1-')
    .replace(/^claude-(\d+(?:\.\d+)*)-(opus|sonnet|haiku)(?=-|$)/, 'claude-$2-$1');
}

/** Lower case, one hyphen per separator run: the unversioned fallback's spelling. */
function slugOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_\-‐-―−]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The first tier word after the grammar's match, when the id went on past it. */
function variantOf(rest: string): string | undefined {
  return slugOf(rest)
    .split('-')
    .find((word) => TIER_WORDS.has(word));
}

/** The id without its source's namespace, and the lab the namespace names. */
function stripNamespace(raw: string, hint: ModelHint): { slug: string; labId?: LabId } {
  const [prefix, ...rest] = raw.replace(/^~/, '').split('/');
  if (hint.source === 'openrouter')
    return { slug: rest.join('/').replace(ROUTE_VARIANT, ''), labId: labForOpenRouterId(raw)?.id };
  if (hint.source === 'huggingface') return { slug: rest.join('/'), labId: labForHuggingFaceOrg(prefix)?.id };
  return { slug: raw, labId: hint.labId };
}

function matchAt(text: string, anywhere: boolean): IdMatch | undefined {
  const first = findModelIds(text)[0];
  // A bare id must start with its model: `eagle3-gemma4-12b` is DeepSeek's draft model, not Gemma.
  return first && (anywhere || first.index === 0) ? first : undefined;
}

/**
 * The lab and sku for one sighting, or undefined when it names no model we can place (an unknown
 * lab, a namespace no lab publishes under, a non-text generator, a title with no versioned id).
 * Steps: strip the source's namespace
 * and routing variant, pull a trailing date into `snapshot`, read the id with the headline grammar
 * (then the display name), apply the family rewrites, and fall back to the stripped slug, tagged
 * `unversioned`, for an id with no version. The grammar stops at words it does not know, which
 * drops `-Instruct`, `-it`, `-FP8`, `-GGUF` and `-Base` (and `-contributor`, kept as `variant`).
 */
export function canonicalModel(raw: string, hint: ModelHint): CanonicalModel | undefined {
  const title = hint.source === 'title';
  const { slug: stripped, labId: sourceLab } = stripNamespace(raw.trim(), hint);
  let slug = stripped;
  let snapshot: string | undefined;
  const dated = title ? null : ID_DATE.exec(slug);
  if (dated) {
    snapshot = dated[1];
    slug = slug.slice(0, dated.index);
  }

  const name = hint.name?.replace(/^[^:]+:\s*/, '');
  let match = matchAt(slug, title);
  let rest = match ? slug.slice(match.end) : '';
  if (!match && name && !title) {
    match = matchAt(name, false);
    rest = match ? name.slice(match.end) : '';
  }

  let base: string;
  let version: string | undefined;
  if (match) {
    base = rewriteFamily(match.id);
    const mmdd = GRAMMAR_DATE.exec(base);
    if (mmdd && !snapshot) {
      snapshot = mmdd[1];
      base = base.slice(0, mmdd.index);
    }
    version = /\d+(?:\.\d+)*/.exec(base)?.[0];
  } else {
    if (title) return undefined;
    base = slugOf(slug);
    rest = '';
  }
  if (!base || NON_TEXT.test(base) || (!title && NON_TEXT.test(slugOf(rest)))) return undefined;

  // A listing's namespace is its maker: `nvidia/llama-3.1-nemotron-70b` is NVIDIA's fine-tune, not
  // Meta's release. A bare id falls back to the model's name; a title is read by it first.
  const namespaced = hint.source === 'openrouter' || hint.source === 'huggingface';
  const labId = title
    ? (labForModelId(base) ?? sourceLab)
    : namespaced
      ? sourceLab
      : (sourceLab ?? labForModelId(base));
  if (!labId) return undefined;
  const variant = title ? undefined : variantOf(rest);
  return {
    labId,
    sku: snapshot ? `${base}@${snapshot}` : base,
    base,
    ...(snapshot ? { snapshot } : {}),
    family: /^[a-z]+/.exec(base)?.[0] ?? base,
    ...(version && match ? { version } : {}),
    ...(match ? {} : { unversioned: true as const }),
    ...(variant ? { variant } : {}),
  };
}

/** The sku without its snapshot. */
export function skuBase(sku: string): string {
  return sku.split('@')[0];
}

/**
 * Does `available` satisfy an announcement of `announced`? The same model, or a member of its line
 * by whole hyphen tokens: `gpt-6` is satisfied by `gpt-6-sol`, never by `gpt-6.5`.
 */
export function satisfies(announced: string, available: string): boolean {
  const a = skuBase(announced);
  const b = skuBase(available);
  return a === b || b.startsWith(`${a}-`);
}
