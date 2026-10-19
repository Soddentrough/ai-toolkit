import { GroupedSelectOption, JobConfig, SelectOption } from '@/types';
import { ModelArch } from './options';
import { objectCopy } from '@/utils/basic';

const expandDatasetDefaults = (
  defaults: { [key: string]: any },
  numDatasets: number,
): { [key: string]: any } => {
  // expands the defaults for datasets[x] to datasets[0], datasets[1], etc.
  const expandedDefaults: { [key: string]: any } = { ...defaults };
  for (const key in defaults) {
    if (key.includes('datasets[x].')) {
      for (let i = 0; i < numDatasets; i++) {
        const datasetKey = key.replace('datasets[x].', `datasets[${i}].`);
        const v = defaults[key];
        expandedDefaults[datasetKey] = Array.isArray(v) ? [...v] : objectCopy(v);
      }
      delete expandedDefaults[key];
    }
  }
  return expandedDefaults;
};

export const handleModelArchChange = (
  modelArchs: ModelArch[],
  currentArchName: string,
  newArchName: string,
  jobConfig: JobConfig,
  setJobConfig: (value: any, key: string) => void,
) => {
  const currentArch = modelArchs.find(a => a.name === currentArchName);
  if (!currentArch || currentArch.name === newArchName) {
    return;
  }

  // update the defaults when a model is selected
  const newArch = modelArchs.find(model => model.name === newArchName);

  // update vram setting
  if (!newArch?.additionalSections?.includes('model.low_vram')) {
    setJobConfig(false, 'config.process[0].model.low_vram');
  }

  // handle layer offloading setting
  if (!newArch?.additionalSections?.includes('model.layer_offloading')) {
    if ('layer_offloading' in jobConfig.config.process[0].model) {
      const newModel = objectCopy(jobConfig.config.process[0].model);
      delete newModel.layer_offloading;
      delete newModel.layer_offloading_text_encoder_percent;
      delete newModel.layer_offloading_transformer_percent;
      setJobConfig(newModel, 'config.process[0].model');
    }
  } else {
    // set to false if not set
    if (!('layer_offloading' in jobConfig.config.process[0].model)) {
      setJobConfig(false, 'config.process[0].model.layer_offloading');
      setJobConfig(1.0, 'config.process[0].model.layer_offloading_text_encoder_percent');
      setJobConfig(1.0, 'config.process[0].model.layer_offloading_transformer_percent');
    }
  }

  const numDatasets = jobConfig.config.process[0].datasets.length;

  let currentDefaults = expandDatasetDefaults(currentArch.defaults || {}, numDatasets);
  let newDefaults = expandDatasetDefaults(newArch?.defaults || {}, numDatasets);

  // set new model
  setJobConfig(newArchName, 'config.process[0].model.arch');

  // update datasets
  const hasControlPath = newArch?.additionalSections?.includes('datasets.control_path') || false;
  const hasMultiControlPaths = newArch?.additionalSections?.includes('datasets.multi_control_paths') || false;
  const hasNumFrames = newArch?.additionalSections?.includes('datasets.num_frames') || false;
  const hasAutoFrameCount = newArch?.additionalSections?.includes('datasets.auto_frame_count') || false;
  const controls = newArch?.controls ?? [];
  const datasets = jobConfig.config.process[0].datasets.map(dataset => {
    const newDataset = objectCopy(dataset);
    newDataset.controls = controls;
    if (hasMultiControlPaths) {
      // make sure the config has the multi control paths
      newDataset.control_path_1 = newDataset.control_path_1 || null;
      newDataset.control_path_2 = newDataset.control_path_2 || null;
      newDataset.control_path_3 = newDataset.control_path_3 || null;
      // if we previously had a single control path and now
      // we selected a multi control model
      if (newDataset.control_path && newDataset.control_path !== '') {
        // only set if not overwriting
        if (!newDataset.control_path_1) {
          newDataset.control_path_1 = newDataset.control_path;
        }
      }
      delete newDataset.control_path; // remove single control path
    } else if (hasControlPath) {
      newDataset.control_path = newDataset.control_path || null;
      if (newDataset.control_path_1 && newDataset.control_path_1 !== '') {
        newDataset.control_path = newDataset.control_path_1;
      }
      if ('control_path_1' in newDataset) {
        delete newDataset.control_path_1;
      }
      if ('control_path_2' in newDataset) {
        delete newDataset.control_path_2;
      }
      if ('control_path_3' in newDataset) {
        delete newDataset.control_path_3;
      }
    } else {
      // does not have control images
      if ('control_path' in newDataset) {
        delete newDataset.control_path;
      }
      if ('control_path_1' in newDataset) {
        delete newDataset.control_path_1;
      }
      if ('control_path_2' in newDataset) {
        delete newDataset.control_path_2;
      }
      if ('control_path_3' in newDataset) {
        delete newDataset.control_path_3;
      }
    }
    if (!hasNumFrames) {
      newDataset.num_frames = 1; // reset num_frames if not applicable
    }
    if (!hasAutoFrameCount) {
      delete newDataset.auto_frame_count;
    }
    return newDataset;
  });
  setJobConfig(datasets, 'config.process[0].datasets');

  // update samples
  const hasSampleCtrlImg = newArch?.additionalSections?.includes('sample.ctrl_img') || false;
  const samples = jobConfig.config.process[0].sample.samples.map(sample => {
    const newSample = objectCopy(sample);
    if (!hasSampleCtrlImg) {
      delete newSample.ctrl_img; // remove ctrl_img if not applicable
    }
    return newSample;
  });
  setJobConfig(samples, 'config.process[0].sample.samples');

  // revert defaults from previous model
  for (const key in currentDefaults) {
    setJobConfig(currentDefaults[key][1], key);
  }

  for (const key in newDefaults) {
    setJobConfig(newDefaults[key][0], key);
  }
};

