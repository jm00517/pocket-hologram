// Talking with her: typing or holding the mic (or, in VR, a trigger / a pinch) → listening, send → thinking →
// speaking. Her answer comes from the local LLM behind the server's /api/chat (short spoken Japanese, as Miku, and how
// your words made her feel); without it she echoes you. Your voice: the browser's speech recognition where it has one
// (Chrome: fast), else a recording sent to the server's /api/stt (faster-whisper, slower).
// The story speaks through the same voice: say() resolves when a line is over (or cut), stop() cuts her off, hear()
// takes your next utterance as an answer instead of talk, setEnabled() puts the bar away during scenes.
import { toVowels, EXPRESSIONS, REACTIONS as BODY } from '../character/Behavior.js';
import { LIBRARY } from '../character/Motions.js';
import { HAND_MODES } from '../character/Hands.js';

const MOTIONS = [...new Set([...BODY, ...Object.keys(LIBRARY.reactions)])];
const FACES = ['neutral', ...Object.keys(EXPRESSIONS)];
const STATES = ['idle', 'listening', 'thinking', 'speaking'];

const langOf = (s) => (/[가-힣]/.test(s) ? 'ko' : /[぀-ヿ]/.test(s) ? 'ja' : 'en');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pickVoice(lang) {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  return vs.find((v) => /female|heami|sunhi|nanami|haruka|ayumi|zira|aria/i.test(v.name)) ?? vs[0];
}

const history = []; // the conversation so far, for the LLM (the server keeps the last dozen turns)
/** -> { answer, feeling }; feeling null when no LLM answered (she echoes you, and it isn't an exchange) */
async function reply(text, context) {
  history.push({ role: 'user', content: text });
  let extra = '';
  try { extra = String(context?.() ?? '').slice(0, 2000); } catch { /* a broken story persona: talk without it */ }
  try {
    const r = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, context: extra || undefined }) });
    if (!r.ok) throw new Error(r.status);
    const { reply: answer, feeling = 0 } = await r.json();
    history.push({ role: 'assistant', content: answer });
    history.splice(0, Math.max(0, history.length - 24));
    return { answer, feeling };
  } catch {
    history.pop();
    return { answer: text, feeling: null }; // no LLM: she says it back
  }
}
const LISTEN = [['ko-KR', '한국어'], ['ja-JP', '日本語'], ['en-US', 'English']];
const listenLang = () => { try { return localStorage.getItem('ph.listenLang') || 'ko-KR'; } catch { return 'ko-KR'; } };

// controls go in the drawer's character section; only the chat input sits at the bottom of the screen
/** route(audioElement): optional, sends her voice somewhere other than straight out (e.g. a 3D sound at her head).
 *  context(): optional, text appended to her persona on every /api/chat (the story's persona()).
 *  onReply({ text, reply, feeling }): optional, after each exchange she answered (feeling -2..2: how your words made her feel). */
