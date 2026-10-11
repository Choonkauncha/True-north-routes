import { liveSetup } from '../lib/live-setup.js';
export const LIVE_SOCKET = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

export function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, Number(input[i]) || 0));
    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output;
}

export function downsampleTo16k(input, sampleRate) {
  if (sampleRate === INPUT_RATE) return floatToPcm16(input);
  const ratio = sampleRate / INPUT_RATE;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < Math.max(start + 1, end); j += 1) sum += input[Math.min(j, input.length - 1)] || 0;
    output[i] = sum / Math.max(1, end - start);
  }
  return floatToPcm16(output);
}

export function pcm16ToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToPcm16(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

function emit(callback, value) { try { callback?.(value); } catch { /* UI callbacks must not break audio cleanup. */ } }

/**
 * Browser-side Gemini Live transport. It receives only an ephemeral token from
 * /api/live-token; the long-lived Gemini key stays on the server.
 */
export function createLiveCoach(ctx, { onState, onTranscript, onError, onExpires, onAudioLevel, setupTimeoutMs = 15000 } = {}) {
  let socket = null;
  let stream = null;
  let inputContext = null;
  let inputSource = null;
  let processor = null;
  let outputContext = null;
  let nextOutputTime = 0;
  const outputSources = new Set();
  let stopped = true;
  let paused = false;
  let tokenExpiresAt = 0;
  let voice = 'Kore';
  let model = 'gemini-3.8-live';
  let micStarted = false;
  let openingMessage = 'Introduce yourself as my True North voice Coach, briefly explain how you can help, and ask one helpful question.';
  let generation = 0;
  let startController = null;
  let setupTimer = null;

  const state = value => emit(onState, value);
  const level=(samples,kind)=>{let power=0,count=0;for(let i=0;i<samples.length;i+=8){power+=samples[i]*samples[i];count++;}emit(onAudioLevel,{[kind]:Math.min(1,Math.sqrt(power/Math.max(1,count))*3)});};
  const fail = error => { stopped = true; paused = false; cleanup(); state('error'); emit(onError, error instanceof Error ? error : new Error(String(error || 'Live Coach could not start.'))); };

  function cleanupAudio() {
    micStarted = false;
    processor?.disconnect(); processor = null;
    inputSource?.disconnect(); inputSource = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    inputContext?.close().catch(() => {}); inputContext = null;
  }

  function cleanupOutput() {
    for (const source of outputSources) { try { source.stop(); } catch { /* Already ended. */ } try { source.disconnect(); } catch {} }
    outputSources.clear();
    outputContext?.close().catch(() => {}); outputContext = null; nextOutputTime = 0;
  }

  function cleanupSocket() {
    const current = socket; socket = null;
    if (current && current.readyState < 2) current.close(1000, 'Live Coach ended');
  }

  function cleanup() { clearTimeout(setupTimer); setupTimer = null; cleanupAudio(); cleanupOutput(); cleanupSocket(); emit(onAudioLevel,{input:0,output:0}); }

  function playAudio(value) {
    if (stopped || paused || !outputContext || !value) return;
    const pcm = base64ToPcm16(value);
    const buffer = outputContext.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 32768;
    const source = outputContext.createBufferSource();
    source.buffer = buffer; source.connect(outputContext.destination);
    outputSources.add(source);
    source.onended = () => { outputSources.delete(source); if(!outputSources.size&&!stopped&&!paused)state('listening'); emit(onAudioLevel,{output:0}); try { source.disconnect(); } catch {} };
    const start = Math.max(outputContext.currentTime + 0.02, nextOutputTime);
    level(channel,'output'); state('speaking');
    source.start(start); nextOutputTime = start + buffer.duration;
  }

  async function executeTool(call) {
    const session = await ctx.sb.auth.getSession();
    const token = session.data?.session?.access_token;
    if (!token) throw new Error('Sign in again to use voice actions.');
    const response = await fetch('/api/voice-action', {method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, body:JSON.stringify({toolCall:{name:call.name,args:call.args}}), signal:AbortSignal.timeout(12000)});
    const data = await response.json().catch(()=>({error:'Voice action failed'}));
    if (!response.ok) return {error:data.error || 'Action denied'};
    if (data.proposal?.action === 'route.build') {
      emit(onTranscript,{role:'assistant',text:`Route draft: ${data.proposal.stops.join('; ')}. Review and confirm in the CRM before execution.`,final:true});
      // Deliberately no automatic route persistence or navigation.
    }
    return data;
  }

  async function handleMessage(message, attempt) {
    if (attempt !== generation || stopped) return;
    if (message?.setupComplete && !micStarted && !stopped) {
      clearTimeout(setupTimer); setupTimer = null;
      micStarted = true;
      try {
        await startMic(attempt);
        if (stopped || attempt !== generation) return;
        send({ clientContent: { turns: [{ role: 'user', parts: [{ text: openingMessage }] }], turnComplete: true } });
        state('listening');
      } catch (error) { if (error?.name !== 'AbortError' && attempt === generation) fail(error); }
      return;
    }
    if (message?.toolCall?.functionCalls?.length) {
      const functionResponses=[];
      for (const call of message.toolCall.functionCalls) {
        let result;
        try { result=await executeTool(call); } catch { result={error:'Voice action could not be completed'}; }
        functionResponses.push({id:call.id,name:call.name,response:result});
      }
      if (attempt === generation && !stopped) send({toolResponse:{functionResponses}});
      return;
    }
    const content = message?.serverContent;
    if (content?.interrupted) {
      for (const source of outputSources) { try { source.stop(); } catch {} }
      outputSources.clear(); nextOutputTime = outputContext?.currentTime || 0; state(paused ? 'paused' : 'listening');
    }
    if (content?.inputTranscription?.text) emit(onTranscript, { role: 'user', text: content.inputTranscription.text, final: false });
    if (content?.outputTranscription?.text) emit(onTranscript, { role: 'assistant', text: content.outputTranscription.text, final: false });
    for (const part of content?.modelTurn?.parts || []) if (part?.inlineData?.data) playAudio(part.inlineData.data);
    if (content?.turnComplete) { emit(onTranscript, { role: 'assistant', text: '', final: true }); state(paused ? 'paused' : 'listening'); }
  }

  function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }

  function startMic(attempt) {
    return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(media => {
      if (stopped || attempt !== generation) {
        media.getTracks().forEach(track => track.stop());
        throw Object.assign(new Error('Live Coach start was cancelled.'), { name: 'AbortError' });
      }
      stream = media;
      inputContext = new AudioContext({ sampleRate: INPUT_RATE });
      inputSource = inputContext.createMediaStreamSource(stream);
      processor = inputContext.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = event => {
        if (stopped || paused || socket?.readyState !== WebSocket.OPEN) return;
        const samples=event.inputBuffer.getChannelData(0);level(samples,'input');
        const pcm = downsampleTo16k(samples, inputContext.sampleRate);
        send({ realtimeInput: { audio: { data: pcm16ToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } } });
      };
      inputSource.connect(processor);
      const silent = inputContext.createGain(); silent.gain.value = 0;
      processor.connect(silent); silent.connect(inputContext.destination);
    });
  }

  async function start() {
    if (!stopped) return;
    const attempt = ++generation;
    startController?.abort(); startController = new AbortController();
    stopped = false; paused = false; state('connecting');
    try {
      const session = await ctx.sb.auth.getSession();
      if (stopped || attempt !== generation) return;
      const accessToken = session.data?.session?.access_token;
      if (!accessToken) throw new Error('Sign in again to use Live Coach.');
      const response = await fetch('/api/live-token', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, signal: AbortSignal.any([startController.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json().catch(() => ({}));
      if (stopped || attempt !== generation) return;
      if (!response.ok || !data.token) throw new Error(data.error || 'Live voice is unavailable right now.');
      tokenExpiresAt = Date.parse(data.expiresAt) || Date.now() + 30 * 60 * 1000;
      model = data.model || model; voice = data.voice || voice;
      openingMessage = data.openingMessage || openingMessage;
      const url = `${LIVE_SOCKET}?access_token=${encodeURIComponent(data.token)}`;
      outputContext = new AudioContext({ sampleRate: OUTPUT_RATE });
      socket = new WebSocket(url);
      setupTimer = setTimeout(() => {
        if (!stopped && attempt === generation) fail(new Error('Live Coach connection timed out. Try starting voice again.'));
      }, setupTimeoutMs);
      socket.onopen = () => {
        if (stopped || attempt !== generation) { cleanupSocket(); return; }
        send({ setup: liveSetup({model,voice,systemInstruction:data.systemInstruction}) });
      };
      socket.onmessage = event => {
        if (stopped || attempt !== generation) return;
        Promise.resolve().then(() => handleMessage(JSON.parse(event.data), attempt)).catch(error => {
          if (!stopped && attempt === generation) fail(error);
        });
      };
      socket.onerror = () => { if (!stopped && attempt === generation) fail(new Error('Live Coach lost its connection.')); };
      socket.onclose = event => {
        if (stopped || attempt !== generation) return;
        if (event.code !== 1000) { fail(new Error('Live Coach disconnected. Try starting voice again.')); return; }
        stopped = true; paused = false; cleanup(); state('idle');
      };
      if (tokenExpiresAt - Date.now() < 2 * 60 * 1000) emit(onExpires, new Date(tokenExpiresAt));
    } catch (error) { if (error?.name !== 'AbortError' && attempt === generation) fail(error); }
  }

  function pause() {
    if (stopped || paused) return;
    paused = true; stream?.getAudioTracks?.().forEach(track => { track.enabled = false; });
    for (const source of outputSources) { try { source.stop(); } catch {} }
    outputSources.clear(); nextOutputTime = outputContext?.currentTime || 0;
    send({ realtimeInput: { audioStreamEnd: true } });
    state('paused');
  }

  function resume() { if (!stopped && paused) { stream?.getAudioTracks?.().forEach(track => { track.enabled = true; }); paused = false; state('listening'); } }

  function stop() {
    generation += 1; startController?.abort(); startController = null;
    stopped = true; paused = false; send({ realtimeInput: { audioStreamEnd: true } }); cleanup(); state('idle');
  }

  return { start, stop, pause, resume, isActive: () => !stopped, getTokenExpiresAt: () => tokenExpiresAt };
}
