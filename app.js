const POLL_INTERVAL_MS = 60_000;
const initialView = new URLSearchParams(location.search).get('view');
const BASE_TIME_ZONE = 'Asia/Bangkok';
function baseDateParts(value) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: BASE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
const baseToday = baseDateParts(new Date());
const state = { rows: [], options: {}, source: ['companyFund', 'cleaning', 'repairs', 'purchases', 'assets', 'payments', 'reviews', 'fundCreate'].includes(initialView) ? initialView : 'fund', query: '', building: '', room: '', from: '', to: '', page: 1, pageSize: 20, calendarMonth: new Date(Number(baseToday.year), Number(baseToday.month) - 1, 1), lastCheckAt: 0, revisionSignature: '' };
const repairFilter = { query: '', building: '', status: 'đang xử lý', month: '', page: 1 };
const purchaseFilter = { query: '', month: '', page: 1 };
const assetFilter = { query: '', type: '', page: 1 };
const companyFilter = { query: '', kind: '', page: 1 };
const paymentFilter = { query: '', status: '', purpose: '', page: 1 };
let loading = false;
let openMenu = '';
let entryMode = 'fund';
let reviewTab = 'ota';
const otaFilter = { building: '', errorsOnly: false };
let otaSyncStatus = null;
const otaExpanded = new Set();
const otaScoreDrafts = new Map();
let editingCleaningId = '';
let draggedCleaningId = '';
let draggedCleaningDate = '';
let movingCleaningDate = false;
let cleaningDragMessageTimer;
const pendingCleaningMoves = new Map();
const $ = id => document.getElementById(id);
const cleaningDialog = document.createElement('dialog');
cleaningDialog.className = 'cleaning-editor-dialog';
cleaningDialog.setAttribute('aria-label', 'Chỉnh sửa lượt dọn phòng');
document.body.append(cleaningDialog);
cleaningDialog.append($('cleaning-direct-form'));
cleaningDialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (!$('cleaning-submit').disabled) $('cleaning-cancel').click();
});
cleaningDialog.addEventListener('click', event => {
  if (event.target === cleaningDialog && !$('cleaning-submit').disabled) $('cleaning-cancel').click();
});
const searchKey = value => String(value || '').toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
const currency = value => value == null ? '' : new Intl.NumberFormat('vi-VN').format(Math.abs(value));
const moneyValue = input => input.value === '' ? null : Number(input.value.replaceAll(',', ''));
const selectedIds = id => [...$(id).selectedOptions].map(option => option.value).filter(Boolean);
function refreshMulti(id) {
  const select = $(id), field = select.closest('.multi-field');
  if (!field.querySelector('.multi-picker')) {
    const picker = document.createElement('div'); picker.className = 'multi-picker';
    picker.innerHTML = '<button type="button" class="multi-trigger" aria-expanded="false">Chọn bản ghi <span class="filter-chevron" aria-hidden="true"></span></button><div class="multi-options" role="listbox" aria-multiselectable="true" hidden></div>';
    field.append(picker);
    picker.querySelector('button').addEventListener('click', () => { closeDatePickers(); const panel = picker.querySelector('.multi-options'); panel.hidden = !panel.hidden; picker.querySelector('button').setAttribute('aria-expanded', String(!panel.hidden)); });
  }
  const picker = field.querySelector('.multi-picker'), panel = picker.querySelector('.multi-options');
  panel.replaceChildren();
  for (const option of select.options) {
    const item = document.createElement('button'), label = document.createElement('span'), tick = document.createElement('span');
    item.type = 'button'; item.className = 'multi-option'; item.setAttribute('role', 'option');
    label.className = 'multi-option-label'; label.textContent = option.textContent;
    tick.className = 'multi-option-tick'; tick.textContent = '✓'; tick.setAttribute('aria-hidden', 'true');
    item.append(label, tick);
    const sync = () => { item.classList.toggle('selected', option.selected); item.setAttribute('aria-selected', String(option.selected)); };
    item.addEventListener('click', () => { option.selected = !option.selected; sync(); updateMultiLabel(id); });
    sync(); panel.append(item);
  }
  if (!select.options.length) panel.textContent = 'Chưa có bản ghi';
  updateMultiLabel(id);
}
function updateMultiLabel(id) {
  const count = selectedIds(id).length, button = $(id).closest('.multi-field').querySelector('.multi-trigger');
  if (button) button.firstChild.textContent = count ? `Đã chọn ${count} bản ghi ` : 'Chọn bản ghi ';
}
document.addEventListener('click', event => { for (const picker of document.querySelectorAll('.multi-picker')) if (!picker.contains(event.target)) { picker.querySelector('.multi-options').hidden = true; picker.querySelector('button').setAttribute('aria-expanded','false'); } });
function formatMoneyInput(input) {
  const before = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '');
  input.value = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let cursor = 0, seen = 0;
  while (cursor < input.value.length && seen < before) if (/\d/.test(input.value[cursor++])) seen++;
  input.setSelectionRange(cursor, cursor);
}
const date = value => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) : '';
const selectMenus = new Map();
let openSelectId = '';
const datePickers = new Map();
let openDateId = '';
function closeDatePickers() {
  if (!openDateId) return;
  const picker = datePickers.get(openDateId);
  picker.panel.hidden = true;
  picker.trigger.setAttribute('aria-expanded', 'false');
  openDateId = '';
}
function syncDatePicker(id) {
  const picker = datePickers.get(id);
  if (!picker) return;
  const { input, trigger, panel } = picker;
  trigger.querySelector('.date-trigger-label').textContent = input.value ? input.value.split('-').reverse().join('/') : 'Chọn ngày';
  panel.replaceChildren();
  const header = document.createElement('div'); header.className = 'date-picker-header';
  const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹'; previous.setAttribute('aria-label','Tháng trước');
  const next = document.createElement('button'); next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label','Tháng sau');
  const title = document.createElement('strong'); title.textContent = `Tháng ${picker.month.getUTCMonth()+1} / ${picker.month.getUTCFullYear()}`;
  previous.addEventListener('click', event => { event.stopPropagation(); picker.month = new Date(Date.UTC(picker.month.getUTCFullYear(),picker.month.getUTCMonth()-1,1)); syncDatePicker(id); panel.querySelector('.date-picker-header button:first-child').focus(); });
  next.addEventListener('click', event => { event.stopPropagation(); picker.month = new Date(Date.UTC(picker.month.getUTCFullYear(),picker.month.getUTCMonth()+1,1)); syncDatePicker(id); panel.querySelector('.date-picker-header button:last-child').focus(); });
  header.append(previous,title,next); panel.append(header);
  const weekdays = document.createElement('div'); weekdays.className = 'date-picker-weekdays';
  for (const day of ['T2','T3','T4','T5','T6','T7','CN']) weekdays.append(cell('span',day));
  panel.append(weekdays);
  const grid = document.createElement('div'); grid.className = 'date-picker-grid';
  const year = picker.month.getUTCFullYear(), month = picker.month.getUTCMonth();
  const offset = (picker.month.getUTCDay()+6)%7, days = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const now = baseDateParts(new Date());
  const today = `${now.year}-${now.month}-${now.day}`;
  for (let index=0; index<Math.ceil((offset+days)/7)*7; index++) {
    const day = index-offset+1;
    if (day<1 || day>days) { grid.append(cell('span','')); continue; }
    const value = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const button = cell('button',String(day)); button.type = 'button';
    button.setAttribute('aria-label',`${String(day).padStart(2,'0')}/${String(month+1).padStart(2,'0')}/${year}`);
    button.className = `date-picker-day${value===input.value?' selected':''}${value===today?' today':''}`;
    button.addEventListener('click', () => { input.value=value; input.dispatchEvent(new Event('change',{bubbles:true})); closeDatePickers(); trigger.focus(); });
    grid.append(button);
  }
  panel.append(grid);
  const todayButton = cell('button','Hôm nay','date-picker-today'); todayButton.type='button';
  todayButton.addEventListener('click', () => { const current=baseDateParts(new Date()); const dateValue=`${current.year}-${current.month}-${current.day}`; input.value=dateValue; picker.month=new Date(`${dateValue}T00:00:00Z`); input.dispatchEvent(new Event('change',{bubbles:true})); closeDatePickers(); trigger.focus(); });
  panel.append(todayButton);
}
function setupDatePicker(id) {
  const input = $(id), wrapper = input.parentElement;
  const trigger = document.createElement('button'); trigger.type='button'; trigger.className='date-trigger';
  trigger.setAttribute('aria-label',`Chọn ${id === 'date-from' ? 'ngày bắt đầu' : id === 'date-to' ? 'ngày kết thúc' : 'ngày'}`); trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls',`${id}-picker`);
  trigger.innerHTML='<span class="date-trigger-label"></span><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 8.5h15M6.5 2.5v4M13.5 2.5v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const panel = document.createElement('div'); panel.id=`${id}-picker`; panel.className='date-picker-panel'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Chọn ngày'); panel.hidden=true;
  wrapper.append(trigger,panel);
  datePickers.set(id,{input,trigger,panel,month:new Date(`${input.value || `${baseToday.year}-${baseToday.month}-${baseToday.day}`}T00:00:00Z`)});
  trigger.addEventListener('click', () => { if (openDateId===id) { closeDatePickers(); return; } closeSelectMenus(); closeDatePickers(); const picker=datePickers.get(id); picker.month=new Date(`${input.value || `${baseToday.year}-${baseToday.month}-${baseToday.day}`}T00:00:00Z`); syncDatePicker(id); panel.hidden=false; trigger.setAttribute('aria-expanded','true'); openDateId=id; });
  input.addEventListener('change',()=>syncDatePicker(id));
  syncDatePicker(id);
}
document.addEventListener('click',event=>{ if (!event.target.closest('.entry-date-field')) closeDatePickers(); });
document.addEventListener('keydown',event=>{ if (event.key==='Escape' && openDateId) { const trigger=datePickers.get(openDateId).trigger; closeDatePickers(); trigger.focus(); } });

function cell(tag, value, className = '') {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}
let imageDialog;
function openImage(url, label) {
  if (!imageDialog) {
    imageDialog = cell('dialog', '', 'image-dialog');
    const close = cell('button', '×', 'image-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Đóng ảnh');
    close.addEventListener('click', () => imageDialog.close());
    imageDialog.append(close, cell('img', ''), cell('p', '', 'image-dialog-caption'));
    imageDialog.addEventListener('click', event => {
      if (event.target === imageDialog) imageDialog.close();
    });
    imageDialog.addEventListener('close', () => imageDialog.querySelector('img').removeAttribute('src'));
    document.body.append(imageDialog);
  }
  const img = imageDialog.querySelector('img');
  img.src = url;
  img.alt = label;
  imageDialog.querySelector('.image-dialog-caption').textContent = label;
  imageDialog.showModal();
}
function imageGallery(row) {
  if (!row.images?.length) return null;
  const details = cell('details', '', 'record-images');
  details.append(cell('summary', `Hình ảnh (${row.images.length})`));
  const gallery = cell('div', '', 'record-image-grid');
  for (const file of row.images) {
    const button = cell('button', '', 'record-image-link');
    const url = `/api/image?source=${encodeURIComponent(row.source)}&id=${encodeURIComponent(row.id)}&token=${encodeURIComponent(file.token)}`;
    const label = file.label || file.name || 'Ảnh đính kèm';
    button.type = 'button';
    button.setAttribute('aria-label', `Xem ${label}`);
    button.addEventListener('click', () => openImage(url, label));
    const img = cell('img', '');
    img.alt = label;
    img.loading = 'lazy';
    img.dataset.src = url;
    button.append(img); gallery.append(button);
  }
  details.append(gallery);
  details.addEventListener('toggle', () => {
    if (details.open) gallery.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; delete img.dataset.src; });
  });
  return details;
}

function paymentImagePreview(row) {
  if(!row.images?.length) return null;
  const wrap=cell('div','','payment-image-preview');
  wrap.append(cell('span',`Ảnh (${row.images.length})`,'payment-image-label'));
  const gallery=cell('div','','record-image-grid');
  for(const file of row.images){
    const button=cell('button','','record-image-link'); button.type='button';
    const url=`/api/image?source=payments&id=${encodeURIComponent(row.id)}&token=${encodeURIComponent(file.token)}`;
    const label=file.label||file.name||'Ảnh đính kèm';button.setAttribute('aria-label',`Mở ảnh ${label}`);
    button.addEventListener('click',()=>openImage(url,label));
    const img=cell('img','');img.alt=label;img.loading='lazy';img.src=url;button.append(img);gallery.append(button);
  }
  wrap.append(gallery);return wrap;
}

function closeSelectMenus() {
  if (!openSelectId) return;
  const current = selectMenus.get(openSelectId);
  current.menu.hidden = true;
  current.trigger.setAttribute('aria-expanded', 'false');
  openSelectId = '';
}

function syncSelectMenu(id) {
  const item = selectMenus.get(id);
  if (!item) return;
  const { select, trigger, menu } = item;
  const selected = select.selectedOptions[0];
  const label = selected?.textContent || 'Chọn';
  trigger.replaceChildren(cell('span', label, 'select-trigger-label'), cell('span', '', 'filter-chevron'));
  trigger.lastChild.setAttribute('aria-hidden', 'true');
  const fieldLabel = select.getAttribute('aria-label') || (select.previousElementSibling?.tagName === 'SPAN' ? select.previousElementSibling.textContent : '') || [...select.parentElement.childNodes].find(node => node.nodeType === Node.TEXT_NODE)?.textContent.trim() || 'Chọn';
  trigger.setAttribute('aria-label', `${fieldLabel}: ${label}`);
  trigger.disabled = select.disabled;
  menu.replaceChildren();
  if (id === 'other-contact') {
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'select-search';
    search.placeholder = 'Tìm theo tên';
    search.setAttribute('aria-label', 'Tìm người thực hiện hoặc thụ hưởng');
    search.addEventListener('input', () => {
      const query = searchKey(search.value);
      for (const button of menu.querySelectorAll('.select-option')) button.hidden = !!query && !searchKey(button.textContent).includes(query);
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        menu.querySelector('.select-option:not([hidden])')?.click();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        menu.querySelector('.select-option:not([hidden])')?.focus();
      }
    });
    menu.append(search);
  }
  for (const option of select.options) {
    const button = cell('button', option.textContent, 'select-option');
    button.type = 'button';
    button.disabled = option.disabled;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(option.selected));
    if (option.selected) button.classList.add('chosen');
    button.addEventListener('click', event => {
      event.stopPropagation();
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncSelectMenu(id);
      closeSelectMenus();
      trigger.focus();
    });
    menu.append(button);
  }
}

