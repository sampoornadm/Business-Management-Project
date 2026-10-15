# Fine-tune — `intfloat/multilingual-e5-small`

Run: 2026-10-06T10:52:19.928801+00:00
Trained 1 epochs on 7105 pairs in 1.4 min on mps, peak MPS allocation 8.8 GB.
batch 64, lr 2e-05, max_seq_len 64 (inference 128).

## Result against the real eval set

| metric | frozen | fine-tuned |
| --- | --- | --- |
| top-1 | 86.8% | **93.4%** |
| top-5 | 98.7% | 98.7% |
| chapter | 93.4% | 100.0% |
| median margin | 0.0102 | 0.1034 |

Items: 76. Classes in the label space: 1301.

**Beats the frozen baseline.**

The eval set is 76 real purchase-order lines and a handful of item families dominate it, so
these counts carry wide error bars. Per-class results are below for that reason; a headline
percentage alone would hide which families actually moved.

## Per class

| heading | correct | of |
| --- | --- | --- |
| 3919 | 6 | 6 |
| 3926 | 6 | 6 |
| 7019 | 11 | 11 |
| 7307 | 27 | 32 |
| 7320 | 8 | 8 |
| 8484 | 13 | 13 |

## Misses

| expected | got | description |
| --- | --- | --- |
| 7307 | 7312 | o ring material fkm shore hardness 80 as per astm d2240 diameter inner 42 mm siz |
| 7307 | 7308 | elbow material mild steel material spec is 1239 part ii 1982 service steam size  |
| 7307 | 7308 | bend material mild steel material spec is 1239 part ii 1982 type 1 service satur |
| 7307 | 7308 | bend material mild steel material spec is 1239 part ii 1982 type 1 service satur |
| 7307 | 7308 | bend material mild steel material spec is 1239 part ii 1982 type 1 service satur |
