import torch
from diffusers import AutoencoderKL

from .._mixin import OstrisModelMixin


class KLVAE(AutoencoderKL, OstrisModelMixin):
    """The diffusers AutoencoderKL (SD/SDXL/Flux1/Z-Image image VAEs), loaded
    from a checkpoint's vae/ subfolder through the universal loader."""

    aitk_subfolder = "vae"

    def _encode(self, x: torch.Tensor) -> torch.Tensor:
        if getattr(torch.version, "hip", None) is not None:
            from torch.nn.attention import SDPBackend, sdpa_kernel
            with sdpa_kernel(SDPBackend.MATH):
                return super()._encode(x)
        return super()._encode(x)

    def _decode(self, z: torch.Tensor, return_dict: bool = True):
        if getattr(torch.version, "hip", None) is not None:
            from torch.nn.attention import SDPBackend, sdpa_kernel
            with sdpa_kernel(SDPBackend.MATH):
                return super()._decode(z, return_dict=return_dict)
        return super()._decode(z, return_dict=return_dict)

