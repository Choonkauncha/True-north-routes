import assert from 'node:assert/strict';
import { LIVE_SOCKET, base64ToPcm16, createLiveCoach, downsampleTo16k, floatToPcm16, pcm16ToBase64 } from '../tn-files/live-coach.js';

assert.match(LIVE_SOCKET, /BidiGenerateContentConstrained$/, 'ephemeral tokens must use the constrained Live endpoint');

const pcm = floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
assert.deepEqual([...pcm], [-32768, -16384, 0, 16383, 32767]);
assert.deepEqual([...base64ToPcm16(pcm16ToBase64(pcm))], [...pcm]);
const downsampled = downsampleTo16k(new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]), 32000);
assert.equal(downsampled.length, 4);
assert.ok(downsampled[1] > 0 && downsampled[3] < 0);
assert.equal(downsampled.byteLength, downsampled.length * 2);

const original = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, AudioContext: globalThis.AudioContext, navigator: globalThis.navigator };
const sent = [];
let activeSocket;
let audioStarts = 0;
class TestSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; activeSocket = this; setImmediate(() => { this.readyState = 1; this.onopen?.(); }); }
  send(raw) { sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
class TestAudioContext {
  constructor() { this.sampleRate = 16000; this.currentTime = 0; this.destination = {}; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
  createBuffer() { return { duration: 0, getChannelData: () => new Float32Array() }; }
  createBufferSource() { return { connect() {}, disconnect() {}, start() { audioStarts += 1; }, stop() {} }; }
  close() { return Promise.resolve(); }
}
let stopCount = 0;
let resolveMedia;
const media = { getTracks: () => [{ stop() { stopCount += 1; }, enabled: true }], getAudioTracks: () => [{ enabled: true }] };
globalThis.fetch = async () => new Response(JSON.stringify({ token: 'short-token', model: 'gemini-3.8-live', voice: 'Kore', expiresAt: new Date(Date.now() + 600000).toISOString(), systemInstruction: 'Coach safely.' }), { status: 200 });
globalThis.WebSocket = TestSocket;
globalThis.AudioContext = TestAudioContext;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveMedia = resolve; }) } } });
const live = createLiveCoach({ sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) } } });
await live.start();
await new Promise(resolve => setImmediate(resolve));
assert.match(activeSocket.url, /BidiGenerateContentConstrained\?access_token=short-token$/);
assert.equal(sent.length, 1);
assert.ok(sent[0].setup, 'only setup is sent before setupComplete');
activeSocket.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
await new Promise(resolve => setImmediate(resolve));
assert.equal(sent.length, 1, 'client content waits while microphone permission is pending');
live.stop();
resolveMedia(media);
await new Promise(resolve => setImmediate(resolve));
assert.equal(stopCount, 1, 'media acquired after cancellation is stopped immediately');
assert.equal(sent.filter((message) => message.clientContent).length, 0, 'cancelled setup never sends client content');
// Successful setup triggers one silent welcome and keeps speech interruptible.
let transcripts = [];
navigator.mediaDevices.getUserMedia = async () => media;
const started = createLiveCoach({ sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) } } }, { onTranscript: row => transcripts.push(row) });
await started.start(); await new Promise(resolve => setImmediate(resolve));
const setup = sent.at(-1).setup;
assert.equal(setup.realtimeInputConfig.activityHandling, 'START_OF_ACTIVITY_INTERRUPTS');
assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
assert.equal(setup.speechConfig, undefined);
activeSocket.onmessage({data:JSON.stringify({setupComplete:{}})});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sent.filter(row=>row.clientContent).length,1);
assert.equal(sent.at(-1).clientContent.turnComplete,true);
assert.match(sent.at(-1).clientContent.turns[0].parts[0].text,/Introduce yourself/);
activeSocket.onmessage({data:JSON.stringify({setupComplete:{}})});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(sent.filter(row=>row.clientContent).length,1,'welcome is not sent twice');
assert.equal(transcripts.length,0,'silent welcome instruction is not a user caption');
started.pause();
activeSocket.onmessage({data:JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAA='}}]}}})});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audioStarts,0,'late server audio must not play after pause');
started.resume();
activeSocket.onmessage({data:JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAA='}}]}}})});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(audioStarts,1,'resume accepts new audio');
const beforeClose=stopCount;
activeSocket.readyState=3;activeSocket.onclose({code:1000});
assert.equal(started.isActive(),false,'normal remote close ends the session');
assert.equal(stopCount,beforeClose+1,'normal remote close releases microphone');
const timeoutErrors=[];
const stalled=createLiveCoach({sb:{auth:{getSession:async()=>({data:{session:{access_token:'user-token'}}})}}},{setupTimeoutMs:5,onError:error=>timeoutErrors.push(error.message)});
await stalled.start();await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(stalled.isActive(),false,'missing setupComplete ends after deadline');
assert.match(timeoutErrors[0],/timed out/);
globalThis.fetch = original.fetch;
globalThis.WebSocket = original.WebSocket;
globalThis.AudioContext = original.AudioContext;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator });

console.log('Gemini Live transport: constrained endpoint, setup ordering, cancellation, PCM framing and downsampling passed.');
