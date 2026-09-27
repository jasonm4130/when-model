import type { ChatModel } from '../domain/availability';
import { cachedJson } from '../infra/edge-cache';

/** One model in chat.qwen.ai's web-app list (an undocumented internal API; the list sits at `data.data`). */
export interface QwenChatModelDto {
  id?: string;
  name?: string;
  owned_by?: string;
  info?: { is_active?: boolean; is_visitor_active?: boolean };
}

interface QwenChatBody {
  success?: boolean;
  data?: { data?: QwenChatModelDto[] };
}

export const QWEN_CHAT_MODELS_URL = 'https://chat.qwen.ai/api/v2/models';
/** Cron-only, and the origin sends `no-cache`: each 15-minute capture reads a fresh list. */
const TTL_SECONDS = 60;

export function toChatModel(dto: QwenChatModelDto): ChatModel | undefined {
  if (typeof dto.id !== 'string' || !dto.id) return undefined;
  const visitor = dto.info?.is_visitor_active;
  return {
    id: dto.id,
    name: typeof dto.name === 'string' && dto.name ? dto.name : dto.id,
    active: dto.info?.is_active === true,
    ...(typeof visitor === 'boolean' ? { visitorActive: visitor } : {}),
  };
}

/**
 * A usable body: JSON with `success` not false and a non-empty `data.data`. An HTML page (a
 * login wall or challenge), `success: false` or an empty list fails, so the source reads down
 * rather than seeding an empty baseline.
 */
export function isQwenChatBody(body: string): boolean {
  if (/^\s*</.test(body)) return false;
  try {
    const parsed = JSON.parse(body) as QwenChatBody;
    return parsed?.success !== false && Array.isArray(parsed?.data?.data) && parsed.data.data.length > 0;
  } catch {
    return false;
  }
}

/** Every model chat.qwen.ai lists, active or not. */
export async function fetchQwenChatModels(): Promise<ChatModel[]> {
  const body = await cachedJson<QwenChatBody>(QWEN_CHAT_MODELS_URL, {
    ttl: TTL_SECONDS,
    validate: isQwenChatBody,
  });
  return (body.data?.data ?? []).map(toChatModel).filter((m): m is ChatModel => m !== undefined);
}
