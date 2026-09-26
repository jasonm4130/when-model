/**
 * Architecture-merged radar (report T1-4): Qwen and Z.ai add model code to Hugging Face
 * `transformers` before a public release. A `models/<name>` module with no matching listing yet
 * is a lab-scoped pre-release flag.
 *
 * `raw.githubusercontent.com` egress from a Worker is unverified per the critic (GitHub throttles
 * unauthenticated shared-IP traffic); `cdn.jsdelivr.net` is the verified fallback — both returned
 * `200 16777` with identical content on 2026-09-26 (`from .qwen4_exp import *` in both), and
 * jsdelivr's `s-maxage=43200` lag (≤12h) doesn't matter for the multi-day leads this signal is
 * built for.
 */
import type { LabId } from '../domain/lab';
import type { PendingArchitecture } from '../domain/lead';
import { cachedText } from '../infra/edge-cache';

const PRIMARY_URL =
  'https://raw.githubusercontent.com/huggingface/transformers/main/src/transformers/models/__init__.py';
const FALLBACK_URL =
  'https://cdn.jsdelivr.net/gh/huggingface/transformers@main/src/transformers/models/__init__.py';

const MODULE_IMPORT = /^\s*from \.([a-zA-Z_][a-zA-Z0-9_]*) import \*/gm;

/** `from .X import *` lines → module names. Pure; matches the generator transformers itself uses. */
export function parseModuleNames(source: string): string[] {
  return [...source.matchAll(MODULE_IMPORT)].map((m) => m[1]);
}

/** A 200 that isn't the registry (rate-limit page, format change) must fail, not read as "no modules". */
async function fetchModuleList(url: string): Promise<string[]> {
  const modules = parseModuleNames(await cachedText(url, { ttl: 1800 }));
  if (!modules.length) throw new Error(`no "from .X import *" lines in ${url}`);
  return modules;
}

/** Primary fetch, falling back to the jsdelivr mirror on any failure. Throws only if both fail. */
export async function fetchTransformersModules(): Promise<string[]> {
  try {
    return await fetchModuleList(PRIMARY_URL);
  } catch (e) {
    console.error('[source:transformers-arch primary]', e instanceof Error ? e.message : e);
    return fetchModuleList(FALLBACK_URL);
  }
}

/**
 * Every `models/<name>` module in `__init__.py` as of 2026-09-26, fetched live via
 * `fetchTransformersModules()` (HTTP 200, 519 modules — matches the report's probe count).
 * A later poll's modules are diffed against this so a module added after today is detected as
 * pending even before D1 first-seen state exists.
 */