export function mountChatBar(getBehavior, controlsRoot, { route, context, onReply } = {}) {
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
  const idle = () => { if (b()?.state === 'listening' || b()?.state === 'thinking') b().setState('idle'); };

  ctl.querySelectorAll('[data-r]').forEach((el) => (el.onclick = () => b()?.react(el.dataset.r)));
  ctl.querySelectorAll('[data-h]').forEach((el) => (el.onclick = () => b()?.c.hands.set(el.dataset.h)));
  const hold = ctl.querySelector('[data-hold]');
  ctl.querySelectorAll('[data-f]').forEach((el) => (el.onclick = () => b()?.express(el.dataset.f, { hold: hold.checked })));
  stateSel.onchange = () => b()?.setState(stateSel.value);
  ctl.querySelector('[data-inertia]').onchange = (e) => { if (b()) b().c.inertialBlend = e.target.checked; };
  input.oninput = () => { if (input.value && b()?.state === 'idle') b().setState('listening'); };
  input.onblur = () => { if (!input.value && b()?.state === 'listening') b().setState('idle'); };

  ctl.querySelector('[data-lang]').onchange = (e) => { try { localStorage.setItem('ph.listenLang', e.target.value); } catch { /* private window */ } };
  let enabled = true, hearing = null, asking = 0;
  async function ask(text) {
    text = text.trim();
    if (!text || !b()) return;
    input.value = '';
    b().react('nod', 0.5);
    b().setState('thinking');
    const me = ++asking;
    const [{ answer, feeling }] = await Promise.all([reply(text, context), wait(900)]);
    // a scene began (or stop()) while she thought: a late answer would talk over it. A newer ask or stop() owns the
    // state then: idle() would knock her out of its 'thinking' (or a scene's state)
    if (me !== asking) return;
    if (!enabled) return idle();
    await say(answer);
    if (feeling !== null) onReply?.({ text, reply: answer, feeling });
  }
  // what you said (typed, or heard while the mic was held) answers a waiting hear(), else it's talk to her
  function utter(text) {
    text = text.trim();
    if (text && hearing) { const h = hearing; hearing = null; input.value = ''; idle(); return h(text); }
    if (text && enabled) return ask(text);
    idle(); // nothing heard: a pending hear() keeps waiting
  }
  bar.querySelector('form').onsubmit = (e) => { e.preventDefault(); utter(input.value); };
  /** the next utterance resolves this instead of going to her (one-shot; a second hear() ends the first with '') */
  function hear() { unhear(); return new Promise((r) => { hearing = r; }); }
  function unhear() { const h = hearing; hearing = null; h?.(''); }
  /** show/hide the chat bar; while off, talk is dropped (a late LLM answer too) and the mic only answers hear() */
  function setEnabled(on) { enabled = !!on; bar.style.display = enabled ? '' : 'none'; if (!enabled) input.blur(); }

  // Your voice, held to talk: the browser's recognizer if it has one, else record and send to /api/stt
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recorder = null, useServer = !SR;
  async function listenStart() {
    if (rec || recorder || (!enabled && !hearing)) return;
    if (b()?.state === 'idle') b().setState('listening');
    if (!useServer) {
      let heard = '';
      rec = new SR(); rec.lang = listenLang(); rec.interimResults = true; rec.continuous = true;
      rec.onresult = (e) => { heard = [...e.results].map((r) => r[0].transcript).join(''); input.value = heard; };
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') useServer = true; };
      rec.onend = () => { rec = null; utter(heard); };
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
        let text = '';
        try {
          const r = await fetch(`api/stt?lang=${listenLang().slice(0, 2)}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: new Blob(chunks) });
          ({ text = '' } = await r.json());
        } catch { /* no server STT */ }
        utter(text);
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
  let voice = null, turn = 0, talking = false, cut = null;
  const tts = (text, o) => fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...o }) })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  /** interrupt: false for her own asides and reactions, which wait their turn instead of cutting a line off.
   *  voice: 'miku' | 'teto' (absent: the server's default). style: 'whisper' | '' (plain); absent or null: she whispers
   *  when you're at her face. cache: the line goes to the server whole, which keeps the audio (the dev tools bake story
   *  lines the same way, so a baked line starts at once). Resolves when she's done or was cut off (a new say, stop()). */
  function say(text, { interrupt = true, voice: who, style, cache = false } = {}) {
    const beh = b();
    if (!beh || (!interrupt && talking)) return Promise.resolve();
    // a clause of punctuation alone ('!?' -> '?') has nothing to sing: Miku's synth answers 400 to it
    const clauses = (cache ? [text] : text.split(/(?<=[、。！？!?,.])/)).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
    if (!clauses.length) return Promise.resolve();
    const me = ++turn;
    cut?.(); // whoever waits on the line she was saying: it's over
    let done; const over = new Promise((r) => { done = r; });
    cut = done;
    const o = { voice: who || undefined, style: style ?? (beh.c.life?.near ? 'whisper' : undefined), cache: cache || undefined };
    speak(me, beh, clauses, o, over).then(done, done);
    return over;
  }
  async function speak(me, beh, clauses, o, over) {
    let i = 0;
    talking = true;
    try {
      let next = tts(clauses[0], o);
      for (; i < clauses.length; i++) {
        const { audio, marks } = await next;
        if (me !== turn) return;
        if (i + 1 < clauses.length) next = tts(clauses[i + 1], o);
        voice?.pause();
        voice = new Audio('data:audio/wav;base64,' + audio);
        route?.(voice);
        voice.onplay = () => beh.speakTimed(marks);
        const ended = new Promise((r) => { voice.onended = voice.onerror = r; });
        await voice.play();
        await Promise.race([ended, over]); // a paused clip never ends
        if (me !== turn) return;
      }
      beh.stopSpeaking(); beh.setState('idle'); talking = false;
      return;
    } catch { /* no server / no voice library */ }
    if (me === turn) { talking = false; await browserSay(clauses.slice(i).join(''), me); } // only what wasn't said yet, and only if this is still the turn
  }
  function browserSay(text, me) {
    const beh = b();
    if (!beh) return;
    if (!('speechSynthesis' in window)) { beh.speak(text); return wait((toVowels(text).length / 7) * 1000); } // a mouth and no sound: over with its vowels
    speechSynthesis.cancel();
    return new Promise((done) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = { ko: 'ko-KR', ja: 'ja-JP', en: 'en-US' }[langOf(text)];
      u.voice = pickVoice(u.lang.slice(0, 2)) ?? null;
      u.pitch = 1.4; u.rate = 1.05;
      u.onstart = () => beh.speak(text);
      // resync the mouth to where the TTS actually is
      u.onboundary = (ev) => beh.speak(text, { from: toVowels(text.slice(0, ev.charIndex)).length });
      u.onend = u.onerror = () => { if (me === turn) { beh.stopSpeaking(); beh.setState('idle'); } done(); };
      speechSynthesis.speak(u);
      beh.speak(text); // start the mouth now; onstart/onboundary resync if TTS actually runs
      setTimeout(done, 2000 + text.length * 300); // Chrome can drop an utterance without onend: a scene must not hang on it
    });
  }
  /** cut her off now: sound and mouth stop, she goes idle, the pending say() resolves, a pending LLM answer is dropped */
  function stop() {
    turn++; asking++; talking = false;
    cut?.(); cut = null;
    voice?.pause(); voice = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const beh = b();
    beh?.stopSpeaking(); if (beh && beh.state !== 'idle') beh.setState('idle');
  }
  /** true while her voice plays (server audio or the browser's TTS) */
  const speaking = () => !!(voice && !voice.paused && !voice.ended) || ('speechSynthesis' in window && speechSynthesis.speaking);
  return { say, ask, listenStart, listenStop, stop, hear, unhear, setEnabled, speaking };
}
