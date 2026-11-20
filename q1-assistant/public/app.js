import { api } from './api.js';

// 前端业务层：只通过 api.js 调后端，不在浏览器里做权限判断或保存身份。
const $ = (id) => document.getElementById(id);
const state = { clients: [], clientId: null, docs: [], busy: false };

function addMsg(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? '我' : '项目资料助手';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrap.append(who, bubble);
  $('msgs').appendChild(wrap);
  scrollDown();
  return wrap;
}

function scrollDown() {
  $('msgs').scrollTop = $('msgs').scrollHeight;
}

// 在 bubble 之前插入"思考过程"区块，返回正文容器供逐字追加。
function renderReasoning(wrap, bubble, text = '') {
  const details = document.createElement('details');
  details.className = 'reasoning';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = '思考过程';
  const body = document.createElement('div');
  body.className = 'reasoning-body';
  body.textContent = text;
  details.append(summary, body);
  wrap.insertBefore(details, bubble);
  return body;
}

function renderAnswerMeta(wrap, bubble, answer) {
  const modeClass = {
    资料所述: 'mode-stated',
    模型推断: 'mode-infer',
    资料不足: 'mode-none',
  }[answer.mode] ?? 'mode-none';

  const tags = document.createElement('div');
  tags.className = 'tags';
  const mode = document.createElement('span');
  mode.className = `badge ${modeClass}`;
  mode.textContent = answer.mode;
  tags.appendChild(mode);

  answer.citations.forEach((cite, index) => {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'badge cite';
    badge.textContent = `${cite.docId} · ${cite.type} · ${cite.date}`;
    const quote = document.createElement('div');
    quote.className = 'quote';
    quote.textContent = `原文片段：${cite.quote}`;
    quote.id = `quote-${Date.now()}-${index}`;
    badge.addEventListener('click', () => quote.classList.toggle('open'));
    tags.appendChild(badge);
    wrap.appendChild(quote);
  });
  wrap.insertBefore(tags, bubble.nextSibling);

  answer.conflicts.forEach((conflict) => {
    const line = document.createElement('div');
    line.className = 'conflict';
    line.textContent = `冲突/时效：${conflict.docId} ${conflict.statement}`;
    wrap.appendChild(line);
  });
}

function createStreamingAnswer() {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = '项目资料助手';
  const bubble = document.createElement('div');
  bubble.className = 'bubble waiting';
  bubble.textContent = '正在检索可见资料…';
  wrap.append(who, bubble);

  // 提问瞬间就挂上"思考过程"区块与等待提示，不等第一个字，等待期也有可见反馈。
  const details = document.createElement('details');
  details.className = 'reasoning';
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = '思考过程';
  const reasoningBody = document.createElement('div');
  reasoningBody.className = 'reasoning-body';
  reasoningBody.textContent = '正在连接模型…';
  details.append(summary, reasoningBody);
  wrap.insertBefore(details, bubble);

  $('msgs').appendChild(wrap);
  scrollDown();

  let gotReasoning = false;
  let gotText = false;
  return {
    reasoning(delta) {
      if (!gotReasoning) {
        reasoningBody.textContent = '';
        gotReasoning = true;
      }
      reasoningBody.textContent += delta;
      scrollDown();
    },
    text(delta) {
      if (!gotText) {
        bubble.classList.remove('waiting');
        bubble.textContent = '';
        gotText = true;
      }
      bubble.textContent += delta;
      scrollDown();
    },
    finish(answer) {
      bubble.classList.remove('waiting');
      bubble.textContent = answer.text;
      if (answer.reasoning) reasoningBody.textContent = answer.reasoning;
      renderAnswerMeta(wrap, bubble, answer);
      scrollDown();
    },
  };
}

function renderIdentities() {
  const host = $('identities');
  host.replaceChildren();
  state.clients.forEach((client) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = client.name;
    button.classList.toggle('active', client.id === state.clientId);
    button.addEventListener('click', () => switchClient(client.id));
    host.appendChild(button);
  });
  const current = state.clients.find((c) => c.id === state.clientId);
  $('identity-label').textContent = `当前身份：${current?.name ?? '—'}`;
}

function renderDocs() {
  const host = $('doclist');
  host.replaceChildren();
  state.docs.forEach((doc) => {
    const row = document.createElement('div');
    row.className = `doc${doc.status === 'superseded' ? ' sup' : ''}`;
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = doc.id;
    const type = document.createElement('span');
    type.className = 't';
    type.textContent = doc.type;
    const date = document.createElement('span');
    date.className = 'd';
    date.textContent = doc.date;
    row.append(id, type, date);
    host.appendChild(row);
  });
  $('count').textContent = `可见 ${state.docs.length} 份`;
}

async function reloadDocs() {
  state.docs = await api.documents();
  renderDocs();
}

async function switchClient(clientId) {
  if (clientId === state.clientId || state.busy) return;
  await api.switchIdentity(clientId);
  state.clientId = clientId;
  $('msgs').replaceChildren();
  renderIdentities();
  await reloadDocs();
}

async function send() {
  const input = $('input');
  const question = input.value.trim();
  if (!question || state.busy) return;
  input.value = '';
  state.busy = true;
  $('send').disabled = true;
  addMsg('user', question);
  const view = createStreamingAnswer();
  try {
    await api.chatStream(question, (event) => {
      state.events += 1;
      if (event.type === 'reasoning') view.reasoning(event.delta);
      else if (event.type === 'text') view.text(event.delta);
      else if (event.type === 'done') view.finish(event.answer);
      else if (event.type === 'error') view.text(`\n生成失败：${event.message}`);
    });
  } catch (error) {
    view.text(`\n请求失败：${error.message}`);
  } finally {
    state.busy = false;
    $('send').disabled = false;
    input.focus();
  }
}

async function init() {
  try {
    const [clients, me] = await Promise.all([api.clients(), api.me()]);
    state.clients = clients;
    state.clientId = me.clientId;
    renderIdentities();
    await reloadDocs();
    addMsg('bot', '您好，请基于当前身份的可见资料提问；每条结论都会标注来源，资料不足时会如实说明。');
  } catch (error) {
    addMsg('bot', `初始化失败：${error.message}`);
    return;
  }
  $('send').addEventListener('click', send);
  $('input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send();
  });
}

init();
