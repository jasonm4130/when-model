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
