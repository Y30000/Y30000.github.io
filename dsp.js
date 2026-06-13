"use strict";

(function() {
  function findFirstPeak(onsetEnvelope, threshold = 0.3) {
    if (onsetEnvelope.length === 0) return 0;
    const maxVal = Math.max(...onsetEnvelope);
    if (maxVal === 0) return 0;

    const limit = threshold * maxVal;
    for (let i = 1; i < onsetEnvelope.length - 1; i += 1) {
      if (onsetEnvelope[i] >= limit) {
        if (onsetEnvelope[i] >= onsetEnvelope[i - 1] && onsetEnvelope[i] >= onsetEnvelope[i + 1]) {
          return i;
        }
      }
    }

    for (let i = 0; i < onsetEnvelope.length; i += 1) {
      if (onsetEnvelope[i] >= limit) {
        return i;
      }
    }

    return 0;
  }

  function getDSPParams(sampleRate) {
    const targetWindow = 0.0464399; // 1024 / 22050
    const targetHop = 0.01160997; // 256 / 22050
    
    const idealFrame = sampleRate * targetWindow;
    const frameLength = Math.pow(2, Math.round(Math.log2(idealFrame)));
    
    const idealHop = sampleRate * targetHop;
    const hopLength = Math.pow(2, Math.round(Math.log2(idealHop)));
    
    return { frameLength, hopLength };
  }

  function analyzeSamples(samples, sampleRate, minBpm = 70.0, maxBpm = 210.0, autoSegment = false, tolerance = 3.0, minDuration = 3.0) {
    const dspParams = getDSPParams(sampleRate);
    const frameLength = dspParams.frameLength;
    const hopLength = dspParams.hopLength;

    const durationSeconds = samples.length / sampleRate;
    if (durationSeconds < 3) {
      throw new Error("3초 이상의 오디오가 필요합니다.");
    }

    let onsetEnvelope = computeOnsetEnvelope(samples, frameLength, hopLength);
    if (!onsetEnvelope.some((value) => value > 0)) {
      throw new Error("리듬 온셋을 찾지 못했습니다.");
    }
    
    const onsetEnvelopeFull = onsetEnvelope.slice();

    // Phase alignment (centering around the first peak of onset energy)
    const firstPeakIdx = findFirstPeak(onsetEnvelope);
    const maxLag = Math.ceil((60 / minBpm) * sampleRate / hopLength);
    if (onsetEnvelope.length - firstPeakIdx >= maxLag) {
      onsetEnvelope = onsetEnvelope.slice(firstPeakIdx);
    }

    const { candidates, strengths } = estimateTempoCandidates(onsetEnvelope, sampleRate, hopLength, minBpm, maxBpm);
    if (candidates.length === 0) {
      throw new Error("BPM을 계산하지 못했습니다.");
    }

    const bpm = selectPrimaryBpm(candidates, minBpm, maxBpm);
    
    let sections = null;
    if (autoSegment) {
      sections = analyzeDynamicSections(onsetEnvelopeFull, sampleRate, hopLength, minBpm, maxBpm, tolerance, minDuration);
    }
    
    return {
      bpm,
      confidence: confidenceFromStrengths(strengths),
      candidates: prioritizeCandidate(bpm, candidates),
      durationSeconds,
      sections,
      firstPeakTime: firstPeakIdx * hopLength / sampleRate,
    };
  }

  function analyzeDynamicSections(onsetEnvelope, sampleRate, hopLength, minBpm, maxBpm, tolerance, minDuration) {
    const windowSeconds = 6.0;
    const windowFrames = Math.floor(windowSeconds * sampleRate / hopLength);
    const totalFrames = onsetEnvelope.length;
    const totalSeconds = totalFrames * hopLength / sampleRate;

    if (totalSeconds < windowSeconds) return null;

    let currentFrame = 0;
    const defaultHopSeconds = 1.0;
    const rawSegments = [];
    let lastBpm = 0.0;

    while (currentFrame + windowFrames <= totalFrames) {
      const windowEnv = onsetEnvelope.slice(currentFrame, currentFrame + windowFrames);
      const { candidates, strengths } = estimateTempoCandidates(windowEnv, sampleRate, hopLength, minBpm, maxBpm);
      
      const currentTime = currentFrame * hopLength / sampleRate;
      let bpm = lastBpm;
      let conf = 0.0;

      if (candidates.length > 0 && strengths.length > 0) {
        bpm = selectPrimaryBpm(candidates, minBpm, maxBpm);
        conf = confidenceFromStrengths(strengths);
      }

      rawSegments.push({
        time: currentTime + (windowSeconds / 2.0),
        bpm: bpm,
        conf: conf
      });

      let hopSeconds = defaultHopSeconds;
      if (bpm > 0) {
        hopSeconds = 60.0 / bpm;
        lastBpm = bpm;
      } else {
        hopSeconds = defaultHopSeconds;
      }

      const hopFrames = Math.max(1, Math.floor(hopSeconds * sampleRate / hopLength));
      currentFrame += hopFrames;
    }

    if (rawSegments.length === 0) return null;

    const sections = [];
    let currentSectionBpm = rawSegments[0].bpm;
    let currentSectionStart = 0.0;
    let sectionConfs = [rawSegments[0].conf];

    for (let i = 1; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      const prevSeg = rawSegments[i - 1];

      if (currentSectionBpm === 0.0 && seg.bpm > 0) {
        currentSectionBpm = seg.bpm;
      }

      if (seg.bpm > 0 && Math.abs(seg.bpm - currentSectionBpm) > tolerance) {
        const boundaryTime = (prevSeg.time + seg.time) / 2.0;
        const avgConf = sectionConfs.reduce((a, b) => a + b, 0) / sectionConfs.length;

        sections.push({
          startTime: round(currentSectionStart, 2),
          endTime: round(boundaryTime, 2),
          bpm: round(currentSectionBpm, 2),
          confidence: round(avgConf, 2)
        });

        currentSectionBpm = seg.bpm;
        currentSectionStart = boundaryTime;
        sectionConfs = [seg.conf];
      } else {
        sectionConfs.push(seg.conf);
      }
    }

    const avgConf = sectionConfs.length > 0 ? sectionConfs.reduce((a, b) => a + b, 0) / sectionConfs.length : 0.0;
    sections.push({
      startTime: round(currentSectionStart, 2),
      endTime: round(totalSeconds, 2),
      bpm: round(currentSectionBpm, 2),
      confidence: round(avgConf, 2)
    });

    const merged = [];
    for (const s of sections) {
      if (s.endTime - s.startTime < minDuration) {
        if (merged.length === 0) {
          merged.push(s);
        } else {
          const prev = merged[merged.length - 1];
          prev.endTime = s.endTime;
        }
      } else {
        merged.push(s);
      }
    }

    if (merged.length > 1 && (merged[0].endTime - merged[0].startTime) < minDuration) {
      merged[1].startTime = merged[0].startTime;
      merged.shift();
    }

    return merged;
  }

  function computeOnsetEnvelope(samples, frameLength, hopLength) {
    if (samples.length < frameLength) return [];

    const window = hannWindow(frameLength);
    let previous = null;
    const flux = [];

    for (let start = 0; start + frameLength <= samples.length; start += hopLength) {
      const real = new Float64Array(frameLength);
      const imag = new Float64Array(frameLength);
      for (let index = 0; index < frameLength; index += 1) {
        real[index] = samples[start + index] * window[index];
      }

      fft(real, imag);
      const magnitude = new Float64Array(frameLength / 2);
      for (let bin = 0; bin < magnitude.length; bin += 1) {
        magnitude[bin] = Math.hypot(real[bin], imag[bin]);
      }

      if (previous) {
        let sum = 0;
        for (let bin = 0; bin < magnitude.length; bin += 1) {
          const diff = magnitude[bin] - previous[bin];
          if (diff > 0) sum += diff;
        }
        flux.push(sum);
      }

      previous = magnitude;
    }

    return normalize(flux);
  }

  function estimateTempoCandidates(onsetEnvelope, sampleRate, hopLength, minBpm = 70.0, maxBpm = 210.0) {
    const centered = center(onsetEnvelope);
    const minLag = Math.floor((60 / maxBpm) * sampleRate / hopLength);
    const maxLag = Math.ceil((60 / minBpm) * sampleRate / hopLength);
    const zeroLag = dotAtLag(centered, 0);

    if (zeroLag <= 0) return { candidates: [], strengths: [] };

    const correlation = [];
    for (let lag = 0; lag <= maxLag + 1; lag += 1) {
      correlation[lag] = dotAtLag(centered, lag);
    }

    const peaks = [];
    for (let lag = Math.max(1, minLag); lag <= maxLag; lag += 1) {
      if (correlation[lag] > correlation[lag - 1] && correlation[lag] >= correlation[lag + 1]) {
        peaks.push({ lag, strength: correlation[lag] / zeroLag });
      }
    }

    peaks.sort((a, b) => b.strength - a.strength);

    const candidates = [];
    const strengths = [];
    for (const peak of peaks) {
      const lag = refineLag(correlation, peak.lag);
      const bpm = 60 * sampleRate / (lag * hopLength);
      if (bpm >= minBpm && bpm <= maxBpm && !nearExisting(bpm, candidates)) {
        candidates.push(round(bpm, 2));
        strengths.push(Math.max(0, peak.strength));
      }
      if (candidates.length === 3) break;
    }

    return { candidates, strengths };
  }

  function dotAtLag(values, lag) {
    let sum = 0;
    for (let index = 0; index + lag < values.length; index += 1) {
      sum += values[index] * values[index + lag];
    }
    return sum;
  }

  function refineLag(correlation, lag) {
    if (lag <= 0 || lag >= correlation.length - 1) return lag;

    const left = correlation[lag - 1];
    const centerValue = correlation[lag];
    const right = correlation[lag + 1];
    const denominator = left - 2 * centerValue + right;
    if (denominator === 0) return lag;

    const adjustment = 0.5 * (left - right) / denominator;
    return lag + clamp(adjustment, -0.5, 0.5);
  }

  function selectPrimaryBpm(candidates, minBpm = 70.0, maxBpm = 210.0) {
    return candidates.find((candidate) => candidate >= minBpm && candidate <= maxBpm) || candidates[0];
  }

  function prioritizeCandidate(primary, candidates) {
    return [primary, ...candidates.filter((candidate) => candidate !== primary)];
  }

  function confidenceFromStrengths(strengths) {
    if (strengths.length === 0) return 0;

    const top = strengths[0];
    const separation = strengths.length > 1 ? top - strengths[1] : top;
    return round(clamp(0.7 * top + 0.3 * Math.max(0, separation), 0, 1), 2);
  }

  function hannWindow(size) {
    const window = new Float64Array(size);
    for (let index = 0; index < size; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    }
    return window;
  }

  function fft(real, imag) {
    const length = real.length;
    let j = 0;

    for (let i = 1; i < length; i += 1) {
      let bit = length >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;

      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let size = 2; size <= length; size <<= 1) {
      const halfSize = size >> 1;
      const theta = (-2 * Math.PI) / size;
      const phaseStepReal = Math.cos(theta);
      const phaseStepImag = Math.sin(theta);

      for (let start = 0; start < length; start += size) {
        let phaseReal = 1;
        let phaseImag = 0;

        for (let offset = 0; offset < halfSize; offset += 1) {
          const evenIndex = start + offset;
          const oddIndex = evenIndex + halfSize;
          const tempReal = phaseReal * real[oddIndex] - phaseImag * imag[oddIndex];
          const tempImag = phaseReal * imag[oddIndex] + phaseImag * real[oddIndex];

          real[oddIndex] = real[evenIndex] - tempReal;
          imag[oddIndex] = imag[evenIndex] - tempImag;
          real[evenIndex] += tempReal;
          imag[evenIndex] += tempImag;

          const nextReal = phaseReal * phaseStepReal - phaseImag * phaseStepImag;
          phaseImag = phaseReal * phaseStepImag + phaseImag * phaseStepReal;
          phaseReal = nextReal;
        }
      }
    }
  }

  function normalize(values) {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const shifted = values.map((value) => value - min);
    const max = Math.max(...shifted);
    if (max === 0) return shifted;
    return shifted.map((value) => value / max);
  }

  function center(values) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.map((value) => value - mean);
  }

  function nearExisting(bpm, candidates) {
    return candidates.some((candidate) => Math.abs(candidate - bpm) < 1);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round(value, digits) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  // Expose functionality to global namespace for non-module usage
  window.BPMAnalyzer = {
    analyzeSamples,
    computeOnsetEnvelope,
    estimateTempoCandidates,
    findFirstPeak
  };
})();