export const BASELINE: readonly string[] = [
  'afmoe',
  'aimv2',
  'albert',
  'align',
  'altclip',
  'apertus',
  'arcee',
  'aria',
  'audio_spectrogram_transformer',
  'audioflamingo3',
  'auto',
  'autoformer',
  'axk1',
  'axk2',
  'aya_vision',
  'bamba',
  'bark',
  'bart',
  'barthez',
  'bartpho',
  'beit',
  'bert',
  'bert_generation',
  'bert_japanese',
  'bertweet',
  'big_bird',
  'bigbird_pegasus',
  'biogpt',
  'bit',
  'bitnet',
  'blenderbot',
  'blenderbot_small',
  'blip',
  'blip_2',
  'bloom',
  'blt',
  'bridgetower',
  'bros',
  'byt5',
  'camembert',
  'canary',
  'canine',
  'chameleon',
  'chinese_clip',
  'chmv2',
  'clap',
  'clip',
  'clipseg',
  'clvp',
  'code_llama',
  'codegen',
  'cohere',
  'cohere2',
  'cohere2_moe',
  'cohere2_vision',
  'cohere_asr',
  'cohere_compass',
  'colmodernvbert',
  'colpali',
  'colqwen2',
  'conditional_detr',
  'convbert',
  'convnext',
  'convnextv2',
  'cosmos3_edge',
  'cosmos3_omni',
  'cpm',
  'cpmant',
  'csm',
  'ctrl',
  'cvt',
  'cwm',
  'd_fine',
  'dab_detr',
  'dac',
  'data2vec',
  'dbrx',
  'deberta',
  'deberta_v2',
  'decision_transformer',
  'deepseek_ocr2',
  'deepseek_v2',
  'deepseek_v3',
  'deepseek_v4',
  'deepseek_v32',
  'deepseek_vl',
  'deepseek_vl_hybrid',
  'deformable_detr',
  'deimv2',
  'deit',
  'depth_anything',
  'depth_pro',
  'detr',
  'dia',
  'diffllama',
  'diffusion_gemma',
  'dinat',
  'dinov2',
  'dinov2_with_registers',
  'dinov3_convnext',
  'dinov3_vit',
  'distilbert',
  'doge',
  'donut',
  'dots1',
  'dpr',
  'dpt',
  'edgetam',
  'edgetam_video',
  'efficientloftr',
  'efficientnet',
  'electra',
  'emu3',
  'encodec',
  'encoder_decoder',
  'eomt',
  'eomt_dinov3',
  'ernie',
  'ernie4_5',
  'ernie4_5_moe',
  'ernie4_5_vl_moe',
  'esm',
  'esmc',
  'esmfold2',
  'eurobert',
  'evolla',
  'exaone4',
  'exaone4_5',
  'exaone_moe',
  'falcon',
  'falcon_h1',
  'falcon_mamba',
  'fast_vlm',
  'fastspeech2_conformer',
  'flaubert',
  'flava',
  'flex_olmo',
  'florence2',
  'fnet',
  'focalnet',
  'fsmt',
  'fun_asr_nano',
  'funnel',
  'fuyu',
  'gemma',
  'gemma2',
  'gemma3',
  'gemma3n',
  'gemma4',
  'gemma4_assistant',
  'gemma4_unified',
  'gemma4_unified_assistant',
  'git',
  'glm',
  'glm4',
  'glm4_moe',
  'glm4_moe_lite',
  'glm4v',
  'glm4v_moe',
  'glm5_next',
  'glm46v',
  'glm_image',
  'glm_moe_dsa',
  'glm_ocr',
  'glmasr',
  'glmga',
  'glpn',
  'got_ocr2',
  'gpt2',
  'gpt_bigcode',
  'gpt_neo',
  'gpt_neox',
  'gpt_neox_japanese',
  'gpt_oss',
  'gpt_sw3',
  'gptj',
  'granite',
  'granite4_vision',
  'granite_speech',
  'granite_speech5',
  'granite_speech_plus',
  'granite_swa',
  'granitemoe',
  'granitemoe_swa',
  'granitemoehybrid',
  'granitemoeshared',
  'grounding_dino',
  'groupvit',
  'helium',
  'herbert',
  'hgnet_v2',
  'hiera',
  'higgs_audio_v2',
  'higgs_audio_v2_tokenizer',
  'hrm_text',
  'hubert',
  'hunyuan_v1_dense',
  'hunyuan_v1_moe',
  'hunyuan_vl',
  'hy_v3',
  'hy_v4',
  'hyperclovax',
  'hyperclovax_vision_v2',
  'ibert',
  'idefics',
  'idefics2',
  'idefics3',
  'ijepa',
  'imagegpt',
  'informer',
  'inkling',
  'instructblip',
  'instructblipvideo',
  'internvl',
  'jais2',
  'jamba',
  'janus',
  'jetmoe',
  'jina_embeddings_v3',
  'kimi_k25',
  'kimi_linear',
  'kosmos2',
  'kosmos2_5',
  'kyutai_speech_to_text',
  'laguna',
  'lasr',
  'layoutlm',
  'layoutlmv2',
  'layoutlmv3',
  'layoutxlm',
  'led',
  'levit',
  'lfm2',
  'lfm2_moe',
  'lfm2_vl',
  'lightglue',
  'lighton_ocr',
  'lilt',
  'llama',
  'llama4',
  'llava',
  'llava_next',
  'llava_next_video',
  'llava_onevision',
  'longcat_flash',
  'longformer',
  'longt5',
  'luke',
  'lw_detr',
  'lxmert',
  'm2m_100',
  'mamba',
  'mamba2',
  'marian',
  'markuplm',
  'mask2former',
  'maskformer',
  'mbart',
  'mbart50',
  'megatron_bert',
  'mellum',
  'metaclip_2',
  'mgp_str',
  'mimi',
  'mimo_v2_flash',
  'minicpm3',
  'minicpmv4_6',
  'minicpmv4_7',
  'minimax',
  'minimax_m2',
  'minimax_m3_vl',
  'ministral',
  'ministral3',
  'mistral',
  'mistral3',
  'mistral4',
  'mixtral',
  'mlcd',
  'mllama',
  'mluke',
  'mm_grounding_dino',
  'mobilebert',
  'mobilenet_v1',
  'mobilenet_v2',
  'mobilevit',
  'mobilevitv2',
  'modernbert',
  'modernbert_decoder',
  'modernvbert',
  'moonshine',
  'moonshine_streaming',
  'moshi',
  'mpnet',
  'mpt',
  'mra',
  'mt5',
  'muse_glimmer',
  'muse_glimmer_assistant',
  'musicflamingo',
  'musicgen',
  'musicgen_melody',
  'mvp',
  'myt5',
  'nanochat',
  'nemotron',
  'nemotron3_5_asr',
  'nemotron3_diarization',
  'nemotron_asr_streaming',
  'nemotron_h',
  'nemotron_h_omni',
  'neomme',
  'neucodec',
  'nllb',
  'nllb_moe',
  'nomic_bert',
  'nougat',
  'nystromformer',
  'olmo',
  'olmo2',
  'olmo3',
  'olmo_hybrid',
  'olmoe',
  'omdet_turbo',
  'oneformer',
  'openai',
  'openai_privacy_filter',
  'opt',
  'ovis2',
  'owlv2',
  'owlvit',
  'paddleocr_vl',
  'paligemma',
  'parakeet',
  'patchtsmixer',
  'patchtst',
  'pe_audio',
  'pe_audio_video',
  'pe_video',
  'pegasus',
  'pegasus_x',
  'perceiver',
  'perception_lm',
  'persimmon',
  'phi',
  'phi3',
  'phi4_multimodal',
  'phimoe',
  'phobert',
  'pi0',
  'pix2struct',
  'pixio',
  'pixtral',
  'plbart',
  'poolformer',
  'pop2piano',
  'pp_chart2table',
  'pp_doclayout_v2',
  'pp_doclayout_v3',
  'pp_formulanet',
  'pp_lcnet',
  'pp_lcnet_v3',
  'pp_lcnet_v4',
  'pp_ocrv5_mobile_det',
  'pp_ocrv5_mobile_rec',
  'pp_ocrv5_server_det',
  'pp_ocrv5_server_rec',
  'pp_ocrv6_medium_det',
  'pp_ocrv6_small_det',
  'pp_ocrv6_small_rec',
  'pp_ocrv6_tiny_rec',
  'prompt_depth_anything',
  'prophetnet',
  'pvt',
  'pvt_v2',
  'qianfan_ocr',
  'qwen2',
  'qwen2_5_omni',
  'qwen2_5_vl',
  'qwen2_audio',
  'qwen2_moe',
  'qwen2_vl',
  'qwen3',
  'qwen3_5',
  'qwen3_5_moe',
  'qwen3_asr',
  'qwen3_moe',
  'qwen3_next',
  'qwen3_omni_moe',
  'qwen3_vl',
  'qwen3_vl_moe',
  'qwen4_exp',
  'radio',
  'rag',
  'recurrent_gemma',
  'reformer',
  'regnet',
  'rembert',
  'resnet',
  'rf_detr',
  'roberta',
  'roberta_prelayernorm',
  'roc_bert',
  'roformer',
  'rt_detr',
  'rt_detr_v2',
  'rwkv',
  'sam',
  'sam2',
  'sam2_video',
  'sam3',
  'sam3_lite_text',
  'sam3_tracker',
  'sam3_tracker_video',
  'sam3_video',
  'sam_hq',
  'sapiens2',
  'seamless_m4t',
  'seamless_m4t_v2',
  'seed_oss',
  'segformer',
  'seggpt',
  'sew',
  'sew_d',
  'shieldgemma2',
  'siglip',
  'siglip2',
  'slanet',
  'slanext',
  'smollm3',
  'smolvlm',
  'solar_open',
  'speech_encoder_decoder',
  'speech_to_text',
  'speecht5',
  'splinter',
  'squeezebert',
  'stablelm',
  'starcoder2',
  'step3p7',
  'superglue',
  'superpoint',
  'swiftformer',
  'swin',
  'swin2sr',
  'swinv2',
  'switch_transformers',
  't5',
  't5gemma',
  't5gemma2',
  'table_transformer',
  'tapas',
  'textnet',
  'time_series_transformer',
  'timesfm',
  'timesfm2_5',
  'timesformer',
  'timm_backbone',
  'timm_wrapper',
  'tipsv2',
  'tipsv2_dpt',
  'trocr',
  'tvp',
  'udop',
  'umt5',
  'unispeech',
  'unispeech_sat',
  'univnet',
  'upernet',
  'uvdoc',
  'vaultgemma',
  'vibevoice',
  'vibevoice_acoustic_tokenizer',
  'vibevoice_asr',
  'video_llama_3',
  'video_llava',
  'videomae',
  'videomt',
  'videoprism',
  'vilt',
  'vipllava',
  'vision_encoder_decoder',
  'vision_text_dual_encoder',
  'visual_bert',
  'vit',
  'vit_mae',
  'vit_msn',
  'vitdet',
  'vitmatte',
  'vitpose',
  'vitpose_backbone',
  'vits',
  'vivit',
  'vjepa2',
  'voxtral',
  'voxtral_realtime',
  'wav2vec2',
  'wav2vec2_bert',
  'wav2vec2_conformer',
  'wav2vec2_phoneme',
  'wav2vec2_with_lm',
  'wavlm',
  'whisper',
  'x_clip',
  'xcodec',
  'xcodec2',
  'xglm',
  'xlm',
  'xlm_roberta',
  'xlm_roberta_xl',
  'xlnet',
  'xlstm',
  'xmod',
  'yolos',
  'yoso',
  'youtu',
  'zamba',
  'zamba2',
  'zaya',
  'zoedepth',
];

