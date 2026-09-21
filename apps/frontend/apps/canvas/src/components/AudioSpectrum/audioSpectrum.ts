export const AUDIO_SPECTRUM_BAR_COUNT = 24;

export const STATIC_AUDIO_SPECTRUM_HEIGHTS = [
  8, 14, 22, 28, 18, 10, 13, 11, 25, 28, 16, 9, 6, 5, 8, 21, 28, 16, 10, 17, 9, 8, 18, 11,
];

const DEFAULT_MIN_HEIGHT = 3;
const DEFAULT_MAX_HEIGHT = 32;
const USEFUL_FREQUENCY_RATIO = 0.4;
const MINIMUM_NOISE_FLOOR = 4;
const RELATIVE_NOISE_FLOOR_RATIO = 0.22;
const CONTRAST_EXPONENT = 1.8;
const LOW_FREQUENCY_BAR_RATIO = 0.25;
const LOWEST_FREQUENCY_GAIN = 0.35;

export function frequencyDataToSpectrum(
  frequencyData: Uint8Array,
  barCount = AUDIO_SPECTRUM_BAR_COUNT,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
): number[] {
  const supportedBarCount = barCount > 0 && barCount % 2 === 0 ? barCount : AUDIO_SPECTRUM_BAR_COUNT;
  const usefulBinCount = Math.max(1, Math.floor(frequencyData.length * USEFUL_FREQUENCY_RATIO));
  const heightRange = Math.max(0, maxHeight - minHeight);
  const attenuatedBarCount = Math.max(2, Math.ceil(supportedBarCount * LOW_FREQUENCY_BAR_RATIO));
  const bucketAverages = Array.from({ length: supportedBarCount }, (_, index) => {
    const start = Math.floor((index * usefulBinCount) / supportedBarCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * usefulBinCount) / supportedBarCount));
    let sum = 0;
    for (let binIndex = start; binIndex < end; binIndex += 1) {
      sum += frequencyData[binIndex] ?? 0;
    }
    const average = sum / (end - start);
    if (index >= attenuatedBarCount) return average;
    const progress = index / (attenuatedBarCount - 1);
    const gain = LOWEST_FREQUENCY_GAIN + (1 - LOWEST_FREQUENCY_GAIN) * progress;
    return average * gain;
  });
  const peak = Math.max(...bucketAverages);
  const noiseFloor = Math.max(MINIMUM_NOISE_FLOOR, peak * RELATIVE_NOISE_FLOOR_RATIO);
  if (peak <= noiseFloor) return Array(supportedBarCount).fill(minHeight);

  return bucketAverages.map((average) => {
    const normalized = Math.min(1, Math.max(0, (average - noiseFloor) / (peak - noiseFloor)));
    const contrasted = normalized ** CONTRAST_EXPONENT;
    return Math.round(minHeight + contrasted * heightRange);
  });
}
