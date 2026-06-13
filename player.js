"use strict";

(function() {
  const MIN_BPM = 40;
  const MAX_BPM = 240;

  // Local variables scoped inside IIFE
  let elements = null;
  let callbacks = {}; // { setStatus, switchTab }

  let audio = null;
  let audioBuffer = null;
  let playPointerId = null;
  let visualizerId = null;
  let loopEnabled = false;
  let loopStart = 0;
  let loopEnd = 0;
  let isDraggingPointer = false;

  // Audio context nodes
  let audioContext = null;
  let analyser = null;
  let source = null;
  let lastBeatIndex = -1;
  let syncOffset = 0; // in seconds

  let isStandaloneMetronomePlaying = false;
  let standaloneMetronomeStartTime = 0;
  let standaloneMetronomeId = null;

  let analyzedBpm = 0;
  let currentBpm = 0;
  let metronomeBpm = 120; // 0에서 120으로 기본값 변경 (분석 전 무반응 버그 해결)
  let firstPeakTime = 0;
  let tapTimes = [];
  let isAutoStartTriggered = false;
  
  // 정밀 오디오 룩어헤드 스케줄러 변수
  let timerWorker = null;
  let nextBeatTime = 0;
  let visualDrawQueue = [];
  let nextStandaloneBeatContextTime = 0;

  // Getters for external usage
  function getAudioBuffer() {
    return audioBuffer;
  }

  function getCurrentBpm() {
    return currentBpm;
  }

  function getFirstPeakTime() {
    return firstPeakTime;
  }

  function getSyncOffset() {
    return syncOffset;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function initPlayer(elementsMap, customCallbacks) {
    elements = elementsMap;
    callbacks = customCallbacks || {};

    bindEvents();
    initTimerWorker();
  }

  // Bind Events
  function bindEvents() {
    elements.playBtn.addEventListener("click", playAudio);
    elements.pauseBtn.addEventListener("click", pauseAudio);
    elements.stopBtn.addEventListener("click", stopAudio);
    elements.loopStartBtn.addEventListener("click", setLoopStart);
    elements.loopEndBtn.addEventListener("click", setLoopEnd);
    elements.loopOffBtn.addEventListener("click", disableLoop);

    elements.speedInput.addEventListener("change", (e) => {
      let rate = parseFloat(e.target.value);
      if (isNaN(rate) || rate < 0.1) rate = 0.1;
      if (rate > 5.0) rate = 5.0;
      e.target.value = rate.toFixed(2);
      updatePlaybackRate(rate);
    });

    elements.speedMinusBtn.addEventListener("click", () => {
      let rate = parseFloat(elements.speedInput.value) - 0.05;
      if (rate < 0.1) rate = 0.1;
      updatePlaybackRate(rate);
    });

    elements.speedPlusBtn.addEventListener("click", () => {
      let rate = parseFloat(elements.speedInput.value) + 0.05;
      if (rate > 5.0) rate = 5.0;
      updatePlaybackRate(rate);
    });

    elements.speedPresets.forEach(btn => {
      btn.addEventListener("click", () => {
        const rate = parseFloat(btn.getAttribute("data-speed"));
        updatePlaybackRate(rate);
      });
    });

    elements.metronomeBpmInput.addEventListener("change", (e) => {
      updateMetronomeBpm(parseInt(e.target.value, 10));
    });

    elements.bpmMinusBtn.addEventListener("click", () => {
      updateMetronomeBpm(parseInt(elements.metronomeBpmInput.value, 10) - 1);
    });

    elements.bpmPlusBtn.addEventListener("click", () => {
      updateMetronomeBpm(parseInt(elements.metronomeBpmInput.value, 10) + 1);
    });

    elements.metronomeResetBtn.addEventListener("click", () => {
      if (analyzedBpm > 0) {
        updateMetronomeBpm(Math.round(analyzedBpm));
      } else if (currentBpm > 0) {
        updateMetronomeBpm(Math.round(currentBpm));
      }
    });

    elements.syncMinusBtn.addEventListener("click", () => {
      const currentMs = Math.round(syncOffset * 1000);
      updateSyncOffset(currentMs - 10);
    });

    elements.syncPlusBtn.addEventListener("click", () => {
      const currentMs = Math.round(syncOffset * 1000);
      updateSyncOffset(currentMs + 10);
    });

    elements.metronomePlayBtn.addEventListener("click", () => {
      if (isStandaloneMetronomePlaying) {
        isStandaloneMetronomePlaying = false;
        elements.metronomePlayBtn.textContent = "▶ 메트로놈 단독재생";
        elements.metronomePlayBtn.classList.remove("active");
        if (timerWorker) timerWorker.postMessage("stop");
        visualDrawQueue = [];
      } else {
        initAudioContext();
        isStandaloneMetronomePlaying = true;
        standaloneMetronomeStartTime = audioContext.currentTime;
        nextStandaloneBeatContextTime = audioContext.currentTime;
        elements.metronomePlayBtn.textContent = "⏸ 단독정지";
        elements.metronomePlayBtn.classList.add("active");
        initTimerWorker();
        timerWorker.postMessage("start");
      }
    });

    elements.metronomeSyncTouchBtn.addEventListener("click", () => {
      if (isStandaloneMetronomePlaying) {
        standaloneMetronomeStartTime = performance.now();
        lastBeatIndex = -1;
      } else if (audio && !audio.paused && currentBpm > 0) {
        syncOffset = audio.currentTime - firstPeakTime;
        lastBeatIndex = -1;
        elements.syncOffsetDisplay.textContent = `${Math.round(syncOffset * 1000)}ms`;
      }
      
      elements.metronomeSyncTouchBtn.classList.add("active");
      setTimeout(() => elements.metronomeSyncTouchBtn.classList.remove("active"), 100);
    });

    elements.fetchPointerTimeBtn.addEventListener("click", () => {
      if (audio) {
        elements.metronomeStartTimeInput.value = audio.currentTime.toFixed(2);
        elements.metronomeAutoStartToggle.checked = true;
      }
    });

    elements.tapBtn.addEventListener("click", handleTap);

    elements.tapResetBtn.addEventListener("click", () => {
      tapTimes = [];
      elements.tapBpmValue.textContent = "--";
      elements.applyTapBpmBtn.disabled = true;
    });

    elements.applyTapBpmBtn.addEventListener("click", () => {
      const bpmStr = elements.tapBpmValue.textContent;
      const bpm = parseFloat(bpmStr);
      if (!isNaN(bpm) && bpm > 0) {
        updateMetronomeBpm(Math.round(bpm));
        if (callbacks.setStatus) {
          callbacks.setStatus(`수동 측정 BPM(${bpm.toFixed(1)})이 메트로놈에 반영되었습니다.`, "is-success");
        }
      }
    });

    // Spacebar keypress
    window.addEventListener("keydown", (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "SELECT" || activeEl.tagName === "TEXTAREA")) {
        return;
      }
      
      if (e.code === "Space" || e.keyCode === 32) {
        if (elements.playerContainer.classList.contains("hidden")) return;
        
        e.preventDefault();
        handleTap();
      }
    });

    elements.waveformCanvas.addEventListener("mousedown", (e) => {
      isDraggingPointer = true;
      seekToX(e.clientX);
    });

    window.addEventListener("mousemove", (e) => {
      if (isDraggingPointer) {
        seekToX(e.clientX);
      }
    });

    window.addEventListener("mouseup", () => {
      isDraggingPointer = false;
    });

    window.addEventListener("resize", () => {
      if (audioBuffer) {
        drawWaveform();
        updatePlayPointerOnce();
      }
    });
  }

  function cleanupPlayer() {
    if (playPointerId) {
      cancelAnimationFrame(playPointerId);
      playPointerId = null;
    }
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    audioBuffer = null;
    loopEnabled = false;
    loopStart = 0;
    loopEnd = 0;
    isDraggingPointer = false;
    isAutoStartTriggered = false;
    if (timerWorker) timerWorker.postMessage("stop");
    visualDrawQueue = [];
    disablePlayerButtons();
  }

  function disablePlayerButtons() {
    elements.playBtn.disabled = true;
    elements.pauseBtn.disabled = true;
    elements.stopBtn.disabled = true;
    elements.loopStartBtn.disabled = true;
    elements.loopEndBtn.disabled = true;
    elements.loopOffBtn.disabled = true;
    elements.loopStatusText.textContent = "Loop: Disabled";
    
    elements.speedInput.disabled = true;
    elements.speedMinusBtn.disabled = true;
    elements.speedPlusBtn.disabled = true;
    elements.speedPresets.forEach(btn => btn.disabled = true);
    
    elements.metronomeResetBtn.disabled = true;
    elements.enableMetronome.disabled = true;
    elements.enableVisualMetronome.disabled = true;
    elements.metronomeVolume.disabled = true;
    elements.metronomeBpmInput.disabled = true;
    elements.bpmMinusBtn.disabled = true;
    elements.bpmPlusBtn.disabled = true;
    elements.syncMinusBtn.disabled = true;
    elements.syncPlusBtn.disabled = true;
    elements.metronomePlayBtn.disabled = true;
    elements.metronomeSyncTouchBtn.disabled = true;
    elements.metronomeAutoStartToggle.disabled = true;
    elements.metronomeStartTimeInput.disabled = true;
    elements.fetchPointerTimeBtn.disabled = true;
    
    elements.tapBtn.disabled = true;
    elements.tapResetBtn.disabled = true;
    elements.applyTapBpmBtn.disabled = true;
  }

  function enablePlayerButtons() {
    elements.playBtn.disabled = false;
    elements.pauseBtn.disabled = false;
    elements.stopBtn.disabled = false;
    elements.loopStartBtn.disabled = false;
    elements.loopEndBtn.disabled = false;
    elements.loopOffBtn.disabled = false;
    
    elements.speedInput.disabled = false;
    elements.speedMinusBtn.disabled = false;
    elements.speedPlusBtn.disabled = false;
    elements.speedPresets.forEach(btn => btn.disabled = false);
    
    elements.metronomeResetBtn.disabled = false;
    elements.enableMetronome.disabled = false;
    elements.enableVisualMetronome.disabled = false;
    elements.metronomeVolume.disabled = false;
    elements.metronomeBpmInput.disabled = false;
    elements.bpmMinusBtn.disabled = false;
    elements.bpmPlusBtn.disabled = false;
    elements.syncMinusBtn.disabled = false;
    elements.syncPlusBtn.disabled = false;
    elements.metronomePlayBtn.disabled = false;
    elements.metronomeSyncTouchBtn.disabled = false;
    elements.metronomeAutoStartToggle.disabled = false;
    elements.metronomeStartTimeInput.disabled = false;
    elements.fetchPointerTimeBtn.disabled = false;
    
    elements.tapBtn.disabled = false;
    elements.tapResetBtn.disabled = false;
  }

  async function setupPlayer(file) {
    try {
      const objectURL = URL.createObjectURL(file);
      audio = new Audio(objectURL);
      
      // 오디오 이벤트 연결
      audio.addEventListener("ended", () => {
        if (!loopEnabled) {
          audio.currentTime = 0;
          if (playPointerId) {
            cancelAnimationFrame(playPointerId);
            playPointerId = null;
          }
          updatePlayPointerOnce();
        }
      });

      // 버퍼 디코딩하여 파형 추출
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const localAudioContext = new AudioContextClass();
      
      if (callbacks.setStatus) {
        callbacks.setStatus("오디오 파형 분석 중...", "");
      }
      
      audioBuffer = await localAudioContext.decodeAudioData(arrayBuffer);
      await localAudioContext.close();
      
      // UI 보이기 및 렌더링
      elements.playerContainer.classList.remove("hidden");
      enablePlayerButtons();
      drawWaveform();
      updatePlayPointerOnce();
      
      if (callbacks.setStatus) {
        callbacks.setStatus("오디오 로드 완료 (재생 대기)", "is-success");
      }
    } catch (err) {
      console.error("Setup player failed:", err);
      cleanupPlayer();
      if (callbacks.setStatus) {
        callbacks.setStatus("재생용 오디오 분석에 실패했습니다. (BPM 분석은 정상 진행 가능)", "is-error");
      }
    }
  }

  function drawWaveform() {
    if (!audioBuffer) return;
    const canvas = elements.waveformCanvas;
    const ctx = canvas.getContext("2d");
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 600;
    canvas.height = 80;
    
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    const rawData = audioBuffer.getChannelData(0); // Left channel
    const numPoints = Math.floor(width);
    const chunkSize = Math.floor(rawData.length / numPoints);
    
    if (chunkSize === 0) return;
    
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      let max = 0;
      const start = i * chunkSize;
      for (let j = 0; j < chunkSize; j++) {
        const val = Math.abs(rawData[start + j]);
        if (val > max) max = val;
      }
      points.push(max);
    }
    
    const maxVal = Math.max(...points);
    const normalizedPoints = maxVal > 0 ? points.map(p => p / maxVal) : points;
    
    // 1. Draw Beat Grid Background Overlay (if BPM analyzed)
    if (currentBpm > 0) {
      const duration = audioBuffer.duration;
      const beatDuration = 60 / currentBpm;
      
      // forward grids
      let t = firstPeakTime;
      let beatIdx = 0;
      while (t < duration) {
        const x = (t / duration) * width;
        if (beatIdx % 4 === 0) {
          ctx.strokeStyle = "rgba(157, 78, 221, 0.45)"; // Accent Purple for Downbeats (bar starts)
          ctx.lineWidth = 1.2;
        } else {
          ctx.strokeStyle = "rgba(0, 245, 212, 0.15)";  // Accent Cyan for normal beats
          ctx.lineWidth = 0.8;
        }
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        t += beatDuration;
        beatIdx++;
      }
      
      // backward grids
      t = firstPeakTime - beatDuration;
      beatIdx = -1;
      while (t >= 0) {
        const x = (t / duration) * width;
        if (Math.abs(beatIdx) % 4 === 0) {
          ctx.strokeStyle = "rgba(157, 78, 221, 0.45)";
          ctx.lineWidth = 1.2;
        } else {
          ctx.strokeStyle = "rgba(0, 245, 212, 0.15)";
          ctx.lineWidth = 0.8;
        }
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        t -= beatDuration;
        beatIdx--;
      }
    }
    
    // 2. Draw Waveform bars
    const midY = height / 2;
    const waveformColor = getComputedStyle(document.documentElement).getPropertyValue('--waveform-color').trim();
    ctx.strokeStyle = waveformColor || "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    for (let x = 0; x < normalizedPoints.length; x++) {
      const val = normalizedPoints[x];
      const lineH = val * (height * 0.8) / 2;
      
      ctx.moveTo(x, midY - lineH);
      ctx.lineTo(x, midY + lineH);
    }
    ctx.stroke();
  }

  function updatePlayPointerOnce() {
    if (!audio || !audioBuffer) return;
    const canvas = elements.waveformCanvas;
    const ctx = canvas.getContext("2d");
    
    drawWaveform();
    
    const width = canvas.width;
    const height = canvas.height;
    const duration = audio.duration || audioBuffer.duration || 0;
    const currentTime = audio.currentTime;
    
    if (elements.timeDisplay) {
      elements.timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
    
    const ratio = duration > 0 ? currentTime / duration : 0;
    const x = ratio * width;
    
    if (loopEnabled) {
      const loopStartRatio = loopStart / duration;
      const loopEndRatio = loopEnd / duration;
      
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(loopStartRatio * width, 0);
      ctx.lineTo(loopStartRatio * width, height);
      ctx.stroke();
      
      ctx.strokeStyle = "#3b82f6";
      ctx.beginPath();
      ctx.moveTo(loopEndRatio * width, 0);
      ctx.lineTo(loopEndRatio * width, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  function initAudioContext() {
    if (audioContext) return;
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    
    source = audioContext.createMediaElementSource(audio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    
    source.connect(analyser);
    analyser.connect(audioContext.destination);
  }

  function drawSpectrum() {
    if (!audio || audio.paused || !analyser) {
      visualizerId = null;
      return;
    }
    
    const canvas = elements.visualizerCanvas;
    const ctx = canvas.getContext("2d");
    const height = canvas.height;
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 600;
    const width = canvas.width;
    
    ctx.clearRect(0, 0, width, height);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    const barWidth = (width / bufferLength) * 1.5;
    let barHeight;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i];
      
      const percent = i / bufferLength;
      const r = Math.floor(0 + (157 * percent));
      const g = Math.floor(245 - (167 * percent));
      const b = Math.floor(212 + (9 * percent));
      
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
      
      const renderedH = (barHeight / 255) * height * 0.85;
      ctx.fillRect(x, height - renderedH, barWidth - 1, renderedH);
      
      x += barWidth;
    }
    
    visualizerId = requestAnimationFrame(drawSpectrum);
  }

  function playClickSoundAtTime(time, isDownbeat) {
    if (!audioContext) return;
    
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(isDownbeat ? 1000 : 750, time);
    
    const volume = parseFloat(elements.metronomeVolume.value) || 0.5;
    gainNode.gain.setValueAtTime(volume, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    
    osc.start(time);
    osc.stop(time + 0.05);
  }

  function initTimerWorker() {
    if (timerWorker) return;
    
    const workerCode = `
      let timerId = null;
      let interval = 25;
      self.onmessage = function(e) {
        if (e.data === "start") {
          if (timerId) clearInterval(timerId);
          timerId = setInterval(() => {
            self.postMessage("tick");
          }, interval);
        } else if (e.data === "stop") {
          if (timerId) {
            clearInterval(timerId);
            timerId = null;
          }
        }
      };
    `;
    
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerURL = URL.createObjectURL(blob);
    timerWorker = new Worker(workerURL);
    
    timerWorker.onmessage = function(e) {
      if (e.data === "tick") {
        scheduler();
      }
    };
  }

  function scheduler() {
    if (metronomeBpm <= 0) return;

    // 1. 단독 재생 모드 스케줄러
    if (isStandaloneMetronomePlaying) {
      const lookahead = 0.1;
      const beatDuration = 60 / metronomeBpm;
      const scheduleAheadLimit = audioContext.currentTime + lookahead;
      
      while (nextStandaloneBeatContextTime < scheduleAheadLimit) {
        const elapsed = nextStandaloneBeatContextTime - standaloneMetronomeStartTime;
        const beatIndex = Math.round(elapsed / beatDuration);
        const isDownbeat = (beatIndex % 4 === 0);
        
        if (elements.enableMetronome.checked) {
          playClickSoundAtTime(nextStandaloneBeatContextTime, isDownbeat);
        }
        if (elements.enableVisualMetronome.checked) {
          visualDrawQueue.push({ time: nextStandaloneBeatContextTime, isDownbeat });
        }
        
        nextStandaloneBeatContextTime += beatDuration;
      }
      return;
    }

    // 2. 오디오 연동 재생 모드 스케줄러
    if (!audio || audio.paused) return;

    let isAutoStartMuted = true;
    if (elements.metronomeAutoStartToggle.checked) {
      const autoStartTime = parseFloat(elements.metronomeStartTimeInput.value) || 0;
      if (audio.currentTime >= autoStartTime) {
        isAutoStartMuted = false;
      } else {
        isAutoStartMuted = true;
      }
    } else {
      isAutoStartMuted = true;
    }

    if (isAutoStartMuted) {
      const beatDuration = 60 / metronomeBpm;
      const baseStart = firstPeakTime + syncOffset;
      const elapsed = audio.currentTime - baseStart;
      if (elapsed < 0) {
        nextBeatTime = baseStart;
      } else {
        nextBeatTime = baseStart + Math.ceil(elapsed / beatDuration) * beatDuration;
      }
      return;
    }

    const lookahead = 0.1; // 100ms
    const rate = audio.playbackRate || 1.0;
    const beatDuration = 60 / metronomeBpm;
    const scheduleAheadLimit = audioContext.currentTime + lookahead;

    while (true) {
      const nextBeatContextTime = audioContext.currentTime + (nextBeatTime - audio.currentTime) / rate;
      
      if (nextBeatContextTime < scheduleAheadLimit) {
        const elapsedForBeat = nextBeatTime - (firstPeakTime + syncOffset);
        const beatIndex = Math.round(elapsedForBeat / beatDuration);
        const isDownbeat = (beatIndex % 4 === 0);
        
        if (elements.enableMetronome.checked) {
          playClickSoundAtTime(nextBeatContextTime, isDownbeat);
        }
        if (elements.enableVisualMetronome.checked) {
          visualDrawQueue.push({ time: nextBeatContextTime, isDownbeat });
        }
        
        nextBeatTime += beatDuration;
      } else {
        break;
      }
    }
  }

  function updatePlayPointerLoop() {
    if (!audio || audio.paused) {
      playPointerId = null;
      return;
    }
    
    if (loopEnabled && audio.currentTime >= loopEnd) {
      audio.currentTime = loopStart;
      
      // 루프 되감기 시 다음 스케줄링 비트 재계산
      const beatDuration = 60 / metronomeBpm;
      const baseStart = firstPeakTime + syncOffset;
      const elapsed = audio.currentTime - baseStart;
      if (elapsed < 0) {
        nextBeatTime = baseStart;
      } else {
        nextBeatTime = baseStart + Math.ceil(elapsed / beatDuration) * beatDuration;
      }
      visualDrawQueue = [];
    }
    
    // 자동 시작 UI 업데이트 트리거 (메인 스레드 반응성 유지)
    if (elements.metronomeAutoStartToggle.checked && !isStandaloneMetronomePlaying) {
      const autoStartTime = parseFloat(elements.metronomeStartTimeInput.value) || 0;
      if (audio.currentTime >= autoStartTime) {
        if (!isAutoStartTriggered) {
          elements.enableMetronome.checked = true;
          isAutoStartTriggered = true;
          if (callbacks.setStatus) {
            callbacks.setStatus("메트로놈이 지정된 시간에 도달하여 자동 시작되었습니다.", "is-success");
          }
        }
      } else {
        isAutoStartTriggered = false;
      }
    } else {
      isAutoStartTriggered = false;
    }

    // 비주얼 플래시 드로우 큐 렌더링
    while (visualDrawQueue.length > 0 && visualDrawQueue[0].time <= audioContext.currentTime) {
      const flashEvent = visualDrawQueue.shift();
      const isDownbeat = flashEvent.isDownbeat;
      
      elements.metronomeLamp.className = "metronome-light " + (isDownbeat ? "flash-strong" : "flash");
      document.body.classList.add(isDownbeat ? "screen-flash-strong" : "screen-flash");
      setTimeout(() => {
        elements.metronomeLamp.className = "metronome-light";
        document.body.classList.remove("screen-flash-strong", "screen-flash");
      }, 80);
    }
    
    updatePlayPointerOnce();
    playPointerId = requestAnimationFrame(updatePlayPointerLoop);
  }

  function playAudio() {
    if (!audio) return;
    
    try {
      initAudioContext();
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }
    } catch (err) {
      console.error("AudioContext failed to start:", err);
    }
    
    // 재생 시점 기준 다음 비트 타임 계산
    const beatDuration = 60 / metronomeBpm;
    const baseStart = firstPeakTime + syncOffset;
    const elapsed = audio.currentTime - baseStart;
    if (elapsed < 0) {
      nextBeatTime = baseStart;
    } else {
      nextBeatTime = baseStart + Math.ceil(elapsed / beatDuration) * beatDuration;
    }
    
    audio.play().then(() => {
      initTimerWorker();
      if (timerWorker) timerWorker.postMessage("start");
      
      if (!playPointerId) {
        playPointerId = requestAnimationFrame(updatePlayPointerLoop);
      }
      if (!visualizerId && analyser) {
        visualizerId = requestAnimationFrame(drawSpectrum);
      }
    }).catch(e => console.error("Play failed:", e));
  }

  function pauseAudio() {
    if (!audio) return;
    audio.pause();
    isAutoStartTriggered = false; 
    if (timerWorker) timerWorker.postMessage("stop");
    visualDrawQueue = [];
    if (playPointerId) {
      cancelAnimationFrame(playPointerId);
      playPointerId = null;
    }
    if (visualizerId) {
      cancelAnimationFrame(visualizerId);
      visualizerId = null;
    }
    elements.metronomeLamp.className = "metronome-light";
    updatePlayPointerOnce();
  }

  function stopAudio() {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    lastBeatIndex = -1; // 정지 시 인덱스 리셋
    isAutoStartTriggered = false; // 정지 시 자동시작 트리거 상태 해제
    if (playPointerId) {
      cancelAnimationFrame(playPointerId);
      playPointerId = null;
    }
    if (visualizerId) {
      cancelAnimationFrame(visualizerId);
      visualizerId = null;
    }
    elements.metronomeLamp.className = "metronome-light";
    
    const canvas = elements.visualizerCanvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    updatePlayPointerOnce();
  }

  function setLoopStart() {
    if (!audio) return;
    loopStart = audio.currentTime;
    if (loopEnabled && loopStart >= loopEnd) {
      loopEnd = audio.duration || audioBuffer.duration;
    }
    loopEnabled = true;
    updateLoopStatusText();
    updatePlayPointerOnce();
  }

  function setLoopEnd() {
    if (!audio) return;
    const current = audio.currentTime;
    if (current <= loopStart) {
      alert("루프 종료 지점은 시작 지점 이후여야 합니다.");
      return;
    }
    loopEnd = current;
    loopEnabled = true;
    updateLoopStatusText();
    updatePlayPointerOnce();
  }

  function disableLoop() {
    loopEnabled = false;
    updateLoopStatusText();
    updatePlayPointerOnce();
  }

  function updateLoopStatusText() {
    if (loopEnabled) {
      elements.loopStatusText.textContent = `Loop: Enabled (${loopStart.toFixed(2)}s ~ ${loopEnd.toFixed(2)}s)`;
    } else {
      elements.loopStatusText.textContent = "Loop: Disabled";
    }
  }

  function seekToX(clientX) {
    if (!audio || !audioBuffer) return;
    const canvas = elements.waveformCanvas;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const duration = audio.duration || audioBuffer.duration;
    
    const wasPlaying = !audio.paused;
    audio.currentTime = ratio * duration;
    
    // 재생 위치 변경 시 비트 매칭용 인덱스 초기화로 첫 박 씹힘 방지
    lastBeatIndex = -1;
    
    if (!wasPlaying) {
      updatePlayPointerOnce();
    }
  }

  function updatePlaybackRate(rate) {
    if (!audio) return;
    audio.playbackRate = rate;
    elements.speedInput.value = rate.toFixed(2);
    
    elements.speedPresets.forEach(btn => {
      const btnSpeed = parseFloat(btn.getAttribute("data-speed"));
      if (Math.abs(btnSpeed - rate) < 0.01) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  function updateMetronomeBpm(bpm) {
    if (bpm < MIN_BPM) bpm = MIN_BPM;
    if (bpm > MAX_BPM) bpm = MAX_BPM;
    metronomeBpm = bpm;
    elements.metronomeBpmInput.value = bpm;
    lastBeatIndex = -1;
  }

  function updateSyncOffset(offsetMs) {
    syncOffset = offsetMs / 1000.0;
    elements.syncOffsetDisplay.textContent = `${offsetMs > 0 ? '+' : ''}${offsetMs}ms`;
    lastBeatIndex = -1;
  }

  function handleTap() {
    const now = Date.now();
    
    tapTimes = tapTimes.filter(t => now - t < 5000);
    tapTimes.push(now);
    
    if (tapTimes.length < 2) {
      elements.tapBpmValue.textContent = "Tap...";
      elements.applyTapBpmBtn.disabled = true;
      return;
    }
    
    let sumIntervals = 0;
    for (let i = 1; i < tapTimes.length; i++) {
      sumIntervals += (tapTimes[i] - tapTimes[i - 1]);
    }
    const avgInterval = sumIntervals / (tapTimes.length - 1);
    const calculatedBpm = 60 / (avgInterval / 1000);
    
    if (calculatedBpm >= MIN_BPM && calculatedBpm <= MAX_BPM) {
      elements.tapBpmValue.textContent = calculatedBpm.toFixed(1);
      elements.applyTapBpmBtn.disabled = false;
    } else {
      elements.tapBpmValue.textContent = "Out of range";
      elements.applyTapBpmBtn.disabled = true;
    }
  }

  function setAnalyzedData(bpm, firstPeak) {
    analyzedBpm = bpm;
    currentBpm = bpm;
    metronomeBpm = Math.round(bpm);
    firstPeakTime = firstPeak || 0;
    
    elements.metronomeBpmInput.value = metronomeBpm;
    
    if (audioBuffer) {
      drawWaveform();
      updatePlayPointerOnce();
    }
  }

  function resetPlayerState() {
    elements.speedInput.value = "1.00";
    elements.speedPresets.forEach(btn => {
      if (btn.getAttribute("data-speed") === "1.0") {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
    elements.enableMetronome.checked = false;
    elements.enableVisualMetronome.checked = true;
    elements.metronomeAutoStartToggle.checked = true; // 리셋 시 기본 활성화
    elements.metronomeLamp.className = "metronome-light";
    elements.metronomeVolume.value = "0.5";
    elements.metronomeBpmInput.value = "120";
    elements.syncOffsetDisplay.textContent = "0ms";
    
    elements.tapBpmValue.textContent = "--";
    elements.applyTapBpmBtn.disabled = true;
    
    analyzedBpm = 0;
    currentBpm = 0;
    metronomeBpm = 120; // reset 시 120으로 원복
    firstPeakTime = 0;
    syncOffset = 0;
    tapTimes = [];
    lastBeatIndex = -1;
    isAutoStartTriggered = false;
    
    if (timerWorker) timerWorker.postMessage("stop");
    visualDrawQueue = [];
    nextBeatTime = 0;
    nextStandaloneBeatContextTime = 0;
    
    if (elements.timeDisplay) {
      elements.timeDisplay.textContent = "00:00 / 00:00";
    }
  }

  // Expose functionality to global namespace for non-module usage
  window.AudioPlayer = {
    initPlayer,
    setupPlayer,
    cleanupPlayer,
    drawWaveform,
    updatePlayPointerOnce,
    setAnalyzedData,
    resetPlayerState,
    getAudioBuffer,
    getCurrentBpm,
    getFirstPeakTime,
    getSyncOffset
  };
})();
