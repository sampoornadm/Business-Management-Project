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
| Off-the-shelf model, matching against class averages | 28.9% |
| Off-the-shelf model with a conventional classifier head | 1.3% |
| Off-the-shelf model, matching individual texts, trusting curated terms | 80.3% |
| **Trained model, same matching** | **92.1%** |

Worth separating those last two, because the lesson is not the obvious one. Most of the gain came
from **how** items are matched, not from training: switching from class averages to individual
texts, and trusting a curated trade term above generic tariff wording, took an untrained
off-the-shelf model from 28.9% to 80.3%. Training then added a further 11.8 points. Both are real;
the matching change was the bigger one.

Both probe items that motivated this work now come out right: a disc-spring washer on 7320 and a
mild steel socket on 7307. Neither had ever been correct before.

### What that number does and does not mean

**Read this before quoting 92%.** Two separate caveats, and both matter.

First, the settings were chosen by trying several and keeping the best, on these same 76 items.
Re-measured honestly — choosing on one half and scoring the untouched other half — the result is
**86.8%** (of 38 items). That is the number to quote.

Second, those 76 items land on only **six** distinct HSN headings, and all six already have trade
terms filled in. So the figure means: *for the kinds of item this business buys regularly, and whose
codes someone has described in the sheet, the system is right about nine times in ten.* It is not a
claim about all 1,301 headings.

For headings nobody has written trade terms for, the honest measure is a separate test of 1,657
held-out official descriptions spanning 933 headings, where the system gets **59.6%**. The gap
between 92% and 60% is precisely the value of the `trade_terms` column — and precisely why filling
it in is the most useful thing anyone can do here.

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
uv run python build_index.py       # the vectors the server matches against
uv sync --extra export
uv run python export_onnx.py       # the model the server actually loads
uv run python calibrate.py         # the confidence below which the app stays quiet
uv run python compare_runs.py      # compare every run so far, honestly
uv run python -m pytest tests/     # the checks on the data-handling code
```

Or press **Update** on the Settings page, which runs all of it and re-classifies the draft BOQs.

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
