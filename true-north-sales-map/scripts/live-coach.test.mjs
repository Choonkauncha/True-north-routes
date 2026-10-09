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
  createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} }; }
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
globalThis.fetch = original.fetch;
globalThis.WebSocket = original.WebSocket;
globalThis.AudioContext = original.AudioContext;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original.navigator });

console.log('Gemini Live transport: constrained endpoint, setup ordering, cancellation, PCM framing and downsampling passed.');
