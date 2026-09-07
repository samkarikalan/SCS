/* ============================================================
   HELP MODULE -- Redesigned with search, accordion, sections
   File: help.js
   ============================================================ */

var helpData        = null;
var loadedLang      = null;
var currentSection  = 'getting_started';
var helpSearchTimer = null;

/* ── Search placeholder per language ── */
const HELP_I18N = {
  en: { search: t('searchHelp'), no_results: t('noResultsFound'), loading: t('loading'), error: t('helpUnavailable'), contact: t('stillNeedHelp') },
  jp: { search: 'ヘルプを検索...', no_results: '結果が見つかりません', loading: '読み込み中...', error: '接続を確認してください。', contact: 'まだお困りですか？サポートに連絡' },
  kr: { search: '도움말 검색...', no_results: '결과 없음', loading: '로딩 중...', error: '연결을 확인하세요.', contact: '도움이 필요하신가요? 지원팀 문의' },
  zh: { search: '搜索帮助...', no_results: '没有结果', loading: '加载中...', error: '请检查您的连接。', contact: '仍需帮助？联系支持' },
  vi: { search: 'Tìm kiếm trợ giúp...', no_results: 'Không tìm thấy', loading: 'Đang tải...', error: 'Vui lòng kiểm tra kết nối.', contact: 'Vẫn cần trợ giúp? Liên hệ hỗ trợ' },
};

const SECTION_META = {
  getting_started: { icon: '🚀' },
  players:         { icon: '👥' },
  rounds:          { icon: '🏸' },
  vault:           { icon: '🔒' },
  viewer:          { icon: '👁' },
  clubs:           { icon: '🏟️' },
  subscription:    { icon: '⚡' },
  settings:        { icon: '⚙️' },
  faq:             { icon: '❓' },
};

const SECTION_LABELS = {
  en: { getting_started:'Get Started', players:'Players', rounds:'Rounds', vault:'Vault', viewer:'Player', clubs:'Clubs', subscription:'Subscription', settings:'Settings', faq:'FAQ' },
  jp: { getting_started:'はじめに', players:'プレイヤー', rounds:'ラウンド', vault:'ボールト', viewer:'ビューワー', clubs:'クラブ', subscription:'サブスクリプション', settings:'設定', faq:'よくある質問' },
  kr: { getting_started:'시작하기', players:'플레이어', rounds:'라운드', vault:'볼트', viewer:'뷰어', clubs:'클럽', subscription:'구독', settings:'설정', faq:'자주 묻는 질문' },
  zh: { getting_started:'开始', players:'球员', rounds:'回合', vault:'保险库', viewer:'查看者', clubs:'俱乐部', subscription:'订阅', settings:'设置', faq:'常见问题' },
  vi: { getting_started:'Bắt đầu', players:'Người chơi', rounds:'Vòng đấu', vault:'Kho', viewer:'Người xem', clubs:'Câu lạc bộ', subscription:'Đăng ký', settings:'Cài đặt', faq:'Câu hỏi thường gặp' },
};

function getLang()    { return localStorage.getItem('appLanguage') || 'en'; }
function getI18n(key) { return (HELP_I18N[getLang()] || HELP_I18N.en)[key]; }
function getSectionLabel(key) { return ((SECTION_LABELS[getLang()] || SECTION_LABELS.en)[key]) || key; }

/* ── Load help JSON ── */
function loadHelpData(callback) {
  const lang = getLang();
  if (helpData && loadedLang === lang) { callback(helpData); return; }

  _setHelpContainer(`<div class="help-loading"><div class="help-spinner"></div><p>${getI18n('loading')}</p></div>`);

  fetch(`./help_${lang}.json?v=${Date.now()}`)
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => { helpData = data; loadedLang = lang; callback(data); })
    .catch(() => {
      if (lang !== 'en') {
        fetch(`./help_en.json?v=${Date.now()}`)
          .then(r => r.json())
          .then(data => { helpData = data; loadedLang = 'en'; callback(data); })
          .catch(showHelpError);
      } else { showHelpError(); }
    });
}

function showHelpError() {
  _setHelpContainer(`
    <div class="help-state-box">
      <div class="help-state-icon">📡</div>
      <p class="help-state-msg">${getI18n('error')}</p>
      <button class="help-retry-btn" onclick="renderHelp()">↺ Retry</button>
    </div>`);
}

function _setHelpContainer(html) {
  const el = document.getElementById('helpContainer');
  if (el) el.innerHTML = html;
}

/* ── Render full help page ── */
function renderHelp() {
  // Update search placeholder
  const searchEl = document.getElementById('helpSearch');
  if (searchEl) searchEl.placeholder = getI18n('search');

  loadHelpData(data => {
    renderHelpNav(data);
    showHelpSection(currentSection, data);
  });
}

