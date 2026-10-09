/** REST/WebSocket wire configuration, not the SDK's LiveConnectConfig shape. */
export function liveSetup({model, voice = 'Kore', systemInstruction = 'You are the positive, practical True North voice Coach.'}) {
  return {
    model: `models/${String(model).replace(/^models\//, '').trim()}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}}
    },
    realtimeInputConfig: {
      automaticActivityDetection: {disabled: false},
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'
    },
    inputAudioTranscription: {}, outputAudioTranscription: {}, sessionResumption: {},
    systemInstruction: {parts: [{text: systemInstruction}]}
  };
}
