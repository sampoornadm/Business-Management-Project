import numpy as np

from bmp_hsn.calibration import CrossValidatedCalibrator, coverage_at_precision


def test_confidence_rises_with_similarity_and_margin():
    # Confident, correct items score high on both features; unsure ones score low on both.
    similarity = np.array([0.9, 0.88, 0.86, 0.3, 0.32, 0.29], dtype=np.float32)
    margin = np.array([0.20, 0.18, 0.22, 0.001, 0.002, 0.001], dtype=np.float32)
    correct = np.array([1, 1, 1, 0, 0, 0])

    calibrator = CrossValidatedCalibrator(folds=3).fit(similarity, margin, correct)
    confident = calibrator.predict(np.array([0.9]), np.array([0.2]))
    unsure = calibrator.predict(np.array([0.3]), np.array([0.001]))

    assert confident[0] > unsure[0]


def test_out_of_fold_predictions_exist_for_every_item():
    # The threshold has to be chosen on predictions the calibrator did not train on. With 76 eval
    # items, fitting and measuring on the same rows would report a precision nobody ever gets.
    rng = np.random.default_rng(0)
    similarity = rng.random(30).astype(np.float32)
    margin = rng.random(30).astype(np.float32)
    correct = (similarity > 0.5).astype(int)

    calibrator = CrossValidatedCalibrator(folds=5).fit(similarity, margin, correct)
    assert calibrator.out_of_fold.shape == (30,)
    assert np.all((calibrator.out_of_fold >= 0.0) & (calibrator.out_of_fold <= 1.0))


def test_coverage_at_precision_picks_a_threshold_meeting_the_target():
    # Six items, the three confident ones correct. Demanding 100% precision should answer only those.
    confidence = np.array([0.95, 0.92, 0.90, 0.40, 0.35, 0.30])
    correct = np.array([1, 1, 1, 0, 0, 0])

    threshold, precision, coverage = coverage_at_precision(confidence, correct, target=1.0)
    assert precision == 1.0
    assert coverage == 0.5
    assert 0.40 < threshold <= 0.90


def test_coverage_at_precision_reports_honestly_when_the_target_is_unreachable():
    # Every item is wrong: no threshold can deliver 95% precision, so coverage must be zero rather
    # than a threshold that quietly answers anyway.
    confidence = np.array([0.9, 0.8, 0.7])
    correct = np.array([0, 0, 0])

    threshold, precision, coverage = coverage_at_precision(confidence, correct, target=0.95)
    assert coverage == 0.0
    assert precision == 0.0
    assert threshold > confidence.max()


def test_higher_precision_target_never_increases_coverage():
    rng = np.random.default_rng(1)
    confidence = rng.random(50)
    correct = (rng.random(50) < confidence).astype(int)

    _, _, lenient = coverage_at_precision(confidence, correct, target=0.6)
    _, _, strict = coverage_at_precision(confidence, correct, target=0.9)
    assert strict <= lenient
