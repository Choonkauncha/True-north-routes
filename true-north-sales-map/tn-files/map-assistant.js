import { createLiveCoach } from "./live-coach.js";
import { mountOrbDragging } from "./orb-position.js";
import { mountCoachOrb } from "./coach-orb.js";
import {
  ASSISTANT_GREETING,
  ASSISTANT_GREETING_STEPS,
  singleSentenceText,
  matchAssistantIntent,
  createAssistantCommandRunner,
  commandResultText
} from "../lib/assistant-command.js";

let active = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineSentenceParts(parts) {
  return parts.map(part => {
    if (part.type === "action") {
      const argsJson = escapeHtml(JSON.stringify(part.args || {}));
      return `<button type="button" class="mapAssistantWord isRevealed" data-action-word="${escapeHtml(part.id)}" data-command="${escapeHtml(part.command)}" data-args="${argsJson}" data-revealed="true">${escapeHtml(part.label)}</button>`;
    }
    return `<span class="mapAssistantWhisperSpan">${escapeHtml(part.text)}</span>`;
  }).join("");
}

export function mountMapAssistant(ctx = {}) {
  active?.dispose();
  if (!document?.body) return null;

  const identity = ctx?.rep?.user_id || null;

  const root = document.createElement("aside");
  root.id = "tnMapAssistant";
  root.className = "mapAssistant mapAssistantRoot";
  root.dataset.state = "idle";
  root.setAttribute("aria-label", "True North voice assistant");
  root.innerHTML =
    `<div id="tnMapAssistantHud" class="mapAssistantHud" hidden>` +
      `<p class="mapAssistantWhisper" data-whisper data-whisper-text data-caption data-result role="status" aria-live="polite">${escapeHtml(ASSISTANT_GREETING)}</p>` +
    `</div>` +
    `<button class="mapAssistantLauncher tnCoachOrbStage" type="button" aria-label="Tap to start field assistant" aria-expanded="false" aria-controls="tnMapAssistantHud" data-voice-state="idle">` +
      `<canvas aria-hidden="true"></canvas>` +
      `<span class="mapAssistantOrbFallback" aria-hidden="true">◉</span>` +
      `<span class="mapAssistantLiveDot" aria-hidden="true"></span>` +
      `<span class="mapAssistantTapHint" data-tap-hint>Tap to start</span>` +
    `</button>`;

  document.body.append(root);

  let css = document.querySelector("[data-map-assistant-css]");
  if (!css) {
    css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/tn-files/map-assistant.css";
    css.dataset.mapAssistantCss = "1";
    document.head.append(css);
  }

  const hud = root.querySelector("#tnMapAssistantHud");
  const launch = root.querySelector(".mapAssistantLauncher");
  const tapHint = root.querySelector("[data-tap-hint]");
  const whisperEl = root.querySelector("[data-whisper-text]");

  const orb = mountCoachOrb(launch.querySelector("canvas"));
  const disposeDragging = mountOrbDragging(root, launch, hud);
  const controller = new AbortController();

  let disposed = false;
  let sessionOpen = false;
  let greetingStarted = false;
  let openingGreetingActive = false;
  let voiceState = "idle";
  let greetingTimers = [];
  let fallbackSpeechTimer = null;
  let recognition = null;
  let userTranscriptBuffer = "";
  let assistantTranscriptBuffer = "";

  function clearGreetingTimers() {
    for (const timer of greetingTimers) clearTimeout(timer);
    greetingTimers = [];
  }

  function clearPendingSpeechTimer() {
    if (fallbackSpeechTimer) {
      clearTimeout(fallbackSpeechTimer);
      fallbackSpeechTimer = null;
    }
  }

  function triggerSettleAnimation() {
    if (!whisperEl) return;
    whisperEl.classList.remove("isSettling");
    void whisperEl.offsetWidth;
    whisperEl.classList.add("isSettling");
    whisperEl.onanimationend = () => whisperEl.classList.remove("isSettling");
  }

  function setSentence(rawText, { tone = "default", stepIndex = null, parts = null } = {}) {
    if (!whisperEl || disposed) return;
    const next = singleSentenceText(rawText) || ASSISTANT_GREETING;
    const nextHtml = Array.isArray(parts) && parts.length
      ? renderInlineSentenceParts(parts)
      : escapeHtml(next);
    const changed = whisperEl.innerHTML !== nextHtml;
    whisperEl.innerHTML = nextHtml;
    whisperEl.classList.toggle("isResult", tone === "result");
    whisperEl.classList.toggle("isError", tone === "error");
    whisperEl.dataset.result = tone === "error" ? "error" : tone === "result" ? "success" : "info";
    if (stepIndex !== null) whisperEl.dataset.step = String(stepIndex);
    else delete whisperEl.dataset.step;
    if (changed) triggerSettleAnimation();
    disposeDragging.reposition?.();
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
    for (const step of ASSISTANT_GREETING_STEPS) {
      const applyStep = () => {
        if (disposed || hud.hidden || root.dataset.commandBusy) return;
        setSentence(step.text, {
          tone: "default",
          stepIndex: step.revealStep,
          parts: step.parts
        });
        if (step.energy > 0) {
          syncOrbState("speaking", step.energy);
        } else {
          orb.setLevels({ input: 0, output: 0 });
          syncOrbState(voiceState === "idle" ? "listening" : voiceState, 0);
        }
      };
      if (step.atMs === 0) applyStep();
      else greetingTimers.push(setTimeout(applyStep, step.atMs));
    }
  }

  function beginGreetingWhenTalking() {
    if (disposed || !sessionOpen || greetingStarted) return;
    clearPendingSpeechTimer();
    greetingStarted = true;
    openingGreetingActive = true;
    hud.hidden = false;
    disposeDragging.reposition?.();
    if (!root.dataset.commandBusy) {
      startGreetingCadence();
    }
  }

  function activateFallbackVoice() {
    if (disposed || !sessionOpen) return;
    beginGreetingWhenTalking();
    startSpeechFallback();
  }

  function startSpeechFallback() {
    const SpeechRec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRec || recognition || disposed || !sessionOpen) return;
    try {
      recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = event => {
        if (disposed || !sessionOpen) return;
        const latest = event.results?.[event.results.length - 1];
        const transcript = String(latest?.[0]?.transcript || "").trim();
        if (!transcript) return;
        if (hud.hidden) beginGreetingWhenTalking();
        openingGreetingActive = false;
        clearGreetingTimers();
        setSentence(transcript, { tone: "default", parts: null });
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

  function show(open, { startVoice = false, immediateHud = false } = {}) {
    sessionOpen = open;
    root.classList.toggle("isActive", open);
    launch.setAttribute("aria-expanded", String(open));
    launch.setAttribute("aria-label", open ? "Voice assistant active. Tap orb to stop." : "Tap to start field assistant");
    if (tapHint) {
      tapHint.textContent = "Tap to start";
      tapHint.hidden = open;
    }
    if (open) {
      refreshContext();
      if (immediateHud) {
        greetingStarted = true;
        hud.hidden = false;
        disposeDragging.reposition?.();
      } else {
        greetingStarted = false;
        openingGreetingActive = false;
        userTranscriptBuffer = "";
        assistantTranscriptBuffer = "";
        clearGreetingTimers();
        clearPendingSpeechTimer();
        // Keep dialogue hidden until the voice agent is loaded and actually talking
        hud.hidden = true;
        syncOrbState("connecting", 0);
        disposeDragging.reposition?.();
        if (startVoice && ctx?.sb && identity && ["idle", "error"].includes(voiceState)) {
          voice.start().catch(() => activateFallbackVoice());
        } else if (startVoice) {
          fallbackSpeechTimer = setTimeout(() => activateFallbackVoice(), 40);
        }
      }
    } else {
      greetingStarted = false;
      openingGreetingActive = false;
      userTranscriptBuffer = "";
      assistantTranscriptBuffer = "";
      hud.hidden = true;
      clearGreetingTimers();
      clearPendingSpeechTimer();
      stopSpeechFallback();
      orb.setLevels({ input: 0, output: 0 });
      syncOrbState("idle", 0);
      disposeDragging.reposition?.();
    }
  }

  const run = createAssistantCommandRunner({
    isCurrent: () => !disposed && !controller.signal.aborted,
    getContext: () => ctx.getMapContext(),
    async authorize(call, { signal }) {
      if (!ctx?.sb || !identity) throw Error("Sign in to use the True North assistant.");
      const session = await ctx.sb.auth.getSession();
      if (!session.data?.session || session.data.session.user.id !== identity) throw Error("Account changed. Restart the assistant.");
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { authorization: `Bearer ${session.data.session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ workspace: "map", toolCall: call }),
        signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(20000)])
      });
      const data = await response.json();
      const current = await ctx.sb.auth.getSession();
      if (current.data?.session?.user?.id !== identity) throw Error("Account changed.");
      if (!response.ok) throw Error(data.error || "Command denied.");
      if (data.authorized && data.actorId !== identity) throw Error("Command authorization failed.");
      return data;
    },
    execute: (name, args) => ctx.executeMapAction(name, args),
    onStart(call) {
      openingGreetingActive = false;
      clearGreetingTimers();
      clearPendingSpeechTimer();
      if (hud.hidden) show(true, { immediateHud: true });
      root.dataset.commandBusy = "true";
      syncOrbState("working", 0.35);
      const label = call.name === "clear_route"
        ? "Clearing your route…"
        : call.name.startsWith("build_")
          ? "Building your route…"
          : `Running ${call.name.replace(/_/g, " ")}…`;
      // Immediately replace any inline action buttons with the single status sentence
      setSentence(label, { tone: "default", parts: null });
    },
    onResult(_call, result) {
      if (disposed) return;
      delete root.dataset.commandBusy;
      if (hud.hidden) show(true, { immediateHud: true });
      syncOrbState(voiceState === "idle" ? "listening" : voiceState, 0);
      // Display ONLY the single result sentence with zero leftover buttons
      setSentence(commandResultText(result), { tone: result?.error ? "error" : "result", parts: null });
      refreshContext();
    }
  });

  const voice = createLiveCoach(ctx, {
    workspace: "map",
    executeMapTool: run,
    onState(value) {
      voiceState = value;
      if (!sessionOpen || disposed) return;
      if (value === "speaking") {
        beginGreetingWhenTalking();
      } else if (value === "listening" && !greetingStarted) {
        clearPendingSpeechTimer();
        fallbackSpeechTimer = setTimeout(() => {
          if (!disposed && sessionOpen && !greetingStarted) {
            beginGreetingWhenTalking();
          }
        }, 3500);
      }
      if (!root.dataset.commandBusy) {
        if (!greetingStarted) {
          syncOrbState("connecting", 0);
        } else {
          syncOrbState(value === "idle" ? "listening" : value, 0);
        }
      }
    },
    onTranscript(row) {
      if (!sessionOpen || disposed) return;
      if (row?.role === "assistant") {
        if (row.text) {
          if (!greetingStarted) {
            beginGreetingWhenTalking();
          }
          if (!openingGreetingActive && !root.dataset.commandBusy) {
            assistantTranscriptBuffer = assistantTranscriptBuffer
              ? `${assistantTranscriptBuffer.trimEnd()} ${row.text.trimStart()}`.trim()
              : row.text.trim();
            setSentence(assistantTranscriptBuffer, { tone: "default", parts: null });
          }
        }
        if (row.final) {
          assistantTranscriptBuffer = "";
          userTranscriptBuffer = "";
        }
        return;
      }
      if (row?.role === "user" && row.text) {
        if (!greetingStarted) return;
        openingGreetingActive = false;
        assistantTranscriptBuffer = "";
        clearGreetingTimers();
        userTranscriptBuffer = userTranscriptBuffer
          ? `${userTranscriptBuffer.trimEnd()} ${row.text.trimStart()}`.trim()
          : row.text.trim();
        setSentence(userTranscriptBuffer, { tone: "default", parts: null });
        const matched = matchAssistantIntent(row.text) || matchAssistantIntent(userTranscriptBuffer);
        if (matched && !root.dataset.commandBusy) {
          userTranscriptBuffer = "";
          run(matched).catch(() => {});
        }
      }
    },
    onAudioLevel: levels => orb.setLevels(levels),
    onError() {
      if (disposed) return;
      voiceState = "error";
      if (sessionOpen) {
        activateFallbackVoice();
      }
    }
  });

  launch.onclick = () => {
    if (!sessionOpen) {
      show(true, { startVoice: true });
    } else {
      voice.stop();
      show(false);
    }
  };

  hud.addEventListener("click", event => {
    const button = event.target.closest(".mapAssistantWord[data-command]");
    if (!button) return;
    event.stopPropagation();
    openingGreetingActive = false;
    clearGreetingTimers();
    if (!ctx?.sb || !identity) {
      setSentence("Sign in to run assistant actions.", { tone: "error", parts: null });
      return;
    }
    let args = {};
    try { args = JSON.parse(button.dataset.args || "{}"); } catch {}
    if (button.dataset.command === "build_timed_route" && !args.minutes) args = { minutes: 120 };
    run({ name: button.dataset.command, args }).catch(() => {});
  });

  const completed = event => {
    if (disposed) return;
    openingGreetingActive = false;
    if (hud.hidden) show(true, { immediateHud: true });
    clearGreetingTimers();
    setSentence(commandResultText(event.detail), { tone: event.detail?.error ? "error" : "result", parts: null });
  };
  document.addEventListener("tn-assistant-command-result", completed);

  const auth = ctx?.sb?.auth?.onAuthStateChange?.((event, session) => {
    if (event === "SIGNED_OUT" || (session?.user?.id && session.user.id !== identity)) dispose();
  })?.data?.subscription;

  const feature = event => {
    if (event.detail?.coach === false || event.detail?.map === false) {
      voice.stop();
      controller.abort();
      for (const btn of hud.querySelectorAll(".mapAssistantWord")) btn.disabled = true;
    } else if (event.detail?.coach === true && controller.signal.aborted && !disposed) {
      mountMapAssistant(ctx);
    }
  };
  document.addEventListener("tn-feature-access", feature);

  function runSpokenText(text) {
    const matched = matchAssistantIntent(text);
    if (!matched) return Promise.resolve(null);
    return run(matched);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sessionOpen = false;
    clearGreetingTimers();
    clearPendingSpeechTimer();
    stopSpeechFallback();
    controller.abort();
    voice.stop();
    disposeDragging();
    orb.dispose();
    auth?.unsubscribe();
    document.removeEventListener("tn-feature-access", feature);
    document.removeEventListener("tn-assistant-command-result", completed);
    root.remove();
    if (active === instance) active = null;
  }

  const instance = { root, dispose, runCommand: run, runSpokenText, matchIntent: matchAssistantIntent };
  active = instance;
  return instance;
}