export interface PendingSeedEntry {
  module: string;
  /** Verified merge time, never a commit date (the report calls commit dates "a known timestamp trap": llama.cpp's Qwen3.5 merge was reverted 13.5h after its commit timestamp). */
  mergedAt: string;
  pr: number;
  source: string;
}

/**
 * Hand-curated, verified pending architectures. `qwen4_exp`'s `mergedAt` is the GitHub API's own
 * `merged_at` for PR #48337 (`gh api repos/huggingface/transformers/pulls/48337`), fetched live
 * 2026-09-26: `merged_at: "2026-08-26T12:03:40Z"`, matching the report exactly. It is already
 * present in `BASELINE` (the module shipped to the registry 31 days ago with no public weights
 * yet), so without this seed its `since` would read "today" instead of its true merge date.
 */
export const PENDING_SEED: readonly PendingSeedEntry[] = [
  {
    module: 'qwen4_exp',
    mergedAt: '2026-08-26T12:03:40Z',
    pr: 48337,
    source: 'https://github.com/huggingface/transformers/pull/48337',
  },
];

const PREFIX_LABS: readonly { prefix: RegExp; labId: LabId }[] = [
  { prefix: /^qwen/i, labId: 'qwen' },
  { prefix: /^glm/i, labId: 'zai' },
  { prefix: /^deepseek/i, labId: 'deepseek' },
  { prefix: /^gemma/i, labId: 'google' },
  { prefix: /^llama/i, labId: 'meta' },
  { prefix: /^(mistral|ministral)/i, labId: 'mistral' },
  { prefix: /^kimi/i, labId: 'moonshot' },
  { prefix: /^gpt_oss/i, labId: 'openai' },
  { prefix: /^grok/i, labId: 'xai' },
];

