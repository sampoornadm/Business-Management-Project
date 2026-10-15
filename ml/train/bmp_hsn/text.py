"""Text normalisation shared by the corpus, the eval set and the server's query path.

Mirrors apps/server/src/modules/classification/classification.text.ts#normaliseText. The two must
stay byte-identical: the index is embedded from normalised corpus text, and the server embeds the
query with the same rule. A mismatch quietly moves every query off the distribution it was trained
on, which shows up as lost accuracy rather than as an error.

What it removes is register, not meaning: tariff text is CAPS with punctuation ("PURE-BRED BREEDING
ANIMALS."), purchase-order text is mixed case with noise ("PU : TUBE"). Lower-casing and collapsing
punctuation to spaces makes the two read the same to the encoder.
"""

from __future__ import annotations

import re

_PUNCTUATION = re.compile(r"[.,;:()\[\]\"'`!?*+&_\-/\\|]")
_WHITESPACE = re.compile(r"\s+")


def normalise_text(text: str) -> str:
    return _WHITESPACE.sub(" ", _PUNCTUATION.sub(" ", text.lower())).strip()
