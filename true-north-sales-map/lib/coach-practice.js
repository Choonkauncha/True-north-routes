import { isSetterRole } from './role-access.js';

const PHASES = ['opener', 'objection', 'handoff', 'recap'];
const clean = (value, max = 1200) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const label = phase => `[Practice: ${phase}]`;
const prompt = {
  opener: 'Homeowner role-play: “What is this about?”\n\nIntroduce yourself in your own words and ask permission for one short question.',
  objection: 'Homeowner role-play: “I’m not interested. We already have someone.”\n\nReply calmly. Respect their choice; a graceful exit is a useful outcome.',
  handoff: 'Homeowner role-play: “I’ve noticed a stain, but I don’t want to commit to anything.”\n\nOffer one truthful next step and ask permission. An inspection is not a promise of damage, coverage, or a sale.',
  recap: 'Practice complete. Choose one small improvement to use in your next conversation.'
};

function state(history) {
  const messages = Array.isArray(history) ? history.slice(-12) : [];
  const latest = [...messages].reverse().find(row => row?.role === 'assistant' && /^\[Practice: (opener|objection|handoff|recap)\]/.test(String(row.content ?? '')));
  const content = String(latest?.content ?? '').slice(0, 5000);
  const phase = content.match(/^\[Practice: (opener|objection|handoff|recap)\]/)?.[1] || 'opener';
  const reviewed = content.match(/^\[Feedback: (opener|objection|handoff)\]$/m)?.[1];
  return { phase, reviewed, messages };
}

