'use client';
import { useMemo, useState, useRef } from 'react';
import {
  ModelArch,
  quantizationOptions,
  defaultQtype,
  jobTypeOptions,
  SampleTags,
} from './options';
import { useModelArchs } from '@/extensions/modelArchs';
import { defaultCompileOptions, defaultDatasetConfig } from './jobConfig';
import { GroupedSelectOption, JobConfig, SelectOption } from '@/types';
import { objectCopy, tagsToObj, objToTags } from '@/utils/basic';
import {
  TextInput,
  TextAreaInput,
  SelectInput,
  Checkbox,
  FormGroup,
  NumberInput,
  SliderInput,
  CreatableSelectInput,
} from '@/components/formInputs';
import Card from '@/components/Card';
import { X, Copy, Wand2, SquareDashed, Info, ChevronDown, ChevronRight, Sparkles, SlidersHorizontal } from 'lucide-react';
import { openDoc } from '@/components/DocModal';
import { openUpsamplePromptsModal, toAspectRatio } from '@/components/UpsamplePromptsModal';
import { openPromptBoxEditor } from '@/components/PromptBoxEditorModal';
import AddSingleImageModal from '@/components/AddSingleImageModal';
import SampleControlImage from '@/components/SampleControlImage';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { handleModelArchChange, deriveTriggerFromJobName, matchDatasetFromJobName } from './utils';
import { IoFlaskSharp } from 'react-icons/io5';
import { isMac } from '@/helpers/basic';
import { defaultSampleConfig } from '@/helpers/defaultSamples';

type Props = {
  jobConfig: JobConfig;
  setJobConfig: (value: any, key: string) => void;
  status: 'idle' | 'saving' | 'success' | 'error';
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  runId: string | null;
  gpuIDs: string | null;
  setGpuIDs: (value: string | null) => void;
  gpuList: any;
  datasetOptions: any;
  isLoading?: boolean;
};

function CollapsibleAdvancedSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4 pt-3 border-t border-gray-800/80">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left py-1.5 px-2 -mx-2 rounded-md hover:bg-gray-800/50 transition-colors group"
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 group-hover:text-gray-200">
          {open ? <ChevronDown className="w-4 h-4 text-blue-400" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
          <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400 transition-colors" />
          <span>{title}</span>
        </div>
        {!open && summary && (
          <span className="text-xs text-gray-500 truncate max-w-[60%] font-mono">{summary}</span>
        )}
      </button>
      {open && <div className="mt-3 pt-2 space-y-4">{children}</div>}
    </div>
  );
}

