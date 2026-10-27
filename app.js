/* 마이위시포켓 — 여러 쇼핑몰의 위시 상품을 한곳에 모으는 위시리스트
 * 데이터(위시, 폴더, 구매 기준)는 브라우저 localStorage에 저장한다.
 */
(() => {
  'use strict';

  const KEY = { items: 'mwp.items.v2', folders: 'mwp.folders.v2', criteria: 'mwp.criteria.v2' };
  const ALL = '__all__';             // '내 위시템' = 모든 위시
  const DEFAULT_FOLDER_NAME = '내 위시템';
  const DEFAULT_CRITERIA = [
    '이게 없어서 지금 실제로 불편한 일이 있나?',
    '비슷한 물건이 집에 없나?',
    '한 달 뒤에도 여전히 갖고 싶을까?',
    '일주일에 한 번 이상 쓸까?',
    '이번 달 예산 안에서 살 수 있나?',
    '세일이 아니어도 살까?',
    '다른 쇼핑몰보다 이 가격이 최선인가?',
  ];

  // ---------- 상태 ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let items = loadArr(KEY.items).filter((it) => it && typeof it.id === 'string' && typeof it.title === 'string');
  let folders = loadArr(KEY.folders).filter((f) => f && f.id && f.name);
  let criteria = loadArr(KEY.criteria, null);
  if (!criteria) criteria = DEFAULT_CRITERIA.map((text) => ({ id: uid(), text }));

  let view = 'wish';
  let currentFolder = ALL;
  let editingId = null;
  let starValue = 3;
  let starTouched = false;   // 사용자가 별을 직접 눌렀는지 (누른 뒤에는 추천이 덮어쓰지 않음)

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const sheet = $('sheet');
  const form = $('form');
  const tpl = $('card-tpl');

  // ---------- 저장 ----------
  function loadArr(key, fallback = []) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : fallback;
    } catch { return fallback; }
  }
  function save() {
    try {
      localStorage.setItem(KEY.items, JSON.stringify(items));
      localStorage.setItem(KEY.folders, JSON.stringify(folders));
      localStorage.setItem(KEY.criteria, JSON.stringify(criteria));
    } catch { toast('저장 공간이 부족해 저장하지 못했어요'); }
  }

  // ---------- 유틸 ----------
  const won = (n) => (n == null ? '' : n.toLocaleString('ko-KR') + '원');
  function parsePrice(text) {
    const s = String(text ?? '').replace(/\s/g, '');
    if (!s) return null;
    const man = s.match(/^([\d.]+)만/);
    if (man) return Math.round(parseFloat(man[1]) * 10000);
    const digits = s.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }
  // 네이버 스마트스토어 상품은 로그인한 사람에게만 보여서, 열면 로그인 화면이 먼저 나온다 (네이버 정책)
  function needsNaverLogin(url) {
    try { return /(^|\.)smartstore\.naver\.com$/.test(new URL(url).hostname); } catch { return false; }
  }
  function domainOf(url) { try { return new URL(url).hostname.replace(/^(www|m)\./, ''); } catch { return ''; } }
  function normalizeUrl(raw) {
    let s = (raw || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
  }
  const findUrl = (t) => ((t || '').match(/https?:\/\/[^\s]+/) || [''])[0];

  // 날짜는 기기 시간대 기준 'YYYY-MM-DD'로 다룬다
  function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysBetween(fromStr, toStr) {
    const [a, b] = [fromStr, toStr].map((s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); });
    return Math.round((b - a) / 86400000);
  }
  // 직접 입력한 세일이 우선이고, 없으면(또는 끝났으면) 자동 가격 확인 결과를 쓴다
  function saleInfo(it) {
    if (it.salePrice == null) return autoSale(it);
    let dday = null;
    if (it.saleEnd) {
      dday = daysBetween(todayStr(), it.saleEnd);
      if (dday < 0) return autoSale(it);    // 끝난 세일은 숨김
    }
    const pct = it.price && it.salePrice < it.price ? Math.round((1 - it.salePrice / it.price) * 100) : null;
    return { dday, pct, price: it.salePrice, base: it.price, auto: false };
  }
  // 자동 세일: 쇼핑몰의 지금 가격이 담을 때 가격(또는 쇼핑몰이 알려 준 원래 가격)보다 낮을 때
  function autoSale(it) {
    const base = Math.max(it.price || 0, it.autoOriginal || 0);
    if (it.autoPrice == null || !base || it.autoPrice >= base) return null;
    const pct = Math.round((1 - it.autoPrice / base) * 100);
    return { dday: null, pct: pct || null, price: it.autoPrice, base, auto: true };
  }
  const ddayText = (d) => (d == null ? '기간 미정' : d === 0 ? '오늘 마감' : `D-${d}`);
  const folderName = (id) => (folders.find((f) => f.id === id) || {}).name || DEFAULT_FOLDER_NAME;
  const starsText = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  // '예'의 비율로 별 추천: 전부 예 → 5, 전부 아니오 → 1
  function recommendStars(yes, total) {
    if (!total) return null;
    return Math.max(1, Math.round((yes / total) * 5));
  }

  let toastTimer;
  function toast(msg, action) {
    const el = $('toast');
    el.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = action.label;
      b.onclick = () => { action.run(); el.classList.remove('show'); };
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
  }

  // ---------- 화면: 공통 ----------
  const byNewest = (a, b) => b.createdAt - a.createdAt;

  function render() {
    renderSummary();
    renderSaleBoard();
    renderFolders();
    renderWish();
    renderPriority();
    renderCriteria();
  }

  function renderSummary() {
    $('count-all').textContent = items.length;
    const total = items.reduce((s, it) => s + ((saleInfo(it) || {}).price ?? it.price ?? 0), 0);
    $('total-all').textContent = won(total);
  }

  function renderSaleBoard() {
    const list = items
      .map((it) => ({ it, s: saleInfo(it) }))
      .filter((x) => x.s)
      .sort((a, b) => (a.s.dday ?? 9999) - (b.s.dday ?? 9999) || byNewest(a.it, b.it));
    const box = $('sale-list');
    box.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('span');
      p.className = 'sale-empty';
      p.textContent = '위시에 세일 정보를 입력하면 여기에 모여요';
      box.appendChild(p);
      return;
    }
    for (const { it, s } of list) {
      const a = document.createElement(it.url ? 'a' : 'span');
      a.className = 'sale-item' + (s.dday != null && s.dday <= 2 ? ' urgent' : '');
      if (it.url) { a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      const d = document.createElement('b'); d.textContent = s.auto ? '자동' : ddayText(s.dday);
      a.append(d, ` ${it.title} `);
      if (s.pct) { const p = document.createElement('em'); p.textContent = `${s.pct}%↓ `; a.append(p); }
      a.append(won(s.price));
      box.appendChild(a);
    }
  }

  function renderFolders() {
    const el = $('folders');
    el.innerHTML = '';
    const mk = (id, label, count) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(currentFolder === id));
      b.textContent = label;
      const c = document.createElement('span'); c.className = 'chip-count'; c.textContent = count;
      b.appendChild(c);
      b.onclick = () => { currentFolder = id; renderFolders(); renderWish(); };
      el.appendChild(b);
    };
    if (currentFolder !== ALL && !folders.some((f) => f.id === currentFolder)) currentFolder = ALL;
    mk(ALL, DEFAULT_FOLDER_NAME, items.length);
    for (const f of folders) mk(f.id, f.name, items.filter((it) => it.folder === f.id).length);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'chip chip-add'; add.textContent = '＋ 폴더';
    add.onclick = openFolderSheet;
    el.appendChild(add);
  }

  // 핀터레스트식 벽돌 배치: 화면 폭에 맞는 세로 줄을 만들고 카드를 왼쪽→오른쪽 차례로 나눠 담는다
  // (CSS columns만 쓰면 최신 카드가 위→아래로 쌓여 '최신이 맨 위' 순서가 흐트러진다)
  const colCount = () => (innerWidth >= 960 ? 4 : innerWidth >= 640 ? 3 : 2);
  let gridCols = colCount();
  function fillGrid(box, arr) {
    const cols = Array.from({ length: gridCols }, () => {
      const c = document.createElement('div'); c.className = 'col'; box.appendChild(c); return c;
    });
    arr.forEach((it, i) => cols[i % gridCols].appendChild(cardFor(it)));
  }
  window.addEventListener('resize', () => {
    if (colCount() !== gridCols) { gridCols = colCount(); renderWish(); renderPriority(); }
  });

  function renderWish() {
    const box = $('wish-list');
    box.innerHTML = '';
    const arr = items.filter((it) => currentFolder === ALL || it.folder === currentFolder).sort(byNewest);
    if (!arr.length) { box.appendChild(emptyMsg(items.length ? '이 폴더는 비어 있어요.' : null)); return; }
    fillGrid(box, arr);
  }

  function renderPriority() {
    const box = $('priority-list');
    box.innerHTML = '';
    if (!items.length) { box.appendChild(emptyMsg(null)); return; }
    for (let s = 5; s >= 1; s--) {
      const group = items.filter((it) => it.stars === s).sort(byNewest);
      if (!group.length) continue;
      const sec = document.createElement('section');
      sec.className = 'prio-group';
      const h = document.createElement('h3');
      h.className = 'prio-head';
      h.innerHTML = `<span class="stars">${starsText(s)}</span> <span class="prio-count"></span>`;
      h.querySelector('.prio-count').textContent = `${group.length}개`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      fillGrid(grid, group);
      sec.append(h, grid);
      box.appendChild(sec);
    }
  }

  function emptyMsg(text) {
    const d = document.createElement('div');
    d.className = 'empty';
    if (text) { d.textContent = text; return d; }
    d.innerHTML = '<p class="empty-title">아직 담긴 위시가 없어요</p><p>오른쪽 아래 <b>＋</b> 버튼을 눌러 상품 링크를 붙여넣어 보세요.</p>'
      + '<button type="button" class="btn ghost small">처음이라면 이용 방법 보기</button>';
    d.querySelector('button').onclick = () => setView('guide');
    return d;
  }

  function cardFor(it) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = it.id;
    const thumb = node.querySelector('.thumb');
    const img = thumb.querySelector('img');
    const titleA = node.querySelector('.card-title a');
    const go = node.querySelector('.go');
    if (it.url) { thumb.href = titleA.href = go.href = it.url; }
    else { thumb.removeAttribute('href'); titleA.removeAttribute('href'); go.remove(); }

    const placeholder = () => {
      img.remove();
      const ph = document.createElement('span');
      const h = [...(it.title || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0);
      ph.className = 'ph ph' + (h % 6);
      ph.style.aspectRatio = ['1', '4 / 5', '5 / 4'][h % 3];   // 높이를 섞어 벽돌 배치 느낌을 살린다
      ph.textContent = (it.title || '?').trim().charAt(0);
      thumb.appendChild(ph);
    };
    if (it.image) { img.referrerPolicy = 'no-referrer'; img.src = it.image; img.onerror = placeholder; }
    else placeholder();

    titleA.textContent = it.title;
    node.querySelector('.folder-name').textContent = folderName(it.folder);
    const st = node.querySelector('.stars');
    st.textContent = starsText(it.stars);
    st.setAttribute('aria-label', `우선순위 별 ${it.stars}개`);

    const s = saleInfo(it);
    const priceEl = node.querySelector('.price');
    if (s) {
      priceEl.textContent = won(s.price);
      if (s.base && s.base !== s.price) {
        const del = document.createElement('del'); del.textContent = won(s.base);
        priceEl.append(' ', del);
      }
      node.querySelector('.sale-tag').textContent = (s.auto ? '가격 내려감' : `${ddayText(s.dday)} 세일`) + (s.pct ? ` · ${s.pct}%↓` : '');
    } else {
      priceEl.textContent = it.price != null ? won(it.price) : '가격 미정';
    }
    node.querySelector('.memo').textContent = it.memo || '';
    const days = daysBetween(todayStr(new Date(it.createdAt)), todayStr());
    const dom = domainOf(it.url);
    node.querySelector('.sub').textContent = [dom, days === 0 ? '오늘 담음' : `담은 지 ${days}일`].filter(Boolean).join(' · ');
    if (needsNaverLogin(it.url)) node.querySelector('.note').textContent = '네이버 로그인 후 상품이 열려요';
    return node;
  }

  // ---------- 구매 기준 탭 ----------
  function renderCriteria() {
    const ol = $('criteria-list');
    ol.innerHTML = '';
    criteria.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'crit';
      const input = document.createElement('input');
      input.type = 'text'; input.value = c.text; input.maxLength = 60;
      input.setAttribute('aria-label', `질문 ${i + 1}`);
      input.addEventListener('change', () => {
        const v = input.value.trim();
        if (!v) { input.value = c.text; return; }
        c.text = v; save(); toast('질문을 고쳤어요');
      });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'icon-btn'; del.textContent = '✕';
      del.setAttribute('aria-label', `질문 ${i + 1} 삭제`);
      del.onclick = () => {
        criteria = criteria.filter((x) => x.id !== c.id);
        save(); renderCriteria();
        toast('질문을 지웠어요', { label: '되돌리기', run: () => { criteria.splice(i, 0, c); save(); renderCriteria(); } });
      };
      li.append(input, del);
      ol.appendChild(li);
    });
    if (!criteria.length) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = '질문이 없어요. 아래에서 추가해 보세요.';
      ol.appendChild(li);
    }
  }
  $('criteria-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('criteria-input').value.trim();
    if (!v) return;
    criteria.push({ id: uid(), text: v });
    $('criteria-input').value = '';
    save(); renderCriteria();
  });
  $('criteria-reset').addEventListener('click', () => {
    const prev = criteria;
    criteria = DEFAULT_CRITERIA.map((text) => ({ id: uid(), text }));
    save(); renderCriteria();
    toast('기본 질문으로 되돌렸어요', { label: '취소', run: () => { criteria = prev; save(); renderCriteria(); } });
  });

  // ---------- 탭 전환 ----------
  function setView(v) {
    view = v;
    for (const id of ['wish', 'priority', 'criteria', 'guide']) $('view-' + id).hidden = id !== v;
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    $('btn-add').hidden = v === 'criteria' || v === 'guide';
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  // ---------- 등록·수정 화면 ----------
  function fillFolderSelect(selected) {
    const sel = $('f-folder');
    sel.innerHTML = '';
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    opt('', DEFAULT_FOLDER_NAME + ' (폴더 없음)');
    for (const f of folders) opt(f.id, f.name);
    opt('__new__', '＋ 새 폴더 만들기');
    sel.value = selected && folders.some((f) => f.id === selected) ? selected : '';
    $('new-folder-row').hidden = true;
  }
  $('f-folder').addEventListener('change', (e) => {
    const isNew = e.target.value === '__new__';
    $('new-folder-row').hidden = !isNew;
    if (isNew) $('f-new-folder').focus();
  });

  function renderStarPick() {
    const box = $('star-pick');
    box.innerHTML = '';
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'star' + (n <= starValue ? ' on' : '');
      b.textContent = '★';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(n === starValue));
      b.setAttribute('aria-label', `별 ${n}개`);
      b.onclick = () => { starValue = n; starTouched = true; renderStarPick(); updateRecommend(); };
      box.appendChild(b);
    }
    const label = document.createElement('span');
    label.className = 'star-label';
    label.textContent = ['', '언젠가', '고민 중', '갖고 싶음', '곧 살 것', '꼭 살 것'][starValue];
    box.appendChild(label);
  }

  function renderChecks(answers) {
    const ul = $('f-checks');
    ul.innerHTML = '';
    if (!criteria.length) {
      const li = document.createElement('li'); li.className = 'hint';
      li.textContent = "'구매 기준' 탭에서 질문을 추가하면 여기에 나와요.";
      ul.appendChild(li);
    }
    for (const c of criteria) {
      const li = document.createElement('li');
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = c.id; cb.checked = !!(answers && answers[c.id]);
      cb.addEventListener('change', updateRecommend);
      lab.append(cb, ' ', c.text);
      li.appendChild(lab);
      ul.appendChild(li);
    }
    updateRecommend();
  }

  function updateRecommend() {
    const boxes = [...$('f-checks').querySelectorAll('input[type=checkbox]')];
    const yes = boxes.filter((b) => b.checked).length;
    const rec = recommendStars(yes, boxes.length);
    const el = $('recommend');
    el.innerHTML = '';
    if (rec == null) return;
    el.append(`'예' ${yes}/${boxes.length} → 추천 `);
    const s = document.createElement('b'); s.textContent = starsText(rec); el.appendChild(s);
    if (!starTouched) {
      if (starValue !== rec) { starValue = rec; renderStarPick(); }
    } else if (starValue !== rec) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'link-btn'; b.textContent = '추천대로 바꾸기';
      b.onclick = () => { starValue = rec; starTouched = false; renderStarPick(); updateRecommend(); };
      el.append(' ', b);
    }
  }

  function openSheet(item, prefill) {
    editingId = item ? item.id : null;
    form.reset();
    const d = item || prefill || {};
    $('sheet-title').textContent = item ? '위시 수정' : '위시 추가';
    $('btn-save').textContent = item ? '수정 저장' : '저장';
    $('form-error').textContent = '';
    setFetchStatus('');
    $('f-url').value = d.url || '';
    $('f-title').value = d.title || '';
    $('f-price').value = d.price != null ? d.price.toLocaleString('ko-KR') : '';
    $('f-sale-price').value = d.salePrice != null ? d.salePrice.toLocaleString('ko-KR') : '';
    $('f-sale-end').value = d.saleEnd || '';
    $('sale-box').open = d.salePrice != null || !!d.saleEnd;
    $('f-memo').value = d.memo || '';
    fillFolderSelect(item ? item.folder : (currentFolder !== ALL ? currentFolder : ''));
    setPreview(d.image || '');
    // 수정할 때는 저장된 별을 존중하고, 새로 추가할 때는 체크리스트 추천을 따른다
    starValue = item ? item.stars : 1;
    starTouched = !!item;
    renderStarPick();
    renderChecks(d.answers);
    pendingAuto = null;
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
    if (!item && d.url && !d.title) fetchPreview();
  }
  function closeSheet() {
    if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open');
    editingId = null;
  }

  let previewSrc = '';
  function setPreview(src) {
    previewSrc = src || '';
    $('f-preview').hidden = !src;
    const img = $('f-preview-img');
    if (src) { img.referrerPolicy = 'no-referrer'; img.src = src; img.onerror = () => { $('f-preview').hidden = true; }; }
    else img.removeAttribute('src');
  }
  // tone: true/'err' = 빨간 오류, 'soft' = 부드러운 안내 상자
  function setFetchStatus(msg, tone) {
    const el = $('fetch-status');
    el.textContent = msg;
    el.classList.toggle('err', tone === true || tone === 'err');
    el.classList.toggle('soft', tone === 'soft');
  }

  const MSG_MANUAL = '이 쇼핑몰은 상품 정보를 꼭꼭 숨겨 두어서 불러오지 못했어요. '
    + '상품명과 가격만 살짝 적어 주시면, 마이위시포켓이 예쁘게 담아 둘게요. 링크는 그대로 저장돼요.';
  const MSG_LOGIN = '네이버 상품은 로그인한 사람에게만 정보를 보여 줘서 불러오지 못했어요. '
    + '상품명과 가격만 살짝 적어 주세요. 링크는 그대로 저장되고, 나중에 \'사이트로 이동\'을 누른 뒤 로그인하면 상품이 열려요.';

  // /api/preview 호출 (등록 화면과 자동 가격 확인이 함께 사용)
  async function fetchInfo(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch('/api/preview?url=' + encodeURIComponent(url), { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && !data.error, data };
    } finally { clearTimeout(t); }
  }

  let pendingAuto = null;   // 등록 화면에서 불러온 '지금 가격' → 저장할 때 자동 세일 정보로 함께 저장

  async function fetchPreview() {
    const url = normalizeUrl($('f-url').value);
    if (!url) { setFetchStatus('올바른 링크(https://...)를 입력해 주세요', true); return; }
    $('f-url').value = url;
    const btn = $('btn-fetch');
    if (btn.disabled) return;   // 이미 불러오는 중
    btn.disabled = true;
    setFetchStatus('상품 정보를 불러오는 중…');
    try {
      const { ok, data } = await fetchInfo(url);
      if (data.reason === 'login' || needsNaverLogin(url)) { setFetchStatus(MSG_LOGIN, 'soft'); return; }
      if (!ok) throw new Error(data.error);
      const filled = [];
      if (data.title && !$('f-title').value.trim()) { $('f-title').value = data.title; filled.push('상품명'); }
      // 세일 중이면 '가격' 칸에는 원래 가격을 넣고, 지금 가격은 자동 세일로 저장한다
      const listPrice = data.originalPrice ?? data.price;
      if (listPrice != null && !$('f-price').value.trim()) { $('f-price').value = listPrice.toLocaleString('ko-KR'); filled.push('가격'); }
      if (data.image) { setPreview(data.image); filled.push('사진'); }
      pendingAuto = data.price != null ? { url, price: data.price, originalPrice: data.originalPrice ?? null } : null;
      let msg = filled.length ? `${filled.join('·')}을(를) 불러왔어요. 확인 후 저장하세요.` : MSG_MANUAL;
      if (data.originalPrice) {
        const pct = Math.round((1 - data.price / data.originalPrice) * 100);
        msg = `${filled.join('·')}을(를) 불러왔어요. 지금 ${pct}% 세일 중(${won(data.price)})이라 세일 알림판에 자동으로 띄워 둘게요.`;
      }
      setFetchStatus(msg, filled.length ? '' : 'soft');
    } catch {
      setFetchStatus(MSG_MANUAL, 'soft');
    } finally {
      btn.disabled = false;
    }
  }

  function addFolder(name) {
    const n = (name || '').trim();
    if (!n) return { error: '폴더 이름을 입력해 주세요.' };
    if (n === DEFAULT_FOLDER_NAME || folders.some((f) => f.name === n)) return { error: '이미 있는 폴더 이름이에요.' };
    const f = { id: uid(), name: n };
    folders.push(f);
    return { folder: f };
  }

  function onSubmit(e) {
    e.preventDefault();
    const err = (m) => { $('form-error').textContent = m; };
    const url = normalizeUrl($('f-url').value);
    const title = $('f-title').value.trim();
    const priceText = $('f-price').value;
    const price = parsePrice(priceText);
    const saleText = $('f-sale-price').value;
    const salePrice = parsePrice(saleText);
    const saleEnd = $('f-sale-end').value || '';

    if (url === null) return err('링크 형식이 올바르지 않아요.');
    if (!title) return err('상품명을 입력해 주세요.');
    if (priceText.trim() && price == null) return err('가격은 숫자로 입력해 주세요.');
    if (saleText.trim() && salePrice == null) return err('세일가는 숫자로 입력해 주세요.');
    if (saleEnd && salePrice == null) return err('세일 종료일을 넣었다면 세일가도 입력해 주세요.');
    if (salePrice != null && price != null && salePrice >= price) return err('세일가가 원래 가격보다 낮아야 해요.');
    if (saleEnd && saleEnd < todayStr() && !(editingId && items.find((x) => x.id === editingId)?.saleEnd === saleEnd)) {
      return err('세일 종료일이 이미 지났어요.');
    }

    let folder = $('f-folder').value;
    if (folder === '__new__') {
      const r = addFolder($('f-new-folder').value);
      if (r.error) return err(r.error);
      folder = r.folder.id;
    }

    const answers = {};
    $('f-checks').querySelectorAll('input[type=checkbox]').forEach((b) => { if (b.checked) answers[b.value] = true; });

    const data = {
      url: url || '', title, price, folder,
      stars: starValue, answers,
      salePrice, saleEnd,
      memo: $('f-memo').value.trim(),
      image: previewSrc,
    };
    // 자동 가격 정보: 방금 불러온 값이 있으면 쓰고, 링크가 바뀌었으면 비워서 다음 확인 때 새로 받는다
    const old = editingId && items.find((x) => x.id === editingId);
    if (pendingAuto && pendingAuto.url === data.url) {
      Object.assign(data, { autoPrice: pendingAuto.price, autoOriginal: pendingAuto.originalPrice, checkedAt: Date.now() });
    } else if (!old || old.url !== data.url) {
      Object.assign(data, { autoPrice: null, autoOriginal: null, checkedAt: 0 });
    }
    if (editingId) {
      items = items.map((it) => (it.id === editingId ? { ...it, ...data } : it));
      toast('수정했어요');
    } else {
      items.unshift({ id: uid(), createdAt: Date.now(), ...data });
      toast('위시에 담았어요');
    }
    save(); closeSheet(); render();
  }

  // ---------- 카드 버튼 (위시·우선순위 탭 공통) ----------
  function onCardClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.card').dataset.id;
    const it = items.find((x) => x.id === id);
    if (!it) return;
    if (btn.dataset.act === 'edit') openSheet(it);
    if (btn.dataset.act === 'delete') {
      const idx = items.indexOf(it);
      items.splice(idx, 1);
      save(); render();
      toast('삭제했어요', { label: '되돌리기', run: () => { items.splice(Math.min(idx, items.length), 0, it); save(); render(); } });
    }
  }
  $('wish-list').addEventListener('click', onCardClick);
  $('priority-list').addEventListener('click', onCardClick);

  // ---------- 폴더 관리 ----------
  const folderSheet = $('folder-sheet');
  function openFolderSheet() {
    $('folder-error').textContent = '';
    $('folder-input').value = '';
    renderFolderManage();
    if (typeof folderSheet.showModal === 'function') folderSheet.showModal(); else folderSheet.setAttribute('open', '');
    $('folder-input').focus();
  }
  function renderFolderManage() {
    const ul = $('folder-manage');
    ul.innerHTML = '';
    const base = document.createElement('li');
    base.className = 'fm-row';
    base.innerHTML = `<span class="fm-name">${DEFAULT_FOLDER_NAME}</span><small class="hint">기본 폴더 · 모든 위시</small>`;
    ul.appendChild(base);
    for (const f of folders) {
      const li = document.createElement('li');
      li.className = 'fm-row';
      const input = document.createElement('input');
      input.type = 'text'; input.value = f.name; input.maxLength = 20;
      input.setAttribute('aria-label', '폴더 이름');
      input.addEventListener('change', () => {
        const v = input.value.trim();
        if (!v || v === DEFAULT_FOLDER_NAME || folders.some((x) => x !== f && x.name === v)) {
          $('folder-error').textContent = '비어 있거나 이미 있는 이름이에요.';
          input.value = f.name; return;
        }
        $('folder-error').textContent = '';
        f.name = v; save(); render();
      });
      const cnt = document.createElement('small');
      cnt.className = 'hint';
      cnt.textContent = `${items.filter((it) => it.folder === f.id).length}개`;
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn small ghost danger'; del.textContent = '삭제';
      del.onclick = () => {
        const moved = items.filter((it) => it.folder === f.id);
        const idx = folders.indexOf(f);
        folders.splice(idx, 1);
        moved.forEach((it) => { it.folder = ''; });
        save(); render(); renderFolderManage();
        toast(`'${f.name}' 폴더를 지웠어요`, {
          label: '되돌리기',
          run: () => { folders.splice(idx, 0, f); moved.forEach((it) => { it.folder = f.id; }); save(); render(); renderFolderManage(); },
        });
      };
      li.append(input, cnt, del);
      ul.appendChild(li);
    }
  }
  $('folder-add').addEventListener('click', () => {
    const r = addFolder($('folder-input').value);
    if (r.error) { $('folder-error').textContent = r.error; return; }
    $('folder-error').textContent = '';
    $('folder-input').value = '';
    save(); render(); renderFolderManage();
  });
  $('folder-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('folder-add').click(); } });
  $('folder-close').addEventListener('click', () => folderSheet.close());

  // ---------- 백업 ----------
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'mywishpocket', version: 2, items, folders, criteria }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `마이위시포켓-백업-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'mywishpocket' || !Array.isArray(data.items)) throw new Error();
      const knownF = new Set(folders.map((x) => x.id));
      folders.push(...(data.folders || []).filter((x) => x && x.id && x.name && !knownF.has(x.id)));
      const known = new Set(items.map((x) => x.id));
      const added = data.items.filter((x) => x && typeof x.id === 'string' && typeof x.title === 'string' && !known.has(x.id));
      items = [...added, ...items];
      if (Array.isArray(data.criteria) && data.criteria.length) {
        const knownC = new Set(criteria.map((c) => c.id));
        criteria.push(...data.criteria.filter((c) => c && c.id && c.text && !knownC.has(c.id)));
      }
      save(); render();
      toast(`위시 ${added.length}개를 불러왔어요`);
    } catch { toast('마이위시포켓 백업 파일이 아니에요'); }
  });

  // ---------- 엑셀로 저장 ----------
  // 라이브러리 없이 .xlsx(압축 안 한 zip + 시트 XML)를 직접 만든다 → 오프라인에서도 동작
  $('btn-excel').addEventListener('click', () => {
    if (!items.length) { toast('아직 담긴 위시가 없어요'); return; }
    const head = ['폴더', '상품명', '가격(원)', '세일가(원)', '세일 종료일', '별점', "구매 기준 '예'", '메모', '쇼핑몰', '링크', '담은 날짜'];
    const rows = [...items].sort((a, b) => b.stars - a.stars || byNewest(a, b)).map((it) => [
      folderName(it.folder), it.title, it.price, (saleInfo(it) || {}).price, it.saleEnd || '',
      starsText(it.stars), `${criteria.filter((c) => it.answers && it.answers[c.id]).length}/${criteria.length}`,
      it.memo || '', domainOf(it.url), it.url || '', todayStr(new Date(it.createdAt)),
    ]);
    const blob = new Blob([buildXlsx(head, rows, [12, 40, 12, 12, 13, 10, 13, 24, 18, 50, 12])],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `마이위시포켓-${todayStr()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`엑셀 파일로 저장했어요 (${items.length}개)`);
  });

  function buildXlsx(head, rows, widths) {
    const esc = (v) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const col = (i) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
    // 스타일 1 = 굵은 제목 줄, 2 = 천 단위 쉼표 숫자
    const cell = (v, r, c, style) => {
      const ref = col(c) + r;
      if (v == null || v === '') return '';
      if (typeof v === 'number') return `<c r="${ref}" s="${style || 2}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const sheetRows = [head, ...rows].map((row, i) =>
      `<row r="${i + 1}">${row.map((v, c) => cell(v, i + 1, c, i === 0 ? 1 : 0)).join('')}</row>`).join('');
    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="위시리스트" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5484D"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
        + `<sheetData>${sheetRows}</sheetData></worksheet>`,
    };
    return zipStore(files);
  }

  // 압축하지 않는(store) zip 만들기
  function zipStore(files) {
    const enc = new TextEncoder();
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const parts = []; const central = []; let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const nameBuf = enc.encode(name); const data = enc.encode(text); const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nameBuf.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
      const cen = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameBuf.length, 2], [42, offset, 4]]
        .forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
      parts.push(local, nameBuf, data);
      central.push(cen, nameBuf);
      offset += 30 + nameBuf.length + data.length;
    }
    const cenSize = central.reduce((s, b) => s + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    const n = Object.keys(files).length;
    [[0, 0x06054b50, 4], [8, n, 2], [10, n, 2], [12, cenSize, 4], [16, offset, 4]]
      .forEach(([o, v, k]) => (k === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    return new Blob([...parts, ...central, end]);
  }

  // ---------- 휴대폰 공유로 들어온 링크 ----------
  function handleShareTarget() {
    const p = new URLSearchParams(location.search);
    // manifest의 share_target이 ?title=&text=&url= 형태로 보내준다
    if (!['url', 'text', 'title'].some((k) => p.has(k))) return;
    const url = p.get('url') || findUrl(p.get('text')) || findUrl(p.get('title'));
    history.replaceState(null, '', location.pathname);
    if (url) openSheet(null, { url });
  }

  // ---------- 설치(PWA) ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('install-wrap').hidden = false; });
  $('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); await deferredPrompt.userChoice;
    deferredPrompt = null; $('install-wrap').hidden = true;
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ---------- 연결 ----------
  $('btn-add').addEventListener('click', () => openSheet(null));
  $('btn-close').addEventListener('click', closeSheet);
  $('btn-fetch').addEventListener('click', fetchPreview);
  // 링크를 붙여넣으면 바로 정보 불러오기 ('상품명 + 링크'처럼 복사돼도 링크만 골라낸다)
  $('f-url').addEventListener('paste', (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const url = findUrl(text) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text.trim()) ? text.trim() : '');
    if (!url) return;
    e.preventDefault();
    $('f-url').value = url;
    fetchPreview();
  });
  form.addEventListener('submit', onSubmit);
  window.addEventListener('storage', (e) => {
    if (Object.values(KEY).includes(e.key)) {
      items = loadArr(KEY.items); folders = loadArr(KEY.folders); criteria = loadArr(KEY.criteria, criteria);
      render();
    }
  });
  // 날짜가 바뀌면(앱을 켜둔 채 자정이 지나면) D-day 다시 계산
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkPrices(); } });

  // ---------- 자동 가격 확인 ----------
  // 앱을 열 때, 하루 한 번 담아 둔 상품의 지금 가격을 다시 읽어 와서 내려갔으면 세일 알림판에 띄운다
  const CHECK_EVERY = 20 * 60 * 60 * 1000;
  const CHECK_MAX = 30;      // 한 번에 확인하는 최대 개수 (나머지는 다음에)
  let checking = false;
  async function checkPrices() {
    if (checking || !navigator.onLine || location.protocol === 'file:') return;
    const due = items
      .filter((it) => it.url && !needsNaverLogin(it.url) && Date.now() - (it.checkedAt || 0) > CHECK_EVERY)
      .slice(0, CHECK_MAX);
    if (!due.length) return;
    checking = true;
    const before = new Set(items.filter((it) => (saleInfo(it) || {}).auto).map((it) => it.id));
    // 느린 쇼핑몰 하나가 전체를 붙잡지 않도록 3개씩 동시에 확인하고, 하나 끝날 때마다 바로 저장한다
    const queue = [...due];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { id, url } = job;
        let data = null;
        try { const r = await fetchInfo(url); if (r.ok) data = r.data; } catch { /* 막힌 쇼핑몰은 다음 확인 때 다시 시도 */ }
        const cur = items.find((x) => x.id === id);   // 확인하는 동안 지워지거나 링크가 바뀌었을 수 있다
        if (!cur || cur.url !== url) continue;
        cur.checkedAt = Date.now();
        if (data && data.price != null) { cur.autoPrice = data.price; cur.autoOriginal = data.originalPrice ?? null; }
        save(); renderSummary(); renderSaleBoard();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    checking = false;
    render();
    const newly = items.filter((it) => (saleInfo(it) || {}).auto && !before.has(it.id)).length;
    if (newly) toast(`위시 ${newly}개의 가격이 내려갔어요!`);
  }

  save();
  render();
  handleShareTarget();
  setTimeout(checkPrices, 1500);

  window.__mwp = { parsePrice, recommendStars, daysBetween, todayStr };
})();
