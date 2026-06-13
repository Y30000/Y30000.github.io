"use strict";

(function() {
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
    advancedSettings: document.getElementById("advancedSettings"),
    enableRange: document.getElementById("enableRangeCheckbox"),
    minBpm: document.getElementById("minBpmInput"),
    maxBpm: document.getElementById("maxBpmInput"),
    rangeInputsRow: document.getElementById("rangeInputsRow"),
    enableSection: document.getElementById("enableSectionCheckbox"),
    startTime: document.getElementById("startTimeInput"),
    endTime: document.getElementById("endTimeInput"),
    sectionTimesRow: document.getElementById("sectionTimesRow"),
    sampleRateSelect: document.getElementById("sampleRateSelect"),
    
    autoSegment: document.getElementById("autoSegmentCheckbox"),
    tolerance: document.getElementById("toleranceInput"),
    minDuration: document.getElementById("minDurationInput"),
    
    sectionsContainer: document.getElementById("sectionsContainer"),
    sectionsList: document.getElementById("sectionsList"),
    
    // File detail toggle elements
    dropZonePrompt: document.getElementById("dropZonePrompt"),
    fileDetails: document.getElementById("fileDetails"),
   
    // Player elements
    playerContainer: document.getElementById("playerContainer"),
    waveformCanvas: document.getElementById("waveformCanvas"),
    playBtn: document.getElementById("playBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    stopBtn: document.getElementById("stopBtn"),
    loopStartBtn: document.getElementById("loopStartBtn"),
    loopEndBtn: document.getElementById("loopEndBtn"),
    loopOffBtn: document.getElementById("loopOffBtn"),
    loopStatusText: document.getElementById("loopStatusText"),
   
    // Premium controls
    timeDisplay: document.getElementById("timeDisplay"),
    speedInput: document.getElementById("speedInput"),
    speedMinusBtn: document.getElementById("speedMinusBtn"),
    speedPlusBtn: document.getElementById("speedPlusBtn"),
    speedPresets: document.querySelectorAll(".preset-btn"),
    
    metronomeResetBtn: document.getElementById("metronomeResetBtn"),
    enableMetronome: document.getElementById("enableMetronomeCheckbox"),
    enableVisualMetronome: document.getElementById("enableVisualMetronomeCheckbox"),
    metronomeLamp: document.getElementById("metronomeLamp"),
    metronomeVolume: document.getElementById("metronomeVolume"),
    metronomeBpmInput: document.getElementById("metronomeBpmInput"),
    bpmMinusBtn: document.getElementById("bpmMinusBtn"),
    bpmPlusBtn: document.getElementById("bpmPlusBtn"),
    syncMinusBtn: document.getElementById("syncMinusBtn"),
    syncOffsetDisplay: document.getElementById("syncOffsetDisplay"),
    syncPlusBtn: document.getElementById("syncPlusBtn"),
    metronomePlayBtn: document.getElementById("metronomePlayBtn"),
    metronomeSyncTouchBtn: document.getElementById("metronomeSyncTouchBtn"),
    metronomeAutoStartToggle: document.getElementById("metronomeAutoStartToggle"),
    metronomeStartTimeInput: document.getElementById("metronomeStartTimeInput"),
    fetchPointerTimeBtn: document.getElementById("fetchPointerTimeBtn"),
   
    tapBtn: document.getElementById("tapBtn"),
    tapResetBtn: document.getElementById("tapResetBtn"),
    tapBpmValue: document.getElementById("tapBpmValue"),
    applyTapBpmBtn: document.getElementById("applyTapBpmBtn"),
    visualizerCanvas: document.getElementById("visualizerCanvas"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    themeToggleIcon: document.getElementById("themeToggleIcon"),
   
    // Tabs elements
    tabButtons: document.querySelectorAll(".tab-button"),
    tabContents: document.querySelectorAll(".tab-content"),
    tabBtnPlayer: document.getElementById("tabBtnPlayer"),
    tabBtnSections: document.getElementById("tabBtnSections"),
    playerPlaceholder: document.getElementById("playerPlaceholder"),
    sectionsPlaceholder: document.getElementById("sectionsPlaceholder"),
    sectionsContentWrapper: document.getElementById("sectionsContentWrapper"),
    recalcSectionsBtn: document.getElementById("recalcSectionsBtn"),
  };

  let selectedFile = null;
  let cachedSamples = null;
  let cachedSampleRate = null;

  elements.input.addEventListener("change", () => {
    setFile(elements.input.files[0] || null);
  });

  [elements.minBpm, elements.maxBpm, elements.startTime, elements.endTime, elements.tolerance, elements.minDuration].forEach((input) => {
    input.addEventListener("input", validateInputs);
  });
  [elements.enableRange, elements.enableSection, elements.autoSegment].forEach((chk) => {
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
    elements.advancedSettings.open = false;
    elements.enableRange.checked = false;
    elements.enableSection.checked = false;
    elements.autoSegment.checked = true;
    elements.minBpm.value = "70.0";
    elements.maxBpm.value = "210.0";
    elements.startTime.value = "0.0";
    elements.endTime.value = "30.0";
    elements.tolerance.value = "5.0";
    elements.minDuration.value = "10.0";
    elements.sampleRateSelect.value = "22050";
    
    window.AudioPlayer.cleanupPlayer();
    window.AudioPlayer.resetPlayerState();
    
    setFile(null);
    resetResult();
    setStatus("오디오 파일을 선택하세요.", "");
    switchTab("analysis");
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
    window.AudioPlayer.cleanupPlayer();
    
    if (file) {
      elements.fileName.textContent = file.name;
      elements.dropZonePrompt.classList.add("hidden");
      elements.fileDetails.classList.remove("hidden");
      
      // 재생 탭 활성화 및 플레이스홀더 숨김
      elements.tabBtnPlayer.disabled = false;
      elements.playerPlaceholder.classList.add("hidden");
      elements.playerContainer.classList.remove("hidden");
      
      window.AudioPlayer.setupPlayer(file);
      switchTab("player"); // 파일이 로드되면 자동으로 재생 탭으로 전환
    } else {
      elements.fileName.textContent = "파일 선택";
      elements.dropZonePrompt.classList.remove("hidden");
      elements.fileDetails.classList.add("hidden");
      
      // 탭 잠금 및 플레이스홀더 노출
      elements.tabBtnPlayer.disabled = true;
      elements.tabBtnSections.disabled = true;
      elements.playerPlaceholder.classList.remove("hidden");
      elements.playerContainer.classList.add("hidden");
      elements.sectionsPlaceholder.classList.remove("hidden");
      elements.sectionsContentWrapper.classList.add("hidden");
      
      switchTab("analysis");
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
    const autoEnabled = elements.autoSegment.checked;

    if (autoEnabled && sectionEnabled) {
      elements.enableSection.checked = false;
      elements.sectionTimesRow.classList.add("hidden");
    }

    // Toggle visibility of setting rows
    if (rangeEnabled) {
      elements.rangeInputsRow.classList.remove("hidden");
    } else {
      elements.rangeInputsRow.classList.add("hidden");
    }

    if (elements.enableSection.checked) {
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

    // 3. Validate Advanced Settings
    const tolVal = parseFloat(elements.tolerance.value);
    if (isNaN(tolVal) || tolVal <= 0) {
      setStatus("에러: 변화 허용 오차는 0보다 커야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
    }
    const minDurVal = parseFloat(elements.minDuration.value);
    if (isNaN(minDurVal) || minDurVal <= 0) {
      setStatus("에러: 최소 유지 시간은 0보다 커야 합니다.", "is-error");
      elements.analyzeButton.disabled = true;
      return false;
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
    elements.tabBtnSections.disabled = true;
    elements.sectionsPlaceholder.classList.remove("hidden");
    elements.sectionsContentWrapper.classList.add("hidden");
    elements.sectionsContainer.classList.add("hidden");
    elements.sectionsList.innerHTML = "";
  }

  function renderResult(result) {
    elements.bpm.textContent = result.bpm.toFixed(2);
    elements.confidence.textContent = `${(result.confidence * 100).toFixed(1)}%`;
    elements.candidates.textContent = result.candidates
      .map((candidate) => candidate.toFixed(2))
      .join(", ");
    elements.duration.textContent = `${result.durationSeconds.toFixed(2)}s`;
    
    // Store BPM and Phase offset for metronome and beat grid in player module
    window.AudioPlayer.setAnalyzedData(result.bpm, result.firstPeakTime || 0);
    
    if (result.sections && result.sections.length > 0) {
      elements.tabBtnSections.disabled = false;
      elements.sectionsPlaceholder.classList.add("hidden");
      elements.sectionsContentWrapper.classList.remove("hidden");
      elements.sectionsContainer.classList.remove("hidden");
      
      let html = "";
      for (const sec of result.sections) {
        html += `<div><span>⏰ ${sec.startTime.toFixed(1)}s ~ ${sec.endTime.toFixed(1)}s</span> <strong>${sec.bpm.toFixed(1)} BPM</strong> (신뢰도: ${(sec.confidence * 100).toFixed(1)}%)</div>`;
      }
      elements.sectionsList.innerHTML = html;
      switchTab("sections"); // 자동 구간이 검출되면 자동으로 구간 분석 탭으로 전환
    } else {
      elements.tabBtnSections.disabled = true;
      elements.sectionsPlaceholder.classList.remove("hidden");
      elements.sectionsContentWrapper.classList.add("hidden");
      elements.sectionsContainer.classList.add("hidden");
      elements.sectionsList.innerHTML = "";
    }
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

    // Resample target to specified or default rate and mix to mono
    const targetSampleRate = parseInt(elements.sampleRateSelect.value, 10) || 22050;
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
    
    // Cache for rapid recalculation
    cachedSamples = samples;
    cachedSampleRate = targetSampleRate;
    if (elements.recalcSectionsBtn) elements.recalcSectionsBtn.disabled = false;

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
    
    const autoSegment = elements.autoSegment.checked;
    const tolerance = parseFloat(elements.tolerance.value) || 3.0;
    const minDuration = parseFloat(elements.minDuration.value) || 3.0;

    const result = window.BPMAnalyzer.analyzeSamples(samples, targetSampleRate, minBpmVal, maxBpmVal, autoSegment, tolerance, minDuration);
    result.fileName = file.name;
    return result;
  }

  // Recalculate Sections Logic
  if (elements.recalcSectionsBtn) {
    elements.recalcSectionsBtn.addEventListener("click", () => {
      if (!cachedSamples || !cachedSampleRate) return;
      
      let samples = cachedSamples;
      
      // Check range subset setting
      if (elements.enableSection.checked) {
        const startTimeVal = parseFloat(elements.startTime.value);
        const endTimeVal = parseFloat(elements.endTime.value);
        const startSample = Math.floor(startTimeVal * cachedSampleRate);
        const endSample = Math.floor(endTimeVal * cachedSampleRate);
        
        if (startSample < samples.length) {
          samples = samples.slice(startSample, Math.min(endSample, samples.length));
        }
      }
      
      let minBpmVal = 70.0;
      let maxBpmVal = 210.0;
      if (elements.enableRange.checked) {
        minBpmVal = parseFloat(elements.minBpm.value) || 70.0;
        maxBpmVal = parseFloat(elements.maxBpm.value) || 210.0;
      }
      
      const autoSegment = elements.autoSegment.checked;
      const tolerance = parseFloat(elements.tolerance.value) || 5.0;
      const minDuration = parseFloat(elements.minDuration.value) || 10.0;
      
      try {
        const result = window.BPMAnalyzer.analyzeSamples(samples, cachedSampleRate, minBpmVal, maxBpmVal, autoSegment, tolerance, minDuration);
        if (selectedFile) result.fileName = selectedFile.name;
        renderResult(result);
        setStatus("구간 분석을 성공적으로 다시 계산했습니다.", "is-success");
      } catch (error) {
        console.error(error);
        setStatus(error.message, "is-error");
      }
    });
  }

  function switchTab(tabId) {
    elements.tabButtons.forEach(btn => {
      if (btn.getAttribute("data-tab") === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    elements.tabContents.forEach(content => {
      if (content.getAttribute("id") === `tabContent${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`) {
        content.classList.add("active");
        
        // 재생 탭으로 전환되었을 때 Canvas 크기 재조정 및 파형 재렌더링 처리
        if (tabId === "player") {
          setTimeout(() => {
            window.AudioPlayer.drawWaveform();
            window.AudioPlayer.updatePlayPointerOnce();
          }, 50);
        }
      } else {
        content.classList.remove("active");
      }
    });
  }

  function initTabs() {
    elements.tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        // 비활성화된 탭은 전환 불가능
        if (btn.disabled) return;
        
        const tabId = btn.getAttribute("data-tab");
        if (tabId) {
          switchTab(tabId);
        }
      });
    });
  }

  // 테마(화이트/다크) 모드 토글 로직
  function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);
    
    elements.themeToggleBtn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);
      updateThemeIcon(newTheme);
      
      // 테마가 바뀌면 파형/그리드를 새 색상 테마에 맞춰 다시 렌더링
      window.AudioPlayer.drawWaveform();
      window.AudioPlayer.updatePlayPointerOnce();
    });
  }

  function updateThemeIcon(theme) {
    if (theme === "dark") {
      elements.themeToggleIcon.textContent = "🌙";
      elements.themeToggleBtn.title = "화이트 모드로 전환";
    } else {
      elements.themeToggleIcon.textContent = "☀️";
      elements.themeToggleBtn.title = "다크 모드로 전환";
    }
  }

  // 스크립트 로드 시 탭, 테마, 플레이어 모듈 초기화
  initTabs();
  initTheme();
  window.AudioPlayer.initPlayer(elements, { setStatus });
})();