function cues(text) {
  const lower = text.toLowerCase();
  const unqualified = pattern => [...lower.matchAll(pattern)].some(match => {
    const prefix = lower.slice(0, match.index).split(/[.!?;]|\b(?:but|however)\b/).at(-1);
    return !/(?:\bnot|\bnever|\bno|\bcannot|\bcan['’]t|\bwon['’]t|\bdon['’]t|\bdo not)\b[^.!?]{0,25}$/.test(prefix);
  });
  const promise = unqualified(/(?:insurance (?:will|always) (?:pay|cover)|guarantee(?:d)? (?:coverage|approval|free roof)|(?:get|give) you a free roof|your roof (?:is|has been) (?:definitely )?damaged|definitely (?:roof )?damage)/g);
  const pressure = unqualified(/(?:must sign|have to sign|sign (?:right )?now|only chance|won['’]?t take no|don['’]?t take no|ignore (?:their|your|the) (?:no|refusal))/g);
  const permission = /(?:\b(?:may|can|could) i\b|would (?:it|you)|is (?:now|this|that|it) (?:an? )?(?:okay|ok|good)|okay (?:if|to)|good time|do you have (?:a|one)|if you(?:['’]d| would) (?:like|prefer)|with your permission)/.test(lower);
  const question = /\b(?:what|how|which|tell me)\b/.test(lower) && /\?|tell me/.test(lower);
  const respect = /\b(?:understand|respect|no problem|thank you|thanks|of course|have a good|no worries)\b/.test(lower);
  const identity = /\btrue north\b/.test(lower);
  const step = /\b(?:inspect(?:ion)?|look|schedule|appointment|visit|time|call|follow.?up)\b/.test(lower);
  return { promise, pressure, permission, question, respect, identity, step, words: text.split(/\s+/).filter(Boolean).length };
}

function feedback(text, phase) {
  const c = cues(text);
  const quote = `“${text.slice(0, 80)}${text.length > 80 ? '…' : ''}”`;
  const strength = phase === 'opener' && c.identity ? 'You named True North clearly.' : phase === 'objection' && c.respect ? 'You acknowledged their choice without arguing.' : phase === 'handoff' && c.step ? 'You offered a concrete next step.' : c.permission ? 'You made room for the homeowner’s permission.' : c.question ? 'You asked a question that invites them to speak.' : c.words <= 35 ? 'You kept your response short enough to leave room for listening.' : 'You have a draft we can simplify into one clear thought.';
  const improvement = c.promise ? `Remove the certainty about damage or insurance. Those outcomes require appropriate inspection and policy review; never promise them.${c.pressure ? ' Remove the pressure too; honor a refusal.' : ''}` : c.pressure ? 'Remove the pressure to sign or continue. Honor a refusal and end the conversation respectfully.' : phase === 'objection' && !c.respect ? 'Acknowledge their choice first: “I understand; thanks for letting me know.” Do not turn a clear no into another pitch.' : !c.permission && phase !== 'objection' ? 'Add a brief permission question before continuing.' : c.words > 45 ? 'Cut this to one idea and one question; let them answer before adding details.' : phase === 'opener' && !c.identity ? 'Name True North so they know whom you represent.' : phase === 'handoff' && !c.step ? 'Name the proposed next step clearly, then ask whether they want it.' : 'Keep that calm approach, pause, and let their answer guide you.';
  return `${quote}\n${strength} ${improvement}`;
}

function hint(snapshot, phase) {
  const name = clean(snapshot?.profile?.firstName, 35) || 'your name';
  if (phase === 'opener') return `Example to adapt: “Hi, I’m ${name} with True North Restorations. Is now an okay time for one quick question about your roof?”`;
  if (phase === 'objection') return 'Example to adapt: “I understand. Thanks for letting me know. Have a good day.” A clear no needs a respectful exit, not a rebuttal.';
  if (phase === 'handoff') return isSetterRole(snapshot?.profile?.role) ? 'Example to adapt: “If you’d like, we can discuss arranging an inspection to understand that stain. Would you like me to explain what the visit involves?” Confirm interest before an inspection handoff.' : 'Example to adapt: “An inspection may help us understand the stain before discussing any recommendation. Would you like to hear what that next step involves?” Confirm interest before making recommendations.';
  return 'Choose one habit: ask permission, acknowledge a refusal, or explain a truthful next step. Use it once, then reflect on what happened.';
}

/** Read-only, clearly labeled practice. History determines the exercise, never user identity. */
export function practiceCoachReply(snapshot, message, history = [], action = '') {
  const name = clean(snapshot?.profile?.firstName, 35) || 'Teammate';
  const text = clean(message);
  const current = state(history);
  const phase = action === 'retry' ? (current.reviewed || current.phase) : current.phase;
  if (action === 'start') return `${label('opener')}\n${name}, let’s practice a short, respectful True North conversation. This is role-play, not a real homeowner or an app action.\n\n${prompt.opener}`;
  if (action === 'hint') return `${label(phase)}\n${name}, here’s an example; make it sound like you.\n\n${hint(snapshot, phase)}\n\n${phase === 'recap' ? 'What habit will you practice next?' : prompt[phase]}`;
  if (action === 'retry' || !text) return `${label(phase)}\n${name}, take another try. Focus on one clear thought and leave room for an answer.\n\n${phase === 'recap' ? 'Which habit will you use next?' : prompt[phase]}`;
  if (phase === 'recap') return `${label('recap')}\n${name}, keep your next step small and within your control. Your plan: “${text.slice(0, 110)}${text.length > 110 ? '…' : ''}”\n\n${cues(text).promise || cues(text).pressure ? 'Revise that plan to avoid pressure or claims about damage and insurance. Ask permission and honor the homeowner’s choice.' : 'Practice it once aloud, then use it in a respectful conversation. Record the outcome honestly.'}\n\nWhat will help you remember that habit?`;
  const next = PHASES[PHASES.indexOf(phase) + 1];
  const recap = next === 'recap' ? `${isSetterRole(snapshot?.profile?.role) ? 'For your setter role, a clear, consent-based handoff matters more than pushing for a commitment.' : 'Understand the homeowner’s priorities before recommending a next step.'} This practice does not complete a lesson or change any app record.\n\nWhich one improvement will you take into your next conversation?` : prompt[next];
  return `${label(next)}\n[Feedback: ${phase}]\n${name}, ${feedback(text, phase)}\n\n${recap}`;
}