/** Which frontier/tracked lab a module prefix belongs to, or undefined for the rest of the registry. */
export function labIdForModule(module: string): LabId | undefined {
  return PREFIX_LABS.find((p) => p.prefix.test(module))?.labId;
}

/**
 * Trailing module tokens that describe a build or layer type and never appear in a listing name
 * ("Qwen3.5-35B-A3B" ships from `qwen3_5_moe`). `next` is deliberately absent: "Qwen3 Next" is a
 * product name, and stripping it would let any existing Qwen3 listing clear `qwen3_next`.
 */
const NON_NAME_SUFFIX = /(?:_(?:exp|experimental|preview|beta|rc\d*|moe))+$/i;

/**
 * A module name → the loose pattern that matches its family in a listing name, e.g.
 * `qwen4_exp` → `qwen[ _-]?4` (the report's own example): strip non-name suffixes, allow a space
 * or dash between letters and a generation number, read `_` or adjacent digits inside a version
 * as an optional dot (`qwen3_5` → "Qwen3.5", `kimi_k25` → "Kimi K2.5"), and refuse a match that
 * is only a prefix of a longer word or number ("ColQwen4", "Qwen 40B").
 *
 * Module names that are codenames rather than versions cannot be recovered this way: `glm4_moe`
 * shipped as GLM-4.5 and `glm_moe_dsa` as GLM-5. Those clear early or never; seed them by hand.
 */
