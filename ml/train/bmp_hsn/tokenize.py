"""Tokenises a batch into one of a few fixed widths.

Metal compiles and caches a kernel per distinct tensor shape. Padding each batch to its own longest
text gives a new shape almost every step, and the run degrades as that cache grows: measured on this
corpus, steps started at 0.75 s and were many seconds each later in the same run, which looked
exactly like a hang. Rounding the width up to a multiple of 32 bounds the whole run to four shapes.

The extra padding is masked, so it changes the arithmetic not at all — only how many distinct
kernels Metal is asked to keep.
"""

from __future__ import annotations

import torch

BUCKET = 32


def pad_to_bucket(features: dict, bucket: int = BUCKET) -> dict:
    """Right-pads every 2-D tensor in `features` to the next multiple of `bucket`."""
    width = next(
        (v.shape[1] for v in features.values() if isinstance(v, torch.Tensor) and v.dim() == 2),
        None,
    )
    if width is None:
        return features

    target = max(bucket, ((width + bucket - 1) // bucket) * bucket)
    if target == width:
        return features

    padded = {}
    for key, value in features.items():
        if isinstance(value, torch.Tensor) and value.dim() == 2 and value.shape[1] == width:
            padded[key] = torch.nn.functional.pad(value, (0, target - width), value=0)
        else:
            padded[key] = value
    return padded


def tokenize_batch(model, texts: list[str], device: str, bucket: int = BUCKET) -> dict:
    """Tokenise, bucket-pad, and move to the device — the one path training and profiling share."""
    features = pad_to_bucket(model.tokenize(texts), bucket)
    return {k: (v.to(device) if hasattr(v, "to") else v) for k, v in features.items()}
