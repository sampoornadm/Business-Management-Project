import torch

from bmp_hsn.tokenize import pad_to_bucket


def features(lengths: list[int], width: int) -> dict:
    return {
        "input_ids": torch.ones((len(lengths), width), dtype=torch.long),
        "attention_mask": torch.tensor(
            [[1] * n + [0] * (width - n) for n in lengths], dtype=torch.long
        ),
    }


def test_pads_up_to_the_next_bucket():
    # MPS compiles and caches a kernel per distinct tensor shape. Batches padded to their own
    # longest text produce a new shape almost every step, and the step time degrades as that cache
    # grows — measured here as 0.75 s at step 1 against many seconds later in the same run.
    out = pad_to_bucket(features([20, 23], width=23), bucket=32)
    assert out["input_ids"].shape == (2, 32)
    assert out["attention_mask"].shape == (2, 32)


def test_padding_is_masked_out_so_the_model_ignores_it():
    out = pad_to_bucket(features([2, 3], width=3), bucket=8)
    assert out["attention_mask"][0].tolist() == [1, 1, 0, 0, 0, 0, 0, 0]
    assert out["attention_mask"][1].tolist() == [1, 1, 1, 0, 0, 0, 0, 0]


def test_a_batch_already_on_a_bucket_boundary_is_untouched():
    original = features([32], width=32)
    out = pad_to_bucket(original, bucket=32)
    assert out["input_ids"].shape == (1, 32)
    assert torch.equal(out["attention_mask"], original["attention_mask"])


def test_only_a_handful_of_distinct_shapes_can_result():
    widths = {pad_to_bucket(features([n], width=n), bucket=32)["input_ids"].shape[1]
              for n in range(1, 129)}
    assert widths == {32, 64, 96, 128}


def test_leaves_non_tensor_entries_alone():
    padded = pad_to_bucket({**features([3], width=3), "label": "x"}, bucket=8)
    assert padded["label"] == "x"
