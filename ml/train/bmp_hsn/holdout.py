"""Splits the evaluation set so a hyperparameter can be chosen without reading the answer off it.

The epoch count for this model was picked by running 1, 2, 3 and 4 epochs and looking at real-item
accuracy. That is selection on test, and the winning number it produces is optimistic — the sweep
gets as many chances as it has settings, and the best one banks the noise.

Splitting the 76 items in half fixes the claim, not the sweep: choose the epoch count on one half,
report the other. Both halves are small, so what this buys is an unbiased estimate with wide error
bars rather than a precise one, which is the honest trade at this data size.
"""

from __future__ import annotations

from typing import Callable, Iterable, TypeVar

T = TypeVar("T")


def stratified_halves(
    items: Iterable[T], key: Callable[[T], str]
) -> tuple[list[T], list[T]]:
    """Partitions items into two halves, alternating within each class.

    Alternating by class rather than splitting at random keeps both halves covering the same
    headings. The eval set is dominated by a few item families — eight sleeves, ten gaskets — so a
    random split can easily hand one half every gasket and measure two different problems.
    """
    grouped: dict[str, list[T]] = {}
    for item in items:
        grouped.setdefault(key(item), []).append(item)

    left: list[T] = []
    right: list[T] = []
    # Classes sorted, and a running parity across classes, so single-item classes alternate sides
    # instead of all landing left.
    parity = 0
    for name in sorted(grouped):
        for item in grouped[name]:
            (left if parity % 2 == 0 else right).append(item)
            parity += 1

    return left, right
