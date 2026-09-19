import type { Drop } from '../domain/drop';
import { labForOpenRouterId } from '../domain/lab';
import { cachedJson } from '../infra/edge-cache';
import { toIso } from '../infra/text';

export interface OpenRouterModelDto {
  id?: string;
  name?: string;
  /** Unix seconds. */
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const TTL_SECONDS = 600;

/** Aliases (`~vendor/latest`), batch variants and OpenRouter's own routers are not drops. */
function isListing(
  model: OpenRouterModelDto,
): model is Required<Pick<OpenRouterModelDto, 'id' | 'name' | 'created'>> & OpenRouterModelDto {
  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    Number.isFinite(model.created) &&
    !model.id.startsWith('~') &&
    !model.id.endsWith(':batch') &&
    !model.id.startsWith('openrouter/')
  );
}

function perMillion(perToken: string | undefined): number | undefined {
  const n = Number.parseFloat(perToken ?? 'NaN') * 1e6;
  return Number.isFinite(n) ? n : undefined;
}

export function toDrop(model: OpenRouterModelDto): Drop | undefined {
  if (!isListing(model)) return undefined;
  const lab = labForOpenRouterId(model.id);
  const prompt = perMillion(model.pricing?.prompt);
  return {
    id: model.id,
    name: model.name.replace(/^[^:]+:\s*/, ''),
    lab: lab?.name ?? model.name.split(':')[0],
    labId: lab?.id,
    createdAt: toIso(model.created * 1000) ?? new Date(0).toISOString(),
    context: model.context_length,
    promptPerM: prompt,
    completionPerM: perMillion(model.pricing?.completion),
    modality: model.architecture?.modality,
    url: `https://openrouter.ai/${model.id.split('/').map(encodeURIComponent).join('/')}`,
    free: model.id.endsWith(':free') || prompt === 0,
  };
}

/** All listings, newest first. */
export async function fetchDrops(): Promise<Drop[]> {
  const { data } = await cachedJson<{ data?: OpenRouterModelDto[] }>(MODELS_URL, { ttl: TTL_SECONDS });
  return (data ?? [])
    .map(toDrop)
    .filter((d): d is Drop => d !== undefined)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
