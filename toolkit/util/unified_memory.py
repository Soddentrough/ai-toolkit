"""Unified memory (integrated GPU / APU / SoC) support.

On unified-memory architectures (e.g. NVIDIA DGX Spark GB10, Windows RTX Spark
N1X, AMD Strix Halo APUs with large shared memory pools, Apple Silicon) the CPU
and GPU share physical DRAM, so moving a module to the CPU frees nothing and
only incurs unnecessary host<->device copy overhead (~100MB/s on GB10 under
Linux, ~0.5-2GB/s pageable on Windows/WDDM). When a unified memory device is
detected we make module-level moves to the CPU a no-op (dtype casts still
apply). Tensor-level .cpu()/.to('cpu') is left alone since saving, numpy, etc.
need it.

Note for Windows: WDDM gives CUDA a fixed budget (~80% of system RAM, e.g.
~45GB of 54GB) that host allocations do not count against. nvidia-smi / Task
Manager only show the small dedicated segment (8GB); the real pool is what
torch.cuda.mem_get_info() reports. If a job needs to keep modules on the CPU
to stay under that budget, set AITK_DISABLE_UNIFIED_MEMORY=1 (or
AITK_UNIFIED_MEMORY=0) to turn this off.

Set AITK_UNIFIED_MEMORY=1 to force-enable or AITK_DISABLE_UNIFIED_MEMORY=1 (or
AITK_UNIFIED_MEMORY=0) to turn this off.
"""
import os
import sys

import torch

_patched = False


def _get_host_total_memory_bytes() -> int:
    try:
        if hasattr(os, "sysconf") and "SC_PAGE_SIZE" in os.sysconf_names and "SC_PHYS_PAGES" in os.sysconf_names:
            return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))
    except Exception:
        pass
    return 0


def is_unified_memory() -> bool:
    if os.environ.get("AITK_DISABLE_UNIFIED_MEMORY", "0") == "1":
        return False
    override = os.environ.get("AITK_UNIFIED_MEMORY", "").strip().lower()
    if override in ("0", "false", "no", "off"):
        return False
    if override in ("1", "true", "yes", "on"):
        return True
    # macOS has no CUDA; MPS unified memory is handled elsewhere
    if sys.platform == "darwin":
        return False
    # On non-Linux (e.g. Windows), ROCm APUs may have a small dedicated carveout
    # and os.sysconf is unavailable for the host-RAM ratio check below.
    if not sys.platform.startswith("linux") and getattr(torch.version, "hip", None) is not None:
        return False
    try:
        if not torch.cuda.is_available():
            return False
        props = torch.cuda.get_device_properties(0)
        if not bool(getattr(props, "is_integrated", False)):
            return False
        # Integrated GPUs may have a tiny BIOS carveout (e.g. 512MB-2GB iGPU) where
        # device memory is still capacity-constrained relative to host RAM, or a
        # unified memory pool (e.g. GB10, Strix Halo) where the GPU addresses most
        # of system RAM. Only treat as unified memory when the GPU pool is at least
        # 50% of system RAM (or >= 48 GB).
        dev_total = int(getattr(props, "total_memory", 0))
        host_total = _get_host_total_memory_bytes()
        if host_total > 0 and dev_total < (host_total // 2) and dev_total < (48 * 1024**3):
            return False
        return True
    except Exception:
        return False


def apply_unified_memory_patches():
    global _patched
    if _patched or not is_unified_memory():
        return
    _patched = True

    orig_to = torch.nn.Module.to

    def to(self, *args, **kwargs):
        device, dtype, non_blocking, memory_format = torch._C._nn._parse_to(*args, **kwargs)
        if device is None or device.type != "cpu":
            return orig_to(self, *args, **kwargs)
        # drop the cpu move, keep any dtype / memory format conversion
        new_kwargs = {}
        if dtype is not None:
            new_kwargs["dtype"] = dtype
        if memory_format is not None:
            new_kwargs["memory_format"] = memory_format
        if not new_kwargs:
            return self
        return orig_to(self, non_blocking=non_blocking, **new_kwargs)

    def cpu(self):
        return self

    torch.nn.Module.to = to
    torch.nn.Module.cpu = cpu
    print(f"Unified memory device detected ({torch.cuda.get_device_name(0)}): module moves to cpu are disabled")