/* ── Render nav pills ── */
function renderHelpNav(data) {
  const nav = document.getElementById('helpNav');
  if (!nav) return;
  nav.innerHTML = Object.entries(SECTION_META)
    .filter(([key]) => data[key])
    .map(([key, meta]) => `
      <button class="help-nav-pill ${key === currentSection ? 'active' : ''}"
        onclick="switchHelpSection('${key}')">
        <span class="help-nav-icon">${meta.icon}</span>
        <span class="help-nav-label">${getSectionLabel(key)}</span>
      </button>`).join('');
}

/* ── Switch section ── */
function switchHelpSection(key) {
  currentSection = key;
  document.querySelectorAll('.help-nav-pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('onclick').includes(`'${key}'`));
  });
  const searchEl = document.getElementById('helpSearch');
  if (searchEl) searchEl.value = '';
  showHelpSection(key, helpData);
}

/* ── Show section ── */
function showHelpSection(sectionKey, data) {
  const section = data?.[sectionKey];
  if (!section) { _setHelpContainer('<div class="help-state-box"><p class="help-state-msg">No content available.</p></div>'); return; }

  const items = Object.entries(section).map(([k, topic], i) => renderAccordionItem(k, topic, i === 0)).join('');
  _setHelpContainer(`<div class="help-acc-list-wrap">${items}</div>${_contactFooter()}`);
}

/* ── Contact footer ── */
function _contactFooter() {
  return `<div class="help-contact-footer">
    <span class="help-contact-icon">💬</span>
    <span>${getI18n('contact')}</span>
  </div>`;
}

/* ── Render accordion item ── */
function renderAccordionItem(key, topic, openByDefault) {
  const title   = topic.title   || key;
  const content = topic.content || '';
  const list    = topic.list    || [];
  const tip     = topic.tip     || '';
  const note    = topic.note    || '';
  const steps   = topic.steps   || []; // numbered steps support

  const bodyHtml = `
    ${content ? `<p class="help-acc-text">${content}</p>` : ''}
    ${steps.length ? `<ol class="help-steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
    ${list.length  ? `<ul class="help-acc-list">${list.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
    ${tip  ? `<div class="help-tip"><span class="help-tip-icon">💡</span><span>${tip}</span></div>`   : ''}
    ${note ? `<div class="help-note"><span class="help-tip-icon">📌</span><span>${note}</span></div>` : ''}
  `;

  return `
    <div class="help-acc ${openByDefault ? 'open' : ''}" data-key="${key}">
      <div class="help-acc-header" onclick="toggleAccordion(this)">
        <span class="help-acc-title">${title}</span>
        <span class="help-acc-chevron">›</span>
      </div>
      <div class="help-acc-body">
        <div class="help-acc-inner">${bodyHtml}</div>
      </div>
    </div>`;
}

/* ── Toggle accordion ── */
function toggleAccordion(header) {
  const item   = header.closest('.help-acc');
  const isOpen = item.classList.toggle('open');
  header.querySelector('.help-acc-chevron').style.transform = isOpen ? 'rotate(90deg)' : '';
}

/* ── Search ── */
function helpSearch(query) {
  clearTimeout(helpSearchTimer);
  helpSearchTimer = setTimeout(() => {
    const q = query.trim().toLowerCase();
    if (!q) { showHelpSection(currentSection, helpData); return; }

    const results = [];
    Object.entries(helpData || {}).forEach(([, section]) => {
      Object.entries(section).forEach(([topicKey, topic]) => {
        const allText = [topic.title, topic.content, ...(topic.list||[]), ...(topic.steps||[])].join(' ').toLowerCase();
        if (allText.includes(q)) results.push({ topicKey, topic });
      });
    });

    if (!results.length) {
      _setHelpContainer(`
        <div class="help-state-box">
          <div class="help-state-icon">🔍</div>
          <p class="help-state-msg">${getI18n('no_results')}</p>
        </div>`);
      return;
    }
    _setHelpContainer(`<div class="help-acc-list-wrap">${results.map(({topic}, i) => renderAccordionItem(`r_${i}`, topic, true)).join('')}</div>`);
  }, 220);
}

/* ── Language change ── */
function changeLanguage(lang) {
  localStorage.setItem('appLanguage', lang);
  helpData   = null;
  loadedLang = null;
  const hp = document.getElementById('helpPage');
  if (hp && hp.style.display !== 'none') renderHelp();
}

/* ── Tab open ── */
function onHelpTabOpen() { renderHelp(); }

document.addEventListener('DOMContentLoaded', () => {
  const hp = document.getElementById('helpPage');
  if (hp && hp.style.display !== 'none') renderHelp();
});
