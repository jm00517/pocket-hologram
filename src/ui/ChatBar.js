// Test harness for conversational animation until an LLM is wired in:
// typing → listening, send → thinking → speaking (browser TTS + text lip sync). The reply is the
// typed text echoed back; swap `reply()` for the LLM call later.
import { toVowels } from '../character/Behavior.js';

const REACTIONS = ['nod', 'hardnod', 'shake', 'tilt', 'happy', 'surprised', 'shy', 'wave', 'angry', 'annoyed', 'sigh', 'cocky', 'sarcastic'];
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
    <div class="row">${REACTIONS.map((r) => `<button data-r="${r}">${r}</button>`).join('')}
      <select data-s>${STATES.map((s) => `<option>${s}</option>`).join('')}</select></div>
    <form class="row"><input placeholder="말 걸기 (지금은 따라 말함)" autocomplete="off"><button>보내기</button></form>`;
  document.body.append(bar);
  const input = bar.querySelector('input'), stateSel = bar.querySelector('[data-s]');
  const b = () => getBehavior();

  bar.querySelectorAll('[data-r]').forEach((el) => (el.onclick = () => b()?.react(el.dataset.r)));
  stateSel.onchange = () => b()?.setState(stateSel.value);
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
