'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { defaultJobConfig, defaultDatasetConfig, migrateJobConfig } from './jobConfig';
import { jobTypeOptions } from './options';
import { JobConfig } from '@/types';
import { objectCopy } from '@/utils/basic';
import { useNestedState, setNestedValue } from '@/utils/hooks';
import { SelectInput } from '@/components/formInputs';
import useSettings from '@/hooks/useSettings';
import useGPUInfo from '@/hooks/useGPUInfo';
import useDatasetList from '@/hooks/useDatasetList';
import YAML from 'yaml';
import path from 'path';
import { TopBar, MainContent } from '@/components/layout';
import { Button } from '@headlessui/react';
import { FaChevronLeft } from 'react-icons/fa';
import { Bookmark, Save, Trash2, Upload } from 'lucide-react';
import SimpleJob from './SimpleJob';
import AdvancedConfigEditor from '@/components/AdvancedConfigEditor';
import ErrorBoundary from '@/components/ErrorBoundary';
import { apiClient } from '@/utils/api';

interface JobPreset {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  config: JobConfig;
  updatedAt?: string;
}

export default function TrainingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = searchParams.get('id');
  const cloneId = searchParams.get('cloneId');
  const [gpuIDs, setGpuIDs] = useState<string | null>(null);
  const { settings, isSettingsLoaded } = useSettings();
  const { gpuList, isGPUInfoLoaded } = useGPUInfo();
  const { datasets, status: datasetFetchStatus } = useDatasetList();
  const [datasetOptions, setDatasetOptions] = useState<{ value: string; label: string }[]>([]);
  const [showAdvancedView, setShowAdvancedView] = useState(false);

  const [jobConfig, setJobConfig] = useNestedState<JobConfig>(objectCopy(migrateJobConfig(defaultJobConfig)));
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Presets state
  const [presets, setPresets] = useState<JobPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [presetDescInput, setPresetDescInput] = useState('');
  const [presetSaving, setPresetSaving] = useState(false);

  // Load presets on mount
  useEffect(() => {
    apiClient
      .get('/api/jobs/presets')
      .then(res => {
        if (res.data?.presets) {
          setPresets(res.data.presets);
        }
      })
      .catch(err => console.error('Failed to load presets:', err));
  }, []);

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const currentName = jobConfig.config.name;
    const currentTrigger = jobConfig.config.process[0].trigger_word;
    const currentDatasets = objectCopy(jobConfig.config.process[0].datasets);

    const nextConfig = migrateJobConfig(objectCopy(preset.config));
    // Preserve current paths and user's job name / trigger / dataset folder if they already set one
    if (isSettingsLoaded && settings.TRAINING_FOLDER) {
      nextConfig.config.process[0].training_folder = settings.TRAINING_FOLDER;
    }
    nextConfig.config.process[0].sqlite_db_path = './aitk_db.db';
    if (currentName && currentName !== 'my_first_lora_v1') {
      nextConfig.config.name = currentName;
    }
    if (currentTrigger) {
      nextConfig.config.process[0].trigger_word = currentTrigger;
    }
    if (
      currentDatasets.length > 0 &&
      currentDatasets[0].folder_path &&
      currentDatasets[0].folder_path !== defaultDatasetConfig.folder_path &&
      nextConfig.config.process[0].datasets.length > 0
    ) {
      nextConfig.config.process[0].datasets[0].folder_path = currentDatasets[0].folder_path;
    }

    setJobConfig(nextConfig);
  };

  const handleOpenSavePreset = () => {
    const existing = presets.find(p => p.id === selectedPresetId && !p.builtIn);
    setPresetNameInput(existing ? existing.name : jobConfig.config.name || '');
    setPresetDescInput(existing?.description || '');
    setShowSavePresetModal(true);
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetNameInput.trim() || presetSaving) return;
    setPresetSaving(true);
    try {
      const res = await apiClient.post('/api/jobs/presets', {
        name: presetNameInput.trim(),
        description: presetDescInput.trim(),
        config: jobConfig,
      });
      if (res.data?.presets) {
        setPresets(res.data.presets);
      }
      if (res.data?.preset?.id) {
        setSelectedPresetId(res.data.preset.id);
      }
      setShowSavePresetModal(false);
    } catch (err) {
      console.error('Failed to save preset:', err);
      alert('Failed to save preset.');
    } finally {
      setPresetSaving(false);
    }
  };

  const handleDeletePreset = async () => {
    const selected = presets.find(p => p.id === selectedPresetId);
    if (!selected || selected.builtIn) return;
    if (!confirm(`Delete preset "${selected.name}"?`)) return;

    try {
      const res = await apiClient.delete(`/api/jobs/presets?id=${encodeURIComponent(selected.id)}`);
      if (res.data?.presets) {
        setPresets(res.data.presets);
      }
      setSelectedPresetId('');
    } catch (err) {
      console.error('Failed to delete preset:', err);
      alert('Failed to delete preset.');
    }
  };

  const handleImportConfig = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        let parsed: any;
        if (file.name.endsWith('.json') || file.name.endsWith('.jsonc')) {
          parsed = JSON.parse(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
        } else {
          parsed = YAML.parse(text);
        }

        try {
          parsed.config.process[0].sqlite_db_path = './aitk_db.db';
          parsed.config.process[0].training_folder = settings.TRAINING_FOLDER;
          parsed.config.process[0].device = 'cuda';
          parsed.config.process[0].performance_log_every = 10;
        } catch (err) {
          console.warn('Could not set required fields on imported config:', err);
        }

        migrateJobConfig(parsed);
        setJobConfig(parsed);
      } catch (err) {
        console.error('Failed to parse config file:', err);
        alert('Failed to parse config file. Please check the file format.');
      }
    };
    reader.readAsText(file);

    // Reset so the same file can be re-imported
    e.target.value = '';
  };

  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (datasetFetchStatus !== 'success') return;

    const datasetOptions = datasets.map(name => ({ value: path.join(settings.DATASETS_FOLDER, name), label: name }));
    setDatasetOptions(datasetOptions);

    if (datasetOptions.length > 0) {
      const defaultDatasetPath = defaultDatasetConfig.folder_path;
      setJobConfig((prev: JobConfig) => {
        let updated = prev;
        for (let i = 0; i < prev.config.process[0].datasets.length; i++) {
          if (prev.config.process[0].datasets[i].folder_path === defaultDatasetPath) {
            updated = setNestedValue(updated, datasetOptions[0].value, `config.process[0].datasets[${i}].folder_path`);
          }
        }
        return updated;
      });
    }
  }, [datasets, settings, isSettingsLoaded, datasetFetchStatus]);

  // clone existing job
  useEffect(() => {
    if (cloneId) {
      apiClient
        .get(`/api/jobs?id=${cloneId}`)
        .then(res => res.data)
        .then(data => {
          console.log('Clone Training:', data);
          setGpuIDs(data.gpu_ids);
          const newJobConfig = migrateJobConfig(JSON.parse(data.job_config));
          newJobConfig.config.name = `${newJobConfig.config.name}_copy`;
          setJobConfig(newJobConfig);
        })
        .catch(error => console.error('Error fetching training:', error));
    }
  }, [cloneId]);

  useEffect(() => {
    if (runId) {
      apiClient
        .get(`/api/jobs?id=${runId}`)
        .then(res => res.data)
        .then(data => {
          console.log('Training:', data);
          setGpuIDs(data.gpu_ids);
          setJobConfig(migrateJobConfig(JSON.parse(data.job_config)));
        })
        .catch(error => console.error('Error fetching training:', error));
    }
  }, [runId]);

  useEffect(() => {
    if (isGPUInfoLoaded) {
      if (gpuIDs === null && gpuList.length > 0) {
        setGpuIDs(`${gpuList[0].index}`);
      }
    }
  }, [gpuList, isGPUInfoLoaded]);

  useEffect(() => {
    if (isSettingsLoaded) {
      setJobConfig(settings.TRAINING_FOLDER, 'config.process[0].training_folder');
    }
  }, [settings, isSettingsLoaded]);

  const saveJob = async () => {
    if (status === 'saving') return;
    setStatus('saving');

    apiClient
      .post('/api/jobs', {
        id: runId,
        name: jobConfig.config.name,
        gpu_ids: gpuIDs,
        job_config: jobConfig,
      })
      .then(res => {
        setStatus('success');
        if (runId) {
          router.push(`/jobs/${runId}`);
        } else {
          router.push(`/jobs/${res.data.id}`);
        }
      })
      .catch(error => {
        if (error.response?.status === 409) {
          alert('Training name already exists. Please choose a different name.');
        } else {
          alert('Failed to save job. Please try again.');
        }
        console.log('Error saving training:', error);
      })
      .finally(() =>
        setTimeout(() => {
          setStatus('idle');
        }, 2000),
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveJob();
  };

  const selectedPreset = presets.find(p => p.id === selectedPresetId);

  return (
    <>
      <TopBar>
        <div className="flex-shrink-0">
          <Button className="text-gray-500 dark:text-gray-300 px-2 sm:px-3 mt-1" onClick={() => history.back()}>
            <FaChevronLeft />
          </Button>
        </div>
        <div className="flex-shrink-0">
          <h1 className="text-base sm:text-lg truncate max-w-[120px] sm:max-w-none">
            {runId ? 'Edit Training Job' : 'New Training Job'}
          </h1>
        </div>
        <div className="flex-1"></div>

        {/* Presets Selector & Controls */}
        <div className="hidden md:flex items-center gap-1.5">
          <Bookmark className="w-4 h-4 text-blue-400 mr-0.5" />
          <select
            value={selectedPresetId}
            onChange={e => applyPreset(e.target.value)}
            className="text-xs sm:text-sm bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[230px]"
            title={selectedPreset?.description || 'Load a saved or built-in preset configuration'}
          >
            <option value="">Load Preset...</option>
            {presets.some(p => !p.builtIn) && (
              <optgroup label="Saved Presets">
                {presets
                  .filter(p => !p.builtIn)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Built-in Presets">
              {presets
                .filter(p => p.builtIn)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <Button
            className="text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2.5 py-1 rounded-md text-xs flex items-center gap-1 transition-colors"
            onClick={handleOpenSavePreset}
            title="Save current configuration as a reusable preset"
          >
            <Save className="w-3.5 h-3.5 text-blue-400" />
            <span>Save Preset</span>
          </Button>
          {selectedPreset && !selectedPreset.builtIn && (
            <Button
              className="text-red-300 bg-gray-800 hover:bg-red-900/50 border border-gray-700 p-1.5 rounded-md text-xs transition-colors"
              onClick={handleDeletePreset}
              title={`Delete preset "${selectedPreset.name}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <div className="hidden md:block mx-3 bg-gray-200 dark:bg-gray-800 w-0.5 h-6"></div>

        <div className="hidden lg:block mr-2">
          <Button
            className="text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-2.5 py-1 rounded-md text-xs flex items-center gap-1 transition-colors"
            onClick={handleImportConfig}
            title="Import a YAML or JSON config file from disk"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </Button>
        </div>

        {showAdvancedView && (
          <>
            <div className="hidden sm:block mr-2">
              <SelectInput
                value={`${gpuIDs}`}
                onChange={value => setGpuIDs(value)}
                options={gpuList.map((gpu: any) => ({ value: `${gpu.index}`, label: `GPU #${gpu.index}` }))}
              />
            </div>
          </>
        )}
        {!showAdvancedView && (
          <>
            <div className="hidden sm:block mr-2">
              <SelectInput
                value={`${jobConfig?.config.process[0].type}`}
                onChange={value => {
                  const currentOption = jobTypeOptions.find(
                    option => option.value === jobConfig?.config.process[0].type,
                  );
                  if (currentOption && currentOption.onDeactivate) {
                    setJobConfig(currentOption.onDeactivate(objectCopy(jobConfig)));
                  }
                  const option = jobTypeOptions.find(option => option.value === value);
                  if (option) {
                    if (option.onActivate) {
                      setJobConfig(option.onActivate(objectCopy(jobConfig)));
                    }
                    jobTypeOptions.forEach(opt => {
                      if (opt.value !== option.value && opt.onDeactivate) {
                        setJobConfig(opt.onDeactivate(objectCopy(jobConfig)));
                      }
                    });
                  }
                  setJobConfig(value, 'config.process[0].type');
                }}
                options={jobTypeOptions}
              />
            </div>
          </>
        )}

        <div className="pr-1 sm:pr-2 flex-shrink-0">
          <Button
            className="text-gray-200 bg-gray-800 hover:bg-gray-700 px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm"
            onClick={() => setShowAdvancedView(!showAdvancedView)}
          >
            <span className="sm:hidden">{showAdvancedView ? 'Simple' : 'YAML'}</span>
            <span className="hidden sm:inline">{showAdvancedView ? 'Simple Form' : 'YAML Editor'}</span>
          </Button>
        </div>
        <div className="flex-shrink-0">
          <Button
            className="text-white bg-green-600 hover:bg-green-700 px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-medium"
            onClick={() => saveJob()}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? (
              'Saving...'
            ) : (
              <>
                <span className="sm:hidden">{runId ? 'Update' : 'Create'}</span>
                <span className="hidden sm:inline">{runId ? 'Update Job' : 'Create Job'}</span>
              </>
            )}
          </Button>
        </div>
      </TopBar>

      {/* Save Preset Modal */}
      {showSavePresetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-md w-full p-5 shadow-xl">
            <h3 className="text-base font-semibold text-gray-100 mb-1 flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-blue-400" />
              Save Job Preset
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              Save your current model, quantization, training, dataset, and sample settings as a reusable preset.
            </p>
            <form onSubmit={handleSavePreset} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-300 mb-1">Preset Name</label>
                <input
                  type="text"
                  value={presetNameInput}
                  onChange={e => setPresetNameInput(e.target.value)}
                  placeholder="e.g. My Z-Image De-Turbo Character LoRA"
                  className="w-full text-sm px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-300 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={presetDescInput}
                  onChange={e => setPresetDescInput(e.target.value)}
                  placeholder="e.g. BF16 unquantized, 2000 steps, rank 32"
                  className="w-full text-sm px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSavePresetModal(false)}
                  className="px-3 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={presetSaving || !presetNameInput.trim()}
                  className="px-4 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {presetSaving ? 'Saving...' : 'Save Preset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.json,.jsonc"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {showAdvancedView ? (
        <div className="pt-[48px] absolute top-0 left-0 w-full h-full overflow-auto">
          <AdvancedConfigEditor
            config={jobConfig}
            setConfig={setJobConfig}
            transformOnParse={(parsed: any) => {
              try {
                parsed.config.process[0].sqlite_db_path = './aitk_db.db';
                parsed.config.process[0].training_folder = settings.TRAINING_FOLDER;
                parsed.config.process[0].device = 'cuda';
                parsed.config.process[0].performance_log_every = 10;
              } catch (e) {
                console.warn(e);
              }
              return migrateJobConfig(parsed);
            }}
          />
        </div>
      ) : (
        <MainContent>
          <ErrorBoundary
            fallback={
              <div className="flex items-center justify-center h-64 text-lg text-red-600 font-medium bg-red-100 dark:bg-red-900/20 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg">
                Advanced job detected. Please switch to YAML editor to continue.
              </div>
            }
          >
            <SimpleJob
              jobConfig={jobConfig}
              setJobConfig={setJobConfig}
              status={status}
              handleSubmit={handleSubmit}
              runId={runId}
              gpuIDs={gpuIDs}
              setGpuIDs={setGpuIDs}
              gpuList={gpuList}
              datasetOptions={datasetOptions}
              isLoading={!isSettingsLoaded || !isGPUInfoLoaded || datasetFetchStatus !== 'success'}
            />
          </ErrorBoundary>

          <div className="pt-20"></div>
        </MainContent>
      )}
    </>
  );
}