function setupSelectMenu(id) {
  const select = $(id);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-options`);
  const menu = document.createElement('div');
  menu.id = `${id}-options`;
  menu.className = 'select-options';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label'));
  menu.hidden = true;
  select.hidden = true;
  select.tabIndex = -1;
  select.after(trigger, menu);
  selectMenus.set(id, { select, trigger, menu });
  const open = (focusOption = false) => {
    if (openSelectId === id) { closeSelectMenus(); return; }
    closeMenus();
    closeDatePickers();
    closeSelectMenus();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openSelectId = id;
    if (id === 'other-contact') menu.querySelector('.select-search')?.focus();
    else if (focusOption) {
      const chosen = menu.querySelector('.chosen') || menu.querySelector('button');
      chosen?.focus();
    }
  };
  trigger.addEventListener('click', () => open());
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (openSelectId !== id) open(true);
    else (menu.querySelector('.chosen') || menu.querySelector('button'))?.focus();
  });
  select.addEventListener('change', () => syncSelectMenu(id));
  syncSelectMenu(id);
}
function syncEntrySelectMenus(...ids) {
  for (const id of ids) syncSelectMenu(id);
}
function setEntryOptions(id, values, placeholder, preferred = '') {
  const select = $(id);
  const selected = select.value;
  select.replaceChildren(new Option(placeholder, ''), ...(values || []).map(value => new Option(value, value)));
  select.value = values?.includes(selected) ? selected : values?.includes(preferred) ? preferred : '';
  syncSelectMenu(id);
}
function updateEntryOptions() {
  setEntryOptions('fund-create-kind', state.options.fundKinds, 'Chọn loại giao dịch', 'Nạp tiền');
  setEntryOptions('history-building', state.options.buildings, 'Chọn toà');
  setEntryOptions('other-building', state.options.buildings, 'Chọn toà');
  setEntryOptions('other-channel', state.options.paymentChannels, 'Chọn');
  setEntryOptions('history-category', entryMode === 'income' ? state.options.incomeKinds : state.options.expenseKinds, 'Chọn nội dung');
  setEntryOptions('other-kind', entryMode === 'repairs' ? state.options.repairStatuses : state.options.paymentPurposes, 'Chọn');
}

const BUILDING_COLORS = new Map([
  ['niko', 0], ['lune', 1], ['mia', 2], ['154htm', 3],
  ['sunrise w2.1802', 4], ['sgs.b508', 5]
]);
function buildingColorClass(building) {
  const name = String(building || '').trim().toLocaleLowerCase('vi');
  let index = BUILDING_COLORS.get(name);
  if (index == null) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    index = hash % 6;
  }
  return `building-color-${index}`;
}
function tagColorClass(value) {
  const name = String(value || '').trim().toLocaleLowerCase('vi');
  if (!name) return 'tag-color-muted';
  let hash = 0;
  for (const char of name) hash = (hash * 33 + char.codePointAt(0)) >>> 0;
  return `tag-color-${hash % 10}`;
}

function locationBuilding(row, location) {
  const name = String(location || '').trim();
  const buildings = row.buildings || [];
  return buildings.find(building => name.toLocaleLowerCase('vi').startsWith(`${building}.`.toLocaleLowerCase('vi')))
    || (buildings.length === 1 ? buildings[0] : '');
}

function amountText(value) {
  return value == null ? '' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${currency(value)} ₫`;
}

function fundHistory(row, label) {
  const entries = row.fundEntries || [];
  const lines = entries.length
    ? entries.map(entry => [entry.date ? date(entry.date) : '', entry.category || 'Bút toán Quỹ', entry.amount == null ? '' : amountText(entry.amount), entry.note].filter(Boolean).join(' · '))
    : ['Chưa tìm thấy bút toán Quỹ liên kết với giao dịch này.'];
  const el = cell('span', entries.length ? label : `Chưa liên kết ${label.toLocaleLowerCase('vi')}`, `fund-history ${entries.length ? 'has-link' : 'no-link'}`);
  el.tabIndex = 0;
  el.setAttribute('role', 'note');
  el.setAttribute('aria-label', lines.join('\n'));
  el.dataset.tooltip = lines.join('\n');
  return el;
}

function locationText(row) {
  if ((row.source === 'income' || row.source === 'cleaning') && row.location) return row.location;
  const rooms = row.rooms || [];
  const building = row.buildings?.length === 1 ? row.buildings[0] : '';
  return rooms.map(room => building && !room.startsWith(`${building}.`) ? `${building}.${room}` : room).join(', ');
}

function fundActorLabel(row) {
  const category = (row.category || '').toLocaleLowerCase('vi');
  if (category.includes('nạp')) return 'Người nộp';
  if (category.includes('rút')) return 'Người rút';
  return row.amount < 0 ? 'Người rút' : 'Người nộp';
}

function totals(rows) {
  return rows.reduce((a, r) => {
    if (r.amount == null) { a.missing++; return a; }
    if (r.amount > 0) { a.positive += r.amount; a.positiveCount++; }
    if (r.amount < 0) { a.negative += r.amount; a.negativeCount++; }
    return a;
  }, { positive: 0, negative: 0, positiveCount: 0, negativeCount: 0, missing: 0 });
}

function updateSummary() {
  const fund = state.rows.filter(r => r.source === 'fund');
  const t = totals(fund);
  $('balance').textContent = `${new Intl.NumberFormat('vi-VN').format(t.positive + t.negative)} ₫`;
}

function sourceRows() {
  return state.rows.filter(row => row.source === state.source);
}