export function familyRegex(module: string): RegExp {
  const core = module.toLowerCase().replace(NON_NAME_SUFFIX, '');
  let pattern = '';
  for (let i = 0; i < core.length; i++) {
    const ch = core[i];
    const prev = core[i - 1] ?? '';
    const next = core[i + 1] ?? '';
    if (ch === '_') {
      if (/\d/.test(prev) && /\d/.test(next)) pattern += '[._-]?';
      else if (/[a-z]/.test(prev) && /\d/.test(next)) pattern += '[ _-]?';
      else pattern += '[ ._-]?';
      continue;
    }
    if (/\d/.test(ch) && /[a-z]/.test(prev)) {
      // The family's own generation may follow a tier word: `mistral4` shipped as "Mistral Small 4".
      pattern += /^[a-z]+$/.test(core.slice(0, i)) ? '(?:[ -][a-z]+)?[ _-]?' : '[ _-]?';
    } else if (/\d/.test(ch) && /\d/.test(prev)) pattern += '\\.?';
    pattern += /[a-z0-9]/.test(ch) ? ch : `\\${ch}`;
  }
  const tail = /\d$/.test(core) ? '(?!\\d)' : '';
  return new RegExp(`(?<![a-z0-9])${pattern}${tail}`, 'i');
}

/**
 * Pure. `modules` is this poll's live parse; `baseline` is the snapshot above (so a module absent
 * from it is novel); `seed` hand-backdates specific modules' true `since`; `listings` (id/name
 * pairs from OpenRouter or Hugging Face, supplied by the caller) clears `pending` once a matching
 * model has actually shipped; `firstSeen` (module → ISO, meant to be D1-backed) supplies `since`
 * for a novel module this function has not seen with the seed's help.
 */
export function pendingArchitectures(
  modules: readonly string[],
  baseline: readonly string[],
  seed: readonly PendingSeedEntry[],
  listings: readonly { id: string; name: string }[],
  now: Date,
  firstSeen?: ReadonlyMap<string, string>,
): PendingArchitecture[] {
  const baselineSet = new Set(baseline);
  const seedByModule = new Map(seed.map((s) => [s.module, s]));
  const tracked = new Set<string>([...seedByModule.keys(), ...modules.filter((m) => !baselineSet.has(m))]);
  const nowMs = now.getTime();
  const out: PendingArchitecture[] = [];

  for (const module of modules) {
    if (!tracked.has(module)) continue;
    const labId = labIdForModule(module);
    if (!labId) continue;

    const seedEntry = seedByModule.get(module);
    let since: string;
    let sinceSource: PendingArchitecture['sinceSource'];
    if (seedEntry) {
      since = seedEntry.mergedAt;
      sinceSource = 'seed';
    } else {
      const seenAt = firstSeen?.get(module);
      if (seenAt) {
        since = seenAt;
        sinceSource = 'first-seen';
      } else {
        since = now.toISOString();
        sinceSource = 'detected';
      }
    }

    const sinceMs = Date.parse(since);
    const daysPending = Number.isFinite(sinceMs) ? Math.max(0, (nowMs - sinceMs) / 86_400_000) : 0;
    const pattern = familyRegex(module);
    const pending = !listings.some((l) => pattern.test(l.name));
    out.push({ module, labId, since, sinceSource, daysPending, pending });
  }
  return out;
}
