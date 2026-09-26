import type { Drop } from '../domain/drop';
import { labForOpenRouterId } from '../domain/lab';
import { isStealthSlot } from '../domain/stealth';
import { cachedJson } from '../infra/edge-cache';
import { toIso } from '../infra/text';

export interface OpenRouterModelDto {
  id?: string;
  canonical_slug?: string;
  name?: string;
  /** Unix seconds. */
  created?: number;
  description?: string;
  context_length?: number;
  /** Per token, as decimal strings. Routers report "-1". */
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; output_modalities?: string[]; tokenizer?: string };
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TTL_SECONDS = 600;

/** "Vendor: Model" names; the vendor part is the lab label for labs outside the registry. */
const VENDOR_PREFIX = /^([^:]+):\s*/;

/**
 * Aliases (`~vendor/latest`), batch variants and routers are not drops. Routers carry the `Router`
 * tokenizer, third-party ones included; `toDrop` also drops every `openrouter/*` id that is not a
 * stealth slot, so OpenRouter's own routers stay out even without one.
 */
function isListing(
  model: OpenRouterModelDto,
): model is Required<Pick<OpenRouterModelDto, 'id' | 'name' | 'created'>> & OpenRouterModelDto {
  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    Number.isFinite(model.created) &&
    !model.id.startsWith('~') &&
    !model.id.endsWith(':batch') &&
    model.architecture?.tokenizer !== 'Router'
  );
}

/** Negative prices are a sentinel ("-1" on routers), not a price. */
function perMillion(perToken: string | undefined): number | undefined {
  const n = Number.parseFloat(perToken ?? 'NaN') * 1e6;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** `output_modalities`, else the right-hand side of `modality` ("text+image->text"). */
function outputModalities(architecture: OpenRouterModelDto['architecture']): string[] | undefined {
  const listed = architecture?.output_modalities;
  if (Array.isArray(listed)) return listed.filter((m): m is string => typeof m === 'string');
  const out = architecture?.modality?.split('->')[1];
  return out ? out.split('+').filter(Boolean) : undefined;
}

export function toDrop(model: OpenRouterModelDto): Drop | undefined {
  if (!isListing(model)) return undefined;
  const prompt = perMillion(model.pricing?.prompt);
  const completion = perMillion(model.pricing?.completion);
  const stealth = isStealthSlot({
    id: model.id,
    name: model.name,
    promptPerM: prompt,
    completionPerM: completion,
  });
  // Everything else under openrouter/ is one of OpenRouter's routers.
  if (model.id.startsWith('openrouter/') && !stealth) return undefined;
  const lab = labForOpenRouterId(model.id);
  const outputs = outputModalities(model.architecture);
  return {
    id: model.id,
    name: model.name.replace(VENDOR_PREFIX, ''),
    lab: stealth ? 'Stealth' : (lab?.name ?? VENDOR_PREFIX.exec(model.name)?.[1] ?? model.id.split('/')[0]),
    labId: lab?.id,
    createdAt: toIso(model.created * 1000) ?? new Date(0).toISOString(),
    context: model.context_length,
    promptPerM: prompt,
    completionPerM: completion,
    modality: model.architecture?.modality,
    url: `https://openrouter.ai/${model.id.split('/').map(encodeURIComponent).join('/')}`,
    free: model.id.endsWith(':free') || prompt === 0,
    canonicalSlug: typeof model.canonical_slug === 'string' ? model.canonical_slug : undefined,
    outputModalities: outputs,
    textOutput: outputs ? outputs.length > 0 && outputs.every((m) => m === 'text') : undefined,
    stealth,
    description: stealth && typeof model.description === 'string' ? model.description : undefined,
  };
}

/** All listings, stealth slots included, newest first. */
export async function fetchDrops(): Promise<Drop[]> {
  const { data } = await cachedJson<{ data?: OpenRouterModelDto[] }>(MODELS_URL, { ttl: TTL_SECONDS });
  return (data ?? [])
    .map(toDrop)
    .filter((d): d is Drop => d !== undefined)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