function optionsFor(kind) {
  const rows = sourceRows().filter(row => kind === 'building' || !state.building || row.buildings.includes(state.building));
  const key = kind === 'building' ? 'buildings' : 'rooms';
  return [...new Set(rows.flatMap(row => row[key] || []))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
}

function closeMenus() {
  for (const kind of ['building', 'room']) {
    $(kind + '-options').hidden = true;
    $(kind + '-filter').setAttribute('aria-expanded', 'false');
  }
  openMenu = '';
}

function renderMenu(kind, options) {
  const menu = $(kind + '-options');
  const trigger = $(kind + '-filter');
  const defaultText = kind === 'building' ? 'Tất cả toà' : 'Tất cả phòng';
  trigger.replaceChildren();
  trigger.append(cell('span', state[kind] || defaultText, 'filter-trigger-label'));
  const chevron = cell('span', '', 'filter-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(chevron);
  menu.replaceChildren();
  for (const option of ['', ...options]) {
    const button = cell('button', option || defaultText);
    button.type = 'button';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(state[kind] === option));
    const classes = [];
    if (state[kind] === option) classes.push('chosen');
    button.className = classes.join(' ');
    button.addEventListener('click', event => {
      event.stopPropagation();
      state[kind] = option;
      if (kind === 'building') state.room = '';
      state.page = 1;
      renderFilters();
      renderRows();
      closeMenus();
      trigger.focus();
    });
    menu.append(button);
  }
}

function renderFilters() {
  const buildings = optionsFor('building');
  if (state.building && !buildings.includes(state.building)) state.building = '';
  const rooms = optionsFor('room');
  if (state.room && !rooms.includes(state.room)) state.room = '';
  renderMenu('building', buildings);
  renderMenu('room', rooms);
  $('room-filter').disabled = rooms.length === 0;
}

function parseDateInput(value) {
  if (!value.trim()) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCDate() !== day || parsed.getUTCMonth() !== month - 1 || parsed.getUTCFullYear() !== year) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function applyDateFilters() {
  const from = parseDateInput($('date-from').value);
  const to = parseDateInput($('date-to').value);
  const error = from === null || to === null ? 'Nhập ngày theo định dạng dd/mm/yyyy.' : from && to && from > to ? 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.' : '';
  $('filter-error').hidden = !error;
  $('filter-error').textContent = error;
  $('date-from').setAttribute('aria-invalid', String(from === null || Boolean(error && from && to && from > to)));
  $('date-to').setAttribute('aria-invalid', String(to === null || Boolean(error && from && to && from > to)));
  if (error) return;
  state.from = from;
  state.to = to;
  state.page = 1;
  renderRows();
}

function filteredRows(ignoreDateRange = false) {
  const query = state.query.trim().toLocaleLowerCase('vi');
  return sourceRows().filter(row => {
    if (state.building && !(row.buildings || []).includes(state.building)) return false;
    if (state.room && !(row.rooms || []).includes(state.room)) return false;
    if (row.source === 'fund' && state.building && state.room &&
        !(row.linkedEntries || []).some(item => (item.buildings || []).includes(state.building) && (item.rooms || []).includes(state.room))) return false;
    const day = row.date?.slice(0, 10) || '';
    if (!ignoreDateRange && state.from && (!day || day < state.from)) return false;
    if (!ignoreDateRange && state.to && (!day || day > state.to)) return false;
    const linkedText = (row.linkedEntries || []).flatMap(item => [item.category, item.building, item.room, item.location, locationText(item), item.note]);
    const fundText = (row.fundEntries || []).flatMap(item => [item.category, item.note]);
    return !query || [row.category, row.building, row.room, row.location, row.note, row.done ? 'đã dọn' : 'chưa đánh dấu', row.guestRequestedNoCleaning ? 'khách yêu cầu không dọn' : '', ...(row.staffChangeNames || []), ...(row.creatorNames || []), ...linkedText, ...fundText].some(value => String(value).toLocaleLowerCase('vi').includes(query));
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}

function renderCalendar() {
  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const titleDate = new Date(Date.UTC(year, month, 15));
  $('calendar-month').textContent = new Intl.DateTimeFormat('vi-VN', { timeZone: BASE_TIME_ZONE, month: 'long', year: 'numeric' }).format(titleDate);
  $('calendar-grid').setAttribute('aria-label', `Lịch dọn phòng tháng ${month + 1} năm ${year}`);
  const monthPicker = $('calendar-month-picker');
  if (!monthPicker.options.length) {
    for (let value = 1; value <= 12; value++) monthPicker.add(new Option(`Tháng ${value}`, String(value)));
  }
  const dataYears = state.rows.filter(row => row.source === 'cleaning' && row.date).map(row => Number(row.date.slice(0, 4)));
  const knownYears = [...dataYears, Number(baseToday.year), year];
  const minYear = Math.min(...knownYears);
  const maxYear = Math.max(...knownYears) + 1;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
  const yearPicker = $('calendar-year-picker');
  const yearOptions = years.map(String);
  if (JSON.stringify([...yearPicker.options].map(option => option.value)) !== JSON.stringify(yearOptions)) {
    yearPicker.replaceChildren(...years.map(value => new Option(String(value), String(value))));
  }
  monthPicker.value = String(month + 1);
  yearPicker.value = String(year);
  syncSelectMenu('calendar-month-picker');
  syncSelectMenu('calendar-year-picker');
  const filtered = filteredRows(true);
  const monthRows = filtered.filter(row => row.date?.slice(0, 7) === key);
  const missingDate = filtered.filter(row => !row.date).length;
  $('calendar-count').textContent = `${monthRows.length} lượt dọn${missingDate ? ` · ${missingDate} bản ghi thiếu ngày` : ''}`;
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  const firstVisibleDate = new Date(Date.UTC(year, month, 1 - offset)).toISOString().slice(0, 10);
  const lastVisibleDate = new Date(Date.UTC(year, month, cellCount - offset)).toISOString().slice(0, 10);
  const byDate = new Map();
  for (const row of filtered) {
    const day = row.date?.slice(0, 10);
    if (!day || day < firstVisibleDate || day > lastVisibleDate) continue;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day).push(row);
  }
  const todayParts = baseDateParts(new Date());
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const grid = $('calendar-grid');
  grid.replaceChildren();
  for (let index = 0; index < cellCount; index++) {
    const dateValue = new Date(Date.UTC(year, month, index - offset + 1));
    const dateKey = dateValue.toISOString().slice(0, 10);
    const inMonth = dateValue.getUTCMonth() === month;
    const dayCell = document.createElement('div');
    dayCell.className = `calendar-day${inMonth ? '' : ' outside-month'}${dateKey === today ? ' today' : ''}${(byDate.get(dateKey) || []).length ? ' has-events' : ''}`;
    dayCell.setAttribute('aria-label', new Intl.DateTimeFormat('vi-VN', { timeZone: BASE_TIME_ZONE, dateStyle: 'full' }).format(dateValue));
    dayCell.addEventListener('dragover', event => {
      if (!draggedCleaningId || movingCleaningDate) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      dayCell.classList.toggle('drag-target', dateKey !== draggedCleaningDate);
    });
    dayCell.addEventListener('dragleave', event => { if (!dayCell.contains(event.relatedTarget)) dayCell.classList.remove('drag-target'); });
    dayCell.addEventListener('drop', event => {
      if (!draggedCleaningId || movingCleaningDate) return;
      event.preventDefault();
      dayCell.classList.remove('drag-target');
      const row = state.rows.find(item => item.source === 'cleaning' && item.id === draggedCleaningId);
      draggedCleaningId = '';
      draggedCleaningDate = '';
      if (row && row.date?.slice(0, 10) !== dateKey) moveCleaningDate(row, dateKey);
    });
    const header = document.createElement('div');
    header.className = 'calendar-day-header';
    header.append(cell('span', inMonth ? String(dateValue.getUTCDate()) : `${dateValue.getUTCDate()}/${dateValue.getUTCMonth() + 1}`, 'calendar-day-number'));
    if (inMonth) {
      const add = cell('button', '', 'calendar-day-add');
      add.type = 'button';
      add.setAttribute('aria-label', `Thêm lượt dọn ngày ${dateKey.split('-').reverse().join('/')}`);
      add.title = 'Thêm lượt dọn';
      add.addEventListener('click', () => openCleaningForm(dateKey));
      header.append(add);
    }
    const events = byDate.get(dateKey) || [];
    if (events.length) header.append(cell('span', String(events.length), 'calendar-day-count'));
    dayCell.append(header);
    const dayList = document.createElement('div');
    dayList.className = 'calendar-day-list';
    const buildings = new Map();
    for (const row of events) {
      const building = row.building || 'Chưa rõ toà';
      if (!buildings.has(building)) buildings.set(building, []);
      buildings.get(building).push(row);
    }
    for (const [building, buildingRows] of [...buildings].sort(([a], [b]) => a.localeCompare(b, 'vi', { numeric: true }))) {
      const group = document.createElement('div');
      const colorClass = buildingColorClass(building);
      group.className = `calendar-building-group ${colorClass}`;
      group.append(cell('div', building, `calendar-building ${colorClass}`));
      for (const row of buildingRows.sort((a, b) => (a.room || '').localeCompare(b.room || '', 'vi', { numeric: true }))) {
        const event = document.createElement('div');
        event.className = 'calendar-event';
        const roomLine = document.createElement('button');
        roomLine.type = 'button';
        roomLine.className = 'calendar-room-line calendar-room-edit';
        roomLine.setAttribute('aria-label', `Sửa lượt dọn ${building} ${row.room || 'chưa rõ phòng'} ngày ${dateKey.split('-').reverse().join('/')}`);
        roomLine.draggable = true;
        roomLine.title = 'Bấm để sửa · Kéo sang ngày khác để chuyển lịch';
        roomLine.addEventListener('dragstart', event => {
          if (movingCleaningDate) { event.preventDefault(); return; }
          draggedCleaningId = row.id;
          draggedCleaningDate = row.date?.slice(0, 10) || '';
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', row.id);
          roomLine.classList.add('dragging');
        });
        roomLine.addEventListener('dragend', () => {
          draggedCleaningId = '';
          draggedCleaningDate = '';
          roomLine.classList.remove('dragging');
          grid.querySelectorAll('.drag-target').forEach(target => target.classList.remove('drag-target'));
        });
        roomLine.addEventListener('click', () => openCleaningForm(dateKey, row));
        roomLine.append(cell('span', row.room || 'Chưa rõ phòng', 'calendar-room'));
        if (row.done) roomLine.append(cell('span', 'Đã dọn', 'calendar-status done'));
        else if (row.guestRequestedNoCleaning) roomLine.append(cell('span', 'Không dọn', 'calendar-status guest-request'));
        else roomLine.append(cell('span', 'Chưa đánh dấu', 'calendar-status pending'));
        event.append(roomLine);
        if (row.note) event.append(cell('div', row.note, 'calendar-note'));
        const gallery = imageGallery(row); if (gallery) event.append(gallery);
        group.append(event);
      }
      dayList.append(group);
    }
    dayCell.append(dayList);
    grid.append(dayCell);
  }
}

async function moveCleaningDate(row, dateKey) {
  const message = $('cleaning-drag-message');
  const originalDate = row.date;
  const originalMonth = state.calendarMonth;
  movingCleaningDate = true;
  clearTimeout(cleaningDragMessageTimer);
  pendingCleaningMoves.set(row.id, dateKey);
  row.date = dateKey;
  state.calendarMonth = new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, 1);
  renderCalendar();
  message.hidden = false;
  message.className = 'cleaning-drag-message';
  message.textContent = `Đang lưu ngày mới cho ${row.building}.${row.room}…`;
  try {
    const response = await fetch('/api/cleaning/date', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({recordId:row.id,date:dateKey})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không chuyển được lượt dọn.');
    message.textContent = `Đã chuyển ${row.building}.${row.room} sang ngày ${dateKey.split('-').reverse().join('/')}.`;
    cleaningDragMessageTimer = setTimeout(() => { message.hidden = true; }, 5000);
    while (loading) await new Promise(resolve => setTimeout(resolve, 50));
    await load({force:true,silent:true});
  } catch (error) {
    const current = state.rows.find(item => item.source === 'cleaning' && item.id === row.id);
    if (current) current.date = originalDate;
    if (state.calendarMonth.getFullYear() === Number(dateKey.slice(0, 4)) && state.calendarMonth.getMonth() === Number(dateKey.slice(5, 7)) - 1) state.calendarMonth = originalMonth;
    renderCalendar();
    clearTimeout(cleaningDragMessageTimer);
    message.classList.add('error');
    message.textContent = `${error.message} Đã đưa lượt dọn về ngày cũ.`;
  } finally { pendingCleaningMoves.delete(row.id); movingCleaningDate = false; }
}

function renderRepairOptions() {
  const repairs = state.rows.filter(row => row.source === 'repairs');
  const buildings = [...new Set(repairs.flatMap(row => row.buildings || []))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  const months = [...new Set(repairs.map(row => row.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  const statuses = state.options.repairStatuses || [];
  $('repair-building').replaceChildren(new Option('Tất cả toà', ''), ...buildings.map(value => new Option(value, value)));
  $('repair-status').replaceChildren(new Option('Tất cả trạng thái', ''), ...statuses.map(value => new Option(value, value)));
  $('repair-month').replaceChildren(new Option('Tất cả tháng', ''), ...months.map(value => new Option(`Tháng ${value.slice(5)}/${value.slice(0, 4)}`, value)));
  if (repairFilter.status && !statuses.includes(repairFilter.status)) repairFilter.status = '';
  $('repair-building').value = repairFilter.building;
  $('repair-status').value = repairFilter.status;
  $('repair-month').value = repairFilter.month;
  syncSelectMenu('repair-building');
  syncSelectMenu('repair-status');
  syncSelectMenu('repair-month');
}

function renderPaymentOptions() {
  const purposes = state.options.paymentPurposes || [];
  $('payment-purpose').replaceChildren(new Option('Tất cả mục đích', ''), ...purposes.map(value => new Option(value, value)));
  if (paymentFilter.purpose && !purposes.includes(paymentFilter.purpose)) paymentFilter.purpose = '';
  $('payment-purpose').value = paymentFilter.purpose;
  syncSelectMenu('payment-purpose');
}

function renderPurchaseOptions() {
  const months = [...new Set(state.rows.filter(row => row.source === 'purchases').map(row => row.date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  $('purchase-month').replaceChildren(new Option('Tất cả tháng', ''), ...months.map(value => new Option(`Tháng ${value.slice(5)}/${value.slice(0, 4)}`, value)));
  $('purchase-month').value = purchaseFilter.month;
  syncSelectMenu('purchase-month');
}

function renderAssetOptions() {
  const types = [...new Set(state.rows.filter(row => row.source === 'assets').map(row => row.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  $('asset-type').replaceChildren(new Option('Tất cả loại', ''), ...types.map(value => new Option(value, value)));
  $('asset-type').value = assetFilter.type;
  syncSelectMenu('asset-type');
}

function renderAssets() {
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Tài sản';
  document.title = 'Tài sản · Siris Residences';
  for (const selector of ['.summary', '.ledger', '.footnote']) document.querySelector(selector).hidden = true;
  for (const id of ['repairs-view', 'purchases-view', 'payments-view']) $(id).hidden = true;
  $('assets-view').hidden = false;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'assets';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const query = assetFilter.query.trim().toLocaleLowerCase('vi');
  const rows = state.rows.filter(row => row.source === 'assets' &&
    (!assetFilter.type || row.type === assetFilter.type) &&
    (!query || [row.name, row.type, row.model, row.specification, row.sub, row.note, ...(row.locations || [])].some(value => String(value || '').toLocaleLowerCase('vi').includes(query)))
  ).sort((a, b) => Number(!a.name && !a.type) - Number(!b.name && !b.type) || (a.name || a.type || '').localeCompare(b.name || b.type || '', 'vi', { numeric: true }) || a.id.localeCompare(b.id));
  $('asset-total').textContent = new Intl.NumberFormat('vi-VN').format(rows.length);
  $('asset-purchased').textContent = new Intl.NumberFormat('vi-VN').format(rows.filter(row => row.linkedPurchases?.length).length);
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  assetFilter.page = Math.min(assetFilter.page, totalPages);
  const start = (assetFilter.page - 1) * 20;
  $('asset-range').textContent = rows.length ? `${start + 1}–${Math.min(start + 20, rows.length)} / ${rows.length}` : '0 bản ghi';
  $('asset-page').textContent = `${assetFilter.page} / ${totalPages}`;
  $('asset-prev').disabled = assetFilter.page <= 1;
  $('asset-next').disabled = assetFilter.page >= totalPages;
  $('asset-clear').hidden = !assetFilter.query && !assetFilter.type;
  const list = $('asset-list'); list.replaceChildren();
  if (!rows.length) list.append(cell('p', 'Không có tài sản phù hợp.', 'repair-empty'));
  for (const row of rows.slice(start, start + 20)) {
    const article = cell('article', '', 'asset-entry');
    const header = cell('div', '', 'asset-entry-head');
    header.append(cell('h3', row.name || row.type || 'Tài sản chưa có tên'));
    if (row.type) header.append(cell('span', row.type, `asset-type-tag ${tagColorClass(row.type)}`));
    article.append(header);
    const meta = [row.model, row.specification, row.sub, ...(row.locations || [])].filter(value => value && value !== row.name);
    if (meta.length) article.append(cell('div', meta.join(' · '), 'asset-entry-meta'));
    if (row.note) article.append(cell('p', row.note, 'asset-entry-note'));
    const assetImages = imageGallery(row); if (assetImages) article.append(assetImages);
    for (const [label, records] of [['Lịch sử mua sắm', row.linkedPurchases], ['Lịch sử sửa chữa', row.linkedRepairs]]) {
      if (!records?.length) continue;
      const details = cell('details', '', `asset-history ${label === 'Lịch sử sửa chữa' ? 'asset-repair-history' : 'asset-purchase-history'}`);
      details.append(cell('summary', `${label} (${records.length})`));
      const items = cell('div', '', 'asset-history-items');
      for (const item of records) {
        const line = cell('div', '', 'asset-history-item');
        line.append(cell('strong', item.title || 'Chưa ghi nội dung'));
        line.append(cell('span', [date(item.date), item.status, item.quantity != null ? `SL ${new Intl.NumberFormat('vi-VN').format(item.quantity)}` : '', item.amount != null ? `${new Intl.NumberFormat('vi-VN').format(item.amount)} ₫` : ''].filter(Boolean).join(' · ')));
        items.append(line);
      }
      details.append(items); article.append(details);
    }
    list.append(article);
  }
}

function reviewUrl(value) {
  const raw = String(value || '').trim();
  const candidate = /^\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/.exec(raw)?.[1] || raw;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function renderReviews() {
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Review';
  document.title = 'Review · Siris Residences';
  for (const selector of ['.summary', '.ledger', '.footnote']) document.querySelector(selector).hidden = true;
  for (const id of ['company-fund-view', 'repairs-view', 'purchases-view', 'assets-view', 'payments-view']) $(id).hidden = true;
  $('reviews-view').hidden = false;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'reviews';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const google = state.rows.filter(row => row.source === 'googleReviews').sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')));
  $('reviews-google-total').textContent = new Intl.NumberFormat('vi-VN').format(google.length);
  $('reviews-google-count').textContent = new Intl.NumberFormat('vi-VN').format(google.reduce((sum, row) => sum + (row.images?.length || 0), 0));
  renderOtaDashboard();
  refreshReviewSyncStatus();
  const googleList = $('reviews-google-list'); googleList.replaceChildren();
  if (!google.length) googleList.append(cell('p', 'Chưa có review Google Maps.', 'repair-empty'));
  for (const row of google) {
    const article = cell('article', '', 'review-entry google-review-entry');
    const heading = cell('div', '', 'review-entry-main');
    heading.append(cell('strong', date(row.date) || 'Chưa có ngày'));
    const gallery = imageGallery(row);
    if (gallery) heading.append(gallery);
    article.append(heading);
    const stats = cell('div', '', 'review-entry-stats');
    stats.append(cell('span', new Intl.NumberFormat('vi-VN').format(row.count), 'review-score'));
    stats.append(cell('span', 'review'));
    article.append(stats); googleList.append(article);
  }
  for (const [id, active] of [['reviews-ota-tab', reviewTab === 'ota'], ['reviews-google-tab', reviewTab === 'google']]) $(id).setAttribute('aria-selected', String(active));
  $('reviews-ota').hidden = reviewTab !== 'ota';
  $('reviews-google').hidden = reviewTab !== 'google';
}

const otaNumber = value => value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
function otaWhen(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}
function otaNeedsCheck(item) { return item && ['error', 'unsupported'].includes(item.status); }
function otaRecord(row, checks) {
  const item = checks.get(row.id);
  const block = cell('div', '', 'ota-record');
  block.dataset.reviewId = row.id;
  if (row.note) block.append(cell('div', row.note, 'ota-room-name'));
  const figures = cell('div', '', 'ota-figures');
  const score = cell('strong', otaNumber(row.score), 'ota-score');
  figures.append(score, cell('span', 'điểm', 'ota-unit'));
  block.append(figures, cell('div', `${otaNumber(row.count)} review`, 'ota-review-count'));
  const actions = cell('div', '', 'ota-record-actions');
  const url = reviewUrl(row.url);
  if (url) {
    const link = cell('a', 'Trang gốc ↗');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  const editButton = cell('button', 'Sửa điểm', 'ota-edit-score');
  editButton.type = 'button';
  editButton.disabled = otaScoreDrafts.has(row.id);
  editButton.setAttribute('aria-label', `Sửa điểm ${row.platform} ${row.building}${row.note ? ` · ${row.note}` : ''}`);
  editButton.addEventListener('click', () => { otaScoreDrafts.set(row.id, { value: row.score == null ? '' : String(row.score), saving: false, error: '' }); renderOtaDashboard(); document.getElementById(`ota-score-${row.id}`)?.focus(); });
  actions.append(editButton);
  const details = cell('details', '', 'ota-check ota-updated');
  const label = row.updatedAt ? `Cập nhật ${otaWhen(row.updatedAt)}` : 'Chưa có ngày cập nhật';
  details.append(cell('summary', label));
  const info = cell('div', '', 'ota-check-info');
  if (item?.message) info.append(cell('p', item.message));
  if (otaNeedsCheck(item)) info.append(cell('p', 'Đang hiển thị số liệu đã lưu trong Base.'));
  info.append(cell('p', `Kiểm tra OTA: ${otaWhen(item?.checkedAt)}`));
  info.append(cell('p', `Sửa trong Base: ${otaWhen(row.updatedAt)}`));
  details.append(info); actions.append(details); block.append(actions);
  if (otaScoreDrafts.has(row.id)) block.append(otaScoreEditor(row));
  return block;
}
function otaScoreEditor(row) {
  const draft = otaScoreDrafts.get(row.id);
  const maximum = row.platform.toLowerCase() === 'airbnb' ? 5 : 10;
  const form = cell('form', '', 'ota-score-editor');
  const label = cell('label', `Điểm review (0–${maximum})`);
  label.htmlFor = `ota-score-${row.id}`;
  const input = cell('input'); input.type = 'number'; input.id = label.htmlFor;
  input.min = '0'; input.max = String(maximum); input.step = 'any'; input.inputMode = 'decimal'; input.required = true; input.value = draft.value;
  input.disabled = draft.saving;
  input.addEventListener('input', () => { draft.value = input.value; draft.error = ''; });
  const buttons = cell('div', '', 'ota-score-editor-actions');
  const save = cell('button', draft.saving ? 'Đang lưu…' : 'Lưu điểm'); save.type = 'submit'; save.disabled = draft.saving;
  const cancel = cell('button', 'Huỷ'); cancel.type = 'button'; cancel.disabled = draft.saving;
  cancel.addEventListener('click', () => { otaScoreDrafts.delete(row.id); renderOtaDashboard(); });
  buttons.append(save, cancel); form.append(label, input, buttons);
  const error = cell('p', draft.error || '', 'ota-score-error'); error.setAttribute('role', 'alert'); form.append(error);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (draft.saving || !form.reportValidity()) return;
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < 0 || value > maximum) return;
    draft.value = input.value; draft.saving = true; draft.error = ''; renderOtaDashboard();
    try {
      const response = await fetch('/api/reviews/score', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordId: row.id, score: value }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Chưa lưu được điểm.');
      const current = state.rows.find(item => item.source === 'reviews' && item.id === row.id);
      if (current) { current.score = result.score; current.updatedAt = result.updatedAt; }
      otaScoreDrafts.delete(row.id);
    } catch (failure) { draft.error = failure.message || 'Chưa lưu được điểm.'; draft.saving = false; }
    renderOtaDashboard();
  });
  return form;
}
function renderOtaDashboard() {
  const all = state.rows.filter(row => row.source === 'reviews');
  const checks = new Map((otaSyncStatus?.results || []).map(item => [item.recordId, item]));
  const awaitingData = state.rows.length === 0 && !state.lastCheckAt;
  const inBuilding = all.filter(row => !otaFilter.building || row.building.toLowerCase() === otaFilter.building);
  const errorCount = inBuilding.filter(row => otaNeedsCheck(checks.get(row.id))).length;
  const rows = inBuilding.filter(row => !otaFilter.errorsOnly || otaNeedsCheck(checks.get(row.id)));
  $('reviews-ota-platforms').textContent = otaNumber(new Set(rows.map(row => row.platform)).size);
  $('reviews-ota-total').textContent = otaNumber(rows.length);
  $('reviews-ota-count').textContent = otaNumber(rows.reduce((total, row) => total + (row.count ?? 0), 0));
  $('ota-error-count').textContent = otaNumber(errorCount);
  if (awaitingData) for (const id of ['reviews-ota-platforms', 'reviews-ota-total', 'reviews-ota-count']) $(id).textContent = '—';
  document.querySelectorAll('[data-ota-building]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.otaBuilding === otaFilter.building)));
  $('ota-errors-filter').setAttribute('aria-pressed', String(otaFilter.errorsOnly));
  const status = $('reviews-sync-status');
  const latestUpdate = rows.map(row => row.updatedAt).filter(value => value && !Number.isNaN(new Date(value).getTime())).sort((a, b) => new Date(b) - new Date(a))[0];
  status.classList.toggle('has-errors', otaSyncStatus?.lastRunStatus === 'failed');
  if (!otaSyncStatus) status.textContent = 'Đang đọc trạng thái kiểm tra OTA…';
  else if (otaSyncStatus.lastRunStatus === 'failed') status.textContent = `Kiểm tra lỗi · ${otaWhen(otaSyncStatus.lastAttemptAt)} · Kiểm tra đăng nhập Lark hoặc kết nối mạng.`;
  else if (otaSyncStatus.lastRunStatus === 'running') status.textContent = 'Đang kiểm tra OTA · Số liệu đã lưu vẫn được hiển thị.';
  else status.textContent = `${latestUpdate ? `Cập nhật gần nhất ${otaWhen(latestUpdate)}` : 'Chưa có ngày cập nhật'} · ${rows.length} link OTA`;
  const list = $('reviews-ota-list'); list.replaceChildren();
  if (!rows.length) { list.append(cell('p', awaitingData ? 'Đang tải dữ liệu OTA…' : otaFilter.errorsOnly ? 'Không có link cần kiểm tra lại trong lựa chọn này.' : 'Chưa có link OTA trong lựa chọn này.', 'ota-empty')); return; }
  const buildings = otaFilter.building ? [otaFilter.building] : ['lune', 'mia', ...new Set(rows.map(row => row.building.toLowerCase()).filter(name => name && !['lune', 'mia'].includes(name)))];
  const platforms = [...new Set(rows.map(row => row.platform))].sort((a, b) => {
    const order = ['Agoda', 'Traveloka', 'Expedia', 'Trip.com', 'Airbnb'];
    const rank = name => order.includes(name) ? order.indexOf(name) : order.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const table = cell('table', '', 'ota-matrix');
  const caption = cell('caption', 'Điểm theo thang gốc từng OTA'); table.append(caption);
  const head = cell('thead'); const heading = cell('tr');
  const platformHeading = cell('th', 'Nền tảng'); platformHeading.scope = 'col'; heading.append(platformHeading);
  for (const building of buildings) {
    const th = cell('th'); th.scope = 'col'; th.append(cell('span', building === 'lune' ? 'Lune' : building === 'mia' ? 'Mia' : building, `building-tag ${buildingColorClass(building)}`)); heading.append(th);
  }
  head.append(heading); table.append(head);
  const body = cell('tbody');
  for (const platform of platforms) {
    const platformRows = rows.filter(row => row.platform === platform);
    const isGrouped = platform === 'Airbnb' || buildings.some(building => platformRows.filter(row => row.building.toLowerCase() === building).length > 1);
    const tr = cell('tr', '', 'ota-platform-row');
    const name = cell('th'); name.scope = 'row'; name.append(cell('strong', platform));
    if (isGrouped) {
      name.append(cell('span', `${platformRows.length} loại phòng`, 'ota-platform-note'));
      const toggle = cell('button', otaExpanded.has(platform) ? 'Thu gọn −' : 'Xem loại phòng +', 'ota-expand');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', String(otaExpanded.has(platform)));
      toggle.addEventListener('click', () => { if (otaExpanded.has(platform)) otaExpanded.delete(platform); else otaExpanded.add(platform); renderOtaDashboard(); });
      name.append(toggle);
    }
    tr.append(name);
    for (const building of buildings) {
      const td = cell('td'); td.dataset.building = building === 'lune' ? 'Lune' : building === 'mia' ? 'Mia' : building;
      const records = platformRows.filter(row => row.building.toLowerCase() === building);
      if (!records.length) td.append(cell('span', '—', 'ota-no-record'));
      else if (!isGrouped) td.append(otaRecord(records[0], checks));
      else {
        const summary = cell('div', '', 'ota-group-overview');
        summary.append(cell('strong', `${records.length} loại phòng`));
        summary.append(cell('span', `${records.filter(row => row.score != null).length} có điểm · ${otaNumber(records.reduce((sum, row) => sum + (row.count ?? 0), 0))} review`));
        const latest = records.map(row => row.updatedAt).filter(value => value && !Number.isNaN(new Date(value).getTime())).sort((a, b) => new Date(b) - new Date(a))[0];
        summary.append(cell('span', latest ? `Cập nhật ${otaWhen(latest)}` : 'Chưa có ngày cập nhật', 'ota-group-note'));
        td.append(summary);
      }
      tr.append(td);
    }
    body.append(tr);
    if (isGrouped && otaExpanded.has(platform)) {
      const detailRow = cell('tr', '', 'ota-detail-row'); const td = cell('td'); td.colSpan = buildings.length + 1;
      const grid = cell('div', '', 'ota-room-grid'); grid.style.setProperty('--ota-columns', buildings.length);
      for (const building of buildings) {
        const column = cell('section', '', 'ota-room-column');
        column.append(cell('h3', building === 'lune' ? 'Lune' : building === 'mia' ? 'Mia' : building));
        const records = platformRows.filter(row => row.building.toLowerCase() === building).sort((a, b) => a.note.localeCompare(b.note, 'vi'));
        for (const row of records) column.append(otaRecord(row, checks));
        if (!records.length) column.append(cell('p', 'Không có link phù hợp.', 'ota-group-note'));
        grid.append(column);
      }
      td.append(grid); detailRow.append(td); body.append(detailRow);
    }
  }
  table.append(body); list.append(table);
}
async function refreshReviewSyncStatus() {
  await window.sirisReady;
  if(window.sirisCloud){$('reviews-sync-status').hidden=true;return;}
  try {
    const response = await fetch('/api/review-sync-status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Không đọc được nhật ký');
    otaSyncStatus = await response.json();
    renderOtaDashboard();
  } catch { $('reviews-sync-status').textContent = 'Chưa đọc được trạng thái kiểm tra OTA.'; }
}

function renderCompanyFund() {
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Quỹ công ty';
  document.title = 'Quỹ công ty · Siris Residences';
  for (const selector of ['.summary', '.ledger', '.footnote']) document.querySelector(selector).hidden = true;
  for (const id of ['repairs-view', 'purchases-view', 'assets-view', 'payments-view']) $(id).hidden = true;
  $('company-fund-view').hidden = false;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'companyFund';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const all = state.rows.filter(row => row.source === 'companyFund');
  const sum = key => all.reduce((total, row) => total + (row[key] || 0), 0);
  $('company-deposit').textContent = `${new Intl.NumberFormat('vi-VN').format(sum('deposit'))} ₫`;
  $('company-withdrawal').textContent = `${new Intl.NumberFormat('vi-VN').format(sum('withdrawal'))} ₫`;
  $('company-balance').textContent = `${new Intl.NumberFormat('vi-VN').format(sum('deposit') - sum('withdrawal'))} ₫`;
  const query = companyFilter.query.trim().toLocaleLowerCase('vi');
  const rows = all.filter(row =>
    (!companyFilter.kind || (companyFilter.kind === 'deposit' ? row.deposit != null : row.withdrawal != null)) &&
    (!query || [row.depositNote, row.withdrawalNote, ...(row.linkedPayments || []).flatMap(payment => [payment.category, ...(payment.beneficiaries || [])])].some(value => String(value || '').toLocaleLowerCase('vi').includes(query)))
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  companyFilter.page = Math.min(companyFilter.page, pages);
  const start = (companyFilter.page - 1) * 20;
  $('company-range').textContent = rows.length ? `${start + 1}–${Math.min(start + 20, rows.length)} / ${rows.length}` : '0 bản ghi';
  $('company-page').textContent = `${companyFilter.page} / ${pages}`;
  $('company-prev').disabled = companyFilter.page <= 1;
  $('company-next').disabled = companyFilter.page >= pages;
  $('company-clear').hidden = !companyFilter.query && !companyFilter.kind;
  const list = $('company-list'); list.replaceChildren();
  if (!rows.length) list.append(cell('p', 'Không có bút toán phù hợp.', 'repair-empty'));
  for (const row of rows.slice(start, start + 20)) {
    const article = cell('article', '', 'repair-entry company-entry');
    const top = cell('div', '', 'repair-entry-top');
    top.append(cell('time', date(row.date) || 'Chưa có ngày', 'repair-date'));
    top.append(cell('span', row.deposit != null ? 'Nộp tiền' : 'Chi tiền', `repair-status ${row.deposit != null ? 'complete' : 'active'}`));
    article.append(top);
    article.append(cell('h3', row.depositNote || row.withdrawalNote || (row.deposit != null ? 'Nộp quỹ' : 'Chi quỹ'), 'repair-title'));
    const amount = row.deposit != null ? row.deposit : row.withdrawal;
    article.append(cell('strong', amount == null ? 'Chưa ghi số tiền' : `${row.deposit != null ? '+' : '−'}${new Intl.NumberFormat('vi-VN').format(amount)} ₫`, `payment-row-amount ${row.deposit != null ? 'company-in' : 'company-out'}`));
    if (row.linkedPayments?.length) {
      const details = cell('details', '', 'company-payments');
      details.append(cell('summary', `Yêu cầu thanh toán (${row.linkedPayments.length})`));
      const items = cell('div', '', 'purchase-payment-items');
      for (const payment of row.linkedPayments) {
        const item = cell('div', '', 'purchase-payment-item');
        item.append(cell('strong', payment.category || 'Chưa ghi nội dung'));
        item.append(cell('span', [date(payment.date), payment.paid ? 'Đã chi' : 'Chưa chi', payment.amount != null ? `${new Intl.NumberFormat('vi-VN').format(payment.amount)} ₫` : ''].filter(Boolean).join(' · ')));
        if (payment.beneficiaries?.length) item.append(cell('small', `Thụ hưởng: ${payment.beneficiaries.join(', ')}`));
        items.append(item);
      }
      details.append(items); article.append(details);
    }
    list.append(article);
  }
}

function renderPurchases() {
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Lịch sử mua sắm';
  document.title = 'Lịch sử mua sắm · Siris Residences';
  document.querySelector('.summary').hidden = true;
  document.querySelector('.ledger').hidden = true;
  document.querySelector('.footnote').hidden = true;
  $('repairs-view').hidden = true;
  $('payments-view').hidden = true;
  $('purchases-view').hidden = false;
  $('assets-view').hidden = true;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'purchases';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const query = purchaseFilter.query.trim().toLocaleLowerCase('vi');
  const rows = state.rows.filter(row => row.source === 'purchases' &&
    (!purchaseFilter.month || row.date?.startsWith(purchaseFilter.month)) &&
    (!query || [row.category, row.note, ...(row.linkedAssets || []).flatMap(asset => [asset.name, asset.type, asset.model, asset.specification]), ...(row.linkedPayments || []).flatMap(payment => [payment.category, payment.purpose, ...(payment.beneficiaries || [])])].some(value => String(value || '').toLocaleLowerCase('vi').includes(query)))
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  $('purchase-total').textContent = new Intl.NumberFormat('vi-VN').format(rows.length);
  const known = rows.filter(row => row.amount != null);
  $('purchase-amount').textContent = `${new Intl.NumberFormat('vi-VN').format(known.reduce((sum, row) => sum + row.amount, 0))} ₫`;
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  purchaseFilter.page = Math.min(purchaseFilter.page, totalPages);
  const start = (purchaseFilter.page - 1) * 20;
  $('purchase-range').textContent = rows.length ? `${start + 1}–${Math.min(start + 20, rows.length)} / ${rows.length}` : '0 bản ghi';
  $('purchase-page').textContent = `${purchaseFilter.page} / ${totalPages}`;
  $('purchase-prev').disabled = purchaseFilter.page <= 1;
  $('purchase-next').disabled = purchaseFilter.page >= totalPages;
  $('purchase-clear').hidden = !purchaseFilter.query && !purchaseFilter.month;
  const list = $('purchase-list');
  list.replaceChildren();
  if (!rows.length) list.append(cell('p', 'Không có lịch sử mua sắm phù hợp.', 'repair-empty'));
  for (const row of rows.slice(start, start + 20)) {
    const article = cell('article', '', 'repair-entry purchase-entry');
    const top = cell('div', '', 'repair-entry-top');
    top.append(cell('time', date(row.date) || 'Chưa có ngày', 'repair-date'));
    article.append(top);
    article.append(cell('h3', row.category || row.linkedAssets?.map(asset => asset.name).filter(Boolean).join(', ') || 'Chưa ghi tài sản', 'repair-title'));
    article.append(cell('strong', row.amount == null ? 'Chưa ghi số tiền' : `${new Intl.NumberFormat('vi-VN').format(row.amount)} ₫`, 'payment-row-amount'));
    if (row.quantity != null) article.append(cell('div', `Số lượng: ${new Intl.NumberFormat('vi-VN').format(row.quantity)}`, 'repair-details'));
    if (row.note) article.append(cell('p', row.note, 'repair-note'));
    if (row.linkedAssets?.length) {
      const linked = cell('details', '', 'purchase-assets');
      linked.append(cell('summary', `Tài sản liên kết (${row.linkedAssets.length})`));
      const items = cell('div', '', 'purchase-payment-items');
      for (const asset of row.linkedAssets) {
        const item = cell('div', '', 'purchase-payment-item');
        item.append(cell('strong', asset.name || asset.type || 'Tài sản chưa có tên'));
        const description = [asset.type, asset.model, asset.specification, asset.sub].filter(Boolean).join(' · ');
        if (description) item.append(cell('small', description));
        items.append(item);
      }
      linked.append(items);
      article.append(linked);
    }
    if (row.linkedPayments?.length) {
      const linked = cell('details', '', 'purchase-payments');
      linked.append(cell('summary', `Yêu cầu thanh toán (${row.linkedPayments.length})`));
      const items = cell('div', '', 'purchase-payment-items');
      for (const payment of row.linkedPayments) {
        const item = cell('div', '', 'purchase-payment-item');
        item.append(cell('strong', payment.category || 'Chưa ghi nội dung'));
        item.append(cell('span', [date(payment.date), payment.paid ? 'Đã chi' : 'Chưa chi', payment.amount == null ? '' : `${new Intl.NumberFormat('vi-VN').format(payment.amount)} ₫`].filter(Boolean).join(' · ')));
        if (payment.purpose || payment.beneficiaries?.length) item.append(cell('small', [payment.purpose ? `Mục đích: ${payment.purpose}` : '', payment.beneficiaries?.length ? `Thụ hưởng: ${payment.beneficiaries.join(', ')}` : ''].filter(Boolean).join(' · ')));
        items.append(item);
      }
      linked.append(items);
      article.append(linked);
    }
    list.append(article);
  }
}

function paymentRecordDetails(row) {
  const disclosure=cell('details','','payment-record-details');
  disclosure.append(cell('summary','Chi tiết · Chỉnh sửa'));
  disclosure.addEventListener('toggle',()=>{
    if(!disclosure.open||disclosure.querySelector('form')) return;
    const form=cell('form','','payment-record-form'), grid=cell('div','','fund-form-grid');
    const controls={}, prefix=`payment-edit-${row.id}-`;
    function field(key,label,type,value) {
      const wrap=cell('label','',type==='textarea'?'fund-form-note':''), input=cell(type==='textarea'?'textarea':'input','');
      input.id=prefix+key; input.name=key; if(type!=='textarea') input.type=type;
      input.value=value??''; wrap.append(document.createTextNode(label),input); grid.append(wrap); controls[key]=input; return input;
    }
    const dateInput=field('date','Ngày','date',row.date?.slice(0,10));dateInput.required=true;dateInput.parentElement.classList.add('entry-date-field');
    const money=field('amount','Số tiền','text',row.amount==null?'':String(row.amount).replace(/\B(?=(\d{3})+(?!\d))/g,','));
    money.inputMode='numeric'; money.required=true; money.addEventListener('input',()=>formatMoneyInput(money));
    field('category','Nội dung','textarea',row.category).required=true;
    const selects=[];
    function select(key,label,options,selected,multiple=false) {
      const wrap=cell('label','',multiple?'multi-field':'select-picker'), input=cell('select','');
      input.id=prefix+key; input.multiple=multiple; if(multiple) input.hidden=true;
      if(!multiple) input.append(new Option('Chưa ghi',''));
      for(const [value,text] of options) input.append(new Option(text,value,false,multiple?selected.includes(value):selected===value));
      wrap.append(document.createTextNode(label),input);grid.append(wrap);controls[key]=input;selects.push([input.id,multiple]);
    }
    select('purpose','Mục đích',(state.options.paymentPurposes||[]).map(x=>[x,x]),row.purpose);
    select('channel','Chi cho',(state.options.paymentChannels||[]).map(x=>[x,x]),row.channel);
    const contacts=state.rows.filter(r=>r.source==='contact').map(r=>[r.id,r.name]);
    select('beneficiaryRecordIds','Thụ hưởng',contacts,row.beneficiaryRecordIds||[],true);
    select('contactIds','Liên hệ',contacts,row.contactIds||[],true);
    for(const [key,label,source] of [['repairRecordIds','Sửa chữa','repairs'],['purchaseRecordIds','Mua sắm','purchases']])
      select(key,label,state.rows.filter(r=>r.source===source).map(r=>[r.id,[date(r.date),r.category].filter(Boolean).join(' · ')]),row[key]||[],true);
    field('paymentInfoCustom','Thông tin thanh toán riêng','textarea',row.paymentInfoCustom);
    const paidWrap=cell('label','','payment-edit-paid'),paid=cell('input','');paid.type='checkbox';paid.checked=row.paid;controls.paid=paid;paidWrap.append(paid,document.createTextNode('Đã chi'));grid.append(paidWrap);
    form.append(grid);
    const readonly=cell('div','','payment-readonly');
    for(const [label,value] of [['Người yêu cầu',row.requesterNames?.join(', ')],['Thông tin thanh toán từ danh bạ',row.paymentInfo]]) {
      const item=cell('p','');item.append(cell('span',label+': '),document.createTextNode(value||'—'));readonly.append(item);
    }
    const gallery=imageGallery(row);if(gallery) readonly.append(gallery);
    form.append(readonly);
    const actions=cell('div','','payment-edit-actions'),save=cell('button','Lưu thay đổi','primary'),cancel=cell('button','Huỷ');save.type='submit';cancel.type='button';
    cancel.addEventListener('click',()=>{disclosure.open=false;form.remove();});actions.append(save,cancel);form.append(actions);
    const message=cell('p','','payment-edit-message');message.hidden=true;message.setAttribute('role','status');form.append(message);disclosure.append(form);
    for(const [id,multi] of selects) multi?refreshMulti(id):setupSelectMenu(id);
    setupDatePicker(controls.date.id);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const changes={},original={};
      for(const [key,input] of Object.entries(controls)) {
        const value=input.multiple?[...input.selectedOptions].map(o=>o.value):key==='paid'?input.checked:key==='amount'?moneyValue(input):input.value;
        const prior=key==='date'?row.date?.slice(0,10):row[key];
        if(JSON.stringify(value)!==JSON.stringify(prior??(input.multiple?[]:''))) {changes[key]=value;original[key]=row[key];}
      }
      if(!Object.keys(changes).length){disclosure.open=false;return;}
      save.disabled=true;cancel.disabled=true;save.textContent='Đang lưu…';message.hidden=true;
      try {
        const response=await fetch('/api/payments/update',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({recordId:row.id,changes,original})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||'Không lưu được.');
        disclosure.open=false;await load({force:true});
      } catch(error){message.hidden=false;message.textContent=error.message;}
      finally{save.disabled=false;cancel.disabled=false;save.textContent='Lưu thay đổi';}
    });
  });
  return disclosure;
}

function renderPayments() {
  if ($('payment-list').querySelector('.payment-record-details[open]')) return;
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Yêu cầu thanh toán';
  document.title = 'Yêu cầu thanh toán · Siris Residences';
  for (const selector of ['.summary', '.ledger', '.footnote']) document.querySelector(selector).hidden = true;
  $('repairs-view').hidden = true;
  $('purchases-view').hidden = true;
  $('assets-view').hidden = true;
  $('payments-view').hidden = false;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'payments';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const query = paymentFilter.query.trim().toLocaleLowerCase('vi');
  const rows = state.rows.filter(row => row.source === 'payments' &&
    (!paymentFilter.status || (paymentFilter.status === 'paid') === row.paid) &&
    (!paymentFilter.purpose || row.purpose === paymentFilter.purpose) &&
    (!query || [row.category, row.purpose, row.channel, row.paymentInfo, row.paymentInfoCustom, ...(row.beneficiaries || []), ...(row.requesterNames || []), ...(row.linkedHistory || []).flatMap(item => [item.type, item.title, item.note, ...(item.locations || [])])]
      .some(value => String(value).toLocaleLowerCase('vi').includes(query)))
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const pending = rows.filter(row => !row.paid);
  $('payment-total').textContent = new Intl.NumberFormat('vi-VN').format(rows.length);
  $('payment-pending').textContent = new Intl.NumberFormat('vi-VN').format(pending.length);
  const known = rows.filter(row => row.paid && row.amount != null);
  $('payment-amount').textContent = `${new Intl.NumberFormat('vi-VN').format(known.reduce((sum, row) => sum + row.amount, 0))} ₫`;
  $('payment-clear').hidden = !paymentFilter.query && !paymentFilter.status && !paymentFilter.purpose;
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  paymentFilter.page = Math.min(paymentFilter.page, totalPages);
  const start = (paymentFilter.page - 1) * 20;
  $('payment-range').textContent = rows.length ? `${start + 1}–${Math.min(start + 20, rows.length)} / ${rows.length}` : '0 bản ghi';
  $('payment-page').textContent = `${paymentFilter.page} / ${totalPages}`;
  $('payment-prev').disabled = paymentFilter.page <= 1;
  $('payment-next').disabled = paymentFilter.page >= totalPages;
  const list = $('payment-list');
  list.replaceChildren();
  if (!rows.length) list.append(cell('p', 'Không có yêu cầu thanh toán phù hợp.', 'repair-empty'));
  for (const row of rows.slice(start, start + 20)) {
    const article = document.createElement('article');
    article.className = 'repair-entry payment-entry';
    const top = cell('div', '', 'repair-entry-top');
    top.append(cell('time', date(row.date) || 'Chưa có ngày', 'repair-date'));
    top.append(cell('span', row.paid ? 'Đã chi' : 'Chưa chi', `repair-status ${row.paid ? 'complete' : 'active'}`));
    article.append(top);
    const purposeRow = cell('div', '', 'payment-purpose-row');
    if (row.linkedHistory?.length) {
      const history = cell('details', '', 'payment-history');
      const purpose = cell('summary', '', `payment-purpose ${tagColorClass(row.purpose)}`);
      purpose.append(cell('strong', row.purpose || 'Chưa ghi'));
      history.append(purpose);
      const historyItems = cell('div', '', 'payment-history-items');
      for (const item of row.linkedHistory) {
        const line = cell('div', '', 'payment-history-item');
        line.append(cell('strong', `${item.type}: ${item.title || 'Chưa có nội dung'}`));
        const meta = [item.date ? date(item.date) : '', item.status || '', ...(item.locations || []), item.quantity != null ? `SL ${item.quantity}` : '', item.amount != null ? `${new Intl.NumberFormat('vi-VN').format(item.amount)} ₫` : ''].filter(Boolean).join(' · ');
        if (meta) line.append(cell('span', meta));
        if (item.note) line.append(cell('p', item.note, 'payment-history-note'));
        historyItems.append(line);
      }
      history.append(historyItems);
      purposeRow.append(history);
    } else {
      const purpose = cell('span', '', `payment-purpose ${tagColorClass(row.purpose)}`);
      purpose.append(cell('strong', row.purpose || 'Chưa ghi'));
      purposeRow.append(purpose);
    }
    article.append(purposeRow);
    article.append(cell('h3', row.category || 'Chưa có nội dung', 'repair-title'));
    const amount = cell('strong', row.amount == null ? 'Chưa ghi số tiền' : `${new Intl.NumberFormat('vi-VN').format(row.amount)} ₫`, 'payment-row-amount');
    article.append(amount);
    const details = cell('div', '', 'payment-summary-grid');
    const recipients=[row.channel,row.beneficiaries?.join(', ')].filter(Boolean).join(' · ');
    const transfer=[row.paymentInfo?`Danh bạ: ${row.paymentInfo}`:'',row.paymentInfoCustom?`Riêng: ${row.paymentInfoCustom}`:''].filter(Boolean).join('\n');
    for (const [label,value] of [['Chi trả',recipients],['Yêu cầu',row.requesterNames?.join(', ')],['Thông tin thanh toán',transfer]]) {
      const item=cell('div','','payment-summary-item');
      item.append(cell('span',label,'payment-transfer-label'),cell('p',value||'—'));
      details.append(item);
    }
    article.append(details);
    const quickImages=paymentImagePreview(row);if(quickImages)article.append(quickImages);
    article.append(paymentRecordDetails(row));
    list.append(article);
  }
}

function repairRows() {
  const query = repairFilter.query.trim().toLocaleLowerCase('vi');
  return state.rows.filter(row => row.source === 'repairs' &&
    (!repairFilter.building || row.buildings.includes(repairFilter.building)) &&
    (!repairFilter.status || row.status === repairFilter.status) &&
    (!repairFilter.month || row.date?.startsWith(repairFilter.month)) &&
    (!query || [row.category, row.note, row.status, ...(row.buildings || []), ...(row.locations || []), ...(row.performers || [])]
      .some(value => String(value || '').toLocaleLowerCase('vi').includes(query)))
  ).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}

function renderRepairs() {
  document.body.classList.remove('cash-page');
  document.querySelector('.page-head h1').textContent = 'Lịch sử sửa chữa';
  document.title = 'Lịch sử sửa chữa · Siris Residences';
  document.querySelector('.summary').hidden = true;
  document.querySelector('.ledger').hidden = true;
  document.querySelector('.footnote').hidden = true;
  $('repairs-view').hidden = false;
  $('purchases-view').hidden = true;
  $('assets-view').hidden = true;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === 'repairs';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const rows = repairRows();
  $('repair-total').textContent = new Intl.NumberFormat('vi-VN').format(rows.length);
  $('repair-open').textContent = new Intl.NumberFormat('vi-VN').format(rows.filter(row => row.status === 'đang xử lý' || row.status === 'tiếp nhận').length);
  const withCost = rows.filter(row => row.amount != null);
  $('repair-cost').textContent = `${new Intl.NumberFormat('vi-VN').format(withCost.reduce((sum, row) => sum + row.amount, 0))} ₫`;
  $('repair-cost-count').textContent = `(${withCost.length} bản ghi)`;
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  repairFilter.page = Math.min(repairFilter.page, totalPages);
  const start = (repairFilter.page - 1) * 20;
  $('repair-range').textContent = rows.length ? `${start + 1}–${Math.min(start + 20, rows.length)} / ${rows.length}` : '0 bản ghi';
  $('repair-clear').hidden = !repairFilter.query && !repairFilter.building && !repairFilter.status && !repairFilter.month;
  $('repair-page').textContent = `${repairFilter.page} / ${totalPages}`;
  $('repair-prev').disabled = repairFilter.page <= 1;
  $('repair-next').disabled = repairFilter.page >= totalPages;
  const list = $('repair-list');
  list.replaceChildren();
  if (!rows.length) {
    list.append(cell('p', 'Không có lịch sử sửa chữa phù hợp.', 'repair-empty'));
    return;
  }
  for (const row of rows.slice(start, start + 20)) {
    const article = document.createElement('article');
    article.className = 'repair-entry';
    const top = document.createElement('div');
    top.className = 'repair-entry-top';
    top.append(cell('time', date(row.date) || 'Chưa có ngày', 'repair-date'));
    top.append(cell('span', row.status || 'Chưa có trạng thái', `repair-status ${row.status === 'hoàn thành' ? 'complete' : 'active'}`));
    article.append(top);
    article.append(cell('h3', row.category || 'Chưa có nội dung', 'repair-title'));
    const locations = document.createElement('div');
    locations.className = 'repair-locations';
    for (const place of row.locations?.length ? row.locations : row.buildings || []) {
      const building = (row.buildings || []).find(item => place.toLocaleLowerCase('vi').startsWith(item.toLocaleLowerCase('vi'))) || row.buildings?.[0];
      locations.append(cell('span', place, `location-tag ${buildingColorClass(building)}`));
    }
    if (locations.childNodes.length) article.append(locations);
    const details = document.createElement('div');
    details.className = 'repair-details';
    if (row.performers?.length) details.append(cell('span', `Thực hiện: ${row.performers.join(', ')}`));
    if (row.amount != null) details.append(cell('span', `Chi phí: ${new Intl.NumberFormat('vi-VN').format(row.amount)} ₫`));
    if (details.childNodes.length) article.append(details);
    if (row.note) article.append(cell('p', row.note, 'repair-note'));
    const repairImages = imageGallery(row); if (repairImages) article.append(repairImages);
    list.append(article);
  }
}

function renderRows() {
  $('company-fund-view').hidden = true;
  $('reviews-view').hidden = true;
  if (state.source === 'reviews') { renderReviews(); return; }
  if (state.source === 'companyFund') { renderCompanyFund(); return; }
  if (state.source === 'payments') { renderPayments(); return; }
  if (state.source === 'repairs') { renderRepairs(); return; }
  if (state.source === 'purchases') { renderPurchases(); return; }
  if (state.source === 'assets') { renderAssets(); return; }
  $('repairs-view').hidden = true;
  $('purchases-view').hidden = true;
  $('assets-view').hidden = true;
  $('payments-view').hidden = true;
  document.querySelector('.ledger').hidden = false;
  const isCleaning = state.source === 'cleaning';
  const isCreating = state.source === 'fundCreate';
  document.body.classList.toggle('cash-page', !isCleaning);
  $('amount-heading').textContent = isCleaning ? '' : state.source === 'income' ? 'Thực nhận' : 'Số tiền';
  $('description-heading').textContent = isCleaning ? 'Tình trạng dọn' : 'Nội dung';
  $('location-heading').textContent = isCleaning ? 'Buồng' : 'Toà / phòng';
  if (state.source === 'fund') $('location-heading').textContent = 'Chi tiết';
  document.querySelector('table').classList.toggle('fund-ledger', state.source === 'fund');
  $('ledger-title').textContent = isCleaning ? 'Lịch sử dọn buồng phòng ngắn hạn' : isCreating ? 'Quỹ tiền mặt' : 'Sổ giao dịch';
  $('source-note').textContent = isCleaning ? 'Lấy từ bảng Ngắn hạn trong Lark Base.' : 'Mỗi dòng giữ nguyên nguồn dữ liệu gốc.';
  $('source-note').hidden = true;
  $('updated').hidden = true;
  $('search').closest('.search').hidden = isCleaning;
  $('room-filter').closest('.filter-menu-wrap').hidden = isCleaning;
  $('clear-filters').hidden = isCleaning;
  $('calendar-count').hidden = isCleaning;
  document.querySelector('.filter-row').setAttribute('aria-label', isCleaning ? 'Bộ lọc dọn phòng' : 'Bộ lọc giao dịch');
  $('search').placeholder = isCleaning ? 'Tìm phòng, tình trạng, ghi chú' : 'Tìm nội dung, toà, ghi chú';
  $('search').setAttribute('aria-label', isCleaning ? 'Tìm lịch dọn phòng' : 'Tìm giao dịch');
  document.querySelector('.page-head h1').textContent = isCleaning ? 'Buồng phòng ngắn hạn' : isCreating ? 'Nhập liệu' : 'Quỹ tiền mặt';
  document.title = `${isCleaning ? 'Dọn phòng ngắn hạn' : isCreating ? 'Nhập liệu' : 'Quỹ tiền mặt'} · Siris Residences`;
  document.querySelector('.summary').hidden = isCleaning || isCreating;
  document.querySelector('table').classList.toggle('cleaning-view', isCleaning);
  document.querySelector('.footnote').hidden = isCleaning || isCreating;
  document.querySelector('.toolbar').hidden = isCleaning || isCreating;
  $('calendar-view').hidden = !isCleaning;
  $('entry-layout').hidden = !isCreating;
  document.querySelector('.ledger .section-head').hidden = isCreating;
  $('fund-create-form').hidden = !isCreating || entryMode !== 'fund';
  $('history-create-form').hidden = !isCreating || !['income','expense'].includes(entryMode);
  $('other-create-form').hidden = !isCreating || !['cleaning','repairs','payments'].includes(entryMode);
  document.querySelector('.table-wrap').hidden = isCleaning || isCreating;
  document.querySelector('.pagination').hidden = isCleaning || isCreating;
  const filterRow = document.querySelector('.filter-row');
  const buildingFilter = $('building-filter').closest('.filter-menu-wrap');
  if (isCleaning) $('calendar-building-slot').append(buildingFilter);
  else filterRow.prepend(buildingFilter);
  filterRow.hidden = isCleaning || isCreating;
  document.querySelectorAll('.date-filter').forEach(filter => { filter.hidden = isCleaning; });
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === (isCleaning ? 'cleaning' : isCreating ? 'editor' : 'cash');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (isCleaning) {
    renderCalendar();
    return;
  }
  if (isCreating) return;
  const rows = filteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const body = $('rows');
  body.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = cell('td', isCleaning ? 'Không có lịch dọn phòng phù hợp.' : 'Không có giao dịch phù hợp.', 'empty');
    td.colSpan = 4;
    tr.append(td); body.append(tr);
  }
  for (const row of rows.slice(start, start + state.pageSize)) {
    const tr = document.createElement('tr');
    tr.append(cell('td', amountText(row.amount), `amount ${row.amount > 0 ? 'positive' : row.amount < 0 ? 'negative' : 'muted'}`));
    const dateCell = document.createElement('td');
    dateCell.className = 'date';
    dateCell.append(cell('span', date(row.date), 'row-date'));
    if (!isCleaning) {
      const mobileAmount = document.createElement('span');
      mobileAmount.className = `mobile-amount ${row.amount > 0 ? 'positive' : row.amount < 0 ? 'negative' : 'muted'}`;
      if (row.source === 'income') mobileAmount.append(cell('span', 'Thực nhận ', 'mobile-amount-label'));
      mobileAmount.append(cell('span', amountText(row.amount)));
      dateCell.append(mobileAmount);
    }
    tr.append(dateCell);
    const desc = document.createElement('td');
    const heading = document.createElement('div');
    heading.className = 'row-heading';
    heading.append(cell('span', row.category || 'Chưa có nội dung', 'row-title'));
    if (row.source === 'cleaning') {
      if (row.done) heading.append(cell('span', 'Đã dọn', 'cleaning-status done'));
      if (row.guestRequestedNoCleaning) heading.append(cell('span', 'Khách yêu cầu không dọn', 'cleaning-status guest-request'));
      if (!row.done && !row.guestRequestedNoCleaning) heading.append(cell('span', 'Chưa đánh dấu', 'cleaning-status pending'));
    }
    if (row.source === 'fund') {
      const actor = row.creatorNames?.length ? row.creatorNames.join(', ') : 'Chưa ghi';
      const actorKind = fundActorLabel(row) === 'Người rút' ? 'withdrawal' : 'deposit';
      heading.append(cell('span', `${fundActorLabel(row)}: ${actor}`, `fund-actor ${actorKind}`));
    }
    if (row.source === 'income' || row.source === 'expense') for (const building of row.buildings || []) heading.append(cell('span', building, `building-tag ${buildingColorClass(building)}`));
    desc.append(heading);
    if (row.source === 'income') {
      const details = document.createElement('div');
      details.className = 'income-breakdown';
      const item = (label, value) => {
        const line = document.createElement('span');
        line.className = 'income-detail';
        line.append(cell('span', label, 'income-label'), cell('strong', value, 'income-value'));
        details.append(line);
      };
      item('Khách đưa', row.customerPaid == null ? 'Chưa ghi' : `${currency(row.customerPaid)} ₫`);
      if (row.staffChangeAmount > 0) {
        item('Nhân viên thối', row.staffChangeAmount == null ? 'Chưa ghi' : `${currency(row.staffChangeAmount)} ₫`);
        item('Người thối', row.staffChangeNames?.length ? row.staffChangeNames.join(', ') : 'Chưa ghi');
      }
      desc.append(details);
      const incomeMeta = document.createElement('div');
      incomeMeta.className = 'income-meta-row';
      if (row.changeGiven) incomeMeta.append(cell('span', 'Đã thối tiền', 'income-change-status'));
      incomeMeta.append(fundHistory(row, 'Lịch sử bỏ quỹ'));
      desc.append(incomeMeta);
    }
    if (row.source === 'expense') {
      const expenseMeta = document.createElement('div');
      expenseMeta.className = 'income-meta-row';
      expenseMeta.append(fundHistory(row, 'Lịch sử lấy quỹ'));
      desc.append(expenseMeta);
    }
    if (row.note) { const note = cell('span', row.note, 'row-note'); note.title = row.note; desc.append(note); }
    const place = document.createElement('td');
    for (const linked of row.linkedEntries || []) {
      const detail = document.createElement('div');
      detail.className = 'linked-detail';
      const detailHeading = document.createElement('div');
      detailHeading.className = 'row-heading';
      detailHeading.append(cell('span', `${linked.source === 'income' ? 'Thu' : 'Chi'} · ${linked.category || 'Chưa có nội dung'}`, 'linked-title'));
      for (const building of linked.buildings || []) detailHeading.append(cell('span', building, `building-tag ${buildingColorClass(building)}`));
      detail.append(detailHeading);
      if (!linked.missing) {
        const meta = [linked.date ? date(linked.date) : '', locationText(linked) || linked.location, amountText(linked.amount)].filter(Boolean).join(' · ');
        if (meta) detail.append(cell('span', meta, 'linked-meta'));
        if (linked.note) detail.append(cell('span', linked.note, 'linked-note'));
      }
      place.append(detail);
    }
    tr.append(desc);
    if (row.source !== 'fund') {
      const location = locationText(row);
      if (location) {
        place.className = 'has-room building-locations';
        for (const item of location.split(/\s*,\s*/).filter(Boolean)) {
          const building = locationBuilding(row, item);
          place.append(cell('span', item, `location-tag${building ? ` ${buildingColorClass(building)}` : ''}`));
        }
      } else {
        place.className = 'building-locations';
        for (const building of row.buildings || []) place.append(cell('span', building, `location-tag ${buildingColorClass(building)}`));
      }
    }
    tr.append(place);
    body.append(tr);
  }
  const itemName = isCleaning ? 'lịch dọn' : 'giao dịch';
  $('range').textContent = rows.length ? `${start + 1}–${Math.min(start + state.pageSize, rows.length)} / ${rows.length} ${itemName}` : `0 ${itemName}`;
  $('page').textContent = `${state.page} / ${totalPages}`;
  $('prev').disabled = state.page <= 1;
  $('next').disabled = state.page >= totalPages;
}

window.addEventListener('siris:session-lost',()=>{state.rows=[];state.options={};state.revisionSignature='';});
async function load({ force = false, silent = false } = {}) {
  if (loading) return;
  loading = true;
  if (!silent) {
    $('refresh').disabled = true;
    $('notice').className = 'notice';
    $('notice').textContent = force ? 'Đang làm mới từ Lark Base…' : 'Đang tải dữ liệu từ Lark Base…';
  }
  try {
    const dataUrl=new URL('/api/data',location.origin);dataUrl.searchParams.set('view',state.source);if(force)dataUrl.searchParams.set('refresh','1');
    const response=await fetch(dataUrl.pathname+dataUrl.search,{cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không tải được dữ liệu.');
    for (const [id, dateKey] of pendingCleaningMoves) {
      const row = data.rows.find(item => item.source === 'cleaning' && item.id === id);
      if (row) row.date = dateKey;
    }
    const currentTable=state.source==='fundCreate'?'fund':state.source;
    const denied=data.tables?.[currentTable]?.denied;
    const signature = JSON.stringify([data.tables, data.options]);
    if (signature !== state.revisionSignature) {
      state.rows = data.rows;
      state.options = data.options || {};
      state.revisionSignature = signature;
      updateEntryOptions();
      updateFundLinkOptions();
      updateHistoryFundOptions();
      updateStaffOptions();
      updateHistoryLocations();
      updateOtherRooms();
      updateCleaningOptions();
      const selectedContact = $('other-contact').value;
      $('other-contact').replaceChildren(new Option('Không chọn', ''));
      for (const row of state.rows.filter(item => item.source === 'contact' && item.name).sort((a,b) => a.name.localeCompare(b.name,'vi'))) $('other-contact').add(new Option(row.name,row.id));
      if ([...$('other-contact').options].some(option => option.value === selectedContact)) $('other-contact').value = selectedContact;
      syncEntrySelectMenus('other-contact');
      updateRepairSuggestions();
      if (entryMode === 'payments') updateOtherRelated();
      updateSummary();
      renderRepairOptions();
      renderPurchaseOptions();
      renderAssetOptions();
      renderPaymentOptions();
      renderFilters();
      renderRows();
    }
    if (!data.stale) state.lastCheckAt = Date.now();
    $('updated').textContent = `Tự cập nhật mỗi 60 giây · Cập nhật ${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(data.fetchedAt))}`;
    $('notice').textContent = denied ? 'Bạn chưa có quyền xem bảng này trong Lark Base.' : data.stale ? 'Đang hiển thị dữ liệu đã tải trước đó vì kết nối Lark Base gặp lỗi.' : '';
    if (data.stale) $('notice').className = 'notice error';
  } catch (error) {
    $('notice').textContent = error.message;
    $('notice').className = 'notice error';
    if (!state.rows.length) {
      const tr = document.createElement('tr');
      const td = cell('td', 'Không đọc được dữ liệu từ Lark Base.', 'empty');
      td.colSpan = 4;
      tr.append(td);
      $('rows').replaceChildren(tr);
    }
  } finally { loading = false; $('refresh').disabled = false; }
}

document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
  state.source = button.dataset.source;
  state.page = 1;
  document.querySelectorAll('.tabs button').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', String(item === button)); });
  renderFilters();
  renderRows();
}));
function updateFundLinkOptions() {
  const kind = $('fund-create-kind').value;
  for (const [source,id] of [['income','fund-create-income'],['expense','fund-create-expense']]) {
    const select = $(id);
    const selected = new Set(selectedIds(id));
    select.replaceChildren();
    for (const row of state.rows.filter(item => item.source === source).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))) {
      const label = [date(row.date), row.category, row.building || row.location, row.amount != null ? `${new Intl.NumberFormat('vi-VN').format(row.amount)} ₫` : ''].filter(Boolean).join(' · ');
      select.add(new Option(label, row.id, false, selected.has(row.id)));
    }
  }
  $('fund-create-income').disabled = kind !== 'Nạp tiền';
  $('fund-create-expense').disabled = kind !== 'Rút tiền';
  $('fund-create-income').closest('.multi-field').hidden = kind !== 'Nạp tiền';
  $('fund-create-expense').closest('.multi-field').hidden = kind !== 'Rút tiền';
  if (kind !== 'Nạp tiền') $('fund-create-income').value = '';
  if (kind !== 'Rút tiền') $('fund-create-expense').value = '';
  refreshMulti('fund-create-income'); refreshMulti('fund-create-expense');
}
function updateHistoryFundOptions() {
  const select = $('history-fund');
  const selected = new Set(selectedIds('history-fund'));
  select.replaceChildren();
  for (const row of state.rows.filter(item => item.source === 'fund').sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))) {
    const label = [date(row.date), row.category, row.amount != null ? `${currency(row.amount)} ₫` : ''].filter(Boolean).join(' · ');
    select.add(new Option(label, row.id, false, selected.has(row.id)));
  }
  refreshMulti('history-fund');
}
async function updateStaffOptions() {
  const select = $('history-staff');
  const selected = select.value;
  select.disabled = true;
  select.replaceChildren(new Option('Đang kiểm tra nhân viên', ''));
  try {
    const response = await fetch('/api/staff', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không kiểm tra được nhân viên.');
    select.replaceChildren(new Option('Không có nhân viên ứng', ''));
    for (const user of result.users.sort((a,b) => a.name.localeCompare(b.name,'vi'))) select.add(new Option(user.name, user.id));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    select.disabled = result.users.length === 0;
    $('history-staff-notice').textContent = result.users.length ? '' : 'Chưa có nhân viên đang hoạt động để chọn.';
  } catch (error) {
    select.replaceChildren(new Option('Chưa xác minh được nhân viên', ''));
    $('history-staff-notice').textContent = error.message;
  }
  $('history-staff-notice').hidden = !$('history-change').checked || !select.disabled;
  syncEntrySelectMenus('history-staff');
}
function updateHistoryLocations() {
  const building = $('history-building').value;
  const options = building ? state.rows.filter(row => row.source === 'location' && row.building === building && row.room).sort((a,b) => a.room.localeCompare(b.room, 'vi', { numeric: true })) : [];
  for (const id of ['history-room','history-location']) {
    const select = $(id);
    const selected = select.value;
    select.replaceChildren(new Option(building ? 'Không chọn' : 'Chọn toà trước', ''));
    select.disabled = !building;
    for (const row of options) select.add(new Option(row.room, row.id));
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }
  syncEntrySelectMenus('history-room','history-location');
}
function renderEntryForm() {
  document.querySelectorAll('[data-entry]').forEach(button => button.classList.toggle('active', button.dataset.entry === entryMode));
  $('fund-create-form').hidden = entryMode !== 'fund';
  $('history-create-form').hidden = !['income','expense'].includes(entryMode);
  $('other-create-form').hidden = !['cleaning','repairs','payments'].includes(entryMode);
  if (entryMode === 'fund') return;
  if (['cleaning','repairs','payments'].includes(entryMode)) { renderOtherForm(); return; }
  const income = entryMode === 'income';
  $('history-create-form').classList.toggle('history-form-expense', !income);
  $('history-create-title').textContent = income ? 'Thêm lịch sử thu' : 'Thêm lịch sử chi';
  setEntryOptions('history-category', income ? state.options.incomeKinds : state.options.expenseKinds, 'Chọn nội dung');
  $('history-customer-wrap').hidden = !income;
  $('history-room-wrap').hidden = !income;
  $('history-location-wrap').hidden = income;
  $('history-change-wrap').hidden = !income;
  $('history-advance-wrap').hidden = !income || !$('history-change').checked;
  $('history-staff-notice').hidden = !income || !$('history-change').checked || !$('history-staff').disabled;
  $('history-amount-label').textContent = income ? 'Thực nhận (₫)' : 'Số tiền (₫)';
  $('history-submit').textContent = income ? 'Lưu lịch sử thu' : 'Lưu lịch sử chi';
  $('history-message').hidden = true;
  syncEntrySelectMenus('history-category');
}
function updateOtherRooms() {
  const building = $('other-building').value;
  const select = $('other-room');
  const selected = select.value;
  select.replaceChildren(new Option(building ? 'Không chọn' : 'Chọn toà trước', ''));
  select.disabled = !building;
  for (const row of state.rows.filter(item => item.source === 'location' && item.building === building && item.room).sort((a,b) => a.room.localeCompare(b.room,'vi',{numeric:true}))) select.add(new Option(row.room, row.id));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
  syncEntrySelectMenus('other-room');
  updateRepairSuggestions();
}
function updateCleaningRooms() {
  const building = $('cleaning-building').value;
  const select = $('cleaning-room');
  const selected = select.value;
  select.replaceChildren(new Option(building ? 'Chọn phòng' : 'Chọn toà trước', ''));
  select.disabled = !building;
  for (const row of state.rows.filter(item => item.source === 'location' && item.building === building && item.room).sort((a,b) => a.room.localeCompare(b.room,'vi',{numeric:true}))) select.add(new Option(row.room, row.id));
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
  syncEntrySelectMenus('cleaning-room');
}
function updateCleaningOptions() {
  setEntryOptions('cleaning-building', state.options.buildings, 'Chọn toà');
  updateCleaningRooms();
}
function selectedImages(id) {
  const files = [...$(id).files];
  if (files.length > 5) throw new Error('Chọn tối đa 5 ảnh.');
  for (const file of files) if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 8_000_000 || !file.size) throw new Error('Chỉ chọn ảnh JPG, PNG, WebP hoặc GIF, mỗi ảnh dưới 8 MB.');
  return files;
}
function updateImagePicker(id) {
  const files = [...$(id).files];
  $(`${id}-count`).textContent = files.length ? `${files.length} ảnh đã chọn` : 'Chưa chọn ảnh';
}
$('other-image').addEventListener('change', () => updateImagePicker('other-image'));
async function optimizeCloudImage(file) {
  if(file.size<=3000000)return file;
  if(file.type==='image/gif')throw new Error('Ảnh GIF lớn hơn 3 MB. Hãy chọn ảnh nhỏ hơn hoặc tải trong Lark.');
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');let edge=Math.min(2560,Math.max(bitmap.width,bitmap.height));
    for(let attempt=0;attempt<5;attempt++){
      const ratio=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.9-attempt*0.08));
      if(blob&&blob.size<=3000000)return blob;edge*=0.8;
    }
    throw new Error('Không tối ưu được ảnh dưới 3 MB. Hãy chọn ảnh nhỏ hơn hoặc tải trong Lark.');
  }finally{bitmap.close();}
}

async function uploadImages(source, recordId, files, message, field) {
  if (!files.length) return;
  if (!recordId) throw new Error('Bản ghi đã lưu nhưng không nhận được mã để tải ảnh. Hãy thêm ảnh trong Lark Base.');
  for (let index = 0; index < files.length; index++) {
    message.textContent = `Đã lưu bản ghi. Đang tải ảnh ${index + 1}/${files.length}…`;
    await window.sirisReady;
    const imageFile=window.sirisCloud?await optimizeCloudImage(files[index]):files[index];
    const bytes = new Uint8Array(await imageFile.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const response = await fetch('/api/image-upload', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({source, recordId, field, type:imageFile.type, name:files[index].name, data:btoa(binary)})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Không tải được ảnh ${index + 1}.`);
  }
}
function renderOtherForm() {
  const labels = { cleaning: 'Dọn phòng ngắn hạn', repairs: 'Lịch sử sửa chữa', payments: 'Yêu cầu thanh toán' };
  $('other-create-title').textContent = `Thêm ${labels[entryMode].toLocaleLowerCase('vi')}`;
  $('other-submit').textContent = `Lưu ${labels[entryMode].toLocaleLowerCase('vi')}`;
  $('other-building-wrap').hidden = entryMode === 'payments';
  $('other-room-wrap').hidden = entryMode === 'payments';
  $('other-text-wrap').hidden = entryMode === 'cleaning';
  $('other-text-label').textContent = entryMode === 'repairs' ? 'Sự cố' : 'Nội dung chi';
  $('other-kind-wrap').hidden = entryMode === 'cleaning';
  $('other-kind-label').textContent = entryMode === 'repairs' ? 'Trạng thái' : 'Mục đích chi';
  setEntryOptions('other-kind', entryMode === 'repairs' ? state.options.repairStatuses : state.options.paymentPurposes, 'Chọn');
  $('other-amount-wrap').hidden = entryMode === 'cleaning';
  $('other-amount-label').textContent = entryMode === 'repairs' ? 'Chi phí (₫)' : 'Số tiền (₫)';
  $('other-extra-wrap').hidden = entryMode === 'payments';
  $('other-image-wrap').hidden = !['cleaning','repairs','payments'].includes(entryMode);
  $('other-image-target-wrap').hidden = entryMode !== 'payments';
  $('other-contact-wrap').hidden = entryMode === 'cleaning';
  $('other-contact-label').textContent = entryMode === 'repairs' ? 'Người thực hiện' : 'Thụ hưởng';
  $('other-channel-wrap').hidden = entryMode !== 'payments';
  $('other-related-wrap').hidden = entryMode !== 'payments';
  updateOtherRelated();
  $('other-checks').replaceChildren();
  for (const [id,label] of entryMode === 'cleaning' ? [['done','Đã dọn'],['noCleaning','Khách yêu cầu không dọn']] : entryMode === 'payments' ? [['paid','Đã chi']] : []) {
    const wrap = cell('label','', 'fund-form-check');
    const input = cell('input',''); input.type = 'checkbox'; input.id = `other-${id}`;
    wrap.append(input, document.createTextNode(label)); $('other-checks').append(wrap);
  }
  for (const id of ['other-done','other-noCleaning']) $(id)?.addEventListener('change', event => {
    if (event.target.checked) $(id === 'other-done' ? 'other-noCleaning' : 'other-done').checked = false;
  });
  $('other-message').hidden = true;
  syncEntrySelectMenus('other-kind','other-contact','other-image-target');
  updateRepairSuggestions();
}
function repairWords(value) {
  const ignored = new Set(['cho', 'cua', 'tai', 'trong', 'ngoai', 'phong', 'toa', 'nha', 'sua', 'thay', 'kiem', 'tra', 'khong', 'duoc', 'lai', 'mot', 'cai', 'can', 'bi']);
  return new Set(searchKey(value).split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !ignored.has(word)));
}
function updateRepairSuggestions() {
  const panel = $('repair-suggestions');
  panel.replaceChildren();
  panel.hidden = entryMode !== 'repairs';
  if (panel.hidden) return;
  const building = $('other-building').value;
  const roomId = $('other-room').value;
  const room = state.rows.find(row => row.source === 'location' && row.id === roomId)?.room || '';
  const issue = $('other-text').value.trim();
  const words = repairWords(issue);
  if (!words.size && !building && !room) { panel.hidden = true; return; }
  const activeContacts = new Set(state.rows.filter(row => row.source === 'contact').map(row => row.id));
  const candidates = new Map();
  for (const repair of state.rows.filter(row => row.source === 'repairs' && row.performerContacts?.length)) {
    const historyWords = repairWords(repair.category);
    const matches = [...words].filter(word => historyWords.has(word)).length;
    const sameBuilding = !!building && repair.buildings?.includes(building);
    const sameRoom = !!room && sameBuilding && repair.rooms?.includes(room);
    if (!matches && !sameBuilding && !sameRoom) continue;
    const score = matches * 5 + (words.size && matches === words.size ? 2 : 0) + (sameRoom ? 3 : 0) + (sameBuilding ? 1.5 : 0) + (repair.status === 'hoàn thành' ? 0.3 : 0);
    for (const contact of repair.performerContacts) {
      if (!activeContacts.has(contact.id)) continue;
      const item = candidates.get(contact.id) || { id: contact.id, name: contact.name, best: 0, similar: 0, buildings: 0, rooms: 0, latest: '', example: '', exampleDate: '', exampleScore: -1 };
      item.best = Math.max(item.best, score);
      if (matches) item.similar++;
      if (sameBuilding) item.buildings++;
      if (sameRoom) item.rooms++;
      if (repair.date && repair.date > item.latest) item.latest = repair.date;
      if (score > item.exampleScore || (score === item.exampleScore && repair.date > item.exampleDate)) {
        item.exampleScore = score;
        item.exampleDate = repair.date || '';
        item.example = repair.category;
      }
      candidates.set(contact.id, item);
    }
  }
  const rank = item => item.best + Math.log1p(item.similar) * 2 + Math.log1p(item.buildings) * 0.6 + Math.log1p(item.rooms);
  const ranked = [...candidates.values()].sort((a, b) =>
    rank(b) - rank(a) ||
    b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name, 'vi')
  ).slice(0, 3);
  const header = cell('div', 'Gợi ý từ lịch sử sửa chữa', 'repair-suggestions-title');
  panel.append(header);
  if (!ranked.length) { panel.append(cell('p', 'Chưa có ca phù hợp trong lịch sử.', 'repair-suggestions-empty')); return; }
  const list = cell('div', '', 'repair-suggestions-list');
  for (const item of ranked) {
    const button = cell('button', '', 'repair-suggestion');
    button.type = 'button';
    button.classList.toggle('selected', $('other-contact').value === item.id);
    button.append(cell('strong', item.name));
    const reasons = [];
    if (item.similar) reasons.push(`${item.similar} ca liên quan`);
    if (item.rooms) reasons.push(`${item.rooms} ca cùng phòng`);
    else if (item.buildings) reasons.push(`${item.buildings} ca cùng toà`);
    button.append(cell('span', reasons.join(' · ') || 'Từng thực hiện sửa chữa'));
    if (item.example) button.append(cell('small', `${item.example}${item.exampleDate ? ` · ${date(item.exampleDate)}` : ''}`));
    button.addEventListener('click', () => {
      $('other-contact').value = item.id;
      $('other-contact').dispatchEvent(new Event('change', { bubbles: true }));
    });
    list.append(button);
  }
  panel.append(list);
}
function updateOtherRelated() {
  const select=$('other-related');
  const selected = new Set(selectedIds('other-related'));
  select.replaceChildren();
  const source=$('other-kind').value==='sửa chữa' ? 'repairs' : $('other-kind').value==='mua sắm' ? 'purchases' : '';
  $('other-related-wrap').hidden=entryMode!=='payments'||!source;
  if (!source) { refreshMulti('other-related'); return; }
  for (const row of state.rows.filter(item=>item.source===source).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))) select.add(new Option([date(row.date),row.category].filter(Boolean).join(' · '),row.id,false,selected.has(row.id)));
  refreshMulti('other-related');
}
$('other-kind').addEventListener('change',updateOtherRelated);
$('other-building').addEventListener('change', updateOtherRooms);
$('other-room').addEventListener('change', updateRepairSuggestions);
$('other-text').addEventListener('input', updateRepairSuggestions);
$('other-contact').addEventListener('change', updateRepairSuggestions);
$('other-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
for (const id of ['other-amount']) $(id).addEventListener('input', event => formatMoneyInput(event.target));
$('other-create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('other-submit'); const message = $('other-message');
  let saved = false;
  button.disabled = true; message.hidden = false; message.className = 'fund-form-message'; message.textContent = 'Đang lưu…';
  try {
    const files = selectedImages('other-image');
    const response = await fetch('/api/entry', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ source:entryMode, date:$('other-date').value, building:$('other-building').value, locationId:$('other-room').value, text:$('other-text').value, kind:$('other-kind').value, amount:moneyValue($('other-amount')), note:$('other-extra').value, contactId:$('other-contact').value, channel:$('other-channel').value, relatedIds:selectedIds('other-related'), done:$('other-done')?.checked || false, noCleaning:$('other-noCleaning')?.checked || false, paid:$('other-paid')?.checked || false }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không lưu được bản ghi.');
    saved = true;
    await uploadImages(entryMode, result.recordId, files, message, entryMode === 'payments' ? $('other-image-target').value : 'Hình ảnh');
    message.textContent = 'Đã lưu vào Lark Base.';
    $('other-create-form').reset(); updateImagePicker('other-image'); $('other-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`; syncDatePicker('other-date'); updateOtherRooms(); updateOtherRelated(); syncEntrySelectMenus('other-building','other-kind','other-contact','other-channel','other-image-target'); await load({force:true});
  } catch(error) { message.classList.add('error'); message.textContent = error.message; if (saved) await load({force:true}); }
  finally { if (!saved || !message.classList.contains('error')) button.disabled = false; }
});
function openCleaningForm(dateValue, row = null) {
  const form = $('cleaning-direct-form');
  form.reset();
  editingCleaningId = row?.id || '';
  form.hidden = false;
  $('cleaning-create-toggle').setAttribute('aria-expanded', 'true');
  form.querySelector('h3').textContent = row ? `Sửa lượt dọn · ${row.building || 'Chưa rõ toà'}.${row.room || 'Chưa rõ phòng'}` : 'Thêm lượt dọn phòng';
  $('cleaning-submit').textContent = row ? 'Lưu thay đổi' : 'Lưu lượt dọn';
  $('cleaning-submit').disabled = false;
  $('cleaning-message').hidden = true;
  $('cleaning-date').value = dateValue;
  syncDatePicker('cleaning-date');
  const building = row?.building || state.building;
  if (building && state.options.buildings?.includes(building)) $('cleaning-building').value = building;
  syncSelectMenu('cleaning-building');
  updateCleaningRooms();
  if (row) {
    const room = [...$('cleaning-room').options].find(option => option.textContent === row.room);
    if (room) $('cleaning-room').value = room.value;
    $('cleaning-done').checked = !!row.done;
    $('cleaning-no-cleaning').checked = !row.done && !!row.guestRequestedNoCleaning;
    $('cleaning-note').value = row.note || '';
    syncEntrySelectMenus('cleaning-room');
  }
  if (!cleaningDialog.open) cleaningDialog.showModal();
  $('cleaning-room').closest('.select-picker')?.querySelector('.select-trigger')?.focus();
}
$('cleaning-create-toggle').addEventListener('click', () => {
  const form = $('cleaning-direct-form');
  if (cleaningDialog.open) { $('cleaning-cancel').click(); return; }
  const today = baseDateParts(new Date());
  openCleaningForm(`${today.year}-${today.month}-${today.day}`);
});
$('cleaning-cancel').addEventListener('click', () => {
  if (cleaningDialog.open) cleaningDialog.close();
  editingCleaningId = '';
  $('cleaning-direct-form').hidden = true;
  $('cleaning-create-toggle').setAttribute('aria-expanded', 'false');
  $('cleaning-direct-form').reset();
  $('cleaning-submit').disabled = false;
  $('cleaning-message').hidden = true;
  $('cleaning-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
  syncDatePicker('cleaning-date'); updateCleaningRooms(); syncEntrySelectMenus('cleaning-building');
});
$('cleaning-building').addEventListener('change', updateCleaningRooms);
for (const [currentId, otherId] of [['cleaning-done', 'cleaning-no-cleaning'], ['cleaning-no-cleaning', 'cleaning-done']]) {
  $(currentId).addEventListener('change', () => { if ($(currentId).checked) $(otherId).checked = false; });
}
$('cleaning-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
$('cleaning-direct-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = $('cleaning-direct-form'), button = $('cleaning-submit'), message = $('cleaning-message');
  let saved = false;
  button.disabled = true; message.hidden = false; message.className = 'fund-form-message'; message.textContent = 'Đang lưu…';
  try {
    const selectedDate = $('cleaning-date').value;
    const editingId = editingCleaningId;
    const endpoint = editingId ? '/api/cleaning' : '/api/entry';
    const response = await fetch(endpoint, {method:editingId ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({source:'cleaning', recordId:editingId, date:selectedDate, building:$('cleaning-building').value, locationId:$('cleaning-room').value, text:'', kind:'', amount:null, note:$('cleaning-note').value, contactId:'', channel:'', relatedIds:[], done:$('cleaning-done').checked, noCleaning:$('cleaning-no-cleaning').checked, paid:false})});
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không lưu được lượt dọn.');
    saved = true;
    message.textContent = editingId ? 'Đã cập nhật lượt dọn trong Lark Base.' : 'Đã lưu lượt dọn vào Lark Base.';
    $('cleaning-direct-form').reset();
    editingCleaningId = '';
    form.querySelector('h3').textContent = 'Thêm lượt dọn phòng';
    button.textContent = 'Lưu lượt dọn';
    $('cleaning-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
    syncDatePicker('cleaning-date'); updateCleaningRooms(); syncEntrySelectMenus('cleaning-building');
    state.calendarMonth = new Date(`${selectedDate}T00:00:00`);
    await load({force:true});
    button.disabled = false;
    $('cleaning-cancel').click();
  } catch(error) { message.classList.add('error'); message.textContent = error.message; if (saved) await load({force:true}); }
  finally { if (!saved || !message.classList.contains('error')) button.disabled = false; }
});
document.querySelectorAll('[data-entry]').forEach(button => button.addEventListener('click', () => { if (entryMode !== button.dataset.entry) { $('other-image').value = ''; updateImagePicker('other-image'); } entryMode = button.dataset.entry; renderEntryForm(); }));
$('history-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
$('history-building').addEventListener('change', updateHistoryLocations);
for (const id of ['fund-create-amount','history-customer','history-amount','history-advance']) $(id).addEventListener('input', event => formatMoneyInput(event.target));
$('history-change').addEventListener('change', () => {
  $('history-advance-wrap').hidden = !$('history-change').checked;
  $('history-staff-notice').hidden = !$('history-change').checked || !$('history-staff').disabled;
  if (!$('history-change').checked) { $('history-staff').value = ''; $('history-advance').value = ''; syncEntrySelectMenus('history-staff'); }
});
$('history-advance').addEventListener('input', () => { if (moneyValue($('history-advance')) > 0) $('history-change').checked = true; });
$('history-create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('history-submit');
  const message = $('history-message');
  if (!$('history-category').value) { message.hidden = false; message.className = 'fund-form-message error'; message.textContent = 'Chọn nội dung trước khi lưu.'; selectMenus.get('history-category').trigger.focus(); return; }
  button.disabled = true; message.hidden = false; message.className = 'fund-form-message'; message.textContent = 'Đang lưu…';
  try {
    const income = entryMode === 'income';
    const response = await fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: entryMode, date: $('history-date').value, category: $('history-category').value, amount: moneyValue($('history-amount')), customerPaid: income ? moneyValue($('history-customer')) : null, changeGiven: income && $('history-change').checked, staffId: income ? $('history-staff').value : '', advanceAmount: income ? moneyValue($('history-advance')) : null, fundIds: selectedIds('history-fund'), building: $('history-building').value, locationId: $(income ? 'history-room' : 'history-location').value, note: $('history-note').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không lưu được bản ghi.');
    message.textContent = 'Đã lưu vào Lark Base.';
    $('history-create-form').reset();
    $('history-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
    syncDatePicker('history-date');
    $('history-advance-wrap').hidden = true;
    $('history-staff-notice').hidden = true;
    updateHistoryLocations();
    syncEntrySelectMenus('history-category','history-building','history-staff');
    await load({ force: true });
  } catch (error) { message.classList.add('error'); message.textContent = error.message; }
  finally { button.disabled = false; }
});
$('fund-create-kind').addEventListener('change', updateFundLinkOptions);
$('fund-create-date').value = `${baseToday.year}-${baseToday.month}-${baseToday.day}`;
$('fund-create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('fund-create-submit');
  const message = $('fund-create-message');
  button.disabled = true;
  message.hidden = false;
  message.className = 'fund-form-message';
  message.textContent = 'Đang lưu…';
  try {
    const response = await fetch('/api/fund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: $('fund-create-date').value, kind: $('fund-create-kind').value, amount: moneyValue($('fund-create-amount')), incomeIds: selectedIds('fund-create-income'), expenseIds: selectedIds('fund-create-expense') }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không lưu được bản ghi.');
    message.textContent = 'Đã lưu vào Lark Base.';
    $('fund-create-amount').value = '';
    $('fund-create-income').value = '';
    $('fund-create-expense').value = '';
    refreshMulti('fund-create-income'); refreshMulti('fund-create-expense');
    await load({ force: true });
  } catch (error) {
    message.classList.add('error');
    message.textContent = error.message;
  } finally { button.disabled = false; }
});
$('search').addEventListener('input', event => { state.query = event.target.value; state.page = 1; renderRows(); });
for (const kind of ['building', 'room']) {
  $(kind + '-filter').addEventListener('click', () => {
    if (openMenu === kind) { closeMenus(); return; }
    closeSelectMenus();
    closeMenus();
    $(kind + '-options').hidden = false;
    $(kind + '-filter').setAttribute('aria-expanded', 'true');
    openMenu = kind;
  });
  $(kind + '-filter').addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    if (openMenu !== kind) $(kind + '-filter').click();
    const buttons = [...$(kind + '-options').querySelectorAll('button')];
    (buttons.find(button => button.classList.contains('chosen')) || buttons[0])?.focus();
  });
}
document.addEventListener('click', event => {
  if (!event.target.closest('.filter-menu-wrap')) closeMenus();
  if (!event.target.closest('.select-picker')) closeSelectMenus();
});
document.addEventListener('keydown', event => {
  if (openSelectId) {
    const item = selectMenus.get(openSelectId);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelectMenus();
      item.trigger.focus();
      return;
    }
    if (event.target.classList?.contains('select-search')) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const buttons = [...item.menu.querySelectorAll('button')];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % buttons.length
        : (current - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  if (event.key === 'Escape' && openMenu) {
    const trigger = $(openMenu + '-filter');
    closeMenus();
    trigger.focus();
    return;
  }
  if (!openMenu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...$(openMenu + '-options').querySelectorAll('button')];
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : event.key === 'ArrowDown' ? (current + 1) % buttons.length
    : (current - 1 + buttons.length) % buttons.length;
  buttons[next].focus();
});
for (const id of ['date-from', 'date-to']) {
  $(id).addEventListener('change', applyDateFilters);
  $(id).addEventListener('keydown', event => { if (event.key === 'Enter') { applyDateFilters(); event.target.blur(); } });
}
$('clear-filters').addEventListener('click', () => {
  state.query = state.building = state.room = state.from = state.to = '';
  state.page = 1;
  $('search').value = $('date-from').value = $('date-to').value = '';
  $('filter-error').hidden = true;
  $('date-from').setAttribute('aria-invalid', 'false');
  $('date-to').setAttribute('aria-invalid', 'false');
  syncDatePicker('date-from');
  syncDatePicker('date-to');
  renderFilters();
  renderRows();
  closeMenus();
});
$('prev').addEventListener('click', () => { state.page--; renderRows(); });
$('next').addEventListener('click', () => { state.page++; renderRows(); });
$('calendar-prev').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); });
$('calendar-next').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); });
$('calendar-today').addEventListener('click', () => { const now = baseDateParts(new Date()); state.calendarMonth = new Date(Number(now.year), Number(now.month) - 1, 1); renderCalendar(); });
$('calendar-month-picker').addEventListener('change', () => { state.calendarMonth = new Date(Number($('calendar-year-picker').value), Number($('calendar-month-picker').value) - 1, 1); renderCalendar(); });
$('calendar-year-picker').addEventListener('change', () => { state.calendarMonth = new Date(Number($('calendar-year-picker').value), state.calendarMonth.getMonth(), 1); renderCalendar(); });
$('refresh').addEventListener('click', () => load({ force: true }));
for (const [id, key] of [['company-search', 'query'], ['company-kind', 'kind']]) {
  $(id).addEventListener(id === 'company-search' ? 'input' : 'change', event => {
    companyFilter[key] = event.target.value;
    companyFilter.page = 1; renderCompanyFund();
  });
}
$('company-clear').addEventListener('click', () => {
  Object.assign(companyFilter, { query: '', kind: '', page: 1 });
  $('company-search').value = $('company-kind').value = '';
  syncSelectMenu('company-kind'); renderCompanyFund();
});
$('company-prev').addEventListener('click', () => { companyFilter.page--; renderCompanyFund(); });
$('company-next').addEventListener('click', () => { companyFilter.page++; renderCompanyFund(); });
for (const [id, key] of [['repair-search', 'query'], ['repair-building', 'building'], ['repair-status', 'status'], ['repair-month', 'month']]) {
  $(id).addEventListener(id === 'repair-search' ? 'input' : 'change', event => {
    repairFilter[key] = event.target.value;
    repairFilter.page = 1;
    renderRepairs();
  });
}
$('repair-clear').addEventListener('click', () => {
  Object.assign(repairFilter, { query: '', building: '', status: '', month: '', page: 1 });
  for (const id of ['repair-search', 'repair-building', 'repair-status', 'repair-month']) $(id).value = '';
  for (const id of ['repair-building', 'repair-status', 'repair-month']) syncSelectMenu(id);
  renderRepairs();
});
$('repair-prev').addEventListener('click', () => { repairFilter.page--; renderRepairs(); });
$('repair-next').addEventListener('click', () => { repairFilter.page++; renderRepairs(); });
for (const [id, key] of [['purchase-search', 'query'], ['purchase-month', 'month']]) {
  $(id).addEventListener(id === 'purchase-search' ? 'input' : 'change', event => {
    purchaseFilter[key] = event.target.value;
    purchaseFilter.page = 1;
    renderPurchases();
  });
}
$('purchase-clear').addEventListener('click', () => {
  Object.assign(purchaseFilter, { query: '', month: '', page: 1 });
  $('purchase-search').value = $('purchase-month').value = '';
  syncSelectMenu('purchase-month');
  renderPurchases();
});
$('purchase-prev').addEventListener('click', () => { purchaseFilter.page--; renderPurchases(); });
$('purchase-next').addEventListener('click', () => { purchaseFilter.page++; renderPurchases(); });
for (const [id, key] of [['asset-search', 'query'], ['asset-type', 'type']]) {
  $(id).addEventListener(id === 'asset-search' ? 'input' : 'change', event => {
    assetFilter[key] = event.target.value;
    assetFilter.page = 1;
    renderAssets();
  });
}
$('asset-clear').addEventListener('click', () => {
  Object.assign(assetFilter, { query: '', type: '', page: 1 });
  $('asset-search').value = $('asset-type').value = '';
  syncSelectMenu('asset-type'); renderAssets();
});
$('asset-prev').addEventListener('click', () => { assetFilter.page--; renderAssets(); });
$('asset-next').addEventListener('click', () => { assetFilter.page++; renderAssets(); });
for (const [id, key] of [['payment-search', 'query'], ['payment-status', 'status'], ['payment-purpose', 'purpose']]) {
  $(id).addEventListener(id === 'payment-search' ? 'input' : 'change', event => {
    paymentFilter[key] = event.target.value;
    paymentFilter.page = 1;
    renderPayments();
  });
}
$('payment-clear').addEventListener('click', () => {
  Object.assign(paymentFilter, { query: '', status: '', purpose: '', page: 1 });
  for (const id of ['payment-search', 'payment-status', 'payment-purpose']) $(id).value = '';
  for (const id of ['payment-status', 'payment-purpose']) syncSelectMenu(id);
  renderPayments();
});
$('payment-prev').addEventListener('click', () => { paymentFilter.page--; renderPayments(); });
$('payment-next').addEventListener('click', () => { paymentFilter.page++; renderPayments(); });
document.querySelectorAll('[data-ota-building]').forEach(button => button.addEventListener('click', () => {
  otaFilter.building = button.dataset.otaBuilding; renderOtaDashboard();
}));
$('ota-errors-filter').addEventListener('click', () => { otaFilter.errorsOnly = !otaFilter.errorsOnly; renderOtaDashboard(); });
for (const [id, tab] of [['reviews-ota-tab', 'ota'], ['reviews-google-tab', 'google']]) {
  $(id).addEventListener('click', () => { reviewTab = tab; renderReviews(); });
}
setInterval(() => { if (document.visibilityState === 'visible') load({ force: true, silent: true }); }, POLL_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastCheckAt >= POLL_INTERVAL_MS) load({ force: true, silent: true });
});
$('repair-status').value = repairFilter.status;
for (const id of ['calendar-month-picker', 'calendar-year-picker', 'repair-building', 'repair-status', 'repair-month', 'purchase-month', 'asset-type', 'company-kind', 'payment-status', 'payment-purpose', 'fund-create-kind', 'history-category', 'history-building', 'history-room', 'history-location', 'history-staff', 'other-building', 'other-room', 'other-kind', 'other-contact', 'other-channel', 'other-image-target', 'cleaning-building', 'cleaning-room']) setupSelectMenu(id);
for (const id of ['fund-create-date','history-date','other-date','cleaning-date','date-from','date-to']) setupDatePicker(id);
renderRows();
const primaryNav = document.querySelector('.sidebar nav');
const activeNav = primaryNav.querySelector('a.active');
if (activeNav && window.matchMedia('(max-width: 1000px)').matches) {
  primaryNav.scrollLeft += activeNav.getBoundingClientRect().left - primaryNav.getBoundingClientRect().left - 8;
}
load();
