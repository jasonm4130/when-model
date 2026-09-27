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
  /**
   * A date as the id wrote it: `20260420`, `2025-07-28`, `09-2025`, the grammar's MMDD `0731`,
   * Qwen's YYMM `2507` or an MM-DD `02-23`.
   */
  snapshot?: string;
  /** The leading word of the base: `gpt`, `claude`, `qwen` … */
  family: string;
  /** The version the grammar matched (`3.8` for `qwen3.8-27b`); absent on an unversioned id. */
  version?: string;
  /** No versioned id matched, so `base` is the stripped slug (`gpt-chat-latest`, `grok-build-0.1`). */
  unversioned?: true;
  /**
   * A word folded into its model rather than kept in the sku: "contributor" in
   * `muse-spark-1.2-contributor`, which the labelled review counts as Muse Spark 1.2's cheaper
   * tier. The tier rules read it separately.
   */
  variant?: string;
}

/** A trailing date on a bare id: YYYYMMDD, YYYY-MM-DD or MM-YYYY. The grammar's MMDD is read after it. */
const ID_DATE = /[-_](\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{4})$/;
const GRAMMAR_DATE = /-([01]\d[0-3]\d)$/;
/**
 * A date among the words past the grammar, wherever it sits (`-Instruct-2507-FP8`): YYYYMMDD,
 * YYYY-MM-DD, MM-YYYY, MMDD (`chat-0628`), Qwen's YYMM (`a22b-2507`) and MM-DD (`flash-02-23`).
 * The two four-digit forms never collide: a month starts 0 or 1, a year 2.
 */
const REST_DATE =
  /(?:^|-)(\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{4}|[01]\d[0-3]\d|2\d(?:0[1-9]|1[0-2])|(?:0[1-9]|1[0-2])-[0-3]\d)(?=-|$)/;
/** OpenRouter's routing variants of one model: `:free`, `:batch`, `:thinking`, `:extended`. */
const ROUTE_VARIANT = /:[a-z0-9-]+$/i;
/**
 * Words that package a model rather than name one: an instruction tune, a base checkpoint, a
 * format or a quantisation. The sku ends at the first (a date after it is still read), so
 * `-Instruct-FP8`, `-it-qat-q4_0-unquantized` and `-GPTQ-Int4` never make a model of their own.
 */
const PACKAGING =
  /^(?:instruct|it|base|hf|original|gguf|awq|gptq|mlx|qat|onnx|exl2|unquantized|(?:nv|mx)?fp\d+|bf16|int\d+|w\d+a\d+|q\d+|\d+bit)$/;
/** A mixture-of-experts model's active parameters (`a22b`): its total size already names it. */
const ACTIVE_PARAMS = /^a\d+(?:\.\d+)?b$/;
/** Folded into their model, kept as `variant` (see `CanonicalModel.variant`). */
const FOLDED_WORDS: ReadonlySet<string> = new Set(['contributor']);
/** Generators and encoders, not chat models: an image, speech or video model is never a text release. */
const NON_TEXT =
  /(?:^|-)(?:image|imagen|veo|sora|lyria|video|audio|speech|tts|asr|embed|embedding|reranker|janus(?:flow)?)(?:-|$)/;

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

/**
 * The words an id carries past the grammar's match, read into the sku: `-a22b-thinking-2507` gives
 * `thinking` and the snapshot `2507`; `-vl-235b-a22b-instruct` gives `vl`, `235b`. Each word names
 * the model (vl, mini, high, chat, terminus, distill, a size …) unless it packages it (`PACKAGING`,
 * which ends the sku), is an active-parameter count, or is folded (`FOLDED_WORDS`).
 */
function readRest(rest: string): { words: string[]; snapshot?: string; variant?: string } {
  const slug = rest
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((w) => /[a-z0-9]/.test(w))
    .join('-');
  const date = REST_DATE.exec(slug);
  const undated = date ? slug.slice(0, date.index) + slug.slice(date.index + date[0].length) : slug;
  const words: string[] = [];
  let variant: string | undefined;
  for (const word of undated.split('-').filter(Boolean)) {
    if (PACKAGING.test(word)) break;
    if (ACTIVE_PARAMS.test(word)) continue;
    if (FOLDED_WORDS.has(word)) variant ??= word;
    else words.push(word);
  }
  return { words, ...(date ? { snapshot: date[1] } : {}), ...(variant ? { variant } : {}) };
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
 * Steps: strip the source's namespace and routing variant, pull a trailing date into `snapshot`,
 * read the id with the headline grammar (then the display name), and read the words the id carries
 * past the grammar's match into the sku (`readRest`), so `qwen3-235b-a22b-2507`,
 * `qwen3-vl-235b-a22b-instruct`, `o3-mini-high` and `deepseek-v3.1-terminus` each stay a model of
 * their own. A lone digit right after the version continues it: `mistral-medium-3-5` is 3.5. Then
 * the family rewrites, and for an id with no version the stripped slug, tagged `unversioned`. A
 * title is read by the grammar alone: the words after its model are the headline's, not the id's.
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

  // OpenRouter's display name ends in "(free)" or "(beta)" on some listings: not a model word.
  const name = hint.name?.replace(/^[^:]+:\s*/, '').replace(/\s*\([^)]*\)/g, '');
  let match = matchAt(slug, title);
  let rest = match ? slug.slice(match.end) : '';
  if (!match && name && !title) {
    match = matchAt(name, false);
    rest = match ? name.slice(match.end) : '';
  }

  let base: string;
  let version: string | undefined;
  let variant: string | undefined;
  if (match) {
    base = match.id;
    const mmdd = GRAMMAR_DATE.exec(base);
    if (mmdd && !snapshot) {
      snapshot = mmdd[1];
      base = base.slice(0, mmdd.index);
    }
    if (!title) {
      const past = readRest(rest);
      let words = past.words;
      if (/^\d$/.test(words[0] ?? '') && /^[-_]\d(?!\d)/.test(rest) && /\d$/.test(base)) {
        base = `${base}.${words[0]}`;
        words = words.slice(1);
      }
      base = [base, ...words].join('-');
      snapshot ??= past.snapshot;
      variant = past.variant;
    }
    base = rewriteFamily(base);
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

/** Two spellings of one snapshot date: `1015`, `10-15` and `20261015` all name 15 October. */
function sameSnapshot(a: string, b: string): boolean {
  const [x, y] = [a.replace(/\D/g, ''), b.replace(/\D/g, '')].sort((p, q) => p.length - q.length);
  return x === y || (x.length === 4 && y.length === 8 && y.endsWith(x));
}

/**
 * Does `available` satisfy an announcement of `announced`? The same model, or a member of its line
 * by whole hyphen tokens: `gpt-6` is satisfied by `gpt-6-sol`, never by `gpt-6.5`. An announced
 * snapshot needs that snapshot: "DeepSeek-V4-Flash-1015 Release" is not satisfied by the
 * deepseek-v4-flash that shipped in April. An announced preview is satisfied by its line: the post
 * "DeepSeek-V4 Preview Release" launched deepseek-v4-flash and deepseek-v4-pro.
 */
export function satisfies(announced: string, available: string): boolean {
  const [a, aSnapshot] = announced.split('@');
  const [b, bSnapshot] = available.split('@');
  if (aSnapshot && !(bSnapshot && sameSnapshot(aSnapshot, bSnapshot))) return false;
  const line = a.replace(/-preview$/, '');
  return b === a || b === line || b.startsWith(`${line}-`);
}
