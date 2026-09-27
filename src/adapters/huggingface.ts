import type { HubRepo } from '../domain/availability';
import type { Paper, TrendingRepo } from '../domain/community';
import { cachedJson } from '../infra/edge-cache';
import { toIso } from '../infra/text';

export interface HfModelDto {
  id?: string;
  likes?: number;
  downloads?: number;
  createdAt?: string;
  trendingScore?: number;
  pipeline_tag?: string;
}
export interface HfPaperDto {
  paper?: { id?: string; title?: string; upvotes?: number; publishedAt?: string };
  publishedAt?: string;
  title?: string;
}

const HF = 'https://huggingface.co';

export function toTrendingRepo(model: HfModelDto): TrendingRepo | undefined {
  if (typeof model.id !== 'string') return undefined;
  return {
    id: model.id,
    url: `${HF}/${model.id}`,
    likes: model.likes ?? 0,
    downloads: model.downloads ?? 0,
    createdAt: toIso(model.createdAt) ?? new Date(0).toISOString(),
    score: model.trendingScore ?? 0,
  };
}

export function toPaper(dto: HfPaperDto): Paper | undefined {
  const id = dto.paper?.id;
  if (typeof id !== 'string') return undefined;
  return {
    id,
    title: dto.paper?.title ?? dto.title ?? id,
    url: `${HF}/papers/${encodeURIComponent(id)}`,
    upvotes: dto.paper?.upvotes ?? 0,
    publishedAt: toIso(dto.publishedAt ?? dto.paper?.publishedAt) ?? new Date(0).toISOString(),
  };
}

/**
 * Pipelines that hold chat models. Vision-language releases (DeepSeek-V4.1-Flash, Qwen3.8-27B)
 * are tagged image-text-to-text, so filtering on text-generation alone hid them.
 */
export const LANGUAGE_PIPELINES: ReadonlySet<string> = new Set([
  'text-generation',
  'image-text-to-text',
  'any-to-any',
]);
/** Trending models fetched before filtering; about half are language models on a typical day. */
const TRENDING_POOL = 60;

/** Hub trending, kept to language pipelines. The Hub ignores a repeated `pipeline_tag`, so filter here. */
export function languageTrending(models: readonly HfModelDto[], limit: number): TrendingRepo[] {
  return models
    .filter((m) => typeof m.pipeline_tag === 'string' && LANGUAGE_PIPELINES.has(m.pipeline_tag))
    .map(toTrendingRepo)
    .filter((r): r is TrendingRepo => r !== undefined)
    .slice(0, limit);
}

export async function fetchTrending(limit = 12): Promise<TrendingRepo[]> {
  const url = `${HF}/api/models?sort=trendingScore&direction=-1&limit=${TRENDING_POOL}`;
  return languageTrending((await cachedJson<HfModelDto[] | null>(url, { ttl: 900 })) ?? [], limit);
}

export async function fetchPapers(limit = 8): Promise<Paper[]> {
  const papers = await cachedJson<HfPaperDto[] | null>(`${HF}/api/daily_papers?limit=${limit}`, {
    ttl: 1800,
  });
  return (papers ?? []).map(toPaper).filter((p): p is Paper => p !== undefined);
}

/** One repo in an organisation listing. `private` is true only for a repo the caller may see privately. */
export interface HfOrgRepoDto {
  id?: string;
  private?: boolean;
  pipeline_tag?: string | null;
  createdAt?: string;
}

/** Newest-created first; 100 covers weeks of any lab's uploads (quantisations included). */
export const HF_ORG_LIMIT = 100;
/** Cron-only: each 15-minute capture reads a fresh listing. */
const ORG_TTL_SECONDS = 60;

export function hfOrgUrl(org: string): string {
  return `${HF}/api/models?author=${encodeURIComponent(org)}&sort=createdAt&direction=-1&limit=${HF_ORG_LIMIT}`;
}

/**
 * A public text repo, or undefined. A repo tagged with a pipeline outside `LANGUAGE_PIPELINES`
 * (image, speech, embeddings) is not a language model; an untagged one is judged by its name later.
 */
export function toHubRepo(dto: HfOrgRepoDto): HubRepo | undefined {
  if (typeof dto.id !== 'string' || !dto.id.includes('/') || dto.private === true) return undefined;
  const tag = typeof dto.pipeline_tag === 'string' ? dto.pipeline_tag : undefined;
  if (tag && !LANGUAGE_PIPELINES.has(tag)) return undefined;
  const createdAt = toIso(dto.createdAt);
  return { id: dto.id, ...(tag ? { pipelineTag: tag } : {}), ...(createdAt ? { createdAt } : {}) };
}

/**
 * One organisation's newest repos for the availability ledger. The Hub pages by a cursor in the
 * Link header, which the edge cache drops, so this reads the first page only. Throws on anything
 * but a non-empty array, so a changed format turns the source red instead of seeding nothing.
 */
export async function fetchHfOrg(org: string): Promise<HubRepo[]> {
  const models = await cachedJson<HfOrgRepoDto[] | null>(hfOrgUrl(org), { ttl: ORG_TTL_SECONDS });
  if (!Array.isArray(models) || models.length === 0)
    throw new Error(`Hugging Face listed no models for ${org}`);
  return models.map(toHubRepo).filter((r): r is HubRepo => r !== undefined);
}
