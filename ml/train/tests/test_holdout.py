from bmp_hsn.holdout import stratified_halves


def test_splits_every_class_across_both_halves_when_it_has_two_or_more_items():
    items = [("a", "7307"), ("b", "7307"), ("c", "7320"), ("d", "7320")]
    left, right = stratified_halves(items, key=lambda x: x[1])

    assert {i[1] for i in left} == {"7307", "7320"}
    assert {i[1] for i in right} == {"7307", "7320"}


def test_partitions_without_dropping_or_duplicating_anything():
    items = [(str(i), f"73{i % 5:02d}") for i in range(37)]
    left, right = stratified_halves(items, key=lambda x: x[1])

    assert len(left) + len(right) == len(items)
    assert not (set(left) & set(right))
    assert set(left) | set(right) == set(items)


def test_is_deterministic():
    items = [(str(i), f"73{i % 7:02d}") for i in range(50)]
    assert stratified_halves(items, key=lambda x: x[1]) == stratified_halves(items, key=lambda x: x[1])


def test_a_class_with_one_item_lands_on_one_side_only():
    # Eight of the eval classes have a single item. They cannot appear in both halves, so the split
    # must place them rather than drop them — otherwise the two halves measure different problems.
    items = [("solo", "8484"), ("a", "7307"), ("b", "7307")]
    left, right = stratified_halves(items, key=lambda x: x[1])
    assert sum(1 for i in left + right if i[0] == "solo") == 1
