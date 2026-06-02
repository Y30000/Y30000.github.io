"use strict";

const SAMPLE_RATE_FALLBACK = 44100;
const FRAME_LENGTH = 1024;
const HOP_LENGTH = 512;
const MIN_BPM = 40;
const MAX_BPM = 240;

const elements = {
  input: document.getElementById("audioInput"),
  dropZone: document.getElementById("dropZone"),
  analyzeButton: document.getElementById("analyzeButton"),
  resetButton: document.getElementById("resetButton"),
  fileName: document.getElementById("fileName"),
  status: document.getElementById("statusText"),
  bpm: document.getElementById("bpmValue"),
  confidence: document.getElementById("confidenceValue"),
  candidates: document.getElementById("candidateValue"),
  duration: document.getElementById("durationValue"),
};

let selectedFile = null;

elements.input.addEventListener("change", () => {
  setFile(elements.input.files[0] || null);
});

elements.analyzeButton.addEventListener("click", async () => {
  if (!selectedFile) return;

  setBusy(true);
  setStatus("분석 중...", "");

  try {
    const result = await analyzeAudioFile(selectedFile);
    renderResult(result);
    setStatus("분석 완료", "is-success");
  } catch (error) {
    resetResult();
    setStatus(error.message || "분석에 실패했습니다.", "is-error");
  } finally {
    setBusy(false);
  }
});

elements.resetButton.addEventListener("click", () => {
  elements.input.value = "";
  setFile(null);
  resetResult();
  setStatus("오디오 파일을 선택하세요.", "");
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => {
  setFile(event.dataTransfer.files[0] || null);
});

function setFile(file) {
  selectedFile = file;
  elements.fileName.textContent = file ? file.name : "파일 선택";
  elements.analyzeButton.disabled = !file;
  resetResult();
  if (file) setStatus("분석 준비 완료", "");
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy || !selectedFile;
  elements.analyzeButton.textContent = isBusy ? "분석 중" : "분석";
}

function setStatus(message, className) {
  elements.status.textContent = message;
  elements.status.className = className;
}

function resetResult() {
  elements.bpm.textContent = "--";
  elements.confidence.textContent = "--";
  elements.candidates.textContent = "--";
  elements.duration.textContent = "--";
}

function renderResult(result) {
  elements.bpm.textContent = result.bpm.toFixed(2);
  elements.confidence.textContent = result.confidence.toFixed(2);
  elements.candidates.textContent = result.candidates
    .map((candidate) => candidate.toFixed(2))
    .join(", ");
  elements.duration.textContent = `${result.durationSeconds.toFixed(2)}s`;
}

async function analyzeAudioFile(file) {
  if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|flac|m4a|aac|ogg)$/i)) {
    throw new Error("오디오 파일만 분석할 수 있습니다.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("이 브라우저는 Web Audio API를 지원하지 않습니다.");
  }

  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const samples = mixToMono(audioBuffer);
    const result = analyzeSamples(samples, audioBuffer.sampleRate || SAMPLE_RATE_FALLBACK);
    result.fileName = file.name;
    return result;
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer) {
  const output = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      output[index] += data[index] / audioBuffer.numberOfChannels;
    }
  }
  return output;
}

function analyzeSamples(samples, sampleRate) {
  const durationSeconds = samples.length / sampleRate;
  if (durationSeconds < 3) {
    throw new Error("3초 이상의 오디오가 필요합니다.");
  }

  const onsetEnvelope = computeOnsetEnvelope(samples);
  if (!onsetEnvelope.some((value) => value > 0)) {
    throw new Error("리듬 온셋을 찾지 못했습니다.");
  }

  const { candidates, strengths } = estimateTempoCandidates(onsetEnvelope, sampleRate);
  if (candidates.length === 0) {
    throw new Error("BPM을 계산하지 못했습니다.");
  }

  const bpm = selectPrimaryBpm(candidates);
  return {
    bpm,
    confidence: confidenceFromStrengths(strengths),
    candidates: prioritizeCandidate(bpm, candidates),
    durationSeconds,
  };
}

function computeOnsetEnvelope(samples) {
  if (samples.length < FRAME_LENGTH) return [];

  const window = hannWindow(FRAME_LENGTH);
  let previous = null;
  const flux = [];

  for (let start = 0; start + FRAME_LENGTH <= samples.length; start += HOP_LENGTH) {
    const real = new Float64Array(FRAME_LENGTH);
    const imag = new Float64Array(FRAME_LENGTH);
    for (let index = 0; index < FRAME_LENGTH; index += 1) {
      real[index] = samples[start + index] * window[index];
    }

    fft(real, imag);
    const magnitude = new Float64Array(FRAME_LENGTH / 2);
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

function estimateTempoCandidates(onsetEnvelope, sampleRate) {
  const centered = center(onsetEnvelope);
  const minLag = Math.floor((60 / MAX_BPM) * sampleRate / HOP_LENGTH);
  const maxLag = Math.ceil((60 / MIN_BPM) * sampleRate / HOP_LENGTH);
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
    const bpm = 60 * sampleRate / (lag * HOP_LENGTH);
    if (bpm >= MIN_BPM && bpm <= MAX_BPM && !nearExisting(bpm, candidates)) {
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

function selectPrimaryBpm(candidates) {
  return candidates.find((candidate) => candidate >= 70 && candidate <= 180) || candidates[0];
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

window.BPMAnalyzer = {
  analyzeSamples,
  computeOnsetEnvelope,
  estimateTempoCandidates,
};
