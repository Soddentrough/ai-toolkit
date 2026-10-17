import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { GpuInfo } from '../types';

const execFileAsync = promisify(execFile);
const statAsync = promisify(fs.stat);
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);

export interface AmdStaticGpu {
  gpu: number;
  name: string;
  driverVersion: string;
  bdf: string | null;
  sysfsDevicePath: string | null;
  hwmonPath: string | null;
  powerLimitW: number;
}

async function readSysfs(filePath: string): Promise<string | null> {
  try {
    const data = await readFileAsync(filePath, 'utf8');
    return data.trim();
  } catch {
    return null;
  }
}

function parseUnitVal(obj: unknown): number | null {
  if (obj === null || obj === undefined || obj === 'N/A') return null;
  if (typeof obj === 'number') return isNaN(obj) ? null : obj;
  if (typeof obj === 'string') {
    const n = parseFloat(obj);
    return isNaN(n) ? null : n;
  }
  if (typeof obj === 'object' && 'value' in (obj as Record<string, unknown>)) {
    const val = (obj as Record<string, unknown>).value;
    if (val === null || val === undefined || val === 'N/A') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val));
    return isNaN(n) ? null : n;
  }
  return null;
}

export async function findAmdSmiPath(): Promise<string | null> {
  if (process.platform === 'win32') return null;
  const candidates = [
    process.env.ROCM_PATH ? `${process.env.ROCM_PATH}/bin/amd-smi` : null,
    '/usr/bin/amd-smi',
    '/opt/rocm/bin/amd-smi',
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    try {
      await statAsync(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  try {
    const { stdout } = await execFileAsync('which', ['amd-smi'], { timeout: 3000 });
    const resolved = stdout.trim();
    if (resolved) return resolved;
  } catch {
    // not found in PATH
  }
  return null;
}

export async function findHipInfoPath(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  if (process.env.HIP_PATH) {
    try {
      const basePath = process.env.HIP_PATH.replace(/\\$/, '');
      const manualPath = `${basePath}\\bin\\hipinfo.exe`;
      await statAsync(manualPath);
      return manualPath;
    } catch {
      // continue
    }
  }
  try {
    const { stdout } = await execFileAsync('where', ['hipinfo.exe'], { timeout: 3000 });
    const first = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (first) return first;
  } catch {
    // not found
  }
  return null;
}

async function resolveSysfsDevicePath(gpuId: number, bdf: string | null): Promise<string | null> {
  if (bdf) {
    const pciPath = `/sys/bus/pci/devices/${bdf}`;
    try {
      await statAsync(pciPath);
      return pciPath;
    } catch {
      // fallback
    }
  }

  const directCard = `/sys/class/drm/card${gpuId}/device`;
  try {
    await statAsync(directCard);
    return directCard;
  } catch {
    // scan /sys/class/drm/card* for AMD vendor 0x1002
  }

  try {
    const entries = await readdirAsync('/sys/class/drm');
    const cardDirs = entries.filter(e => /^card\d+$/.test(e)).sort();
    const amdPaths: string[] = [];
    for (const card of cardDirs) {
      const devPath = `/sys/class/drm/${card}/device`;
      const vendor = await readSysfs(`${devPath}/vendor`);
      if (vendor === '0x1002') {
        amdPaths.push(devPath);
      }
    }
    if (amdPaths[gpuId]) return amdPaths[gpuId];
    if (amdPaths.length > 0) return amdPaths[0];
  } catch {
    // ignore
  }
  return null;
}

async function resolveHwmonPath(sysfsDevicePath: string | null): Promise<string | null> {
  if (!sysfsDevicePath) return null;
  try {
    const files = await readdirAsync(`${sysfsDevicePath}/hwmon`);
    if (files.length > 0) {
      return `${sysfsDevicePath}/hwmon/${files[0]}`;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function discoverAmdStaticGpus(amdSmiPath: string | null): Promise<AmdStaticGpu[]> {
  if (amdSmiPath) {
    try {
      const { stdout } = await execFileAsync(
        amdSmiPath,
        ['static', '--asic', '--driver', '--bus', '--limit', '--json'],
        { timeout: 5000 },
      );
      const staticData = JSON.parse(stdout);
      const staticGpus: any[] = staticData.gpu_data || [];
      const result: AmdStaticGpu[] = [];

      for (const staticInfo of staticGpus) {
        const gpuId = typeof staticInfo.gpu === 'number' ? staticInfo.gpu : result.length;
        const name = staticInfo.asic?.market_name || `AMD GPU ${gpuId}`;
        const rawDriver = staticInfo.driver?.version;
        const driverVersion =
          rawDriver && rawDriver !== 'N/A'
            ? String(rawDriver)
            : staticInfo.driver?.os_kernel_version || staticInfo.driver?.name || 'amdgpu';
        const bdf =
          staticInfo.bus?.bdf && staticInfo.bus.bdf !== 'N/A' ? String(staticInfo.bus.bdf) : null;
        const sysfsDevicePath = await resolveSysfsDevicePath(gpuId, bdf);
        const hwmonPath = await resolveHwmonPath(sysfsDevicePath);
        const powerLimitW =
          parseUnitVal(staticInfo.limit?.ppt0?.socket_power_limit) ??
          parseUnitVal(staticInfo.limit?.ppt0?.max_power_limit) ??
          parseUnitVal(staticInfo.limit?.socket_power_limit) ??
          parseUnitVal(staticInfo.limit?.max_power_limit) ??
          0;

        result.push({
          gpu: gpuId,
          name,
          driverVersion,
          bdf,
          sysfsDevicePath,
          hwmonPath,
          powerLimitW,
        });
      }
      if (result.length > 0) {
        return result;
      }
    } catch (err) {
      console.error('Failed to query amd-smi static:', err);
    }
  }

  // Fallback: discover AMD GPUs directly from /sys/class/drm/card*
  if (process.platform === 'linux') {
    try {
      const entries = await readdirAsync('/sys/class/drm');
      const cardDirs = entries.filter(e => /^card\d+$/.test(e)).sort();
      const result: AmdStaticGpu[] = [];
      for (const card of cardDirs) {
        const devPath = `/sys/class/drm/${card}/device`;
        const vendor = await readSysfs(`${devPath}/vendor`);
        if (vendor !== '0x1002') continue;
        const gpuId = result.length;
        const productName = (await readSysfs(`${devPath}/product_name`)) || `AMD GPU ${gpuId}`;
        const hwmonPath = await resolveHwmonPath(devPath);
        let powerLimitW = 0;
        if (hwmonPath) {
          const cap = await readSysfs(`${hwmonPath}/power1_cap`);
          if (cap) powerLimitW = parseInt(cap, 10) / 1_000_000;
        }
        result.push({
          gpu: gpuId,
          name: productName,
          driverVersion: os.release(),
          bdf: null,
          sysfsDevicePath: devPath,
          hwmonPath,
          powerLimitW,
        });
      }
      return result;
    } catch {
      // ignore
    }
  }

  return [];
}

import os from 'os';

async function parseDpmActiveClockMhz(filePath: string): Promise<number | null> {
  const content = await readSysfs(filePath);
  if (!content) return null;
  for (const line of content.split('\n')) {
    if (line.includes('*')) {
      const match = line.match(/(\d+)\s*Mhz/i);
      if (match) return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Fast sysfs-based sampler for Linux AMD GPUs (no child process spawned).
 * Ideal for 500ms live SSE ticks so the Node.js event loop never forks.
 */
export async function sampleAmdSysfsGpus(staticGpus: AmdStaticGpu[]): Promise<GpuInfo[]> {
  return Promise.all(
    staticGpus.map(async info => {
      const dev = info.sysfsDevicePath;
      const hwmon = info.hwmonPath;

      let temp = 0;
      if (hwmon) {
        const t = await readSysfs(`${hwmon}/temp1_input`);
        if (t) temp = parseInt(t, 10) / 1000;
      }

      let gpuUtil = 0;
      if (dev) {
        const busy = await readSysfs(`${dev}/gpu_busy_percent`);
        if (busy) gpuUtil = parseInt(busy, 10);
      }

      let memVramTotalMB = 0;
      let memVramUsedMB = 0;
      let memGttTotalMB = 0;
      let memGttUsedMB = 0;

      if (dev) {
        const [vTotal, vUsed, gTotal, gUsed] = await Promise.all([
          readSysfs(`${dev}/mem_info_vram_total`),
          readSysfs(`${dev}/mem_info_vram_used`),
          readSysfs(`${dev}/mem_info_gtt_total`),
          readSysfs(`${dev}/mem_info_gtt_used`),
        ]);
        if (vTotal) memVramTotalMB = parseInt(vTotal, 10) / (1024 * 1024);
        if (vUsed) memVramUsedMB = parseInt(vUsed, 10) / (1024 * 1024);
        if (gTotal) memGttTotalMB = parseInt(gTotal, 10) / (1024 * 1024);
        if (gUsed) memGttUsedMB = parseInt(gUsed, 10) / (1024 * 1024);
      }

      const memFreeMB = Math.max(0, memVramTotalMB - memVramUsedMB);
      const memUtil = memVramTotalMB > 0 ? Math.round((memVramUsedMB / memVramTotalMB) * 100) : 0;

      let powerDraw = 0;
      let powerLimit = info.powerLimitW;
      if (hwmon) {
        const p =
          (await readSysfs(`${hwmon}/power1_average`)) ?? (await readSysfs(`${hwmon}/power1_input`));
        if (p) powerDraw = parseInt(p, 10) / 1_000_000;
        if (!powerLimit) {
          const cap = await readSysfs(`${hwmon}/power1_cap`);
          if (cap) powerLimit = parseInt(cap, 10) / 1_000_000;
        }
      }

      let sclk = 0;
      let mclk = 0;
      if (hwmon) {
        const [f1, f2] = await Promise.all([
          readSysfs(`${hwmon}/freq1_input`),
          readSysfs(`${hwmon}/freq2_input`),
        ]);
        if (f1) sclk = parseInt(f1, 10) / 1_000_000;
        if (f2) mclk = parseInt(f2, 10) / 1_000_000;
      }
      if (dev) {
        if (!sclk) {
          sclk = (await parseDpmActiveClockMhz(`${dev}/pp_dpm_sclk`)) ?? 0;
        }
        if (!mclk) {
          mclk = (await parseDpmActiveClockMhz(`${dev}/pp_dpm_mclk`)) ?? 0;
        }
      }

      let fanSpeed = 0;
      if (hwmon) {
        const [pwm, pwmMax] = await Promise.all([
          readSysfs(`${hwmon}/pwm1`),
          readSysfs(`${hwmon}/pwm1_max`),
        ]);
        if (pwm) {
          const max = pwmMax ? parseInt(pwmMax, 10) : 255;
          if (max > 0) fanSpeed = (parseInt(pwm, 10) / max) * 100;
        }
      }

      return {
        index: info.gpu,
        name: info.name,
        driverVersion: info.driverVersion,
        temperature: Math.round(temp),
        utilization: {
          gpu: Math.round(gpuUtil),
          memory: Math.round(memUtil),
        },
        memory: {
          total: Math.round(memVramTotalMB),
          free: Math.round(memFreeMB),
          used: Math.round(memVramUsedMB),
          gttTotal: Math.round(memGttTotalMB),
          gttUsed: Math.round(memGttUsedMB),
          gttFree: Math.round(Math.max(0, memGttTotalMB - memGttUsedMB)),
        },
        power: {
          draw: powerDraw,
          limit: powerLimit,
        },
        clocks: {
          graphics: Math.round(sclk),
          memory: Math.round(mclk),
        },
        fan: {
          speed: Math.round(fanSpeed),
        },
      };
    }),
  );
}

/**
 * Full amd-smi metric + sysfs fallback sampler (used by /api/gpu or when sysfs is not available).
 */
export async function getAmdSmiStats(
  amdSmiPath: string,
  staticGpus?: AmdStaticGpu[],
): Promise<GpuInfo[]> {
  const resolvedStatic = staticGpus ?? (await discoverAmdStaticGpus(amdSmiPath));
  const { stdout: metricStdout } = await execFileAsync(
    amdSmiPath,
    ['metric', '--usage', '--mem-usage', '--power', '--fan', '--clock', '--temperature', '--json'],
    { timeout: 5000 },
  );
  const metricData = JSON.parse(metricStdout);
  const metricGpus: any[] = metricData.gpu_data || [];

  return Promise.all(
    resolvedStatic.map(async info => {
      const gpuId = info.gpu;
      const metrics = metricGpus.find((m: any) => m.gpu === gpuId) || {};
      const dev = info.sysfsDevicePath;
      const hwmon = info.hwmonPath;

      // -- Temperature --
      let temp =
        parseUnitVal(metrics.temperature?.edge) ??
        parseUnitVal(metrics.temperature?.apu_temperature_gfx) ??
        parseUnitVal(metrics.temperature?.hotspot);
      if (temp === null && hwmon) {
        const t = await readSysfs(`${hwmon}/temp1_input`);
        if (t) temp = parseInt(t, 10) / 1000;
      }
      temp = temp || 0;

      // -- GPU Utilization --
      let gpuUtil = parseUnitVal(metrics.usage?.gfx_activity);
      if (gpuUtil === null && dev) {
        const busyp = await readSysfs(`${dev}/gpu_busy_percent`);
        if (busyp) gpuUtil = parseInt(busyp, 10);
      }
      gpuUtil = gpuUtil || 0;

      // -- Memory (Used/Total) --
      let memVramTotalMB = parseUnitVal(metrics.mem_usage?.total_vram);
      let memVramUsedMB = parseUnitVal(metrics.mem_usage?.used_vram);

      if (memVramUsedMB === null && dev) {
        const used = await readSysfs(`${dev}/mem_info_vram_used`);
        if (used) memVramUsedMB = parseInt(used, 10) / 1024 / 1024;
      }
      if (memVramTotalMB === null && dev) {
        const total = await readSysfs(`${dev}/mem_info_vram_total`);
        if (total) memVramTotalMB = parseInt(total, 10) / 1024 / 1024;
      }

      // -- GTT Memory (Used/Total) --
      let memGttTotalMB = parseUnitVal(metrics.mem_usage?.total_gtt);
      let memGttUsedMB = parseUnitVal(metrics.mem_usage?.used_gtt);

      if (memGttUsedMB === null && dev) {
        const used = await readSysfs(`${dev}/mem_info_gtt_used`);
        if (used) memGttUsedMB = parseInt(used, 10) / 1024 / 1024;
      }
      if (memGttTotalMB === null && dev) {
        const total = await readSysfs(`${dev}/mem_info_gtt_total`);
        if (total) memGttTotalMB = parseInt(total, 10) / 1024 / 1024;
      }

      const memTotalMB = memVramTotalMB || 0;
      const memUsedMB = memVramUsedMB || 0;
      const gttTotalMB = memGttTotalMB || 0;
      const gttUsedMB = memGttUsedMB || 0;
      const memFreeMB = parseUnitVal(metrics.mem_usage?.free_vram) ?? Math.max(0, memTotalMB - memUsedMB);
      const memUtil = memTotalMB > 0 ? Math.round((memUsedMB / memTotalMB) * 100) : 0;

      // -- Power --
      let powerDraw =
        parseUnitVal(metrics.power?.socket_power) ?? parseUnitVal(metrics.power?.apu_power);
      if (powerDraw === null && hwmon) {
        const p =
          (await readSysfs(`${hwmon}/power1_average`)) ?? (await readSysfs(`${hwmon}/power1_input`));
        if (p) powerDraw = parseInt(p, 10) / 1_000_000;
      }

      // -- Clocks --
      let sclk =
        parseUnitVal(metrics.clock?.gfx_0?.clk) ??
        parseUnitVal(metrics.clock?.apu_average_gfxclk_frequency);
      let mclk =
        parseUnitVal(metrics.clock?.mem_0?.clk) ??
        parseUnitVal(metrics.clock?.apu_average_uclk_frequency);

      if (sclk === null && hwmon) {
        const c = await readSysfs(`${hwmon}/freq1_input`);
        if (c) sclk = parseInt(c, 10) / 1_000_000;
      }
      if (mclk === null && hwmon) {
        const c = await readSysfs(`${hwmon}/freq2_input`);
        if (c) mclk = parseInt(c, 10) / 1_000_000;
      }

      // -- Fan --
      const fanSpeed = parseUnitVal(metrics.fan?.usage) || 0;

      return {
        index: gpuId,
        name: info.name,
        driverVersion: info.driverVersion,
        temperature: Math.round(temp),
        utilization: {
          gpu: Math.round(gpuUtil),
          memory: Math.round(memUtil),
        },
        memory: {
          total: Math.round(memTotalMB),
          free: Math.round(memFreeMB),
          used: Math.round(memUsedMB),
          gttTotal: Math.round(gttTotalMB),
          gttUsed: Math.round(gttUsedMB),
          gttFree: Math.round(Math.max(0, gttTotalMB - gttUsedMB)),
        },
        power: {
          draw: powerDraw || 0,
          limit: info.powerLimitW,
        },
        clocks: {
          graphics: Math.round(sclk || 0),
          memory: Math.round(mclk || 0),
        },
        fan: {
          speed: Math.round(fanSpeed),
        },
      };
    }),
  );
}

/**
 * Windows AMD GPU stats via hipinfo.exe
 */
export async function getHipStats(hipInfoPath: string): Promise<GpuInfo[]> {
  const { stdout } = await execFileAsync(hipInfoPath, [], { timeout: 5000 });
  const devices = stdout.split('device#').slice(1);

  return devices.map((deviceBlock, idx) => {
    const lines = deviceBlock.split('\n');
    const getVal = (key: string) => {
      const line = lines.find(l => l.trim().startsWith(key));
      if (!line) return null;
      const parts = line.split(':');
      if (parts.length < 2) return null;
      return parts.slice(1).join(':').trim();
    };

    const name = getVal('Name') || `AMD GPU ${idx}`;
    const clockRateStr = getVal('clockRate');
    const clockRate = clockRateStr ? parseFloat(clockRateStr.split(' ')[0]) : 0;

    const memClockStr = getVal('memoryClockRate');
    const memClock = memClockStr ? parseFloat(memClockStr.split(' ')[0]) : 0;

    const memTotalStr = getVal('memInfo.total');
    let memTotalMB = 0;
    if (memTotalStr) {
      if (memTotalStr.includes('GB')) {
        memTotalMB = parseFloat(memTotalStr.split(' ')[0]) * 1024;
      } else if (memTotalStr.includes('MB')) {
        memTotalMB = parseFloat(memTotalStr.split(' ')[0]);
      }
    }

    const memFreeStr = getVal('memInfo.free');
    let memFreeMB = 0;
    if (memFreeStr) {
      const val = parseFloat(memFreeStr.split(' ')[0]);
      if (memFreeStr.includes('GB')) {
        memFreeMB = val * 1024;
      } else if (memFreeStr.includes('MB')) {
        memFreeMB = val;
      }
    }

    const memUsedMB = Math.max(0, memTotalMB - memFreeMB);

    return {
      index: idx,
      name,
      driverVersion: 'HIP',
      temperature: 0,
      utilization: {
        gpu: 0,
        memory: memTotalMB > 0 ? Math.round((memUsedMB / memTotalMB) * 100) : 0,
      },
      memory: {
        total: Math.round(memTotalMB),
        free: Math.round(memFreeMB),
        used: Math.round(memUsedMB),
      },
      power: {
        draw: 0,
        limit: 0,
      },
      clocks: {
        graphics: Math.round(clockRate),
        memory: Math.round(memClock),
      },
      fan: {
        speed: 0,
      },
    };
  });
}
