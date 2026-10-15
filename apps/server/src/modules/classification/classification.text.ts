/**
 * Text normalisation for the classifier, applied to queries before they are embedded.
 *
 * Mirrors ml/train/bmp_hsn/text.py#normalise_text. The trainer applies this same rule to the corpus
 * the index is built from, so the two must stay identical: change one and the other, and the
 * queries stop matching the distribution the model was trained on. The shared fixture in
 * classification.text.spec.ts and ml/train/tests/test_text.py is what keeps them honest.
 *
 * It removes register rather than meaning. Tariff text is CAPS with punctuation; purchase-order text
 * is mixed case with noise. Both read the same once case and punctuation are flattened.
 */
const PUNCTUATION = /[.,;:()[\]"'`!?*+&_\-/\\|]/g;
const WHITESPACE = /\s+/g;

export function normaliseText(text: string): string {
  return text.toLowerCase().replace(PUNCTUATION, " ").replace(WHITESPACE, " ").trim();
}
