import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const DEFAULT_URL = 'https://whenmodel.com/api/dashboard.json';
export const LEAD_WINDOWS = Object.freeze({ '24h': 24, '72h': 72, '7d': 24 * 7 });

export function parseIso(value, field) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new Error(`${field} must be an ISO timestamp`);
  return time;
}

export function validateDashboard(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('dashboard response must be a JSON object');
  }
  parseIso(response.generatedAt, 'dashboard.generatedAt');
  if (!response.dropcon || typeof response.dropcon !== 'object')
    throw new Error('dashboard.dropcon is missing');
  if (!Array.isArray(response.labs)) throw new Error('dashboard.labs must be an array');
  if (!Array.isArray(response.drops)) throw new Error('dashboard.drops must be an array');
  return response;
}

export function qualityForDashboard(response) {
  const failedSources = Array.isArray(response.sources)
    ? response.sources
        .filter((source) => source && source.ok === false)
        .map((source) => source.name ?? 'unknown')
    : [];
  const measurement = response.measurement;
  const algorithmVersion = measurement?.algorithmVersion ?? response.algorithmVersion ?? null;
  const schemaVersion =
    measurement?.schema ??
    measurement?.schemaVersion ??
    response.schemaVersion ??
    response.dashboardSchema ??
    null;
  const notes = [];
  if (!measurement) notes.push('legacy snapshot: exact score inputs were not recorded');
  if (failedSources.length) notes.push(`degraded sources: ${failedSources.join(', ')}`);
  return {
    status: failedSources.length ? 'degraded' : measurement ? 'complete' : 'legacy',
    failedSources,
    notes,
    algorithmVersion,
    schemaVersion,
  };
}

/** @param {any} options */
export function makeEnvelope({
  response,
  fetchedAt = new Date().toISOString(),
  requestStartedAt,
  url = DEFAULT_URL,
  collectorRevision = null,
  responseText = JSON.stringify(response),
}) {
  validateDashboard(response);
  parseIso(fetchedAt, 'fetchedAt');
  if (requestStartedAt) parseIso(requestStartedAt, 'requestStartedAt');
  const dashboardGeneratedAt = response.generatedAt;
  const sha256 = createHash('sha256').update(responseText).digest('hex');
  const quality = qualityForDashboard(response);
  return {
    format: 'whenmodel-dashboard-snapshot/v1',
    ...(requestStartedAt ? { requestStartedAt } : {}),
    fetchedAt,
    url,
    dashboardGeneratedAt,
    schemaVersion: quality.schemaVersion,
    algorithmVersion: quality.algorithmVersion,
    collectorRevision,
    responseSha256: sha256,
    quality,
    responseText,
    response,
  };
}

export async function collectorRevision(cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** @param {any} options */
export async function captureSnapshot({
  directory,
  url = DEFAULT_URL,
  maxAgeMinutes = 15,
  allowStale = false,
  fetchImpl = fetch,
  now = () => new Date(),
  revision,
} = {}) {
  if (!directory) throw new Error('--dir is required');
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 0) {
    throw new Error('--max-age-minutes must be a non-negative number');
  }
  const requestStartedAt = now().toISOString();
  const result = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!result.ok) throw new Error(`dashboard request failed: HTTP ${result.status}`);
  const responseText = await result.text();
  const fetchedAt = now().toISOString();
  let response;
  try {
    response = JSON.parse(responseText);
  } catch {
    throw new Error('dashboard response is not valid JSON');
  }
  validateDashboard(response);
  const ageMs = parseIso(fetchedAt, 'fetchedAt') - parseIso(response.generatedAt, 'dashboard.generatedAt');
  if (ageMs < -60_000) throw new Error('dashboard.generatedAt is in the future');
  if (ageMs > maxAgeMinutes * 60_000 && !allowStale) {
    throw new Error(
      `dashboard is stale (${Math.round(ageMs / 60_000)} minutes old; use --allow-stale to archive it explicitly)`,
    );
  }
  const envelope = makeEnvelope({
    response,
    fetchedAt,
    requestStartedAt,
    url,
    collectorRevision: revision === undefined ? await collectorRevision() : revision,
  });
  if (ageMs > maxAgeMinutes * 60_000)
    envelope.quality.notes.push(`stale at collection: ${Math.round(ageMs / 60_000)} minutes old`);
  await mkdir(directory, { recursive: true });
  const stamp = fetchedAt.replace(/[:.]/g, '-');
  const path = join(resolve(directory), `${stamp}-${envelope.responseSha256.slice(0, 12)}.json`);
  await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { path, envelope };
}

/**
 * A lab's 7- and 30-day odds in any schema: v4 dashboards read `odds.p7`/`odds.p30` off the lab's
 * family curve (null when the read was extrapolated and so not trusted); v3 and earlier carried
 * `weekOdds`/`monthOdds`.
 */
function labOdds(lab, horizon, legacy) {
  const read = lab.odds?.[horizon];
  if (read && typeof read === 'object') return read.trusted === false ? null : (read.p ?? null);
  return lab[legacy]?.p ?? null;
}

function metricsFor(response, labId) {
  const lab = response.labs.find((candidate) => candidate?.id === labId);
  if (!lab) return null;
  return {
    heat: lab.heat ?? null,
    status: lab.status ?? null,
    weekOdds: labOdds(lab, 'p7', 'weekOdds'),
    monthOdds: labOdds(lab, 'p30', 'monthOdds'),
    globalScore: response.dropcon?.score ?? null,
    globalLevel: response.dropcon?.level ?? null,
  };
}

