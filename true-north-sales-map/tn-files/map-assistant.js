import { createLiveCoach } from './live-coach.js';
import { mountOrbDragging } from './orb-position.js';
import { mountCoachOrb } from './coach-orb.js';
import {
  ASSISTANT_GREETING,
  ASSISTANT_GREETING_STEPS,
  ASSISTANT_ACTION_WORDS,
  matchAssistantIntent,
  createAssistantCommandRunner,
  commandResultText
} from '../lib/assistant-command.js';

let active = null;

function buildActionWords(ctx) {
  const words = ASSISTANT_ACTION_WORDS.map(item => ({ ...item }));
  const onMap = typeof location === 'undefined' || ['/', '/index', '/index.html'].includes(location.pathname);
  if (!onMap) {
    words.unshift({ id: 'open_map', label: 'Field map', command: 'navigate_app', args: { target: 'map' }, step: 1, tone: 'primary' });
  }
  const role = String(ctx?.rep?.role || '').toLowerCase();
  if (['admin', 'manager', 'owner'].includes(role)) {
    words.push({ id: 'open_admin', label: 'Open admin', command: 'navigate_app', args: { target: 'admin' }, step: 4, tone: 'glass' });
  } else {
    words.push({ id: 'open_setter', label: 'Open setter', command: 'navigate_app', args: { target: 'setter' }, step: 4, tone: 'glass' });
  }
  return words;
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
    `<section id="tnMapAssistantHud" class="mapAssistantHud" hidden aria-label="Field assistant controls" aria-live="polite">` +
      `<div class="mapAssistantWhisper" data-whisper>` +
        `<div class="mapAssistantWhisperTop">` +
          `<span class="mapAssistantBadge" data-status-pill data-state="idle">` +
            `<span class="mapAssistantPulseDot" aria-hidden="true"></span>` +
            `<span data-status role="status">Ready when you are.</span>` +
          `</span>` +
          `<div class="mapAssistantWhisperControls">` +
            `<button type="button" class="mapAssistantMicroBtn" data-pause hidden>Pause mic</button>` +
            `<button type="button" class="mapAssistantMicroBtn" data-end hidden>End voice</button>` +
            `<button type="button" class="mapAssistantMicroBtn" data-close aria-label="Minimize assistant" title="Close assistant">×</button>` +
          `</div>` +
        `</div>` +
        `<p data-caption class="mapAssistantCaption">${ASSISTANT_GREETING}</p>` +
        `<div data-result class="mapAssistantResult" role="status" aria-live="polite" hidden></div>` +
      `</div>` +
      `<div class="mapAssistantWords" role="group" aria-label="Assistant action words">${wordButtonsHtml}</div>` +
    `</section>` +
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
  const status = root.querySelector('[data-status]');
  const statusPill = root.querySelector('[data-status-pill]');
  const caption = root.querySelector('[data-caption]');
  const resultNode = root.querySelector('[data-result]');
  const pause = root.querySelector('[data-pause]');
  const end = root.querySelector('[data-end]');
  const tapHint = root.querySelector('[data-tap-hint]');
  const wordButtons = [...root.querySelectorAll('.mapAssistantWord')];

  let voiceState = 'idle', paused = false, disposed = false, greetingTimers = [];
  const controller = new AbortController();
  const orb = mountCoachOrb(root.querySelector('canvas'));
  const disposeDragging = mountOrbDragging(root, launch, hud);

  function clearGreetingTimers() {
    while (greetingTimers.length) clearTimeout(greetingTimers.pop());
  }

  function revealWordsUpTo(step) {
    for (const btn of wordButtons) {
      if (Number(btn.dataset.step || 1) <= step) {
        btn.dataset.revealed = 'true';
        btn.classList.add('isRevealed');
      }
    }
    disposeDragging.reposition?.();
  }

  function hideAllWords() {
    for (const btn of wordButtons) {
      btn.dataset.revealed = 'false';
      btn.classList.remove('isRevealed', 'isRunning');
    }
  }

  function voiceStatus() {
    if (statusPill) statusPill.dataset.state = voiceState;
    root.dataset.state = voiceState;
    launch.dataset.voiceState = voiceState;
    status.textContent = ({
      idle: identity ? 'Tap an action word or speak.' : 'Sign in to run assistant actions.',
      connecting: 'Listening · connecting voice…',
      listening: 'Listening · speak or tap an action.',
      speaking: 'Speaking · tap any action word.',
      paused: 'Microphone paused.',
      working: 'Running command…',
      error: identity ? 'Tap an action word below.' : 'Sign in to run assistant actions.'
    })[voiceState] || voiceState;
  }

  function startGreetingCadence() {
    clearGreetingTimers();
    hideAllWords();
    caption.hidden = false;
    for (const step of ASSISTANT_GREETING_STEPS) {
      const applyStep = () => {
        if (disposed || hud.hidden) return;
        caption.textContent = step.text;
        revealWordsUpTo(step.revealStep);
        if (step.energy > 0) {
          if (statusPill) statusPill.dataset.state = 'speaking';
          if (!root.dataset.commandBusy && voiceState === 'idle') {
            status.textContent = 'Speaking · introducing actions…';
          }
          orb.setState('speaking');
          orb.setLevels({ input: 0, output: step.energy });
        } else {
          orb.setLevels({ input: 0, output: 0 });
          if (!root.dataset.commandBusy) {
            orb.setState(voiceState === 'idle' ? 'listening' : voiceState);
            voiceStatus();
          }
        }
      };
      if (step.atMs === 0) applyStep();
      else greetingTimers.push(setTimeout(applyStep, step.atMs));
    }
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
    if (tapHint) tapHint.textContent = open ? 'Listening' : 'Tap to start';
    disposeDragging.reposition?.();
    if (open) {
      refreshContext();
      startGreetingCadence();
      if (startVoice && ctx?.sb && identity && ['idle', 'error'].includes(voiceState)) {
        paused = false;
        pause.textContent = 'Pause mic';
        voice.start().catch(() => {});
      }
    } else {
      clearGreetingTimers();
      hideAllWords();
      orb.setLevels({ input: 0, output: 0 });
      orb.setState('idle');
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
      revealWordsUpTo(99);
      root.dataset.commandBusy = 'true';
      orb.setState('working');
      if (statusPill) statusPill.dataset.state = 'working';
      status.textContent = call.name === 'clear_route' ? 'Clearing route…' : call.name.startsWith('build_') ? 'Building your route…' : `Running ${call.name.replace(/_/g, ' ')}…`;
      for (const btn of wordButtons) {
        btn.disabled = true;
        btn.classList.toggle('isRunning', btn.dataset.command === call.name);
      }
    },
    onResult(call, result) {
      if (disposed) return;
      delete root.dataset.commandBusy;
      orb.setState(voiceState === 'idle' ? 'listening' : voiceState);
      voiceStatus();
      for (const btn of wordButtons) {
        btn.disabled = controller.signal.aborted;
        btn.classList.remove('isRunning');
      }
      resultNode.hidden = false;
      resultNode.dataset.result = result.error ? 'error' : 'success';
      resultNode.classList.toggle('isError', Boolean(result.error));
      resultNode.textContent = commandResultText(result);
      if (call.name === 'recent_ohio_storms' && Array.isArray(result.reports)) {
        for (const report of result.reports.slice(0, 6)) {
          const row = document.createElement('p'), link = document.createElement('a');
          try {
            const source = new URL(report.source);
            if (source.protocol !== 'https:') continue;
            link.href = source.href;
          } catch { continue; }
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = `${report.county || 'Ohio'} · ${report.kind} · ${new Date(report.capturedAt).toLocaleString()}`;
          row.append(link);
          resultNode.append(row);
        }
      }
      disposeDragging.reposition?.();
      if (result.error) show(true);
      else refreshContext();
    }
  });

  const voice = createLiveCoach(ctx, {
    workspace: 'map',
    executeMapTool: run,
    onState(value) {
      voiceState = value;
      if (!root.dataset.commandBusy) {
        orb.setState(value);
        voiceStatus();
      }
      const live = !['idle', 'error'].includes(value);
      pause.hidden = !live;
      end.hidden = !live;
      launch.setAttribute('aria-label', live ? 'Voice assistant active. Tap to end.' : 'Tap to start field assistant');
    },
    onTranscript(row) {
      if (!row?.text) return;
      caption.hidden = false;
      caption.textContent = (row.role === 'user' ? 'You: ' : '') + row.text.slice(-240);
      disposeDragging.reposition?.();
    },
    onAudioLevel: levels => orb.setLevels(levels),
    onError(error) {
      if (disposed) return;
      voiceState = 'error';
      voiceStatus();
      if (error?.message && !/Sign in|configured|unavailable/i.test(error.message)) {
        status.textContent = error.message;
      }
    }
  });

  launch.onclick = () => {
    if (hud.hidden) {
      show(true, { startVoice: true });
    } else {
      voice.stop();
      paused = false;
      pause.textContent = 'Pause mic';
      show(false);
    }
  };

  root.querySelector('[data-close]').onclick = event => {
    event.stopPropagation();
    voice.stop();
    paused = false;
    pause.textContent = 'Pause mic';
    show(false);
  };

  end.onclick = event => {
    event.stopPropagation();
    voice.stop();
    paused = false;
    pause.textContent = 'Pause mic';
  };

  pause.onclick = event => {
    event.stopPropagation();
    paused = !paused;
    if (paused) voice.pause();
    else voice.resume();
    pause.textContent = paused ? 'Resume mic' : 'Pause mic';
  };

  for (const button of wordButtons) {
    button.onclick = event => {
      event.stopPropagation();
      revealWordsUpTo(99);
      if (!ctx?.sb || !identity) {
        resultNode.hidden = false;
        resultNode.dataset.result = 'error';
        resultNode.classList.add('isError');
        resultNode.textContent = 'Sign in to run assistant actions.';
        status.textContent = 'Sign in to access your field assistant.';
        return;
      }
      let args = {};
      try { args = JSON.parse(button.dataset.args || '{}'); } catch {}
      if (button.dataset.command === 'build_timed_route' && !args.minutes) args = { minutes: 120 };
      run({ name: button.dataset.command, args }).catch(() => {});
    };
  }

  if (!ctx?.sb || !identity) {
    status.textContent = 'Sign in to access your field assistant.';
  }

  const completed = event => {
    if (disposed) return;
    if (hud.hidden) {
      show(true, { startVoice: false });
      revealWordsUpTo(99);
    }
    resultNode.hidden = false;
    resultNode.dataset.result = event.detail?.error ? 'error' : 'success';
    resultNode.classList.toggle('isError', Boolean(event.detail?.error));
    resultNode.textContent = commandResultText(event.detail);
    disposeDragging.reposition?.();
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
