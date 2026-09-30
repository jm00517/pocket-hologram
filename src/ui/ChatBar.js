// Test harness for conversational animation until an LLM is wired in:
// typing → listening, send → thinking → speaking (browser TTS + text lip sync). The reply is the
// typed text echoed back; swap `reply()` for the LLM call later.
import { toVowels, EXPRESSIONS, REACTIONS as BODY } from '../character/Behavior.js';
import { LIBRARY } from '../character/Motions.js';
import { HAND_MODES } from '../character/Hands.js';

const MOTIONS = [...new Set([...BODY, ...Object.keys(LIBRARY.reactions)])];
const FACES = ['neutral', ...Object.keys(EXPRESSIONS)];
const STATES = ['idle', 'listening', 'thinking', 'speaking'];

const langOf = (s) => (/[가-힣]/.test(s) ? 'ko' : /[぀-ヿ]/.test(s) ? 'ja' : 'en');

function pickVoice(lang) {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  return vs.find((v) => /female|heami|sunhi|nanami|haruka|ayumi|zira|aria/i.test(v.name)) ?? vs[0];
}

// ponytail: echo placeholder; replace with the LLM call (return the reply text).
async function reply(text) { return text; }

export function mountChatBar(getBehavior) {
  const bar = document.createElement('div');
  bar.id = 'chat';
  bar.innerHTML = `
    <div class="row"><b>표정</b>${FACES.map((f) => `<button data-f="${f}">${f}</button>`).join('')}
      <label><input type="checkbox" data-hold> 유지</label></div>
    <div class="row"><b>손</b>${HAND_MODES.map((h) => `<button data-h="${h}">${h}</button>`).join('')}</div>
    <div class="row"><b>모션</b>${MOTIONS.map((r) => `<button data-r="${r}">${r}</button>`).join('')}
      <select data-s>${STATES.map((s) => `<option>${s}</option>`).join('')}</select>
      <label><input type="checkbox" data-inertia checked> 관성 블렌딩</label></div>
    <form class="row"><input placeholder="말 걸기 (지금은 따라 말함)" autocomplete="off"><button>보내기</button></form>`;
  document.body.append(bar);
  const input = bar.querySelector('input'), stateSel = bar.querySelector('[data-s]');
  const b = () => getBehavior();

  bar.querySelectorAll('[data-r]').forEach((el) => (el.onclick = () => b()?.react(el.dataset.r)));
  bar.querySelectorAll('[data-h]').forEach((el) => (el.onclick = () => b()?.c.hands.set(el.dataset.h)));
  const hold = bar.querySelector('[data-hold]');
  bar.querySelectorAll('[data-f]').forEach((el) => (el.onclick = () => b()?.express(el.dataset.f, { hold: hold.checked })));
  stateSel.onchange = () => b()?.setState(stateSel.value);
  bar.querySelector('[data-inertia]').onchange = (e) => { if (b()) b().c.inertialBlend = e.target.checked; };
  input.oninput = () => { if (input.value && b()?.state === 'idle') b().setState('listening'); };
  input.onblur = () => { if (!input.value && b()?.state === 'listening') b().setState('idle'); };

  bar.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !b()) return;
    input.value = '';
    b().react('nod', 0.5);
    b().setState('thinking');
    const [answer] = await Promise.all([reply(text), new Promise((r) => setTimeout(r, 900))]);
    say(answer);
  };

  function say(text) {
    const beh = b();
    if (!beh) return;
    speechSynthesis.cancel();
    if (!('speechSynthesis' in window)) { beh.speak(text); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' }[langOf(text)];
    u.voice = pickVoice(u.lang.slice(0, 2)) ?? null;
    u.pitch = 1.4; u.rate = 1.05;
    u.onstart = () => beh.speak(text);
    // resync the mouth to where the TTS actually is
    u.onboundary = (ev) => beh.speak(text, { from: toVowels(text.slice(0, ev.charIndex)).length });
    u.onend = u.onerror = () => { beh.stopSpeaking(); beh.setState('idle'); };
    speechSynthesis.speak(u);
    beh.speak(text); // start the mouth now; onstart/onboundary resync if TTS actually runs
  }
  return { say };
}