export default function SimpleJob({
  jobConfig,
  setJobConfig,
  handleSubmit,
  status,
  runId,
  gpuIDs,
  setGpuIDs,
  gpuList,
  datasetOptions,
  isLoading,
}: Props) {
  const { archs: modelArchs, groupedModelOptions } = useModelArchs();
  const modelArch = useMemo(() => {
    return modelArchs.find(a => a.name === jobConfig.config.process[0].model.arch) as ModelArch;
  }, [modelArchs, jobConfig.config.process[0].model.arch]);

  // Track whether the user has manually customized trigger_word or dataset selection
  const triggerManuallyEditedRef = useRef<boolean>(false);
  const datasetManuallyEditedRef = useRef<boolean>(false);
  const [expandedDatasetAdvanced, setExpandedDatasetAdvanced] = useState<Record<number, boolean>>({});
  const [expandedPromptOverrides, setExpandedPromptOverrides] = useState<Record<number, boolean>>({});

  const jobType = useMemo(() => {
    return jobTypeOptions.find(j => j.value === jobConfig.config.process[0].type);
  }, [jobConfig.config.process[0].type]);

  const disableSections = useMemo(() => {
    let sections: string[] = [];
    if (modelArch?.disableSections) {
      sections = sections.concat(modelArch.disableSections);
    }
    if (jobType?.disableSections) {
      sections = sections.concat(jobType.disableSections);
    }
    return sections;
  }, [modelArch, jobType]);

  const isVideoModel = !!(modelArch?.group === 'video');
  const isAudioModel = !!(modelArch?.group === 'audio');
  // text-generating models: samples are media in, text out (no size)
  const isLlmModel = !!(modelArch?.group === 'llm');

  const taggedSampleArr: Record<string, any>[] | null = useMemo(() => {
    if (!modelArch) return null;
    if (!modelArch.sampleTags) return null;
    if (!jobConfig.config.process[0].sample.samples) return null;
    let sampleArr: any[] = [];
    for (let i = 0; i < jobConfig.config.process[0].sample.samples.length; i++) {
      const taggedPrompt = jobConfig.config.process[0].sample.samples[i].prompt;
      const tagsObj = tagsToObj(taggedPrompt);
      sampleArr.push(tagsObj);
    }
    return sampleArr;
  }, [modelArch, jobConfig.config.process[0].sample.samples]);

  const modelArchTagSections: SampleTags[] | null = useMemo(() => {
    if (!modelArch?.sampleTags) return null;
    const maxPerGroup = 5;
    let sections: SampleTags[] = [];
    let subSection: SampleTags = {};
    for (const [tagKey, tag] of Object.entries(modelArch.sampleTags)) {
      if ((tag.full && Object.keys(subSection).length > 0) || Object.keys(subSection).length >= maxPerGroup) {
        sections.push(subSection);
        subSection = {};
      }
      subSection[tagKey] = tag;
      if (tag.full) {
        sections.push(subSection);
        subSection = {};
      }
    }
    if (Object.keys(subSection).length > 0) {
      sections.push(subSection);
    }
    return sections.length > 0 ? sections : null;
  }, [modelArch]);

  const transformerQuantizationOptions: GroupedSelectOption[] | SelectOption[] = useMemo(() => {
    const hasARA = modelArch?.accuracyRecoveryAdapters && Object.keys(modelArch.accuracyRecoveryAdapters).length > 0;
    if (!hasARA) {
      return quantizationOptions;
    }
    let newQuantizationOptions = [
      {
        label: 'Standard',
        options: [quantizationOptions[0], quantizationOptions[1]],
      },
    ];

    let ARAs: SelectOption[] = [];
    if (modelArch.accuracyRecoveryAdapters) {
      for (const [label, value] of Object.entries(modelArch.accuracyRecoveryAdapters)) {
        ARAs.push({ value, label });
      }
    }
    if (ARAs.length > 0) {
      newQuantizationOptions.push({
        label: 'Accuracy Recovery Adapters',
        options: ARAs,
      });
    }

    let additionalQuantizationOptions: SelectOption[] = [];
    for (let i = 2; i < quantizationOptions.length; i++) {
      const option = quantizationOptions[i];
      additionalQuantizationOptions.push(option);
    }
    if (additionalQuantizationOptions.length > 0) {
      newQuantizationOptions.push({
        label: 'Additional Quantization Options',
        options: additionalQuantizationOptions,
      });
    }
    return newQuantizationOptions;
  }, [modelArch]);

  const showGPUSelect = !isMac();
  const validationConfig = jobConfig.config.process[0].train.validation_config;

  // Handle smart job name updates
  const handleJobNameChange = (newName: string) => {
    const prevDerived = deriveTriggerFromJobName(jobConfig.config.name);
    const currentTrigger = jobConfig.config.process[0].trigger_word || '';
    const nextDerived = deriveTriggerFromJobName(newName);

    setJobConfig(newName, 'config.name');

    // Auto-populate trigger_word if not manually edited (or if it still matches the previously derived trigger)
    if (
      !disableSections.includes('trigger_word') &&
      (!triggerManuallyEditedRef.current || currentTrigger === '' || currentTrigger === prevDerived)
    ) {
      setJobConfig(nextDerived || null, 'config.process[0].trigger_word');
      // Also ensure default_caption on dataset 0 has [trigger] if it was empty
      if (
        nextDerived &&
        jobConfig.config.process[0].datasets.length > 0 &&
        (!jobConfig.config.process[0].datasets[0].default_caption ||
          jobConfig.config.process[0].datasets[0].default_caption.trim() === '')
      ) {
        setJobConfig('[trigger]', 'config.process[0].datasets[0].default_caption');
      }
    }

    // Auto-select matching dataset folder if the user hasn't manually changed it
    if (!datasetManuallyEditedRef.current && datasetOptions && datasetOptions.length > 0) {
      const matchedDatasetPath = matchDatasetFromJobName(newName, datasetOptions);
      if (matchedDatasetPath && jobConfig.config.process[0].datasets.length > 0) {
        setJobConfig(matchedDatasetPath, 'config.process[0].datasets[0].folder_path');
      }
    }
  };

  // One-click helper to sync trigger word, default caption, dataset, and sample prompts from the job name
  const syncDefaultsFromJobName = () => {
    const derived = deriveTriggerFromJobName(jobConfig.config.name);
    if (!disableSections.includes('trigger_word') && derived) {
      setJobConfig(derived, 'config.process[0].trigger_word');
      triggerManuallyEditedRef.current = false;
    }
    if (jobConfig.config.process[0].datasets.length > 0) {
      const currentCaption = jobConfig.config.process[0].datasets[0].default_caption;
      if (!currentCaption || !currentCaption.includes('[trigger]')) {
        setJobConfig('[trigger]', 'config.process[0].datasets[0].default_caption');
      }
      const matchedDatasetPath = matchDatasetFromJobName(jobConfig.config.name, datasetOptions);
      if (matchedDatasetPath) {
        setJobConfig(matchedDatasetPath, 'config.process[0].datasets[0].folder_path');
      }
    }
    // Ensure sample prompts use [trigger]
    if (!isAudioModel && !isLlmModel && !modelArch?.sampleTags) {
      const currentSamples = jobConfig.config.process[0].sample.samples || [];
      const hasTriggerInSamples = currentSamples.some(s => s.prompt?.includes('[trigger]'));
      if (!hasTriggerInSamples) {
        setJobConfig(objectCopy(defaultSampleConfig.samples), 'config.process[0].sample.samples');
      }
    }
  };

  // Summary strings for collapsed Advanced sections
  const modelAdvSummary = useMemo(() => {
    const m = jobConfig.config.process[0].model;
    const n = jobConfig.config.process[0].network;
    const s = jobConfig.config.process[0].save;
    const parts: string[] = [];
    parts.push(`${(n?.type || 'lora').toUpperCase()} r=${n?.linear ?? 32}`);
    parts.push(m.quantize ? `Quant: ${m.qtype}` : 'Unquantized');
    parts.push(`Save: ${s.dtype.toUpperCase()}`);
    if (m.low_vram) parts.push('Low VRAM');
    if (m.layer_offloading) parts.push('Offload');
    if (m.compile) parts.push('Compile');
    return parts.join(' · ');
  }, [jobConfig.config.process[0].model, jobConfig.config.process[0].network, jobConfig.config.process[0].save]);

  const trainAdvSummary = useMemo(() => {
    const t = jobConfig.config.process[0].train;
    const parts: string[] = [];
    parts.push(`GradAccum: ${t.gradient_accumulation}`);
    if (!isLlmModel) {
      parts.push(`Timestep: ${t.timestep_type} (${t.content_or_style})`);
      parts.push(`Loss: ${t.loss_type}`);
    }
    if (t.ema_config?.use_ema) parts.push('EMA');
    if (t.cache_text_embeddings) parts.push('Cache TE');
    if (t.unload_text_encoder) parts.push('Unload TE');
    if (t.diff_output_preservation) parts.push('DOP');
    if (t.blank_prompt_preservation) parts.push('BPP');
    if (t.validation_config) parts.push('Validation');
    return parts.join(' · ');
  }, [jobConfig.config.process[0].train, isLlmModel]);

  const sampleAdvSummary = useMemo(() => {
    const s = jobConfig.config.process[0].sample;
    const t = jobConfig.config.process[0].train;
    const parts: string[] = [];
    if (!isLlmModel) {
      parts.push(`Sampler: ${s.sampler}`);
      parts.push(`Seed: ${s.seed}${s.walk_seed ? ' (walk)' : ''}`);
    }
    if (s.sample_start_step) parts.push(`Start: ${s.sample_start_step}`);
    if (t.skip_first_sample) parts.push('Skip 1st');
    if (t.force_first_sample) parts.push('Force 1st');
    if (t.disable_sampling) parts.push('Disabled');
    return parts.join(' · ');
  }, [jobConfig.config.process[0].sample, jobConfig.config.process[0].train, isLlmModel]);

  const derivedCandidate = deriveTriggerFromJobName(jobConfig.config.name);
  const currentTrigger = jobConfig.config.process[0].trigger_word || '';

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className={`space-y-6 relative ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
      >
        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-400 border-t-blue-500" />
              <span className="text-sm text-gray-400">Loading...</span>
            </div>
          </div>
        )}

        {/* Top Row: Clean 2-Column Layout for Job Identity & Model Selection */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Card 1: Job & Trigger */}
          <Card title="Job & Concept">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={showGPUSelect ? 'sm:col-span-2' : 'sm:col-span-3'}>
                <TextInput
                  label="Training Name"
                  value={jobConfig.config.name}
                  docKey="config.name"
                  onChange={handleJobNameChange}
                  placeholder="e.g. scotty_portrait_v1"
                  disabled={runId !== null}
                  required
                />
              </div>
              {showGPUSelect && (
                <div>
                  <SelectInput
                    label="GPU ID"
                    value={`${gpuIDs}`}
                    docKey="gpuids"
                    onChange={value => setGpuIDs(value)}
                    options={gpuList.map((gpu: any) => ({ value: `${gpu.index}`, label: `GPU #${gpu.index} (${gpu.name})` }))}
                  />
                </div>
              )}
            </div>

            {disableSections.includes('trigger_word') ? null : (
              <div className="pt-1">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <TextInput
                      label="Trigger Word"
                      value={currentTrigger}
                      docKey="config.process[0].trigger_word"
                      onChange={(value: string | null) => {
                        triggerManuallyEditedRef.current = true;
                        if (value?.trim() === '') {
                          value = null;
                        }
                        setJobConfig(value, 'config.process[0].trigger_word');
                      }}
                      placeholder={derivedCandidate ? `e.g. ${derivedCandidate}` : 'Concept or subject token'}
                      required
                    />
                  </div>
                  <button
                    type="button"
                    onClick={syncDefaultsFromJobName}
                    title="Auto-populate Trigger Word, Default Caption, Dataset, and Sample Prompts from the Training Name"
                    className="mb-[1px] px-3 py-1.5 text-xs font-medium rounded-sm bg-blue-950/70 hover:bg-blue-900/80 text-blue-200 border border-blue-800/80 flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                    <span>Auto-fill from Name</span>
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Use <code className="text-blue-300 bg-gray-800 px-1 py-0.5 rounded">[trigger]</code> in captions and
                  sample prompts — it will automatically be replaced with{' '}
                  <span className="text-gray-200 font-medium">
                    {currentTrigger ? `"${currentTrigger}"` : 'your trigger word'}
                  </span>
                  .
                </p>
              </div>
            )}

            {!disableSections.includes('slider') && (
              <div className="pt-3 mt-3 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <TextInput
                  label="Target Class"
                  value={jobConfig.config.process[0].slider?.target_class ?? ''}
                  onChange={value => setJobConfig(value, 'config.process[0].slider.target_class')}
                  placeholder="eg. person"
                />
                <TextInput
                  label="Anchor Class"
                  value={jobConfig.config.process[0].slider?.anchor_class ?? ''}
                  onChange={value => setJobConfig(value, 'config.process[0].slider.anchor_class')}
                  placeholder=""
                />
                <TextInput
                  label="Positive Prompt"
                  value={jobConfig.config.process[0].slider?.positive_prompt ?? ''}
                  onChange={value => setJobConfig(value, 'config.process[0].slider.positive_prompt')}
                  placeholder="eg. person who is happy"
                />
                <TextInput
                  label="Negative Prompt"
                  value={jobConfig.config.process[0].slider?.negative_prompt ?? ''}
                  onChange={value => setJobConfig(value, 'config.process[0].slider.negative_prompt')}
                  placeholder="eg. person who is sad"
                />
              </div>
            )}
          </Card>

          {/* Card 2: Model Architecture & Collapsible Advanced Model/Network/Save Options */}
          <Card title="Model">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectInput
                label="Model Architecture"
                value={jobConfig.config.process[0].model.arch}
                onChange={value => {
                  handleModelArchChange(
                    modelArchs,
                    jobConfig.config.process[0].model.arch,
                    value,
                    jobConfig,
                    setJobConfig,
                  );
                }}
                options={groupedModelOptions}
              />
              <TextInput
                label="Name or Path"
                value={jobConfig.config.process[0].model.name_or_path}
                docKey="config.process[0].model.name_or_path"
                onChange={(value: string | null) => {
                  if (value?.trim() === '') {
                    value = null;
                  }
                  setJobConfig(value, 'config.process[0].model.name_or_path');
                }}
                placeholder="HuggingFace repo ID or local path"
                required
              />
            </div>

            {modelArch?.additionalSections?.includes('model.model_kwargs.instruction') && (
              <TextAreaInput
                label="LLM Prompt"
                className="pt-2"
                rows={2}
                docKey="model.model_kwargs.instruction"
                value={jobConfig.config.process[0].model.model_kwargs?.instruction ?? ''}
                onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.instruction')}
                placeholder="Describe this in detail."
                required
              />
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {modelArch?.modelNotes && (
                <button
                  type="button"
                  onClick={() => {
                    openDoc({
                      title: `Notes - ${modelArch.label}`,
                      description: <div className="space-y-3">{modelArch.modelNotes}</div>,
                    });
                  }}
                  className="flex-1 flex items-center gap-2 rounded-md bg-blue-950/60 border border-blue-800 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/60 text-left"
                >
                  <Info className="w-4 h-4 shrink-0 text-blue-400" />
                  <span>Model notes</span>
                </button>
              )}
              {modelArch?.gateUrl && (
                <button
                  type="button"
                  onClick={() => {
                    const gateUrl = modelArch.gateUrl as string;
                    openDoc({
                      title: 'Gated Model',
                      description: (
                        <div className="space-y-3">
                          <p>
                            This model is gated on Huggingface. Before you can use it, you will need to accept the model
                            terms on the model page:
                          </p>
                          <p>
                            <a
                              href={gateUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 underline"
                            >
                              {gateUrl}
                            </a>
                          </p>
                          <p>
                            You will also need to create a Huggingface{' '}
                            <a
                              href="https://huggingface.co/settings/tokens"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 underline"
                            >
                              read token
                            </a>{' '}
                            and add it on the{' '}
                            <a href="/settings" className="text-blue-400 hover:text-blue-300 underline">
                              settings page
                            </a>
                            .
                          </p>
                        </div>
                      ),
                    });
                  }}
                  className="flex-1 flex items-center gap-2 rounded-md bg-yellow-950/60 border border-yellow-800 px-3 py-1.5 text-xs text-yellow-200 hover:bg-yellow-900/60 text-left"
                >
                  <Info className="w-4 h-4 shrink-0 text-yellow-400" />
                  <span>
                    Gated model. <span className="underline">Learn more.</span>
                  </span>
                </button>
              )}
            </div>

            {/* Collapsible Advanced Model, Network, Quantization & Save Settings */}
            <CollapsibleAdvancedSection title="Advanced Model, Network & Quantization" summary={modelAdvSummary}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Network / Target */}
                <div>
                  <SelectInput
                    label="Target Type"
                    value={jobConfig.config.process[0].network?.type ?? 'lora'}
                    onChange={value => setJobConfig(value, 'config.process[0].network.type')}
                    options={[
                      { value: 'lora', label: 'LoRA' },
                      { value: 'lokr', label: 'LoKr' },
                    ]}
                  />
                  {jobConfig.config.process[0].network?.type == 'lokr' && (
                    <SelectInput
                      label="LoKr Factor"
                      className="pt-2"
                      value={`${jobConfig.config.process[0].network?.lokr_factor ?? -1}`}
                      onChange={value => setJobConfig(parseInt(value), 'config.process[0].network.lokr_factor')}
                      options={[
                        { value: '-1', label: 'Auto' },
                        { value: '4', label: '4' },
                        { value: '8', label: '8' },
                        { value: '16', label: '16' },
                        { value: '32', label: '32' },
                      ]}
                    />
                  )}
                  {jobConfig.config.process[0].network?.type == 'lora' && (
                    <>
                      <NumberInput
                        label="Linear Rank"
                        className="pt-2"
                        value={jobConfig.config.process[0].network.linear}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].network.linear');
                          setJobConfig(value, 'config.process[0].network.linear_alpha');
                        }}
                        placeholder="eg. 32"
                        min={0}
                        max={1024}
                        required
                      />
                      {!disableSections.includes('network.conv') && (
                        <NumberInput
                          label="Conv Rank"
                          className="pt-2"
                          value={jobConfig.config.process[0].network.conv}
                          onChange={value => {
                            setJobConfig(value, 'config.process[0].network.conv');
                            setJobConfig(value, 'config.process[0].network.conv_alpha');
                          }}
                          placeholder="eg. 16"
                          min={0}
                          max={1024}
                        />
                      )}
                    </>
                  )}
                </div>

                {/* Quantization & Compile */}
                <div>
                  {!disableSections.includes('model.quantize') && (
                    <>
                      <SelectInput
                        label="Quantize Transformer"
                        value={jobConfig.config.process[0].model.quantize ? jobConfig.config.process[0].model.qtype : ''}
                        onChange={value => {
                          if (value === '') {
                            setJobConfig(false, 'config.process[0].model.quantize');
                            value = defaultQtype;
                          } else {
                            setJobConfig(true, 'config.process[0].model.quantize');
                          }
                          setJobConfig(value, 'config.process[0].model.qtype');
                        }}
                        options={transformerQuantizationOptions}
                      />
                      {!disableSections.includes('model.quantize_te') && !isLlmModel && (
                        <SelectInput
                          label="Quantize Text Encoder"
                          className="pt-2"
                          value={
                            jobConfig.config.process[0].model.quantize_te
                              ? jobConfig.config.process[0].model.qtype_te
                              : ''
                          }
                          onChange={value => {
                            if (value === '') {
                              setJobConfig(false, 'config.process[0].model.quantize_te');
                              value = defaultQtype;
                            } else {
                              setJobConfig(true, 'config.process[0].model.quantize_te');
                            }
                            setJobConfig(value, 'config.process[0].model.qtype_te');
                          }}
                          options={quantizationOptions}
                        />
                      )}
                    </>
                  )}
                  {!isLlmModel && (
                    <div className="pt-3">
                      <Checkbox
                        label="Compile Model"
                        checked={jobConfig.config.process[0].model.compile || false}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].model.compile');
                          if (value) {
                            for (const key in defaultCompileOptions) {
                              setJobConfig((defaultCompileOptions as any)[key], `config.process[0].model.${key}`);
                            }
                          } else {
                            for (const key in defaultCompileOptions) {
                              setJobConfig(undefined, `config.process[0].model.${key}`);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Save Options & Memory */}
                <div>
                  <SelectInput
                    label="Save Data Type"
                    value={jobConfig.config.process[0].save.dtype}
                    onChange={value => setJobConfig(value, 'config.process[0].save.dtype')}
                    options={[
                      { value: 'bf16', label: 'BF16' },
                      { value: 'fp16', label: 'FP16' },
                      { value: 'fp32', label: 'FP32' },
                    ]}
                  />
                  <NumberInput
                    label="Max Step Saves to Keep"
                    className="pt-2"
                    value={jobConfig.config.process[0].save.max_step_saves_to_keep}
                    onChange={value => setJobConfig(value, 'config.process[0].save.max_step_saves_to_keep')}
                    placeholder="eg. 4"
                    min={1}
                    required
                  />
                  <div className="pt-3 space-y-2">
                    {modelArch?.additionalSections?.includes('model.low_vram') && (
                      <Checkbox
                        label="Low VRAM"
                        checked={jobConfig.config.process[0].model.low_vram}
                        onChange={value => setJobConfig(value, 'config.process[0].model.low_vram')}
                      />
                    )}
                    {modelArch?.additionalSections?.includes('model.model_kwargs.kv_cache') && (
                      <Checkbox
                        label="KV Cache"
                        docKey="model.model_kwargs.kv_cache"
                        checked={jobConfig.config.process[0].model.model_kwargs.kv_cache || false}
                        onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.kv_cache')}
                      />
                    )}
                    {modelArch?.additionalSections?.includes('model.qie.match_target_res') && (
                      <Checkbox
                        label="Match Target Res"
                        docKey="model.qie.match_target_res"
                        checked={jobConfig.config.process[0].model.model_kwargs.match_target_res}
                        onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.match_target_res')}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Additional Model Adapters / Layer Offloading / Multistage */}
              {(modelArch?.additionalSections?.includes('model.assistant_lora_path') ||
                modelArch?.additionalSections?.includes('model.unconditional_lora_path') ||
                (modelArch?.customModelSelectOptions && modelArch.customModelSelectOptions.length > 0)) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-800/60">
                  {modelArch?.additionalSections?.includes('model.assistant_lora_path') && (
                    <TextInput
                      label="Training Adapter Path"
                      value={jobConfig.config.process[0].model.assistant_lora_path ?? ''}
                      docKey="config.process[0].model.assistant_lora_path"
                      onChange={(value: string | undefined) => {
                        if (value?.trim() === '') {
                          value = undefined;
                        }
                        setJobConfig(value, 'config.process[0].model.assistant_lora_path');
                      }}
                      placeholder=""
                    />
                  )}
                  {modelArch?.additionalSections?.includes('model.unconditional_lora_path') && (
                    <TextInput
                      label="Unconditional Adapter Path"
                      value={jobConfig.config.process[0].model.unconditional_lora_path ?? ''}
                      docKey="config.process[0].model.unconditional_lora_path"
                      onChange={(value: string | undefined) => {
                        if (value?.trim() === '') {
                          value = undefined;
                        }
                        setJobConfig(value, 'config.process[0].model.unconditional_lora_path');
                      }}
                      placeholder=""
                    />
                  )}
                  {modelArch?.customModelSelectOptions?.map(customOption =>
                    customOption.type === 'checkbox' ? (
                      <Checkbox
                        key={customOption.label}
                        label={customOption.label}
                        checked={customOption.getValue(jobConfig)}
                        doc={customOption.doc}
                        onChange={value => customOption.onChange(value, jobConfig, setJobConfig)}
                      />
                    ) : (
                      <SelectInput
                        key={customOption.label}
                        label={customOption.label}
                        value={customOption.getValue(jobConfig) ?? ''}
                        doc={customOption.doc}
                        onChange={value => customOption.onChange(value, jobConfig, setJobConfig)}
                        options={customOption.options}
                      />
                    ),
                  )}
                </div>
              )}

              {modelArch?.additionalSections?.includes('model.layer_offloading') && !isMac() && (
                <div className="pt-2 border-t border-gray-800/60">
                  <Checkbox
                    label={
                      <>
                        Layer Offloading <IoFlaskSharp className="inline text-yellow-500" name="Experimental" />{' '}
                      </>
                    }
                    checked={jobConfig.config.process[0].model.layer_offloading || false}
                    onChange={value => setJobConfig(value, 'config.process[0].model.layer_offloading')}
                    docKey="model.layer_offloading"
                  />
                  {jobConfig.config.process[0].model.layer_offloading && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <SliderInput
                        label="Transformer Offload %"
                        value={Math.round(
                          (jobConfig.config.process[0].model.layer_offloading_transformer_percent ?? 1) * 100,
                        )}
                        onChange={value =>
                          setJobConfig(value * 0.01, 'config.process[0].model.layer_offloading_transformer_percent')
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                      <SliderInput
                        label="Text Encoder Offload %"
                        value={Math.round(
                          (jobConfig.config.process[0].model.layer_offloading_text_encoder_percent ?? 1) * 100,
                        )}
                        onChange={value =>
                          setJobConfig(value * 0.01, 'config.process[0].model.layer_offloading_text_encoder_percent')
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                    </div>
                  )}
                </div>
              )}

              {modelArch?.additionalSections?.includes('model.multistage') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-800/60">
                  <FormGroup label="Stages to Train" docKey={'model.multistage'}>
                    <Checkbox
                      label="High Noise"
                      checked={jobConfig.config.process[0].model.model_kwargs?.train_high_noise || false}
                      onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.train_high_noise')}
                    />
                    <Checkbox
                      label="Low Noise"
                      checked={jobConfig.config.process[0].model.model_kwargs?.train_low_noise || false}
                      onChange={value => setJobConfig(value, 'config.process[0].model.model_kwargs.train_low_noise')}
                    />
                  </FormGroup>
                  <NumberInput
                    label="Switch Every"
                    value={jobConfig.config.process[0].train.switch_boundary_every}
                    onChange={value => setJobConfig(value, 'config.process[0].train.switch_boundary_every')}
                    placeholder="eg. 1"
                    docKey={'train.switch_boundary_every'}
                    min={1}
                    required
                  />
                </div>
              )}
            </CollapsibleAdvancedSection>
          </Card>
        </div>

        {/* Training Section: Essential Controls Front & Center + Collapsible Advanced */}
        <div>
          <Card title="Training">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <NumberInput
                label="Steps"
                value={jobConfig.config.process[0].train.steps}
                onChange={value => setJobConfig(value, 'config.process[0].train.steps')}
                placeholder="eg. 2000"
                min={1}
                required
              />
              <NumberInput
                label="Learning Rate"
                value={jobConfig.config.process[0].train.lr}
                onChange={value => setJobConfig(value, 'config.process[0].train.lr')}
                placeholder="eg. 0.0001"
                min={0}
                required
              />
              <NumberInput
                label="Batch Size"
                value={jobConfig.config.process[0].train.batch_size}
                onChange={value => setJobConfig(value, 'config.process[0].train.batch_size')}
                placeholder="eg. 1"
                min={1}
                required
              />
              <SelectInput
                label="Optimizer"
                value={jobConfig.config.process[0].train.optimizer}
                onChange={value => setJobConfig(value, 'config.process[0].train.optimizer')}
                options={[
                  { value: 'adafactor', label: 'Adafactor' },
                  { value: 'adam', label: 'Adam' },
                  { value: 'adamw', label: 'AdamW' },
                  { value: 'adamw8bit', label: 'AdamW8Bit' },
                  { value: 'automagic', label: 'Automagic' },
                  { value: 'automagic2', label: 'Automagic v2' },
                  { value: 'automagic3', label: 'Automagic v3' },
                  { value: 'prodigyopt', label: 'Prodigy' },
                  { value: 'prodigy8bit', label: 'Prodigy8Bit' },
                ]}
              />
              <NumberInput
                label="Save Checkpoint Every"
                value={jobConfig.config.process[0].save.save_every}
                onChange={value => setJobConfig(value, 'config.process[0].save.save_every')}
                placeholder="eg. 250"
                min={1}
                required
              />
            </div>

            <CollapsibleAdvancedSection title="Advanced Training, Regularization & Validation" summary={trainAdvSummary}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Col 1: Grad Accum & Weight Decay */}
                <div>
                  <NumberInput
                    label="Gradient Accumulation"
                    value={jobConfig.config.process[0].train.gradient_accumulation}
                    onChange={value => setJobConfig(value, 'config.process[0].train.gradient_accumulation')}
                    placeholder="eg. 1"
                    min={1}
                    required
                  />
                  <NumberInput
                    label="Weight Decay"
                    className="pt-2"
                    value={jobConfig.config.process[0].train.optimizer_params.weight_decay}
                    onChange={value => setJobConfig(value, 'config.process[0].train.optimizer_params.weight_decay')}
                    placeholder="eg. 0.0001"
                    min={0}
                    required
                  />
                </div>

                {/* Col 2: Timestep & Loss */}
                {!isLlmModel && (
                  <div>
                    {!disableSections.includes('train.timestep_type') && (
                      <SelectInput
                        label="Timestep Type"
                        value={jobConfig.config.process[0].train.timestep_type}
                        disabled={disableSections.includes('train.timestep_type') || false}
                        onChange={value => setJobConfig(value, 'config.process[0].train.timestep_type')}
                        options={[
                          { value: 'sigmoid', label: 'Sigmoid' },
                          { value: 'linear', label: 'Linear' },
                          { value: 'shift', label: 'Shift' },
                          { value: 'weighted', label: 'Weighted' },
                        ]}
                      />
                    )}
                    <SelectInput
                      label="Timestep Bias"
                      className="pt-2"
                      value={jobConfig.config.process[0].train.content_or_style}
                      onChange={value => setJobConfig(value, 'config.process[0].train.content_or_style')}
                      options={[
                        { value: 'balanced', label: 'Balanced' },
                        { value: 'content', label: 'High Noise' },
                        { value: 'style', label: 'Low Noise' },
                      ]}
                    />
                    <SelectInput
                      label="Loss Type"
                      className="pt-2"
                      value={jobConfig.config.process[0].train.loss_type}
                      onChange={value => setJobConfig(value, 'config.process[0].train.loss_type')}
                      options={[
                        { value: 'mse', label: 'Mean Squared Error' },
                        { value: 'mae', label: 'Mean Absolute Error' },
                        { value: 'wavelet', label: 'Wavelet' },
                        { value: 'stepped', label: 'Stepped Recovery' },
                      ]}
                    />
                    {modelArch?.additionalSections?.includes('train.audio_loss_multiplier') && (
                      <NumberInput
                        label="Audio Loss Multiplier"
                        className="pt-2"
                        value={jobConfig.config.process[0].train.audio_loss_multiplier ?? 1.0}
                        onChange={value => setJobConfig(value, 'config.process[0].train.audio_loss_multiplier')}
                        placeholder="eg. 1.0"
                        docKey={'train.audio_loss_multiplier'}
                        min={0}
                      />
                    )}
                  </div>
                )}

                {/* Col 3: EMA, Text Encoder & Dataset Pooling */}
                <div>
                  <FormGroup label="EMA (Exponential Moving Average)">
                    <Checkbox
                      label="Use EMA"
                      className="pt-1"
                      checked={jobConfig.config.process[0].train.ema_config?.use_ema || false}
                      onChange={value => setJobConfig(value, 'config.process[0].train.ema_config.use_ema')}
                    />
                  </FormGroup>
                  {jobConfig.config.process[0].train.ema_config?.use_ema && (
                    <NumberInput
                      label="EMA Decay"
                      className="pt-2"
                      value={jobConfig.config.process[0].train.ema_config?.ema_decay as number}
                      onChange={value => setJobConfig(value, 'config.process[0].train.ema_config.ema_decay')}
                      placeholder="eg. 0.99"
                      min={0}
                    />
                  )}

                  {!isLlmModel && (
                    <FormGroup label="Text Encoder & Dataset Options" className="pt-2">
                      {!disableSections.includes('train.unload_text_encoder') && (
                        <Checkbox
                          label="Unload TE"
                          checked={jobConfig.config.process[0].train.unload_text_encoder || false}
                          docKey={'train.unload_text_encoder'}
                          onChange={value => {
                            setJobConfig(value, 'config.process[0].train.unload_text_encoder');
                            if (value) {
                              setJobConfig(false, 'config.process[0].train.cache_text_embeddings');
                            }
                          }}
                        />
                      )}
                      <Checkbox
                        label="Cache Text Embeddings"
                        checked={jobConfig.config.process[0].train.cache_text_embeddings || false}
                        docKey={'train.cache_text_embeddings'}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.cache_text_embeddings');
                          if (value) {
                            setJobConfig(false, 'config.process[0].train.unload_text_encoder');
                          }
                        }}
                      />
                      <Checkbox
                        label="Pool Datasets"
                        docKey={'train.pool_datasets'}
                        checked={jobConfig.config.process[0].train.pool_datasets || false}
                        onChange={value => {
                          setJobConfig(value ? true : undefined, 'config.process[0].train.pool_datasets');
                        }}
                      />
                    </FormGroup>
                  )}
                </div>

                {/* Col 4: Regularization & Guidance */}
                <div>
                  {(!disableSections.includes('train.diff_output_preservation') ||
                    !disableSections.includes('train.blank_prompt_preservation')) && (
                    <FormGroup label="Regularization">
                      <></>
                    </FormGroup>
                  )}
                  {!disableSections.includes('train.diff_output_preservation') && (
                    <>
                      <Checkbox
                        label="Differential Output Preservation"
                        docKey={'train.diff_output_preservation'}
                        className="pt-1"
                        checked={jobConfig.config.process[0].train.diff_output_preservation || false}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.diff_output_preservation');
                          if (value && jobConfig.config.process[0].train.blank_prompt_preservation) {
                            setJobConfig(false, 'config.process[0].train.blank_prompt_preservation');
                          }
                        }}
                      />
                      {jobConfig.config.process[0].train.diff_output_preservation && (
                        <>
                          <NumberInput
                            label="DOP Loss Multiplier"
                            className="pt-2"
                            value={jobConfig.config.process[0].train.diff_output_preservation_multiplier as number}
                            onChange={value =>
                              setJobConfig(value, 'config.process[0].train.diff_output_preservation_multiplier')
                            }
                            placeholder="eg. 1.0"
                            min={0}
                          />
                          <TextInput
                            label="DOP Preservation Class"
                            className="pt-2 pb-4"
                            value={jobConfig.config.process[0].train.diff_output_preservation_class as string}
                            onChange={value =>
                              setJobConfig(value, 'config.process[0].train.diff_output_preservation_class')
                            }
                            placeholder="eg. woman"
                          />
                        </>
                      )}
                    </>
                  )}
                  {!disableSections.includes('train.blank_prompt_preservation') && (
                    <>
                      <Checkbox
                        label="Blank Prompt Preservation"
                        docKey={'train.blank_prompt_preservation'}
                        className="pt-1"
                        checked={jobConfig.config.process[0].train.blank_prompt_preservation || false}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.blank_prompt_preservation');
                          if (value && jobConfig.config.process[0].train.diff_output_preservation) {
                            setJobConfig(false, 'config.process[0].train.diff_output_preservation');
                          }
                        }}
                      />
                      {jobConfig.config.process[0].train.blank_prompt_preservation && (
                        <NumberInput
                          label="BPP Loss Multiplier"
                          className="pt-2"
                          value={
                            (jobConfig.config.process[0].train.blank_prompt_preservation_multiplier as number) || 1.0
                          }
                          onChange={value =>
                            setJobConfig(value, 'config.process[0].train.blank_prompt_preservation_multiplier')
                          }
                          placeholder="eg. 1.0"
                          min={0}
                        />
                      )}
                    </>
                  )}
                  {!isLlmModel && (
                    <FormGroup label="Guidance Losses" className="pt-2">
                      <Checkbox
                        label="Contrastive Guidance Loss"
                        docKey={'train.do_guidance_loss'}
                        className="pt-1"
                        checked={jobConfig.config.process[0].train.do_guidance_loss || false}
                        onChange={value => {
                          if (value) {
                            setJobConfig(true, 'config.process[0].train.do_guidance_loss');
                            if (!jobConfig.config.process[0].train.guidance_loss_target) {
                              setJobConfig(4.0, 'config.process[0].train.guidance_loss_target');
                            }
                          } else {
                            setJobConfig(undefined, 'config.process[0].train.do_guidance_loss');
                            setJobConfig(undefined, 'config.process[0].train.guidance_loss_target');
                          }
                        }}
                      />
                      {jobConfig.config.process[0].train.do_guidance_loss && (
                        <NumberInput
                          label="Guidance Loss Target"
                          docKey={'train.guidance_loss_target'}
                          value={(jobConfig.config.process[0].train.guidance_loss_target as number) || 4.0}
                          onChange={value => setJobConfig(value, 'config.process[0].train.guidance_loss_target')}
                          placeholder="eg. 3.0"
                          min={0}
                        />
                      )}
                      <Checkbox
                        label="Do Differential Guidance"
                        docKey={'train.do_differential_guidance'}
                        className="pt-1"
                        checked={jobConfig.config.process[0].train.do_differential_guidance || false}
                        onChange={value => {
                          let newValue = value == false ? undefined : value;
                          setJobConfig(newValue, 'config.process[0].train.do_differential_guidance');
                          if (!newValue) {
                            setJobConfig(undefined, 'config.process[0].train.differential_guidance_scale');
                          } else if (
                            jobConfig.config.process[0].train.differential_guidance_scale === undefined ||
                            jobConfig.config.process[0].train.differential_guidance_scale === null
                          ) {
                            setJobConfig(3.0, 'config.process[0].train.differential_guidance_scale');
                          }
                        }}
                      />
                      {jobConfig.config.process[0].train.differential_guidance_scale && (
                        <NumberInput
                          label="Differential Guidance Scale"
                          className="pt-2"
                          value={(jobConfig.config.process[0].train.differential_guidance_scale as number) || 3.0}
                          onChange={value =>
                            setJobConfig(value, 'config.process[0].train.differential_guidance_scale')
                          }
                          placeholder="eg. 3.0"
                          min={0}
                        />
                      )}
                    </FormGroup>
                  )}
                </div>
              </div>

              {/* Validation Sub-section inside Advanced Training */}
              {!isLlmModel && (
                <div className="pt-4 border-t border-gray-800/80">
                  <Checkbox
                    label="Enable Deterministic Validation Loss Check"
                    checked={!!validationConfig}
                    onChange={value => {
                      if (value) {
                        setJobConfig(
                          {
                            validation_items: [{ image_path: '', prompt: '' }],
                            resolution: 1024,
                            validate_every_n_steps: 50,
                            validation_sigmas: [0.5],
                          },
                          'config.process[0].train.validation_config',
                        );
                      } else {
                        setJobConfig(undefined, 'config.process[0].train.validation_config');
                      }
                    }}
                  />
                  {validationConfig && (
                    <div className="mt-3 p-4 rounded-lg bg-gray-950/60 border border-gray-800">
                      <p className="text-xs text-gray-400 mb-3">
                        Validation runs a stable loss check on a fixed set of held-out images.{' '}
                        <span className="font-semibold text-gray-300">
                          Do not include validation images in the training dataset.
                        </span>
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <NumberInput
                          label="Validate Every"
                          value={validationConfig.validate_every_n_steps}
                          onChange={value =>
                            setJobConfig(value, 'config.process[0].train.validation_config.validate_every_n_steps')
                          }
                          placeholder="eg. 50"
                          min={1}
                          required
                        />
                        <NumberInput
                          label="Validation Resolution"
                          value={validationConfig.resolution}
                          onChange={value =>
                            setJobConfig(value, 'config.process[0].train.validation_config.resolution')
                          }
                          placeholder="eg. 1024"
                          min={64}
                          required
                        />
                        <SelectInput
                          label="Validation Sigmas"
                          value={(validationConfig.validation_sigmas ?? [1.0, 0.75, 0.5, 0.25]).join(', ')}
                          onChange={value =>
                            setJobConfig(
                              value.split(',').map((v: string) => parseFloat(v)),
                              'config.process[0].train.validation_config.validation_sigmas',
                            )
                          }
                          options={[
                            { value: '0.5', label: '0.5' },
                            { value: '1, 0.5', label: '1.0, 0.5' },
                            { value: '1, 0.66, 0.33', label: '1.0, 0.66, 0.33' },
                            { value: '1, 0.75, 0.5, 0.25', label: '1.0, 0.75, 0.5, 0.25' },
                          ]}
                        />
                      </div>
                      <div className="mt-4">
                        <label className="block text-xs text-gray-300 mb-2">
                          Validation Images ({validationConfig.validation_items.length})
                        </label>
                        {validationConfig.validation_items.map((item, i) => (
                          <div key={i} className="rounded-lg pl-4 pr-1 py-3 mb-3 bg-gray-900">
                            <div className="flex items-center space-x-4">
                              <SampleControlImage
                                instruction="Add Image"
                                src={item.image_path === '' ? null : item.image_path}
                                onNewImageSelected={imagePath => {
                                  setJobConfig(
                                    imagePath ?? '',
                                    `config.process[0].train.validation_config.validation_items[${i}].image_path`,
                                  );
                                }}
                              />
                              <div className="flex-1">
                                <TextInput
                                  label="Prompt"
                                  value={item.prompt}
                                  onChange={value =>
                                    setJobConfig(
                                      value,
                                      `config.process[0].train.validation_config.validation_items[${i}].prompt`,
                                    )
                                  }
                                  placeholder="Enter prompt"
                                />
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setJobConfig(
                                      validationConfig.validation_items.filter((_, index) => index !== i),
                                      'config.process[0].train.validation_config.validation_items',
                                    )
                                  }
                                  className="rounded-full p-1 text-sm"
                                >
                                  <X />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setJobConfig(
                              [...validationConfig.validation_items, { image_path: '', prompt: '' }],
                              'config.process[0].train.validation_config.validation_items',
                            )
                          }
                          className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                        >
                          Add Validation Image
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CollapsibleAdvancedSection>
          </Card>
        </div>

        {/* Datasets Section */}
        <div>
          <Card title="Datasets">
            <div className="space-y-4">
              {jobConfig.config.process[0].datasets.map((dataset, i) => {
                const isDatasetAdvOpen = !!expandedDatasetAdvanced[i];
                const coreResolutions = [512, 768, 1024];
                const extraResolutions = [256, 1280, 1328, 1536, 2048];
                const activeExtraRes = dataset.resolution.filter(r => extraResolutions.includes(r));

                return (
                  <div key={i} className="p-4 rounded-lg bg-gray-800/80 border border-gray-700/60 relative">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-base font-bold text-gray-200">
                        {jobConfig.config.process[0].datasets.length > 1 ? `Dataset ${i + 1}` : 'Dataset Configuration'}
                      </h2>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const duplicated = objectCopy(dataset);
                            const datasets = [...jobConfig.config.process[0].datasets];
                            datasets.splice(i + 1, 0, duplicated);
                            setJobConfig(datasets, 'config.process[0].datasets');
                          }}
                          className="bg-gray-700 hover:bg-gray-600 rounded-md px-2 py-1 text-xs flex items-center gap-1 transition-colors text-gray-200"
                          title="Duplicate Dataset"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Duplicate</span>
                        </button>
                        {jobConfig.config.process[0].datasets.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setJobConfig(
                                jobConfig.config.process[0].datasets.filter((_, index) => index !== i),
                                'config.process[0].datasets',
                              )
                            }
                            className="bg-red-600/80 hover:bg-red-600 text-white rounded-md px-2 py-1 text-xs flex items-center gap-1 transition-colors"
                            title="Remove Dataset"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Remove</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Core Dataset Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                      <div>
                        <SelectInput
                          label="Target Dataset"
                          value={dataset.folder_path}
                          onChange={value => {
                            datasetManuallyEditedRef.current = true;
                            setJobConfig(value, `config.process[0].datasets[${i}].folder_path`);
                          }}
                          options={datasetOptions}
                        />
                        {modelArch?.additionalSections?.includes('datasets.control_path') && (
                          <SelectInput
                            label="Control Dataset"
                            docKey="datasets.control_path"
                            value={dataset.control_path ?? ''}
                            className="pt-2"
                            onChange={value =>
                              setJobConfig(value == '' ? null : value, `config.process[0].datasets[${i}].control_path`)
                            }
                            options={[{ value: '', label: <>&nbsp;</> }, ...datasetOptions]}
                          />
                        )}
                        {modelArch?.additionalSections?.includes('datasets.multi_control_paths') && (
                          <>
                            <SelectInput
                              label="Control Dataset 1"
                              docKey="datasets.multi_control_paths"
                              value={dataset.control_path_1 ?? ''}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(
                                  value == '' ? null : value,
                                  `config.process[0].datasets[${i}].control_path_1`,
                                )
                              }
                              options={[{ value: '', label: <>&nbsp;</> }, ...datasetOptions]}
                            />
                            <SelectInput
                              label="Control Dataset 2"
                              docKey="datasets.multi_control_paths"
                              value={dataset.control_path_2 ?? ''}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(
                                  value == '' ? null : value,
                                  `config.process[0].datasets[${i}].control_path_2`,
                                )
                              }
                              options={[{ value: '', label: <>&nbsp;</> }, ...datasetOptions]}
                            />
                            <SelectInput
                              label="Control Dataset 3"
                              docKey="datasets.multi_control_paths"
                              value={dataset.control_path_3 ?? ''}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(
                                  value == '' ? null : value,
                                  `config.process[0].datasets[${i}].control_path_3`,
                                )
                              }
                              options={[{ value: '', label: <>&nbsp;</> }, ...datasetOptions]}
                            />
                          </>
                        )}
                      </div>

                      <div>
                        <TextInput
                          label="Default Caption (Fallback)"
                          value={dataset.default_caption}
                          onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].default_caption`)}
                          placeholder="e.g. [trigger] or a photo of [trigger]"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">
                          Used when an image has no <code className="text-gray-300">.{dataset.caption_ext || 'txt'}</code>{' '}
                          caption file.
                        </p>
                      </div>

                      {!isAudioModel && (
                        <div>
                          <FormGroup label="Resolutions">
                            <div className="flex flex-wrap gap-3 pt-1">
                              {coreResolutions.map(res => (
                                <Checkbox
                                  key={res}
                                  label={res.toString()}
                                  checked={dataset.resolution.includes(res)}
                                  onChange={() => {
                                    const resolutions = dataset.resolution.includes(res)
                                      ? dataset.resolution.filter(r => r !== res)
                                      : [...dataset.resolution, res];
                                    setJobConfig(resolutions, `config.process[0].datasets[${i}].resolution`);
                                  }}
                                />
                              ))}
                            </div>
                            {activeExtraRes.length > 0 && !isDatasetAdvOpen && (
                              <p className="text-[11px] text-blue-300 pt-1">
                                + Extra resolutions: {activeExtraRes.join(', ')}
                              </p>
                            )}
                          </FormGroup>
                        </div>
                      )}

                      <div>
                        <FormGroup label="Caching & Media">
                          <Checkbox
                            label="Cache Latents to Disk"
                            checked={dataset.cache_latents_to_disk || false}
                            onChange={value =>
                              setJobConfig(value, `config.process[0].datasets[${i}].cache_latents_to_disk`)
                            }
                          />
                          {modelArch?.additionalSections?.includes('datasets.num_frames') &&
                            !dataset.auto_frame_count && (
                              <NumberInput
                                label="Num Frames"
                                className="pt-1"
                                docKey="datasets.num_frames"
                                value={dataset.num_frames}
                                onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].num_frames`)}
                                placeholder="eg. 41"
                                min={1}
                                required
                              />
                            )}
                          {modelArch?.additionalSections?.includes('datasets.auto_frame_count') && (
                            <Checkbox
                              label="Auto Frame Count"
                              checked={dataset.auto_frame_count || false}
                              onChange={value =>
                                setJobConfig(value, `config.process[0].datasets[${i}].auto_frame_count`)
                              }
                              docKey="datasets.auto_frame_count"
                            />
                          )}
                          {modelArch?.additionalSections?.includes('datasets.do_i2v') && (
                            <Checkbox
                              label="Do I2V"
                              checked={dataset.do_i2v || false}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].do_i2v`)}
                              docKey="datasets.do_i2v"
                            />
                          )}
                          {modelArch?.additionalSections?.includes('datasets.do_audio') && (
                            <Checkbox
                              label="Do Audio"
                              checked={dataset.do_audio || false}
                              onChange={value => {
                                setJobConfig(
                                  value ? value : undefined,
                                  `config.process[0].datasets[${i}].do_audio`,
                                );
                              }}
                              docKey="datasets.do_audio"
                            />
                          )}
                        </FormGroup>
                      </div>
                    </div>

                    {/* Per-Dataset Collapsible Advanced Settings */}
                    <div className="mt-3 pt-2 border-t border-gray-700/60">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDatasetAdvanced(prev => ({
                            ...prev,
                            [i]: !prev[i],
                          }))
                        }
                        className="w-full flex items-center justify-between text-left py-1 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          {isDatasetAdvOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                          )}
                          Advanced Dataset Options
                        </span>
                        {!isDatasetAdvOpen && (
                          <span className="text-[11px] font-mono text-gray-400 font-normal">
                            Repeats: {dataset.num_repeats || 1} · Dropout: {dataset.caption_dropout_rate} · Ext: .
                            {dataset.caption_ext || 'txt'}
                            {dataset.flip_x ? ' · FlipX' : ''}
                            {dataset.flip_y ? ' · FlipY' : ''}
                            {dataset.is_reg ? ' · Reg' : ''}
                          </span>
                        )}
                      </button>

                      {isDatasetAdvOpen && (
                        <div className="mt-3 pt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <NumberInput
                              label="Num Repeats"
                              value={dataset.num_repeats || 1}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].num_repeats`)}
                              placeholder="eg. 1"
                              docKey={'dataset.num_repeats'}
                            />
                            <NumberInput
                              label="LoRA Weight"
                              value={dataset.network_weight}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(value, `config.process[0].datasets[${i}].network_weight`)
                              }
                              placeholder="eg. 1.0"
                            />
                            <NumberInput
                              label="Dataset Batch Size Override"
                              value={dataset.batch_size ?? null}
                              className="pt-2"
                              onChange={value =>
                                setJobConfig(
                                  value == null ? undefined : value,
                                  `config.process[0].datasets[${i}].batch_size`,
                                )
                              }
                              placeholder={`${jobConfig.config.process[0].train.batch_size} (uses global)`}
                              min={1}
                              allowEmpty
                            />
                          </div>

                          <div>
                            <NumberInput
                              label="Caption Dropout Rate"
                              docKey="datasets.caption_dropout_rate"
                              value={dataset.caption_dropout_rate}
                              onChange={value =>
                                setJobConfig(value, `config.process[0].datasets[${i}].caption_dropout_rate`)
                              }
                              placeholder="eg. 0.05"
                              min={0}
                              required
                            />
                            <CreatableSelectInput
                              label="Caption Extension"
                              className="pt-2"
                              value={dataset.caption_ext || 'txt'}
                              onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].caption_ext`)}
                              options={[
                                { value: 'txt', label: 'txt' },
                                { value: 'json', label: 'json' },
                                { value: 'caption', label: 'caption' },
                              ]}
                            />
                          </div>

                          <div>
                            <FormGroup label="Augmentation & Regularization">
                              <Checkbox
                                label="Is Regularization Dataset"
                                checked={dataset.is_reg || false}
                                onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].is_reg`)}
                              />
                              {!isAudioModel && !isLlmModel && (
                                <>
                                  <Checkbox
                                    label={
                                      <>
                                        Flip X <FlipHorizontal2 className="inline-block w-4 h-4 ml-1" />
                                      </>
                                    }
                                    checked={dataset.flip_x || false}
                                    onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].flip_x`)}
                                  />
                                  <Checkbox
                                    label={
                                      <>
                                        Flip Y <FlipVertical2 className="inline-block w-4 h-4 ml-1" />
                                      </>
                                    }
                                    checked={dataset.flip_y || false}
                                    onChange={value => setJobConfig(value, `config.process[0].datasets[${i}].flip_y`)}
                                  />
                                </>
                              )}
                              {modelArch?.additionalSections?.includes('datasets.audio_normalize') && (
                                <Checkbox
                                  label="Audio Normalize"
                                  checked={dataset.audio_normalize || false}
                                  onChange={value =>
                                    setJobConfig(
                                      value ? value : undefined,
                                      `config.process[0].datasets[${i}].audio_normalize`,
                                    )
                                  }
                                  docKey="datasets.audio_normalize"
                                />
                              )}
                              {modelArch?.additionalSections?.includes('datasets.audio_preserve_pitch') && (
                                <Checkbox
                                  label="Audio Preserve Pitch"
                                  checked={dataset.audio_preserve_pitch || false}
                                  onChange={value =>
                                    setJobConfig(
                                      value ? value : undefined,
                                      `config.process[0].datasets[${i}].audio_preserve_pitch`,
                                    )
                                  }
                                  docKey="datasets.audio_preserve_pitch"
                                />
                              )}
                            </FormGroup>
                          </div>

                          {!isAudioModel && (
                            <div>
                              <FormGroup label="Additional Resolutions">
                                <div className="grid grid-cols-2 gap-2">
                                  {extraResolutions.map(res => (
                                    <Checkbox
                                      key={res}
                                      label={res.toString()}
                                      checked={dataset.resolution.includes(res)}
                                      onChange={() => {
                                        const resolutions = dataset.resolution.includes(res)
                                          ? dataset.resolution.filter(r => r !== res)
                                          : [...dataset.resolution, res];
                                        setJobConfig(resolutions, `config.process[0].datasets[${i}].resolution`);
                                      }}
                                    />
                                  ))}
                                </div>
                              </FormGroup>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  const newDataset = objectCopy(defaultDatasetConfig);
                  const controls = modelArch?.controls ?? [];
                  newDataset.controls = controls;
                  for (const key in modelArch?.defaults ?? {}) {
                    const marker = 'datasets[x].';
                    const idx = key.indexOf(marker);
                    if (idx !== -1) {
                      (newDataset as any)[key.slice(idx + marker.length)] = modelArch!.defaults![key][0];
                    }
                  }
                  setJobConfig([...jobConfig.config.process[0].datasets, newDataset], 'config.process[0].datasets');
                }}
                className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
              >
                + Add Another Dataset
              </button>
            </div>
          </Card>
        </div>

        {/* Sample Section */}
        <div>
          <Card title="Sample">
            {/* Core Sampling Row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <NumberInput
                label="Sample Every"
                value={jobConfig.config.process[0].sample.sample_every}
                onChange={value => setJobConfig(value, 'config.process[0].sample.sample_every')}
                placeholder="eg. 250"
                min={1}
                required
              />
              {!isLlmModel && (
                <>
                  <NumberInput
                    label="Sample Steps"
                    value={jobConfig.config.process[0].sample.sample_steps}
                    onChange={value => setJobConfig(value, 'config.process[0].sample.sample_steps')}
                    placeholder="eg. 25"
                    min={1}
                    required
                  />
                  <NumberInput
                    label="Guidance Scale"
                    value={jobConfig.config.process[0].sample.guidance_scale}
                    onChange={value => setJobConfig(value, 'config.process[0].sample.guidance_scale')}
                    placeholder="eg. 3.5"
                    min={0}
                    required
                  />
                </>
              )}
              {!isAudioModel && !isLlmModel && (
                <>
                  <NumberInput
                    label="Width"
                    value={jobConfig.config.process[0].sample.width}
                    onChange={value => setJobConfig(value, 'config.process[0].sample.width')}
                    placeholder="eg. 1024"
                    min={0}
                    required
                  />
                  <NumberInput
                    label="Height"
                    value={jobConfig.config.process[0].sample.height}
                    onChange={value => setJobConfig(value, 'config.process[0].sample.height')}
                    placeholder="eg. 1024"
                    min={0}
                    required
                  />
                </>
              )}
            </div>

            {isVideoModel && !isAudioModel && !isLlmModel && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <NumberInput
                  label="Num Frames"
                  value={jobConfig.config.process[0].sample.num_frames}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.num_frames')}
                  placeholder="eg. 41"
                  min={0}
                  required
                />
                <NumberInput
                  label="FPS"
                  value={jobConfig.config.process[0].sample.fps}
                  onChange={value => setJobConfig(value, 'config.process[0].sample.fps')}
                  placeholder="eg. 16"
                  min={0}
                  required
                />
              </div>
            )}

            {/* Collapsible Advanced Sampling Settings */}
            <CollapsibleAdvancedSection title="Advanced Sampling Settings" summary={sampleAdvSummary}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {!isLlmModel && (
                  <div>
                    <SelectInput
                      label="Sampler"
                      value={jobConfig.config.process[0].sample.sampler}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.sampler')}
                      options={[
                        { value: 'flowmatch', label: 'FlowMatch' },
                        { value: 'ddpm', label: 'DDPM' },
                      ]}
                    />
                    <NumberInput
                      label="Sample Start Step"
                      value={jobConfig.config.process[0].sample.sample_start_step ?? 0}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.sample_start_step')}
                      placeholder="eg. 0"
                      className="pt-2"
                      min={0}
                      required
                    />
                  </div>
                )}

                {!isLlmModel && (
                  <div>
                    <NumberInput
                      label="Seed"
                      value={jobConfig.config.process[0].sample.seed}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.seed')}
                      placeholder="eg. 42"
                      min={0}
                      required
                    />
                    {modelArch?.additionalSections?.includes('sample.duration') && (
                      <NumberInput
                        label="Duration (seconds)"
                        value={jobConfig.config.process[0].sample.duration ?? 120}
                        onChange={value => setJobConfig(value, 'config.process[0].sample.duration')}
                        placeholder="eg. 120"
                        className="pt-2"
                        min={1}
                        required
                      />
                    )}
                    <Checkbox
                      label="Walk Seed"
                      className="pt-4"
                      checked={jobConfig.config.process[0].sample.walk_seed}
                      onChange={value => setJobConfig(value, 'config.process[0].sample.walk_seed')}
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <FormGroup label="Sampling Schedule Controls">
                    <div className="flex flex-wrap gap-6 pt-1">
                      <Checkbox
                        label="Skip First Sample"
                        checked={jobConfig.config.process[0].train.skip_first_sample || false}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.skip_first_sample');
                          if (value) {
                            setJobConfig(false, 'config.process[0].train.force_first_sample');
                          }
                        }}
                      />
                      <Checkbox
                        label="Force First Sample"
                        checked={jobConfig.config.process[0].train.force_first_sample || false}
                        docKey={'train.force_first_sample'}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.force_first_sample');
                          if (value) {
                            setJobConfig(false, 'config.process[0].train.skip_first_sample');
                          }
                        }}
                      />
                      <Checkbox
                        label="Disable Sampling"
                        checked={jobConfig.config.process[0].train.disable_sampling || false}
                        onChange={value => {
                          setJobConfig(value, 'config.process[0].train.disable_sampling');
                          if (value) {
                            setJobConfig(false, 'config.process[0].train.force_first_sample');
                          }
                        }}
                      />
                    </div>
                  </FormGroup>
                </div>
              </div>
            </CollapsibleAdvancedSection>

            {/* Sample Prompts List */}
            <div className="pt-4 mt-2 border-t border-gray-800/80 mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Sample Prompts ({jobConfig.config.process[0].sample.samples.length})
                </label>
                {!isAudioModel && !isLlmModel && !modelArch?.sampleTags && (
                  <button
                    type="button"
                    onClick={() =>
                      setJobConfig(objectCopy(defaultSampleConfig.samples), 'config.process[0].sample.samples')
                    }
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    title="Reset sample prompts to 4 default [trigger] prompts"
                  >
                    <Sparkles className="w-3 h-3" />
                    Reset to [trigger] defaults
                  </button>
                )}
              </div>
              {modelArch?.additionalSections?.includes('ideogram_4_prompt') && (
                <button
                  type="button"
                  disabled={jobConfig.config.process[0].sample.samples.length === 0}
                  onClick={() => {
                    const sampleCfg = jobConfig.config.process[0].sample;
                    const items = sampleCfg.samples
                      .map((s, i) => ({
                        index: i,
                        prompt: s.prompt || '',
                        aspectRatio: toAspectRatio(s.width || sampleCfg.width, s.height || sampleCfg.height),
                      }))
                      .filter(it => it.prompt.trim() !== '');
                    if (items.length === 0) return;
                    openUpsamplePromptsModal(items, (index, newPrompt) => {
                      setJobConfig(newPrompt, `config.process[0].sample.samples[${index}].prompt`);
                    });
                  }}
                  className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-2"
                >
                  <Wand2 className="w-4 h-4" />
                  Upsample Prompts
                </button>
              )}
            </div>

            <div className="space-y-2.5">
              {jobConfig.config.process[0].sample.samples.map((sample, i) => {
                const hasOverrides = !!(
                  sample.width ||
                  sample.height ||
                  sample.seed !== undefined ||
                  sample.network_multiplier
                );
                const showOverrides = !!expandedPromptOverrides[i] || hasOverrides;

                return (
                  <div key={i} className="rounded-lg px-3 py-2.5 bg-gray-950/90 border border-gray-800/80">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-mono text-gray-500 pt-2 select-none w-5">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            {modelArch?.sampleTags && taggedSampleArr && modelArchTagSections ? (
                              <>
                                {modelArchTagSections.map((sampleTagSection, sti) => (
                                  <div key={sti} className="grid w-full lg:grid-flow-col lg:auto-cols-fr gap-4 mt-1">
                                    {Object.entries(sampleTagSection).map(([tagKey, tag]) => (
                                      <div key={tagKey} className="mb-2">
                                        {tag.type === 'text' && (
                                          <TextInput
                                            label={tag.title}
                                            value={taggedSampleArr[i][tagKey] ?? ''}
                                            onChange={value => {
                                              let taggedSample = { ...taggedSampleArr[i] };
                                              taggedSample[tagKey] = value;
                                              setJobConfig(
                                                objToTags(taggedSample),
                                                `config.process[0].sample.samples[${i}].prompt`,
                                              );
                                            }}
                                            placeholder={`Enter ${tag.title.toLowerCase()}`}
                                          />
                                        )}
                                        {tag.type === 'multiline' && (
                                          <TextAreaInput
                                            label={tag.title}
                                            value={taggedSampleArr[i][tagKey] ?? ''}
                                            onChange={value => {
                                              let taggedSample = { ...taggedSampleArr[i] };
                                              taggedSample[tagKey] = value;
                                              setJobConfig(
                                                objToTags(taggedSample),
                                                `config.process[0].sample.samples[${i}].prompt`,
                                              );
                                            }}
                                            placeholder={`Enter ${tag.title.toLowerCase()}`}
                                          />
                                        )}
                                        {tag.type === 'number' && (
                                          <NumberInput
                                            label={tag.title}
                                            value={taggedSampleArr[i][tagKey] ?? ''}
                                            onChange={value => {
                                              let taggedSample = { ...taggedSampleArr[i] };
                                              taggedSample[tagKey] = value;
                                              setJobConfig(
                                                objToTags(taggedSample),
                                                `config.process[0].sample.samples[${i}].prompt`,
                                              );
                                            }}
                                            placeholder={`Enter ${tag.title.toLowerCase()}`}
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </>
                            ) : (
                              <>
                                {modelArch?.hasMultiLinePrompts ? (
                                  <TextAreaInput
                                    value={sample.prompt}
                                    onChange={value =>
                                      setJobConfig(value, `config.process[0].sample.samples[${i}].prompt`)
                                    }
                                    placeholder="Enter sample prompt (use [trigger] for your trigger word)"
                                    rows={2}
                                    required
                                  />
                                ) : (
                                  <TextInput
                                    value={sample.prompt}
                                    onChange={value =>
                                      setJobConfig(value, `config.process[0].sample.samples[${i}].prompt`)
                                    }
                                    placeholder={
                                      isLlmModel
                                        ? 'blank = LLM Prompt'
                                        : 'Enter sample prompt (use [trigger] for your trigger word)'
                                    }
                                    required={!isLlmModel}
                                  />
                                )}
                              </>
                            )}

                            {modelArch?.additionalSections?.includes('ideogram_4_prompt') && (
                              <div className="mt-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const sampleCfg = jobConfig.config.process[0].sample;
                                    openPromptBoxEditor({
                                      prompt: sample.prompt || '',
                                      aspectRatio: toAspectRatio(
                                        sample.width || sampleCfg.width,
                                        sample.height || sampleCfg.height,
                                      ),
                                      title: `Prompt #${i + 1}`,
                                      onApply: newPrompt =>
                                        setJobConfig(newPrompt, `config.process[0].sample.samples[${i}].prompt`),
                                    });
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-600 text-gray-300 hover:bg-gray-800 transition-colors"
                                >
                                  <SquareDashed className="w-3.5 h-3.5" />
                                  Edit caption &amp; boxes
                                </button>
                              </div>
                            )}

                            {/* Per-prompt overrides (collapsed by default unless customized) */}
                            {showOverrides && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 pt-2 border-t border-gray-800/70">
                                {!isAudioModel && !isLlmModel && (
                                  <TextInput
                                    label="Width Override"
                                    value={sample.width ? `${sample.width}` : ''}
                                    onChange={value => {
                                      value = value.replace(/\D/g, '');
                                      if (value === '') {
                                        let newConfig = objectCopy(jobConfig);
                                        if (newConfig.config.process[0].sample.samples[i]) {
                                          delete newConfig.config.process[0].sample.samples[i].width;
                                          setJobConfig(
                                            newConfig.config.process[0].sample.samples,
                                            'config.process[0].sample.samples',
                                          );
                                        }
                                      } else {
                                        const intValue = parseInt(value);
                                        if (!isNaN(intValue)) {
                                          setJobConfig(intValue, `config.process[0].sample.samples[${i}].width`);
                                        }
                                      }
                                    }}
                                    placeholder={`${jobConfig.config.process[0].sample.width} (default)`}
                                  />
                                )}
                                {!isAudioModel && !isLlmModel && (
                                  <TextInput
                                    label="Height Override"
                                    value={sample.height ? `${sample.height}` : ''}
                                    onChange={value => {
                                      value = value.replace(/\D/g, '');
                                      if (value === '') {
                                        let newConfig = objectCopy(jobConfig);
                                        if (newConfig.config.process[0].sample.samples[i]) {
                                          delete newConfig.config.process[0].sample.samples[i].height;
                                          setJobConfig(
                                            newConfig.config.process[0].sample.samples,
                                            'config.process[0].sample.samples',
                                          );
                                        }
                                      } else {
                                        const intValue = parseInt(value);
                                        if (!isNaN(intValue)) {
                                          setJobConfig(intValue, `config.process[0].sample.samples[${i}].height`);
                                        }
                                      }
                                    }}
                                    placeholder={`${jobConfig.config.process[0].sample.height} (default)`}
                                  />
                                )}
                                {!isLlmModel && (
                                  <TextInput
                                    label="Seed Override"
                                    value={sample.seed ? `${sample.seed}` : ''}
                                    onChange={value => {
                                      value = value.replace(/\D/g, '');
                                      if (value === '') {
                                        let newConfig = objectCopy(jobConfig);
                                        if (newConfig.config.process[0].sample.samples[i]) {
                                          delete newConfig.config.process[0].sample.samples[i].seed;
                                          setJobConfig(
                                            newConfig.config.process[0].sample.samples,
                                            'config.process[0].sample.samples',
                                          );
                                        }
                                      } else {
                                        const intValue = parseInt(value);
                                        if (!isNaN(intValue)) {
                                          setJobConfig(intValue, `config.process[0].sample.samples[${i}].seed`);
                                        }
                                      }
                                    }}
                                    placeholder={`${
                                      jobConfig.config.process[0].sample.walk_seed
                                        ? jobConfig.config.process[0].sample.seed + i
                                        : jobConfig.config.process[0].sample.seed
                                    } (default)`}
                                  />
                                )}
                                <TextInput
                                  label="LoRA Scale"
                                  value={sample.network_multiplier ? `${sample.network_multiplier}` : ''}
                                  onChange={value => {
                                    value = value.replace(/[^0-9.-]/g, '');
                                    if (value === '') {
                                      let newConfig = objectCopy(jobConfig);
                                      if (newConfig.config.process[0].sample.samples[i]) {
                                        delete newConfig.config.process[0].sample.samples[i].network_multiplier;
                                        setJobConfig(
                                          newConfig.config.process[0].sample.samples,
                                          'config.process[0].sample.samples',
                                        );
                                      }
                                    } else {
                                      setJobConfig(value, `config.process[0].sample.samples[${i}].network_multiplier`);
                                    }
                                  }}
                                  placeholder="1.0 (default)"
                                />
                              </div>
                            )}
                          </div>

                          {modelArch?.additionalSections?.includes('datasets.multi_control_paths') && (
                            <FormGroup label="Control Images" className="pt-1 ml-2">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                {['ctrl_img_1', 'ctrl_img_2', 'ctrl_img_3'].map((ctrlKey, ctrl_idx) => (
                                  <SampleControlImage
                                    key={ctrlKey}
                                    instruction={`Add Control Image ${ctrl_idx + 1}`}
                                    src={sample[ctrlKey as keyof typeof sample] as string}
                                    onNewImageSelected={imagePath => {
                                      if (!imagePath) {
                                        let newSamples = objectCopy(jobConfig.config.process[0].sample.samples);
                                        delete newSamples[i][ctrlKey as keyof typeof sample];
                                        setJobConfig(newSamples, 'config.process[0].sample.samples');
                                      } else {
                                        setJobConfig(imagePath, `config.process[0].sample.samples[${i}].${ctrlKey}`);
                                      }
                                    }}
                                  />
                                ))}
                              </div>
                            </FormGroup>
                          )}
                          {modelArch?.additionalSections?.includes('sample.ctrl_img') && (
                            <SampleControlImage
                              className="ml-2"
                              instruction={isLlmModel ? 'Add Media' : undefined}
                              allowAudio={isLlmModel}
                              src={sample.ctrl_img}
                              onNewImageSelected={imagePath => {
                                if (!imagePath) {
                                  let newSamples = objectCopy(jobConfig.config.process[0].sample.samples);
                                  delete newSamples[i].ctrl_img;
                                  setJobConfig(newSamples, 'config.process[0].sample.samples');
                                } else {
                                  setJobConfig(imagePath, `config.process[0].sample.samples[${i}].ctrl_img`);
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPromptOverrides(prev => ({
                              ...prev,
                              [i]: !prev[i],
                            }))
                          }
                          title="Toggle per-prompt size, seed & LoRA scale overrides"
                          className={`rounded p-1.5 text-xs transition-colors ${
                            showOverrides
                              ? 'text-blue-400 bg-blue-950/50 hover:bg-blue-900/50'
                              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                          }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setJobConfig(
                              jobConfig.config.process[0].sample.samples.filter((_, index) => index !== i),
                              'config.process[0].sample.samples',
                            )
                          }
                          title="Remove prompt"
                          className="rounded p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() =>
                setJobConfig(
                  [...jobConfig.config.process[0].sample.samples, { prompt: '[trigger], ' }],
                  'config.process[0].sample.samples',
                )
              }
              className="mt-3 w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
            >
              + Add Sample Prompt
            </button>
          </Card>
        </div>

        {status === 'success' && <p className="text-green-500 text-center">Training saved successfully!</p>}
        {status === 'error' && <p className="text-red-500 text-center">Error saving training. Please try again.</p>}
      </form>
      <AddSingleImageModal />
    </>
  );
}
