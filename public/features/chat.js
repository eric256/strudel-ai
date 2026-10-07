// Feature module split out of app.js (see the section comments below).
import { bubbleRenderer, extractCode, fencedBlock, requestLLM } from './llm.js';
import { parseJSONLoose, signed, stripThinking } from '../lib/util.js';
import { applySongEdit, rawSheet, refreshPlayingSection } from './song-editor.js';
import { prepareCode } from './sound-check.js';
import { askRouting, wantsRouting } from './routing-ai.js';
import { scaleHelp } from '../lib/scales.js';
import { $, MAX_FIX_ATTEMPTS, activeSong, addMsg, applyPadsReply, applyQuantized, chatContext, chatTarget, clog, createSongFromChat, evaluateCode, getCode, historyForModel, libraryFromReply, normCode, queue, renderMarkdownLite, state, warnUser } from '../app.js';
// ---------------------------------------------------------------------------
// Chat turn
// ---------------------------------------------------------------------------
/**
 * One chat request. The first reply streams into a chat bubble; if its code needs
 * fixing (no code, unknown names, errors when test-played), the retries run quietly
 * — they stream into the 🖥 Console — and the bubble is updated with the final, working
 * reply. Only when every attempt fails does an error reach the chat.
 */
export async function runTurn(userText, attempt = 0, bubble = null, failedCode = null) {
  state.history.push({ role: 'user', content: userText });
  let r = null;
  if (!bubble) {
    bubble = addMsg('assistant', '', { raw: true });
    r = bubbleRenderer(bubble);
  } else {
    setBubbleNote(bubble, `🔧 checking and fixing (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS + 1}) — see 🖥 Console`);
  }
  // song / pads context only rides along on this request (not stored in the history)
  const messages = historyForModel();
  const ctx = chatContext(userText);
  if (ctx) messages[messages.length - 1] = { role: 'user', content: `${ctx}\n\n${messages[messages.length - 1].content}` };
  const text = await requestLLM({
    messages,
    // a fix request works on the AI's failed attempt — not on what's in the editor
    code: failedCode ?? getCode(),
    fixing: failedCode != null,
    onError: () => { if (!bubble.textContent.trim()) bubble.remove(); },
    edited: state.lastAICode != null && normCode(getCode()) !== normCode(state.lastAICode),
    onUpdate: r?.update,
    signal: state.abort.signal,
    label: attempt ? `fix ${attempt}` : 'chat',
  });
  r?.done();
  let code = extractCode(text);

  const retry = (why, msg, fixCode = null) => {
    clog('warn', `✗ ${why} — asking the AI again (${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
    return runTurn(msg, attempt + 1, bubble, fixCode);
  };
  // couldn't fix it: details stay in the console; the reply only gets a ⚠ with the reason as tooltip
  const giveUp = (msg) => { setBubbleNote(bubble, '⚠ not applied', msg); warnUser(msg); };

  // song structure / parts / pads answers
  const songBlock = fencedBlock(text, 'song'), padsBlock = fencedBlock(text, 'pads');
  let partsBlock = fencedBlock(text, 'parts');
  // a reply that rewrote the song's part library as editor code (consts or "part_variant:" labels) is a parts edit
  if (!partsBlock && code && chatTarget() !== 'code') {
    const lib = libraryFromReply(code, activeSong());
    if (lib) { clog('fix', '🎵 the reply rewrote the song’s parts as editor code — applying it to the song’s parts instead'); partsBlock = lib; code = null; }
  }
  const notes = [];
  if (padsBlock) {
    try { const done = applyPadsReply(padsBlock); if (done) notes.push(`🔲 ${done}`); }
    catch (e) { clog('warn', `pads reply unusable: ${e.message}`); }
  }
  if (songBlock || partsBlock) {
    const sg = activeSong();
    if (!sg) notes.push('🎵 no song is open — open one in 🎵 Songs to edit it');
    else {
      let raw = null;
      try { raw = songBlock ? parseJSONLoose(songBlock) : rawSheet(sg.sheet); } catch (e) { raw = null; clog('warn', `song reply unusable: ${e.message}`); }
      const err = raw ? await applySongEdit(sg, raw, partsBlock) : 'the ```song block is not valid JSON';
      if (err) {
        if (attempt < MAX_FIX_ATTEMPTS) {
          return retry(`song edit: ${err}`, `${userText.replace(/\n\nTHE SONG EDIT FAILED[\s\S]*$/, '')}\n\nTHE SONG EDIT FAILED: ${err}. Return the corrected \`\`\`song and \`\`\`parts blocks.`);
        }
        notes.push('⚠ song not changed');
        warnUser(`Song edit failed: ${err}`);
      } else {
        // say what the song really does now (tempo / key moves), not just what the reply claims
        const moved = sg.sheet.sections.filter((x) => x.bpm || x.shift).map((x) => `${x.name}: ${[x.bpm ? `${x.bpm} bpm` : '', x.shift ? `key ${signed(x.shift)}` : ''].filter(Boolean).join(', ')}`);
        // the section playing now switches to its new version on the next bar (the rest already did)
        const nowToo = await refreshPlayingSection(sg);
        const when = queue.songs.includes(sg) && queue.running ? (nowToo ? ' — from the next bar' : ' — from its next section') : '';
        notes.push(`🎵 “${sg.title}” updated${when} · ${sg.sheet.bpm} bpm${moved.length ? `; ${moved.join(' · ')}` : ', one tempo throughout'}`);
      }
    }
  }
  // whole-song mode: the song blocks are the answer; editor code would only change the section playing now
  if (chatTarget() === 'song' && (songBlock || partsBlock) && code) { clog('info', 'whole-song mode: ignored the reply’s editor code'); code = null; }
  if (!code && notes.length) {
    // a song / pads answer without new editor code
    state.history.push({ role: 'assistant', content: stripThinking(text) });
    setBubbleNote(bubble, notes.join(' · '));
    return;
  }

  if (!code) {
    state.history.pop(); // don't let the model imitate a code-less reply
    if (attempt < MAX_FIX_ATTEMPTS) {
      const base = userText.replace(/\n\nIMPORTANT: your previous reply[\s\S]*$/, '');
      if (chatTarget() === 'song') {
        return retry('no song in the reply', base + '\n\nIMPORTANT: your previous reply changed nothing. Reply with the COMPLETE updated sheet in a ```song block ' +
          '(and a ```parts block if parts change).');
      }
      return retry('no code in the reply', base + '\n\nIMPORTANT: your previous reply had no code. Answer with ONE short sentence, then the COMPLETE ' +
        'updated program in a single ```javascript code block.');
    }
    return giveUp('The model did not return any code. Try rephrasing, clearing the chat, or a different model.');
  }
  const prep = await prepareCode(code);
  code = prep.code;
  let reply = stripThinking(text);
  for (const [a, b] of prep.corrections) reply = reply.split(a).join(b); // don't let the model learn wrong names
  state.history.push({ role: 'assistant', content: reply });
  state.lastAICode = code;
  // show the corrected code, not the misspelled one
  if (prep.corrections.length && attempt === 0) { const d = bubble.querySelector(':scope > .typing, :scope > div:not(.note):not(.actions)'); if (d) d.innerHTML = renderMarkdownLite(reply); }

  if (prep.error) {
    if (attempt < MAX_FIX_ATTEMPTS) return retry(prep.error, prep.error + ' Return the full corrected program.', code);
    return giveUp(`Couldn't get working code: ${prep.error}`);
  }

  const finish = () => {
    // the bubble shows the reply that actually worked
    if (attempt > 0) { bubble.innerHTML = ''; const d = document.createElement('div'); d.innerHTML = renderMarkdownLite(reply); bubble.appendChild(d); }
    setBubbleNote(bubble, [attempt > 0 ? `🔧 fixed automatically (${attempt} retr${attempt > 1 ? 'ies' : 'y'})` : '', ...notes].filter(Boolean).join(' · '));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const now = document.createElement('button');
    now.textContent = '▶ Apply now';
    now.onclick = () => evaluateCode(code);
    const q = document.createElement('button');
    q.textContent = '⏱ Apply on bar';
    q.onclick = () => applyQuantized(code, 'chat change');
    actions.append(now, q);
    bubble.appendChild(actions);
  };

  if (!$('autoApply').checked) { finish(); return; }

  const err = await applyQuantized(code, 'chat change');
  if (!err) {
    finish();
    clog('ok', state.pending ? `✓ chat change armed for bar ${state.pending.at + 1}` : '✓ chat change applied');
    addMsg('info', state.pending ? `✓ armed — switching at bar ${state.pending.at + 1}` : '✓ applied & playing');
    return;
  }
  if ($('autoFix').checked && attempt < MAX_FIX_ATTEMPTS) {
    return retry(`error when test-played: ${err.message}`,
      `The code you returned threw this error when it played:\n${err.message}\n` +
        (/scale/i.test(err.message) ? scaleHelp() + '\n' : '') +
        'Fix it and return the full corrected program. Only use functions from the reference.', code);
  }
  finish();
  giveUp(`Not applied (the old music keeps playing): ${err.message}`);
}

