from bmp_hsn.text import normalise_text

# Shared fixture: the same table lives in the server's classification.text.spec.ts. If you change a
# row here, change it there too, or the two sides stop agreeing on what a query looks like.
CASES = [
    ("PURE-BRED BREEDING ANIMALS.", "pure bred breeding animals"),
    ("PU : TUBE", "pu tube"),
    ("  Push-in  fitting,  10MM ", "push in fitting 10mm"),
    ("T/CONNECTOR_(BRASS)", "t connector brass"),
    ("", ""),
]


def test_normalises_register_and_punctuation():
    for raw, expected in CASES:
        assert normalise_text(raw) == expected


def test_tariff_and_purchase_order_wording_meet():
    assert normalise_text("LIVE HORSES, ASSES.") == normalise_text("live horses  asses")
