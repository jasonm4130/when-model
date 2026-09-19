import { cachedJson } from '../fetch';

interface HfModel { id: string; likes: number; downloads: number; createdAt: string; trendingScore?: number; pipeline_tag?: string }
interface HfPaper { paper: { id: string; title: string; upvotes?: number; publishedAt?: string }; publishedAt?: string; title?: string }

export interface Trending { id: string; url: string; likes: number; downloads: number; createdAt: string; score: number }
export interface Paper { id: string; title: string; url: string; upvotes: number; publishedAt: string }

export async function fetchTrending(limit = 12): Promise<Trending[]> {
  const models = await cachedJson<HfModel[]>(`https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${limit}&pipeline_tag=text-generation`, 900);
  return models.map((m) => ({ id: m.id, url: `https://huggingface.co/${m.id}`, likes: m.likes, downloads: m.downloads, createdAt: m.createdAt, score: m.trendingScore ?? 0 }));
}

export async function fetchPapers(limit = 8): Promise<Paper[]> {
  const papers = await cachedJson<HfPaper[]>(`https://huggingface.co/api/daily_papers?limit=${limit}`, 1800);
  return papers.map((p) => ({
    id: p.paper.id,
    title: p.paper.title ?? p.title ?? p.paper.id,
    url: `https://huggingface.co/papers/${p.paper.id}`,
    upvotes: p.paper.upvotes ?? 0,
    publishedAt: p.publishedAt ?? p.paper.publishedAt ?? new Date().toISOString(),
  }));
}
