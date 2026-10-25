import { createLiveCoach } from './live-coach.js';
import { mountOrbDragging } from './orb-position.js';
import { mountCoachOrb } from './coach-orb.js';
import {
  ASSISTANT_GREETING,
  ASSISTANT_GREETING_STEPS,
  ASSISTANT_ACTION_WORDS,
  singleSentenceText,
  matchAssistantIntent,
  createAssistantCommandRunner,
  commandResultText
} from '../lib/assistant-command.js';

let active = null;

function buildActionWords() {
  return ASSISTANT_ACTION_WORDS.slice(0, 4).map(item => ({ ...item }));
}

export function mountMapAssistant(ctx = {}) {
  active?.dispose();
  if (!document?.body) return null;

  const identity = ctx?.rep?.user_id || null;
  const actionWords = buildActionWords(ctx);

  const wordButtonsHtml = actionWords.map((item, idx) => {
    const argsJson = JSON.stringify(item.args || {}).replace(/"/g, '&quot;');
    return `<button type="button" class="mapAssistantWord" data-action-word="${item.id}" data-command="${item.command}" data-args="${argsJson}" data-step="${item.step}" data-tone="${item.tone || 'glass'}" data-revealed="false" style="--word-index:${idx}">` +
      `<span class="mapAssistantWordDot" aria-hidden="true"></span>` +
      `<span class="mapAssistantWordLabel">${item.label}</span>` +
      `</button>`;
  }).join('');

  const root = document.createElement('aside');
  root.id = 'tnMapAssistant';
  root.className = 'mapAssistant mapAssistantRoot';
  root.dataset.state = 'idle';
  root.setAttribute('aria-label', 'True North voice assistant');
  root.innerHTML =
    `<div id="tnMapAssistantHud" class="mapAssistantHud" hidden>` +
      `<p class="mapAssistantWhisper" data-whisper data-whisper-text data-caption data-result role="status" aria-live="polite">${ASSISTANT_GREETING}</p>` +
      `<div class="mapAssistantWords" role="group" aria-label="Assistant actions">${wordButtonsHtml}</div>` +
    `</div>` +
    `<button class="mapAssistantLauncher tnCoachOrbStage" type="button" aria-label="Tap to start field assistant" aria-expanded="false" aria-controls="tnMapAssistantHud" data-voice-state="idle">` +
      `<canvas aria-hidden="true"></canvas>` +
      `<span class="mapAssistantOrbFallback" aria-hidden="true">◉</span>` +
      `<span class="mapAssistantLiveDot" aria-hidden="true"></span>` +
      `<span class="mapAssistantTapHint" data-tap-hint>Tap to start</span>` +
    `</button>`;

  document.body.append(root);

  let css = document.querySelector('[data-map-assistant-css]');
  if (!css) {
    css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/tn-files/map-assistant.css';
    css.dataset.mapAssistantCss = '1';
    document.head.append(css);
  }

  const hud = root.querySelector('#tnMapAssistantHud');
  const launch = root.querySelector('.mapAssistantLauncher');
  const whisper = root.querySelector('[data-whisper-text]');
  const tapHint = root.querySelector('[data-tap-hint]');
  const wordButtons = [...root.querySelectorAll('.mapAssistantWord')];

  let voiceState = 'idle', disposed = false, recognition = null, greetingTimers = [];
  const controller = new AbortController();
  const orb = mountCoachOrb(root.querySelector('canvas'));
  const disposeDragging = mountOrbDragging(root, launch, hud);

  function clearGreetingTimers() {
    while (greetingTimers.length) clearTimeout(greetingTimers.pop());
  }

  function setSentence(rawText, { tone = 'default', stepIndex = null } = {}) {
    if (disposed || !whisper) return;
    const sentence = singleSentenceText(rawText);
    if (!sentence) return;
    whisper.dataset.result = tone === 'error' ? 'error' : tone === 'result' ? 'success' : 'caption';
    whisper.classList.toggle('isError', tone === 'error');
    whisper.classList.toggle('isResult', tone === 'result');
    if (stepIndex !== null) whisper.dataset.step = String(stepIndex);
    if (whisper.textContent !== sentence) {
      whisper.classList.remove('isSettling');
      void whisper.offsetWidth;
      whisper.textContent = sentence;
      whisper.classList.add('isSettling');
    }
    disposeDragging.reposition?.();
  }

  function revealWordsUpTo(step) {
    for (const btn of wordButtons) {
      const reveal = Number(btn.dataset.step || 2) <= step;
      btn.dataset.revealed = reveal ? 'true' : 'false';
      btn.classList.toggle('isRevealed', reveal);
    }
    disposeDragging.reposition?.();
  }

  function hideAllWords() {
    for (const btn of wordButtons) {
      btn.dataset.revealed = 'false';
      btn.classList.remove('isRevealed', 'isRunning');
    }
  }

  function syncOrbState(state, energy = 0) {
    if (disposed) return;
    root.dataset.state = state;
    launch.dataset.voiceState = state;
    orb.setState(state);
    if (energy > 0) orb.setLevels({ input: 0, output: energy });
  }

  function startGreetingCadence() {
    clearGreetingTimers();
    hideAllWords();
    for (const step of ASSISTANT_GREETING_STEPS) {
      const applyStep = () => {
        if (disposed || hud.hidden || root.dataset.commandBusy) return;
        setSentence(step.text, { tone: 'default', stepIndex: step.revealStep });
        revealWordsUpTo(step.revealStep);
        if (step.energy > 0) {
          syncOrbState('speaking', step.energy);
        } else {
          orb.setLevels({ input: 0, output: 0 });
          syncOrbState(voiceState === 'idle' ? 'listening' : voiceState, 0);
        }
      };
      if (step.atMs === 0) applyStep();
      else greetingTimers.push(setTimeout(applyStep, step.atMs));
    }
  }

  function startSpeechFallback() {
    const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRec || recognition || disposed || hud.hidden) return;
    try {
      recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onresult = event => {
        if (disposed || hud.hidden) return;
        const latest = event.results?.[event.results.length - 1];
        const transcript = String(latest?.[0]?.transcript || '').trim();
        if (!transcript) return;
        setSentence(transcript, { tone: 'default' });
        if (latest.isFinal) {
          const matched = matchAssistantIntent(transcript);
          if (matched) run(matched).catch(() => {});
        }
      };
      recognition.onerror = () => {};
      recognition.onend = () => { recognition = null; };
      recognition.start();
    } catch {
      recognition = null;
    }
  }

  function stopSpeechFallback() {
    if (!recognition) return;
    try { recognition.stop(); } catch {}
    recognition = null;
  }

  async function refreshContext() {
    if (!ctx?.getMapContext) return;
    try {
      const context = await ctx.getMapContext();
      if (disposed) return;
      hud.dataset.mapReady = String(context.mapOpen !== false && context.ready !== false);
    } catch {}
  }

  function show(open, { startVoice = false } = {}) {
    hud.hidden = !open;
    root.classList.toggle('isActive', open);
    launch.setAttribute('aria-expanded', String(open));
    launch.setAttribute('aria-label', open ? 'Voice assistant active. Tap orb to stop.' : 'Tap to start field assistant');
    if (tapHint) tapHint.textContent = open ? 'Listening' : 'Tap to start';
    disposeDragging.reposition?.();
    if (open) {
      refreshContext();
      startGreetingCadence();
      if (startVoice && ctx?.sb && identity && ['idle', 'error'].includes(voiceState)) {
        voice.start().catch(() => startSpeechFallback());
      } else if (startVoice) {
        startSpeechFallback();
      }
    } else {
      clearGreetingTimers();
      stopSpeechFallback();
      hideAllWords();
      orb.setLevels({ input: 0, output: 0 });
      syncOrbState('idle', 0);
    }
  }

  const run = createAssistantCommandRunner({
    isCurrent: () => !disposed && !controller.signal.aborted,
    getContext: () => ctx.getMapContext(),
    async authorize(call, { signal }) {
      if (!ctx?.sb || !identity) throw Error('Sign in to use the True North assistant.');
      const session = await ctx.sb.auth.getSession();
      if (!session.data?.session || session.data.session.user.id !== identity) throw Error('Account changed. Restart the assistant.');
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.data.session.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: 'map', toolCall: call }),
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(20000)])
      });
      const data = await response.json();
      const current = await ctx.sb.auth.getSession();
      if (current.data?.session?.user?.id !== identity) throw Error('Account changed.');
      if (!response.ok) throw Error(data.error || 'Command denied.');
      if (data.authorized && data.actorId !== identity) throw Error('Command authorization failed.');
      return data;
    },
    execute: (name, args) => ctx.executeMapAction(name, args),
    onStart(call) {
      clearGreetingTimers();
      revealWordsUpTo(99);
      root.dataset.commandBusy = 'true';
      syncOrbState('working', 0.35);
      const label = call.name === 'clear_route'
        ? 'Clearing your route…'
        : call.name.startsWith('build_')
          ? 'Building your route…'
          : `Running ${call.name.replace(/_/g, ' ')}…`;
      setSentence(label, { tone: 'default' });
      for (const btn of wordButtons) {
        btn.disabled = true;
        btn.classList.toggle('isRunning', btn.dataset.command === call.name);
      }
    },
    onResult(_call, result) {
      if (disposed) return;
      delete root.dataset.commandBusy;
      syncOrbState(voiceState === 'idle' ? 'listening' : voiceState, 0);
      for (const btn of wordButtons) {
        btn.disabled = controller.signal.aborted;
        btn.classList.remove('isRunning');
      }
      setSentence(commandResultText(result), { tone: result?.error ? 'error' : 'result' });
      if (result?.error && hud.hidden) show(true);
      else refreshContext();
    }
  });

  const voice = createLiveCoach(ctx, {
    workspace: 'map',
    executeMapTool: run,
    onState(value) {
      voiceState = value;
      if (!root.dataset.commandBusy && !hud.hidden) {
        syncOrbState(value === 'idle' ? 'listening' : value, 0);
      }
    },
    onTranscript(row) {
      if (!row?.text || hud.hidden) return;
      clearGreetingTimers();
      revealWordsUpTo(99);
      setSentence(row.text, { tone: 'default' });
      if (row.role === 'user') {
        const matched = matchAssistantIntent(row.text);
        if (matched) run(matched).catch(() => {});
      }
    },
    onAudioLevel: levels => orb.setLevels(levels),
    onError() {
      if (disposed) return;
      voiceState = 'error';
      if (!hud.hidden) startSpeechFallback();
    }
  });

  launch.onclick = () => {
    if (hud.hidden) {
      show(true, { startVoice: true });
    } else {
      voice.stop();
      show(false);
    }
  };

  for (const button of wordButtons) {
    button.onclick = event => {
      event.stopPropagation();
      clearGreetingTimers();
      revealWordsUpTo(99);
      if (!ctx?.sb || !identity) {
        setSentence('Sign in to run assistant actions.', { tone: 'error' });
        return;
      }
      let args = {};
      try { args = JSON.parse(button.dataset.args || '{}'); } catch {}
      if (button.dataset.command === 'build_timed_route' && !args.minutes) args = { minutes: 120 };
      run({ name: button.dataset.command, args }).catch(() => {});
    };
  }

  const completed = event => {
    if (disposed) return;
    if (hud.hidden) show(true, { startVoice: false });
    clearGreetingTimers();
    revealWordsUpTo(99);
    setSentence(commandResultText(event.detail), { tone: event.detail?.error ? 'error' : 'result' });
  };
  document.addEventListener('tn-assistant-command-result', completed);

  const auth = ctx?.sb?.auth?.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== identity)) dispose();
  })?.data?.subscription;

  const feature = event => {
    if (event.detail?.coach === false || event.detail?.map === false) {
      voice.stop();
      controller.abort();
      for (const btn of wordButtons) btn.disabled = true;
    } else if (event.detail?.coach === true && controller.signal.aborted && !disposed) {
      mountMapAssistant(ctx);
    }
  };
  document.addEventListener('tn-feature-access', feature);

  function runSpokenText(text) {
    const matched = matchAssistantIntent(text);
    if (!matched) return Promise.resolve(null);
    return run(matched);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearGreetingTimers();
    stopSpeechFallback();
    controller.abort();
    voice.stop();
    disposeDragging();
    orb.dispose();
    auth?.unsubscribe();
    document.removeEventListener('tn-feature-access', feature);
    document.removeEventListener('tn-assistant-command-result', completed);
    root.remove();
    if (active === instance) active = null;
  }

  const instance = { root, dispose, runCommand: run, runSpokenText, matchIntent: matchAssistantIntent };
  active = instance;
  return instance;
}
