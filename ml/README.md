# HSN classification — data, training and results

This folder holds everything behind automatic HSN code and item-category assignment: the lookup
sheet the business owns, the data the model learns from, the tests it is judged on, and the result
of every training run. It is meant to be readable and shareable.

```
ml/
  data/hsn-gst-lookup.xlsx   the sheet you edit — categories, GST rates, trade names
  data/generated/            what the model trains on, rebuilt from the sheet
  data/eval/real-items.csv   real purchase-order lines with the codes they should get
  train/                     the training code
  runs/<timestamp>/          the result of each run, kept so results can be compared
  models/current/            the deployed model (rebuilt, not stored in version control)
```

## What problem this solves

Every item on a tender needs an HSN code, which sets its GST rate. Assigning them by hand is slow
and inconsistent. The difficulty is that India's tariff describes goods in legal language that
nobody writes on a purchase order. Heading 7320 covers springs, and its official text lists
"LEAF-SPRINGS", "HELICAL SPRINGS" and "SPRING PINS" — it never once says "disc spring" or
"Belleville washer", which is what an actual order says.

## Results

Measured on 76 real purchase-order lines from this business, each labelled with the code it should
receive. Percentages are top-1: the single code the system proposes is exactly right.

| Approach | Correct |
| --- | --- |
| The system before this work (AI path only) | **0%** — 0 of 22 |
| Off-the-shelf model, no training | 28.9% |
| Off-the-shelf model with a conventional classifier head | 1.3% |
| **Trained model (this one)** | **50.0%** |

Getting the chapter right — the broad family an item belongs to, which is what drives the category
shown in the app — improved from 32.9% to **67.1%**.

Two honest caveats, because they matter more than the headline:

- **The 50% figure had four settings to choose from and picked the best.** Re-measured properly,
  by choosing the setting on one half of the items and scoring the untouched other half, the
  result is **47.4%** (of 38 items). That is the number to quote.
- **76 items is a small test.** These counts carry wide error bars. The set grows every time
  somebody confirms or corrects a code in the app, and the number should be re-measured as it does.

The old system's 0% deserves explanation, since the app did produce codes. It produced them from
two hand-written rules, which were right 39 times out of 39. On everything *outside* those rules
the AI was right zero times out of twenty-two — it matched on what an item is used *with* rather
than what it is made *of*. A silicone-coated fibreglass sleeve became electrical switchgear because
its description mentions kilovolts; nylon cable ties and PVC tape went the same way.

## How to improve it — the part that needs no engineer

Open `data/hsn-gst-lookup.xlsx` and fill in the **trade_terms** column: the words your suppliers and
tenders actually use for that code, separated by semicolons. Then press Update on the Settings page.

This is the single most effective thing anyone can do to the system. Those terms are the only
bridge between real purchase-order language and the tariff's own wording, and today just 39 of 1,301
codes have any. When an item is classified wrongly, adding its real name to the correct row and
pressing Update is the fix — no code change, no engineer.

The same sheet owns the **GST rate** for each code, and the **display_name** used in category
pickers. Rates were seeded from Notification 9/2025-CT(Rate) effective 22 September 2025; rows
marked `chapter-default` are an assumption from the chapter rather than a verified per-code rate, so
check the codes you actually trade in and mark them `manual` once confirmed.

## Reproducing a run

```bash
cd ml/train
uv sync
uv run python baseline.py          # the untrained floor
uv run python train.py             # train, then score against the real items
uv run python compare_runs.py      # compare every run so far, honestly
uv run python -m pytest tests/     # the checks on the data-handling code
```

Training takes about 2.5 minutes on an M1 Pro using the Mac's GPU. Every run writes a dated folder
under `runs/` containing its accuracy, a per-class breakdown and every individual mistake, so runs
can be compared and a regression is visible rather than assumed.

## Notes on the data

The training corpus is 11,147 text examples across 1,301 codes, built from the official tariff text
plus the curated trade terms. Nothing the model is scored on is ever trained on.

The test set is deliberately **not** built from codes previously confirmed in the app. Of the 19 that
had been confirmed, 11 were wrong — they were bad suggestions that had been clicked through, so
scoring against them would have measured agreement with the very problem being fixed. The expected
codes are set independently, and the app's stored value is kept alongside only so the disagreement
stays visible.

78 entries in the official source were found to be corrupt and are excluded: rows that look like
codes but are not, mostly sub-category text that lost a leading zero and landed under the wrong
chapter — one reads "Mussels" but sits in the pharmaceuticals chapter. Two of them fell in chapters
this business buys from.
