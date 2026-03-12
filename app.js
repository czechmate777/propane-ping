/* ═══════════════════════════════════════════════════
   PROPANE PING — Application Logic
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    home: $('#screen-home'),
    recording: $('#screen-recording'),
    result: $('#screen-result'),
    history: $('#screen-history'),
    debug: $('#screen-debug'),
  };

  const els = {
    themeToggle: $('#theme-toggle'),
    btnTakeReading: $('#btn-take-reading'),
    btnShowHistory: $('#btn-show-history'),
    btnCancelRecording: $('#btn-cancel-recording'),
    recordingLabel: $('.recording-label'),
    recordingHint: $('.recording-hint'),
    progressFill: $('.progress-fill'),
    progressText: $('#progress-text'),
    resultPercent: $('#result-percent'),
    resultLabel: $('#result-label'),
    resultFreq: $('#result-freq'),
    resultTankFill: $('#result-tank-fill'),
    heroTankFill: $('#tank-fill-hero'),
    noteInput: $('#note-input'),
    btnSaveResult: $('#btn-save-result'),
    btnDiscardResult: $('#btn-discard-result'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    btnClearHistory: $('#btn-clear-history'),
    btnBackHome: $('#btn-back-home'),
    confirmOverlay: $('#confirm-overlay'),
    confirmMessage: $('#confirm-message'),
    confirmYes: $('#confirm-yes'),
    confirmNo: $('#confirm-no'),
    btnDebugMode: $('#btn-debug-mode'),
    debugFreq: $('#debug-freq'),
    debugNote: $('#debug-note'),
    btnStopDebug: $('#btn-stop-debug'),
  };

  // ══════════════════════════════════════════════════
  //  THEME MANAGER
  // ══════════════════════════════════════════════════
  const ThemeManager = {
    KEY: 'propaneping-theme',

    init() {
      const saved = localStorage.getItem(this.KEY);
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
      }
      // else stays "auto" — respects prefers-color-scheme
      els.themeToggle.addEventListener('click', () => this.toggle());
    },

    isDark() {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    toggle() {
      const next = this.isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(this.KEY, next);
    },
  };

  // ══════════════════════════════════════════════════
  //  SCREEN NAVIGATION
  // ══════════════════════════════════════════════════
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    // Re-trigger animation
    screens[name].style.animation = 'none';
    // Force reflow
    void screens[name].offsetHeight;
    screens[name].style.animation = '';
  }

  // ══════════════════════════════════════════════════
  //  TANK LEVEL CALCULATOR
  // ══════════════════════════════════════════════════
  // Reference frequency table (Hz → level %)
  // Lower frequency = more liquid = fuller tank
  const REF_POINTS = [
    { hz: 1020, level: 100 },
    { hz: 1245, level: 0 },
  ];

  function hzToLevel(hz) {
    if (hz <= REF_POINTS[0].hz) return 100;
    if (hz >= REF_POINTS[REF_POINTS.length - 1].hz) return 0;
    for (let i = 0; i < REF_POINTS.length - 1; i++) {
      const a = REF_POINTS[i];
      const b = REF_POINTS[i + 1];
      if (hz >= a.hz && hz <= b.hz) {
        const t = (hz - a.hz) / (b.hz - a.hz);
        return Math.round(a.level + t * (b.level - a.level));
      }
    }
    return 0;
  }

  function levelLabel(pct) {
    if (pct >= 88) return 'Full';
    if (pct >= 63) return 'Three-Quarter';
    if (pct >= 38) return 'Half';
    if (pct >= 13) return 'Quarter';
    return 'Empty';
  }

  // ══════════════════════════════════════════════════
  //  AUDIO RECORDER & FREQUENCY ANALYZER
  // ══════════════════════════════════════════════════
  let audioCtx = null;
  let mediaStream = null;
  let analyser = null;
  let recordingActive = false;
  let recordingTimer = null;

  async function startRecording() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('Microphone access is required.\nPlease allow microphone permission and try again.');
      showScreen('home');
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    recordingActive = true;
    showScreen('recording');

    els.recordingLabel.textContent = 'Get ready...';
    els.recordingHint.textContent = 'Starting in 3';
    
    // Reset progress to 0 initially
    els.progressFill.style.width = '0%';
    els.progressText.textContent = '0%';

    let countdown = 3;
    recordingTimer = setInterval(() => {
      if (!recordingActive) return;
      countdown--;
      
      if (countdown > 0) {
        els.recordingHint.textContent = `Starting in ${countdown}`;
      } else {
        clearInterval(recordingTimer);
        
        // Start actual sampling
        els.recordingLabel.textContent = 'Listening…';
        els.recordingHint.textContent = 'Tap the side of your tank now';
        
        const DURATION_MS = 3000;
        const SAMPLE_INTERVAL = 100;
        const samples = [];
        let elapsed = 0;

        recordingTimer = setInterval(() => {
          if (!recordingActive) return;
          elapsed += SAMPLE_INTERVAL;

          // Update progress
          const pct = Math.min(100, Math.round((elapsed / DURATION_MS) * 100));
          els.progressFill.style.width = pct + '%';
          els.progressText.textContent = pct + '%';

          // Sample dominant frequency
          const freq = getDominantFrequency();
          if (freq > 0) samples.push(freq);

          if (elapsed >= DURATION_MS) {
            stopRecording();
            const avgHz = samples.length
              ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
              : 0;
            showResult(avgHz);
          }
        }, SAMPLE_INTERVAL);
      }
    }, 1000);
  }

  function getDominantFrequency() {
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    let maxVal = 0;
    let maxIdx = 0;
    // Skip first few bins (very low noise)
    for (let i = 4; i < bufLen; i++) {
      if (data[i] > maxVal) {
        maxVal = data[i];
        maxIdx = i;
      }
    }

    if (maxVal < 20) return 0; // silence threshold
    const nyquist = audioCtx.sampleRate / 2;
    return (maxIdx / bufLen) * nyquist;
  }

  // ══════════════════════════════════════════════════
  //  DEBUG MODE (Continuous Sampling)
  // ══════════════════════════════════════════════════
  let debugTimer = null;
  const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function getNoteFromFreq(freq) {
    if (freq === 0) return "--";
    // A4 = 440Hz -> MIDI note 69
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
    const roundedNoteNum = Math.round(noteNum);
    const octave = Math.floor(roundedNoteNum / 12) - 1;
    const noteName = NOTE_STRINGS[roundedNoteNum % 12];
    
    // Calculate cents off
    const expectedFreq = 440 * Math.pow(2, (roundedNoteNum - 69) / 12);
    const cents = Math.round(1200 * Math.log(freq / expectedFreq) / Math.log(2));
    const centsStr = cents > 0 ? `+${cents}` : cents;

    return `${noteName}${octave} (${centsStr}c)`;
  }

  async function startDebugMode() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert('Microphone access is required for debug mode.');
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096; // Higher resolution for debug
    source.connect(analyser);

    recordingActive = true;
    showScreen('debug'); // We will add a debug screen in HTML later or handle UI differently
    
    // We'll track the last valid reading to hold it briefly, making the UI less erratic
    let lastValidFreq = 0;
    let holdTimeout = null;

    debugTimer = setInterval(() => {
      if (!recordingActive) return;
      
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);

      let maxVal = 0;
      let maxIdx = 0;
      for (let i = 4; i < bufLen; i++) {
        if (data[i] > maxVal) {
          maxVal = data[i];
          maxIdx = i;
        }
      }

      // Slightly stricter threshold for debug mode so background noise doesn't register
      const nyquist = audioCtx.sampleRate / 2;
      const freq = (maxVal > 30) ? (maxIdx / bufLen) * nyquist : 0;

      if (freq > 0) {
        lastValidFreq = freq;
        if (holdTimeout) clearTimeout(holdTimeout);
        holdTimeout = setTimeout(() => { lastValidFreq = 0; }, 2000); // Hold reading for 2s
      }

      const displayFreq = (freq > 0) ? freq : lastValidFreq;
      const note = getNoteFromFreq(displayFreq);
      
      els.debugFreq.textContent = displayFreq > 0 ? `${Math.round(displayFreq)} Hz` : '-- Hz';
      els.debugNote.textContent = note;
      
    }, 50);
  }

  function stopDebugMode() {
    recordingActive = false;
    if (debugTimer) clearInterval(debugTimer);
    debugTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => { });
      audioCtx = null;
    }
  }

  function stopRecording() {
    recordingActive = false;
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => { });
      audioCtx = null;
    }
    // Reset progress
    els.progressFill.style.width = '0%';
    els.progressText.textContent = '0%';
  }

  // ══════════════════════════════════════════════════
  //  RESULT DISPLAY
  // ══════════════════════════════════════════════════
  let pendingResult = null;

  function showResult(avgHz) {
    const level = hzToLevel(avgHz);
    const label = levelLabel(level);

    pendingResult = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      frequency: avgHz,
      level,
      note: '',
    };

    // Animate tank fill
    const fillOffset = 100 - level; // translateY percentage
    els.resultTankFill.style.transform = `translateY(${fillOffset}%)`;

    els.resultPercent.textContent = level + '%';
    els.resultLabel.textContent = label;
    els.resultFreq.textContent = avgHz > 0 ? `~${avgHz} Hz detected` : 'No clear frequency detected';

    els.noteInput.value = '';
    showScreen('result');
    // Auto-focus note input after animation
    setTimeout(() => els.noteInput.focus(), 400);
  }

  // ══════════════════════════════════════════════════
  //  HISTORY MANAGER (localStorage)
  // ══════════════════════════════════════════════════
  const STORAGE_KEY = 'propaneping-readings';

  function loadReadings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveReadings(readings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
  }

  function addReading(reading) {
    const readings = loadReadings();
    readings.unshift(reading);
    saveReadings(readings);
  }

  function updateNote(id, note) {
    const readings = loadReadings();
    const r = readings.find((r) => r.id === id);
    if (r) {
      r.note = note;
      saveReadings(readings);
    }
  }

  function deleteReading(id) {
    const readings = loadReadings().filter((r) => r.id !== id);
    saveReadings(readings);
    renderHistory();
  }

  function clearAllReadings() {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderHistory() {
    const readings = loadReadings();
    els.historyList.innerHTML = '';
    els.historyEmpty.style.display = readings.length ? 'none' : 'block';

    readings.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'history-card';
      card.style.animationDelay = `${i * 0.05}s`;

      const fillOffset = 100 - r.level;
      card.innerHTML = `
        <div class="history-tank-mini">
          <svg viewBox="0 0 120 180" fill="none">
            <rect x="42" y="4" width="36" height="16" rx="5" stroke="currentColor" stroke-width="3"/>
            <path d="M20 40a18 18 0 0 1 18-18h44a18 18 0 0 1 18 18v100a22 22 0 0 1-22 22H42a22 22 0 0 1-22-22V40Z"
                  stroke="currentColor" stroke-width="3"/>
            <clipPath id="hist-clip-${r.id}">
              <path d="M22 40a16 16 0 0 1 16-16h44a16 16 0 0 1 16 16v100a20 20 0 0 1-20 20H42a20 20 0 0 1-20-20V40Z"/>
            </clipPath>
            <g clip-path="url(#hist-clip-${r.id})">
              <rect x="20" y="24" width="80" height="140"
                    class="tank-fill" style="transform: translateY(${fillOffset}%)"/>
            </g>
            <rect x="38" y="161" width="8" height="8" rx="3" fill="currentColor"/>
            <rect x="74" y="161" width="8" height="8" rx="3" fill="currentColor"/>
          </svg>
        </div>
        <div class="history-top">
          <span class="history-level">${r.level}%</span>
          <span class="history-date">${formatDate(r.timestamp)}</span>
        </div>
        <div class="history-note-row">
          <input class="history-note" type="text" value="${escapeHtml(r.note)}" placeholder="Add note…"
                 data-id="${r.id}" maxlength="80" autocomplete="off">
          <button class="history-delete" data-id="${r.id}" aria-label="Delete reading" title="Delete reading">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      `;

      // Note editing
      const noteInput = card.querySelector('.history-note');
      noteInput.addEventListener('blur', () => updateNote(r.id, noteInput.value.trim()));
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') noteInput.blur();
      });

      // Delete button
      card.querySelector('.history-delete').addEventListener('click', () => {
        deleteReading(r.id);
      });

      els.historyList.appendChild(card);
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ══════════════════════════════════════════════════
  //  CONFIRM DIALOG
  // ══════════════════════════════════════════════════
  function showConfirm(message) {
    return new Promise((resolve) => {
      els.confirmMessage.textContent = message;
      els.confirmOverlay.classList.remove('hidden');
      const yes = () => { cleanup(); resolve(true); };
      const no = () => { cleanup(); resolve(false); };
      const cleanup = () => {
        els.confirmOverlay.classList.add('hidden');
        els.confirmYes.removeEventListener('click', yes);
        els.confirmNo.removeEventListener('click', no);
      };
      els.confirmYes.addEventListener('click', yes);
      els.confirmNo.addEventListener('click', no);
    });
  }

  // ══════════════════════════════════════════════════
  //  HERO TANK IDLE ANIMATION
  // ══════════════════════════════════════════════════
  function animateHeroTank() {
    const levels = [60, 45, 70, 35, 55];
    let idx = 0;
    function next() {
      if (screens.home.classList.contains('active')) {
        els.heroTankFill.style.transform = `translateY(${levels[idx]}%)`;
        idx = (idx + 1) % levels.length;
      }
    }
    next();
    setInterval(next, 3000);
  }

  // ══════════════════════════════════════════════════
  //  EVENT WIRING
  // ══════════════════════════════════════════════════
  function init() {
    ThemeManager.init();
    animateHeroTank();

    // Home
    els.btnTakeReading.addEventListener('click', () => startRecording());
    els.btnShowHistory.addEventListener('click', () => {
      renderHistory();
      showScreen('history');
    });

    // Recording
    els.btnCancelRecording.addEventListener('click', () => {
      stopRecording();
      showScreen('home');
    });

    // Debug Mode
    if(els.btnDebugMode) els.btnDebugMode.addEventListener('click', () => startDebugMode());
    if(els.btnStopDebug) els.btnStopDebug.addEventListener('click', () => {
      stopDebugMode();
      showScreen('home');
    });

    // Result
    els.btnSaveResult.addEventListener('click', () => {
      if (pendingResult) {
        pendingResult.note = els.noteInput.value.trim();
        addReading(pendingResult);
        pendingResult = null;
      }
      showScreen('home');
    });
    els.btnDiscardResult.addEventListener('click', () => {
      pendingResult = null;
      showScreen('home');
    });

    // History
    els.btnBackHome.addEventListener('click', () => showScreen('home'));
    els.btnClearHistory.addEventListener('click', async () => {
      const ok = await showConfirm('Clear all readings? This cannot be undone.');
      if (ok) {
        clearAllReadings();
      }
    });
  }

  // Go!
  init();
})();