const IGNORED_NAME_TOKENS = new Set([
  'my',
  'first',
  'new',
  'test',
  'run',
  'job',
  'copy',
  'lora',
  'lokr',
  'bf16',
  'fp16',
  'fp32',
  'fp8',
  'qfloat8',
  'int8',
  'int4',
  'zimage',
  'deturbo',
  'turbo',
  'base',
  'flux',
  'flex',
  'flex1',
  'flex2',
  'sdxl',
  'sd15',
  'sd3',
  'wan',
  'wan21',
  'wan22',
  'qwen',
  'lumina',
  'chroma',
  'hidream',
  'kontext',
  'kling',
  'hunyuan',
  'ltx',
  'ltx2',
  'cosmos',
  'omnigen',
  'auraflow',
  'pixart',
  'sana',
]);

/**
 * Derives a clean trigger word / subject name from a job training name.
 * For example:
 * - "zimage_deturbo_scotty_lora_bf16" -> "scotty"
 * - "sarah_connor_v2" -> "sarah connor"
 * - "cyberpunk_neon_style_lora_v1" -> "cyberpunk neon style"
 */
export const deriveTriggerFromJobName = (jobName: string): string => {
  if (!jobName || !jobName.trim()) return '';
  const rawTokens = jobName
    .trim()
    .split(/[_\-\s]+/)
    .map(t => t.trim())
    .filter(Boolean);

  const filtered = rawTokens.filter(token => {
    const lower = token.toLowerCase();
    if (IGNORED_NAME_TOKENS.has(lower)) return false;
    // Ignore version tokens like v1, v2, v10, r16, r32, etc.
    if (/^[vr]\d+$/i.test(lower)) return false;
    // Ignore pure step/rank numbers like 1000, 2000, 16, 32
    if (/^\d+$/.test(lower)) return false;
    return true;
  });

  if (filtered.length > 0) {
    return filtered.join(' ');
  }
  // Fallback if all tokens were filtered (unless it's the untouched placeholder name)
  if (jobName.trim().toLowerCase() === 'my_first_lora_v1') {
    return '';
  }
  return rawTokens[0] || '';
};

/**
 * Checks if any available dataset option matches the tokens in the job name.
 */
export const matchDatasetFromJobName = (
  jobName: string,
  datasetOptions: { value: string; label: string }[],
): string | null => {
  if (!jobName || !datasetOptions || datasetOptions.length === 0) return null;
  const lowerName = jobName.toLowerCase();
  const nameTokens = lowerName.split(/[_\-\s]+/).filter(Boolean);

  // 1. Exact token match against dataset label
  for (const opt of datasetOptions) {
    const labelLower = opt.label.toLowerCase();
    if (nameTokens.includes(labelLower) || lowerName === labelLower) {
      return opt.value;
    }
  }

  // 2. Derived trigger match against dataset label
  const derived = deriveTriggerFromJobName(jobName).toLowerCase();
  if (derived) {
    const slug = derived.replace(/\s+/g, '_');
    const found = datasetOptions.find(
      opt => opt.label.toLowerCase() === derived || opt.label.toLowerCase() === slug,
    );
    if (found) return found.value;
  }

  return null;
};

