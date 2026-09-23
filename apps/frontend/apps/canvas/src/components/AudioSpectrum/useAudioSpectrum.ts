import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { STATIC_AUDIO_SPECTRUM_HEIGHTS, frequencyDataToSpectrum } from "./audioSpectrum";

const SPECTRUM_UPDATE_INTERVAL_MS = 1000 / 30;

type AudioGraph = {
  analyser: AnalyserNode;
  context: AudioContext;
  data: Uint8Array<ArrayBuffer>;
  source: MediaElementAudioSourceNode;
};

export type AudioSpectrumState = {
  fallback: boolean;
  heights: number[];
  prepare: () => Promise<void>;
};

export function useAudioSpectrum(audioRef: RefObject<HTMLAudioElement | null>): AudioSpectrumState {
  const [fallback, setFallback] = useState(false);
  const [heights, setHeights] = useState(STATIC_AUDIO_SPECTRUM_HEIGHTS);
  const graphRef = useRef<AudioGraph | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastUpdateRef = useRef(0);
  const mountedRef = useRef(true);

  const reset = useCallback(() => {
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    lastUpdateRef.current = 0;
    if (mountedRef.current) setHeights(STATIC_AUDIO_SPECTRUM_HEIGHTS);
  }, []);

  const startSampling = useCallback(() => {
    if (!graphRef.current || animationFrameRef.current !== undefined) return;

    const sample = (timestamp: number) => {
      const graph = graphRef.current;
      if (!graph) return;
      try {
        if (timestamp - lastUpdateRef.current >= SPECTRUM_UPDATE_INTERVAL_MS) {
          graph.analyser.getByteFrequencyData(graph.data);
          if (mountedRef.current) {
            setHeights(frequencyDataToSpectrum(graph.data));
          }
          lastUpdateRef.current = timestamp;
        }
        animationFrameRef.current = requestAnimationFrame(sample);
      } catch {
        reset();
        if (mountedRef.current) setFallback(true);
      }
    };

    animationFrameRef.current = requestAnimationFrame(sample);
  }, [reset]);

  const prepare = useCallback(async () => {
    try {
      let graph = graphRef.current;
      if (!graph) {
        const element = audioRef.current;
        if (!element) return;
        const context = new window.AudioContext();
        const source = context.createMediaElementSource(element);
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyser.connect(context.destination);
        graph = {
          analyser,
          context,
          data: new Uint8Array(analyser.frequencyBinCount),
          source,
        };
        graphRef.current = graph;
      }
      if (graph.context.state === "suspended") await graph.context.resume();
      if (mountedRef.current) setFallback(false);
    } catch {
      reset();
      if (mountedRef.current) setFallback(true);
    }
  }, [audioRef, reset]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.addEventListener("play", startSampling);
    element.addEventListener("pause", reset);
    element.addEventListener("ended", reset);
    element.addEventListener("emptied", reset);
    return () => {
      element.removeEventListener("play", startSampling);
      element.removeEventListener("pause", reset);
      element.removeEventListener("ended", reset);
      element.removeEventListener("emptied", reset);
    };
  }, [audioRef, reset, startSampling]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      reset();
      const graph = graphRef.current;
      graphRef.current = undefined;
      graph?.source.disconnect();
      graph?.analyser.disconnect();
      void graph?.context.close();
    },
    [reset],
  );

  return { fallback, heights, prepare };
}
