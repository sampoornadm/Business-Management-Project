# Fine-tune — `intfloat/multilingual-e5-small`

Run: 2026-09-30T03:28:47.160794+00:00
Trained 1 epochs on 7144 pairs in 4.5 min on mps, peak MPS allocation 8.8 GB.
batch 64, lr 2e-05, max_seq_len 64 (inference 128).

## Result against the real eval set

| metric | frozen | fine-tuned |
| --- | --- | --- |
| top-1 | 80.3% | **92.1%** |
| top-5 | 98.7% | 98.7% |
| chapter | 90.8% | 97.4% |
| median margin | 0.0099 | 0.1148 |

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
| 7307 | 26 | 32 |
| 7320 | 8 | 8 |
| 8484 | 13 | 13 |

## Misses

| expected | got | description |
| --- | --- | --- |
| 7307 | 4016 | O-RING MATERIAL : FKM , SHORE HARDNESS : 80 AS PER ASTM D2240 DIAMETER, INNER :  |
| 7307 | 7308 | ELBOW MATERIAL : MILD STEEL MATERIAL SPEC : : IS:1239,PART-II,1982 SERVICE : STE |
| 7307 | 7308 | ELBOW MATERIAL : MILD STEEL : GALVANIZED MATERIAL SPEC : IS:1239,PART-II ,1982 S |
| 7307 | 7308 | BEND MATERIAL : MILD STEEL MATERIAL SPEC : : IS:1239,PART-II,1982,TYPE-1 SERVICE |
| 7307 | 7308 | BEND MATERIAL : MILD STEEL MATERIAL SPEC : : IS:1239,PART-II,1982,TYPE-1 SERVICE |
| 7307 | 3926 | TEE MATERIAL : MILD STEEL : GALVANIZED MATERIAL SPEC : IS:1239,PART-II ,1969 SIZ |