/** A small status line under a chat reply. */
function setBubbleNote(bubble, text, tooltip = '') {
  let n = bubble.querySelector(':scope > .note');
  if (!text) { n?.remove(); return; }
  if (!n) { n = document.createElement('div'); n.className = 'note'; bubble.appendChild(n); }
  n.textContent = text;
  n.title = tooltip;
  n.classList.toggle('warn', !!tooltip);
}

export function setBusy(b) {
  state.busy = b;
  $('send').textContent = b ? 'Stop' : 'Send';
  $('send').classList.toggle('stop', b);
}

/** Start-up: the statements that ran here when this was part of app.js (called from app.js at the same point). */
export function setup() {
  $('chat-form').onsubmit = async (e) => {
    e.preventDefault();
    if (state.busy) { state.abort?.abort(); return; }
    const text = $('input').value.trim();
    if (!text) return;
    $('input').value = '';
    addMsg('user', text);
    if ($('chatTarget').value === 'new') { createSongFromChat(text); return; }
    // 🎼 Studio without a song: the message describes one (it's written and opened in the editor)
    if (chatTarget() === 'new') { addMsg('info', '🎼 no song is open — writing a new one from that'); createSongFromChat(text); return; }
    if (chatTarget() === 'wait') { addMsg('info', '🎼 the song is still being written — ask again once it opens in ✎ Edit song'); $('input').value = text; return; }
    setBusy(true);
    state.abort = new AbortController();
    try {
      // 🔀 routing: the effect chains, not the code or the song
      if (wantsRouting(text)) await askRouting(text, { signal: state.abort.signal });
      else await runTurn(text);
    } catch (err) {
      if (err.name === 'AbortError') addMsg('info', 'stopped');
      else warnUser(`AI request failed: ${err.message}`);
    } finally {
      setBusy(false);
      $('input').focus({ preventScroll: true });
    }
  };

  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('chat-form').requestSubmit();
    }
  });
}
