"use strict";

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
  
  // Settings controls
  enableRange: document.getElementById("enableRangeCheckbox"),
  minBpm: document.getElementById("minBpmInput"),
  maxBpm: document.getElementById("maxBpmInput"),
  rangeInputsRow: document.getElementById("rangeInputsRow"),
  enableSection: document.getElementById("enableSectionCheckbox"),
  startTime: document.getElementById("startTimeInput"),
  endTime: document.getElementById("endTimeInput"),
  sectionTimesRow: document.getElementById("sectionTimesRow"),
  sampleRateSelect: document.getElementById("sampleRateSelect"),
  
  // File detail toggle elements
  dropZonePrompt: document.getElementById("dropZonePrompt"),
  fileDetails: document.getElementById("fileDetails"),
};

let selectedFile = null;

elements.input.addEventListener("change", () => {
  setFile(elements.input.files[0] || null);
});

[elements.minBpm, elements.maxBpm, elements.startTime, elements.endTime].forEach((input) => {
  input.addEventListener("input", validateInputs);
});
[elements.enableRange, elements.enableSection].forEach((chk) => {
  chk.addEventListener("change", validateInputs);
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
  elements.enableRange.checked = false;
  elements.enableSection.checked = false;
  elements.minBpm.value = "70.0";
  elements.maxBpm.value = "210.0";
  elements.startTime.value = "0.0";
  elements.endTime.value = "30.0";
  elements.sampleRateSelect.value = "22050";
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
  if (file) {
    elements.fileName.textContent = file.name;
    elements.dropZonePrompt.classList.add("hidden");
    elements.fileDetails.classList.remove("hidden");
  } else {
    elements.fileName.textContent = "파일 선택";
    elements.dropZonePrompt.classList.remove("hidden");
    elements.fileDetails.classList.add("hidden");
  }
  resetResult();
  validateInputs();
}

function setBusy(isBusy) {
  if (isBusy) {
    elements.analyzeButton.disabled = true;
    elements.analyzeButton.textContent = "분석 중";
  } else {
    validateInputs();
    elements.analyzeButton.textContent = "분석";
  }
}

function setStatus(message, className) {
  elements.status.textContent = message;
  elements.status.className = className;
}

function validateInputs() {
  const rangeEnabled = elements.enableRange.checked;
  const sectionEnabled = elements.enableSection.checked;

  // Toggle visibility of setting rows
  if (rangeEnabled) {
    elements.rangeInputsRow.classList.remove("hidden");
  } else {
    elements.rangeInputsRow.classList.add("hidden");
  }

  if (sectionEnabled) {
    elements.sectionTimesRow.classList.remove("hidden");
  } else {
    elements.sectionTimesRow.classList.add("hidden");
  }

  // 1. Validate BPM Candidates
  if (rangeEnabled) {
    const minBpmVal = parseFloat(elements.minBpm.value);
    if (isNaN(minBpmVal)) {
      setStatus("에러: 최소 BPM 탐색 범위는 유효한 숫자여야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
    if (minBpmVal <= 0) {
      setStatus("에러: 최소 BPM 탐색 범위는 0보다 커야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }

    const maxBpmVal = parseFloat(elements.maxBpm.value);
    if (isNaN(maxBpmVal)) {
      setStatus("에러: 최대 BPM 탐색 범위는 유효한 숫자여야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
    if (maxBpmVal < minBpmVal) {
      setStatus("에러: 최대 BPM 탐색 범위는 최소 BPM보다 크거나 같아야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
  }

  // 2. Validate Segment/Section Analysis
  if (sectionEnabled) {
    const startTimeVal = parseFloat(elements.startTime.value);
    if (isNaN(startTimeVal)) {
      setStatus("에러: 시작 시간은 유효한 숫자여야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
    if (startTimeVal < 0) {
      setStatus("에러: 시작 시간은 0 이상이어야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }

    const endTimeVal = parseFloat(elements.endTime.value);
    if (isNaN(endTimeVal)) {
      setStatus("에러: 끝 시간은 유효한 숫자여야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
    if (endTimeVal <= startTimeVal) {
      setStatus("에러: 끝 시간은 시작 시간보다 커야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }

    const duration = endTimeVal - startTimeVal;
    if (duration < 3.0) {
      setStatus(`에러: 분석 구간은 최소 3.0초 이상이어야 합니다. (현재 ${duration.toFixed(2)}초)`, "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
  }

  // 3. Check if input is selected
  const hasFile = !!selectedFile;
  if (!hasFile) {
    setStatus("오디오 파일을 선택하세요.", "");
    elements.analyzeButton.disabled = true;
    return true;
  }

  setStatus("분석 준비 완료", "");
  elements.analyzeButton.disabled = false;
  return true;
}

function resetResult() {
  elements.bpm.textContent = "--";
  elements.confidence.textContent = "--";
  elements.candidates.textContent = "--";
  elements.duration.textContent = "--";
}

function renderResult(result) {
  elements.bpm.textContent = result.bpm.toFixed(2);
  elements.confidence.textContent = `${(result.confidence * 100).toFixed(1)}%`;
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
  let decodedBuffer;
  try {
    decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioContext.close();
  }

  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) {
    throw new Error("이 브라우저는 OfflineAudioContext를 지원하지 않습니다.");
  }

  // Resample target to 22050 Hz and mix to mono
  const targetSampleRate = 22050;
  const offlineCtx = new OfflineAudioContextClass(
    1,
    Math.floor(decodedBuffer.duration * targetSampleRate),
    targetSampleRate
  );

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = decodedBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start();

  const resampledBuffer = await offlineCtx.startRendering();
  let samples = resampledBuffer.getChannelData(0);

  // 구간 지정 분석 (Section Analysis) 처리
  if (elements.enableSection.checked) {
    const startTimeVal = parseFloat(elements.startTime.value);
    const endTimeVal = parseFloat(elements.endTime.value);
    
    const startSample = Math.floor(startTimeVal * targetSampleRate);
    const endSample = Math.floor(endTimeVal * targetSampleRate);
    
    if (startSample >= samples.length) {
      throw new Error(`시작 시간(${startTimeVal}초)이 오디오 전체 길이(${(samples.length / targetSampleRate).toFixed(2)}초)를 초과합니다.`);
    }
    
    const slicedSamples = samples.slice(startSample, Math.min(endSample, samples.length));
    const slicedDuration = slicedSamples.length / targetSampleRate;
    if (slicedDuration < 3.0) {
      throw new Error(`자른 분석 구간이 최소 오디오 요구사항(3.0초)보다 짧습니다. (현재 구간 길이: ${slicedDuration.toFixed(2)}초)`);
    }
    samples = slicedSamples;
  }

  // BPM 탐색 범위 제한 설정 파싱
  let minBpmVal = 70.0;
  let maxBpmVal = 210.0;
  if (elements.enableRange.checked) {
    minBpmVal = parseFloat(elements.minBpm.value) || 70.0;
    maxBpmVal = parseFloat(elements.maxBpm.value) || 210.0;
  }

  const result = analyzeSamples(samples, targetSampleRate, minBpmVal, maxBpmVal);
  result.fileName = file.name;
  return result;
}

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

function analyzeSamples(samples, sampleRate, minBpm = 70.0, maxBpm = 210.0) {
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
  return {
    bpm,
    confidence: confidenceFromStrengths(strengths),
    candidates: prioritizeCandidate(bpm, candidates),
    durationSeconds,
  };
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

window.BPMAnalyzer = {
  analyzeSamples,
  computeOnsetEnvelope,
  estimateTempoCandidates,
  findFirstPeak,
};