function matchesRelease(drop, release) {
  if (!drop || drop.labId !== release.labId) return false;
  const model = release.model.trim().toLowerCase();
  return [drop.id, drop.id?.split('/').at(-1), drop.name, drop.url].some(
    (value) => typeof value === 'string' && value.toLowerCase() === model,
  );
}

/** @param {any[]} snapshots @param {any[]} releases */
export function evaluateSnapshots(snapshots, releases) {
  const ordered = snapshots
    .filter((snapshot) => snapshot?.response && Number.isFinite(Date.parse(snapshot.fetchedAt)))
    .sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
  return releases.map((release) => {
    if (!release?.labId || !release?.model || !release?.releasedAt || !release?.sourceUrl) {
      throw new Error('each release needs labId, model, releasedAt, and sourceUrl');
    }
    const releasedAt = parseIso(release.releasedAt, 'release.releasedAt');
    const leadUp = Object.fromEntries(
      Object.entries(LEAD_WINDOWS).map(([name, hours]) => {
        const eligible = ordered.filter((snapshot) => {
          const fetched = Date.parse(snapshot.fetchedAt);
          return fetched < releasedAt && fetched >= releasedAt - hours * 60 * 60 * 1000;
        });
        const snapshot = eligible.at(-1);
        return [
          name,
          snapshot
            ? {
                outcome: 'observed',
                snapshotCount: eligible.length,
                snapshotFetchedAt: snapshot.fetchedAt,
                dashboardGeneratedAt: snapshot.dashboardGeneratedAt ?? snapshot.response.generatedAt,
                leadTimeMs: releasedAt - Date.parse(snapshot.fetchedAt),
                quality: snapshot.quality ?? qualityForDashboard(snapshot.response),
                metrics: metricsFor(snapshot.response, release.labId),
              }
            : { outcome: 'unobserved', snapshotCount: 0 },
        ];
      }),
    );
    const post = ordered.filter((snapshot) => Date.parse(snapshot.fetchedAt) >= releasedAt);
    const detected = post.find((snapshot) =>
      snapshot.response.drops?.find((drop) => matchesRelease(drop, release)),
    );
    const listing = detected?.response.drops.find((drop) => matchesRelease(drop, release));
    const firstDetectedListing = detected
      ? {
          outcome: 'detected',
          snapshotFetchedAt: detected.fetchedAt,
          delayFromOfficialReleaseMs: Date.parse(detected.fetchedAt) - releasedAt,
          listing: {
            id: listing.id ?? null,
            name: listing.name ?? null,
            url: listing.url ?? null,
            sourceListedAt: listing.createdAt ?? null,
          },
        }
      : {
          outcome: post.length ? 'not_detected_in_archive' : 'unobserved',
          snapshotsObserved: post.length,
        };
    return {
      release: { ...release, releasedAt: new Date(releasedAt).toISOString() },
      leadUp,
      firstDetectedListing,
    };
  });
}

export async function readArchive(directory) {
  const { readdir } = await import('node:fs/promises');
  const paths = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const snapshots = [];
  for (const file of paths) {
    try {
      const snapshot = JSON.parse(await readFile(join(directory, file), 'utf8'));
      if (snapshot.format !== 'whenmodel-dashboard-snapshot/v1') throw new Error('unknown snapshot format');
      validateDashboard(snapshot.response);
      if (typeof snapshot.responseText !== 'string') {
        // Earlier local v1 experiments did not retain transport bytes. Accept only the
        // canonical-hash variant; raw-only snapshots cannot be integrity-verified.
        const canonicalSha256 = createHash('sha256').update(JSON.stringify(snapshot.response)).digest('hex');
        if (snapshot.responseSha256 !== canonicalSha256) {
          throw new Error('response body was not retained, so its SHA-256 cannot be verified');
        }
      } else {
        const actualSha256 = createHash('sha256').update(snapshot.responseText).digest('hex');
        if (snapshot.responseSha256 !== actualSha256)
          throw new Error('response SHA-256 does not match response body');
        let rawResponse;
        try {
          rawResponse = JSON.parse(snapshot.responseText);
        } catch {
          throw new Error('retained response body is not valid JSON');
        }
        if (JSON.stringify(rawResponse) !== JSON.stringify(snapshot.response)) {
          throw new Error('retained response body does not match response');
        }
      }
      snapshots.push(snapshot);
    } catch (error) {
      throw new Error(`cannot read snapshot ${basename(file)}: ${error.message}`);
    }
  }
  return snapshots;
}

export async function readReleaseEvents(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read release events: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('release events JSON must be an array');
  return parsed;
}

export function usage(command) {
  return command === 'capture'
    ? 'Usage: node scripts/capture-dashboard.mjs --dir <archive-dir> [--url <url>] [--max-age-minutes <n>] [--allow-stale]\n\nCaptures one public dashboard response in an immutable JSON envelope.'
    : 'Usage: node scripts/evaluate-dashboard.mjs --archive <archive-dir> --releases <events.json> [--out <report.json>]\n\nEvents are a JSON array of { labId, model, releasedAt, sourceUrl }. Reports observations only; gaps are unobserved.';
}
