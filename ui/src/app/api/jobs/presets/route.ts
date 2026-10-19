import { NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { defaultJobConfig, migrateJobConfig } from '@/app/jobs/new/jobConfig';
import { objectCopy } from '@/utils/basic';

const PRESETS_SETTINGS_KEY = 'JOB_PRESETS';

export interface JobPreset {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  config: any;
  updatedAt?: string;
}

function getBuiltInPresets(): JobPreset[] {
  // 1. Standard Quantized LoRA (default)
  const standardPreset = objectCopy(migrateJobConfig(objectCopy(defaultJobConfig)));

  // 2. Z-Image De-Turbo (BF16 / Unquantized)
  const zimageDeturboPreset = objectCopy(migrateJobConfig(objectCopy(defaultJobConfig)));
  zimageDeturboPreset.config.name = 'zimage_deturbo_lora_v1';
  zimageDeturboPreset.config.process[0].model = {
    name_or_path: 'ostris/Z-Image-De-Turbo',
    extras_name_or_path: 'Tongyi-MAI/Z-Image-Turbo',
    arch: 'zimage:deturbo',
    quantize: false,
    qtype: 'convrot8',
    quantize_te: false,
    qtype_te: 'convrot8',
    low_vram: false,
    model_kwargs: {},
    compile: false,
  };
  zimageDeturboPreset.config.process[0].network.conv = 0;
  zimageDeturboPreset.config.process[0].network.conv_alpha = 0;
  zimageDeturboPreset.config.process[0].train.optimizer = 'adamw';
  zimageDeturboPreset.config.process[0].train.lr = 0.0001;
  zimageDeturboPreset.config.process[0].train.steps = 2500;
  zimageDeturboPreset.config.process[0].train.timestep_type = 'weighted';
  zimageDeturboPreset.config.process[0].train.dtype = 'bf16';
  zimageDeturboPreset.config.process[0].save.dtype = 'bf16';
  zimageDeturboPreset.config.process[0].save.save_every = 250;
  zimageDeturboPreset.config.process[0].sample.sample_every = 250;
  zimageDeturboPreset.config.process[0].sample.sample_steps = 25;
  zimageDeturboPreset.config.process[0].sample.guidance_scale = 3.0;
  zimageDeturboPreset.config.process[0].datasets[0].cache_latents_to_disk = true;

  // 3. Z-Image Turbo w/ Training Adapter (BF16 / Unquantized)
  const zimageTurboPreset = objectCopy(zimageDeturboPreset);
  zimageTurboPreset.config.name = 'zimage_turbo_lora_v1';
  zimageTurboPreset.config.process[0].model = {
    name_or_path: 'Tongyi-MAI/Z-Image-Turbo',
    arch: 'zimage:turbo',
    quantize: false,
    qtype: 'convrot8',
    quantize_te: false,
    qtype_te: 'convrot8',
    low_vram: false,
    model_kwargs: {},
    assistant_lora_path: 'ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors',
    compile: false,
  };
  zimageTurboPreset.config.process[0].sample.sample_steps = 9;
  zimageTurboPreset.config.process[0].sample.guidance_scale = 1.0;

  // 4. Z-Image Base (BF16 / Unquantized)
  const zimageBasePreset = objectCopy(zimageDeturboPreset);
  zimageBasePreset.config.name = 'zimage_base_lora_v1';
  zimageBasePreset.config.process[0].model = {
    name_or_path: 'Tongyi-MAI/Z-Image',
    arch: 'zimage',
    quantize: false,
    qtype: 'convrot8',
    quantize_te: false,
    qtype_te: 'convrot8',
    low_vram: false,
    model_kwargs: {},
    compile: false,
  };
  zimageBasePreset.config.process[0].sample.sample_steps = 30;
  zimageBasePreset.config.process[0].sample.guidance_scale = 4.0;

  return [
    {
      id: 'builtin_zimage_deturbo_bf16',
      name: 'Z-Image De-Turbo (BF16)',
      description: 'ostris/Z-Image-De-Turbo in native BF16 (no quantization, AdamW, 2500 steps, 25 sample steps)',
      builtIn: true,
      config: zimageDeturboPreset,
    },
    {
      id: 'builtin_zimage_turbo_bf16',
      name: 'Z-Image Turbo w/ Adapter (BF16)',
      description: 'Tongyi-MAI/Z-Image-Turbo with training adapter in native BF16 (9 sample steps, CFG 1.0)',
      builtIn: true,
      config: zimageTurboPreset,
    },
    {
      id: 'builtin_zimage_base_bf16',
      name: 'Z-Image Base (BF16)',
      description: 'Tongyi-MAI/Z-Image Base in native BF16 (no quantization, AdamW, cached latents)',
      builtIn: true,
      config: zimageBasePreset,
    },
    {
      id: 'builtin_standard_lora',
      name: 'Standard LoRA (Default)',
      description: 'Default AI Toolkit LoRA configuration',
      builtIn: true,
      config: standardPreset,
    },
  ];
}

async function getUserPresets(): Promise<JobPreset[]> {
  const row = await prisma.settings.findFirst({
    where: { key: PRESETS_SETTINGS_KEY },
  });
  if (!row || !row.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveUserPresets(presets: JobPreset[]) {
  const value = JSON.stringify(presets);
  await prisma.settings.upsert({
    where: { key: PRESETS_SETTINGS_KEY },
    update: { value },
    create: { key: PRESETS_SETTINGS_KEY, value },
  });
}

export async function GET() {
  try {
    const userPresets = await getUserPresets();
    const builtInPresets = getBuiltInPresets();
    return NextResponse.json({
      presets: [...userPresets, ...builtInPresets],
    });
  } catch (error) {
    console.error('Error loading presets:', error);
    return NextResponse.json({ error: 'Failed to load presets' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, config, id } = body;
    if (!name || typeof name !== 'string' || !config) {
      return NextResponse.json({ error: 'Preset name and config are required' }, { status: 400 });
    }

    const userPresets = await getUserPresets();
    const trimmedName = name.trim();
    const now = new Date().toISOString();

    const existingIdx = userPresets.findIndex(
      p => (id && p.id === id) || p.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    const newPreset: JobPreset = {
      id: existingIdx >= 0 ? userPresets[existingIdx].id : `preset_${Date.now()}`,
      name: trimmedName,
      description: description?.trim() || '',
      builtIn: false,
      config,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      userPresets[existingIdx] = newPreset;
    } else {
      userPresets.unshift(newPreset);
    }

    await saveUserPresets(userPresets);
    return NextResponse.json({
      preset: newPreset,
      presets: [...userPresets, ...getBuiltInPresets()],
    });
  } catch (error) {
    console.error('Error saving preset:', error);
    return NextResponse.json({ error: 'Failed to save preset' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Preset id is required' }, { status: 400 });
    }

    const userPresets = await getUserPresets();
    const filtered = userPresets.filter(p => p.id !== id);
    await saveUserPresets(filtered);

    return NextResponse.json({
      presets: [...filtered, ...getBuiltInPresets()],
    });
  } catch (error) {
    console.error('Error deleting preset:', error);
    return NextResponse.json({ error: 'Failed to delete preset' }, { status: 500 });
  }
}
