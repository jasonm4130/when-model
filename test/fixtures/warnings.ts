import type { EarlyWarnings } from '../../src/domain/early-warnings';

/** Early warnings with one of each lead signal; only the fields `leadFlags` reads matter. */
export function warnings(): EarlyWarnings {
  const track = { summary: '', n: 0 };
  return {
    scored: false,
    stealth: {
      ok: true,
      items: [
        {
          id: 'stealth/space-bunny-alpha',
          name: 'Space Bunny Alpha',
          createdAt: '2026-09-23T14:48:04Z',
          daysInStealth: 2.6,
          claimsFrontier: false,
        },
      ],
      track,
    },
    leaks: {
      ok: true,
      items: [
        {
          source: 'testingcatalog',
          sourceName: 'TestingCatalog',
          title: 'OpenAI tests GPT-6.1 ahead of release',
          url: 'https://www.testingcatalog.com/gpt-6-1',
          publishedAt: '2026-09-25T08:00:00Z',
          labId: 'openai',
          modelIds: ['gpt-6.1'],
          cue: 'ahead of release',
        },
        {
          source: 'hn',
          sourceName: 'Hacker News',
          title: 'GPT-6.1 spotted in the API',
          url: 'https://news.ycombinator.com/item?id=9',
          publishedAt: '2026-09-25T09:00:00Z',
          labId: 'openai',
          modelIds: ['gpt-6.1'],
          cue: 'spotted',
        },
      ],
      track,
      sources: [
        { source: 'hn', ok: true },
        { source: 'testingcatalog', ok: true },
      ],
      checkedAgainstListings: true,
    },
    broadcasts: {
      ok: true,
      items: [
        {
          videoId: 'v1',
          channel: 'OpenAI',
          labId: 'openai',
          title: 'OpenAI DevDay 2026 keynote',
          url: 'https://www.youtube.com/watch?v=v1',
          publishedAt: '2026-09-25T00:00:00Z',
          views: 0,
          scheduledStartTime: '2026-09-29T17:00:00Z',
          startsInHours: 5.4,
          confirmed: true,
        },
      ],
      track,
    },
    architectures: {
      ok: true,
      items: [
        {
          module: 'qwen4_exp',
          labId: 'qwen',
          since: '2026-08-26T00:00:00Z',
          sinceSource: 'seed',
          daysPending: 31.2,
          pending: true,
          frontier: true,
        },
      ],
      track,
      checkedAgainstListings: true,
    },
    events: {
      items: [
        {
          id: 'devday-2026',
          label: 'OpenAI DevDay 2026',
          labId: 'openai',
          start: '2026-09-29T17:00:00Z',
          windowStart: '2026-09-26T17:00:00Z',
          windowEnd: '2026-09-30T17:00:00Z',
          source: 'https://devday.openai.com',
          hoursToStart: 70.2,
        },
      ],
      track,
    },
  };
}
