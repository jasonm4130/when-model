/** Hugging Face signals: what the open-weights crowd is downloading and reading. */
export interface TrendingRepo {
  id: string;
  url: string;
  likes: number;
  downloads: number;
  createdAt: string;
  score: number;
}

export interface Paper {
  id: string;
  title: string;
  url: string;
  upvotes: number;
  publishedAt: string;
}
