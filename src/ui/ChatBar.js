// Talking with her: typing or holding the mic (or, in VR, a trigger / a pinch) → listening, send → thinking →
// speaking. Her answer comes from the local LLM behind the server's /api/chat (short spoken Japanese, as Miku);
// without it she echoes you. Your voice: the browser's speech recognition where it has one (Chrome: fast),
// else a recording sent to the server's /api/stt (faster-whisper, slower).
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

const history = []; // the conversation so far, for the LLM (the server keeps the last dozen turns)
async function reply(text) {
  history.push({ role: 'user', content: text });
  try {
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
    if (!r.ok) throw new Error(r.status);
    const { reply: answer } = await r.json();
    history.push({ role: 'assistant', content: answer });
    history.splice(0, Math.max(0, history.length - 24));
    return answer;
  } catch {
    history.pop();
    return text; // no LLM: she says it back
  }
}
const LISTEN = [['ko-KR', '한국어'], ['ja-JP', '日本語'], ['en-US', 'English']];
const listenLang = () => { try { return localStorage.getItem('ph.listenLang') || 'ko-KR'; } catch { return 'ko-KR'; } };

// controls go in the drawer's character section; only the chat input sits at the bottom of the screen
/** route(audioElement): optional, sends her voice somewhere other than straight out (e.g. a 3D sound at her head) */
export function mountChatBar(getBehavior, controlsRoot, { route } = {}) {
  const ctl = document.createElement('div');
  ctl.innerHTML = `
    <h4>표정</h4><div class="chips">${FACES.map((f) => `<button data-f="${f}">${f}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-hold> 표정 유지</label>
    <h4>손</h4><div class="chips">${HAND_MODES.map((h) => `<button data-h="${h}">${h}</button>`).join('')}</div>
    <h4>반응 모션</h4><div class="chips">${MOTIONS.map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>
    <h4>대화 상태</h4><select data-s>${STATES.map((s) => `<option>${s}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" data-inertia checked> 관성 블렌딩</label>
    <h4>말할 언어 (음성 입력)</h4><select data-lang>${LISTEN.map(([v, l]) => `<option value="${v}"${v === listenLang() ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  controlsRoot.append(ctl);
  const bar = document.createElement('div');
  bar.id = 'chat';
  bar.innerHTML = `<form><input placeholder="말 걸기" autocomplete="off"><button type="button" data-mic title="누르고 있는 동안 말하기 (VR: 트리거나 손가락 집기)">🎤</button><button>보내기</button></form>`;
  document.body.append(bar);
  const input = bar.querySelector('input'), stateSel = ctl.querySelector('[data-s]');
  const b = () => getBehavior();

  ctl.querySelectorAll('[data-r]').forEach((el) => (el.onclick = () => b()?.react(el.dataset.r)));
  ctl.querySelectorAll('[data-h]').forEach((el) => (el.onclick = () => b()?.c.hands.set(el.dataset.h)));
  const hold = ctl.querySelector('[data-hold]');
  ctl.querySelectorAll('[data-f]').forEach((el) => (el.onclick = () => b()?.express(el.dataset.f, { hold: hold.checked })));
  stateSel.onchange = () => b()?.setState(stateSel.value);
  ctl.querySelector('[data-inertia]').onchange = (e) => { if (b()) b().c.inertialBlend = e.target.checked; };
  input.oninput = () => { if (input.value && b()?.state === 'idle') b().setState('listening'); };
  input.onblur = () => { if (!input.value && b()?.state === 'listening') b().setState('idle'); };

  ctl.querySelector('[data-lang]').onchange = (e) => { try { localStorage.setItem('ph.listenLang', e.target.value); } catch { /* private window */ } };
  async function ask(text) {
    text = text.trim();
    if (!text || !b()) return;
    input.value = '';
    b().react('nod', 0.5);
    b().setState('thinking');
    const [answer] = await Promise.all([reply(text), new Promise((r) => setTimeout(r, 900))]);
    say(answer);
  }
  bar.querySelector('form').onsubmit = (e) => { e.preventDefault(); ask(input.value); };

  // Your voice, held to talk: the browser's recognizer if it has one, else record and send to /api/stt
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recorder = null, useServer = !SR;
  async function listenStart() {
    if (rec || recorder) return;
    if (b()?.state === 'idle') b().setState('listening');
    if (!useServer) {
      let heard = '';
      rec = new SR(); rec.lang = listenLang(); rec.interimResults = true; rec.continuous = true;
      rec.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(''); input.value = heard; };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') useServer = true; };
      rec.onend = () => { rec = null; if (heard.trim()) ask(heard); else if (b()?.state === 'listening') b().setState('idle'); };
      rec.start();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); recorder = null;
        b()?.setState('thinking');
        try {
          const r = await fetch(`api/stt?lang=${listenLang().slice(0, 2)}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: new Blob(chunks) });
          const { text } = await r.json();
          if (text) return ask(text);
        } catch { /* no server STT */ }
        b()?.setState('idle');
      };
      recorder.start();
    } catch { recorder = null; b()?.setState('idle'); }
  }
  function listenStop() { rec?.stop(); if (recorder?.state === 'recording') recorder.stop(); }
  const mic = bar.querySelector('[data-mic]');
  mic.onpointerdown = (e) => { e.preventDefault(); mic.setPointerCapture(e.pointerId); listenStart(); };
  mic.onpointerup = mic.onpointercancel = () => listenStop();

  // Voice via the local server (scripts/server.py /api/tts: Miku V6 or Teto); falls back to browser TTS.
  // Clause by clause: the first clause plays while the next is still synthesising, so the wait is one
  // clause (~0.3 s for Miku) instead of the whole sentence (~1 s).
  let voice = null, turn = 0, talking = false;
  const tts = (text, style) => fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, style }) })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  /** interrupt: false for her own asides and reactions, which wait their turn instead of cutting a line off */
  async function say(text, { interrupt = true } = {}) {
    const beh = b();
    if (!beh || (!interrupt && talking)) return;
    // a clause of punctuation alone ('!?' -> '?') has nothing to sing: Miku's synth answers 400 to it
    const me = ++turn, clauses = text.split(/(?<=[、。！？!?,.])/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
    if (!clauses.length) return;
    let i = 0;
    talking = true;
    const style = beh.c.life?.near ? 'whisper' : undefined; // you're right at her face: she whispers the whole line
    try {
      let next = tts(clauses[0], style);
      for (; i < clauses.length; i++) {
        const { audio, marks } = await next;
        if (me !== turn) return;
        if (i + 1 < clauses.length) next = tts(clauses[i + 1], style);
        voice?.pause();
        voice = new Audio('data:audio/wav;base64,' + audio);
        route?.(voice);
        voice.onplay = () => beh.speakTimed(marks);
        const ended = new Promise((r) => { voice.onended = r; });
        await voice.play();
        await ended;
      }
      if (me === turn) { beh.stopSpeaking(); beh.setState('idle'); talking = false; }
      return;
    } catch { /* no server / no voice library */ }
    if (me === turn) { talking = false; browserSay(clauses.slice(i).join('')); } // only what wasn't said yet, and only if this is still the turn
  }
  function browserSay(text) {
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
  return { say, ask, listenStart, listenStop };
}
