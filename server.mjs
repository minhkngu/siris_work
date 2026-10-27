import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const localExecFileAsync = promisify(execFile);
const root = path.dirname(fileURLToPath(import.meta.url));
export function createApplication({ adapter = null, origin = 'http://127.0.0.1:4173', view = 'fund' } = {}) {
const cloud = Boolean(adapter);
const execFileAsync = adapter ? adapter.execute.bind(adapter) : localExecFileAsync;
const baseToken = process.env.LARK_BASE_TOKEN;
if(!baseToken) throw Object.assign(new Error('Chưa cấu hình Lark Base.'),{status:503});
const profile = 'cli_aa535e128479df04';
const tables = [
  { key: 'fund', id: 'tblGvOnBuOxoKasX', fields: ['Ngày', 'Nội dung', 'Số tiền', 'Tạo bởi', 'Thu', 'Chi'] },
  { key: 'companyFund', id: 'tbldKgsT5NsFBCsD', fields: ['Ngày', 'Nộp tiền', 'Chi tiền', 'Nội dung nộp', 'Nội dung chi', 'Lịch sử chi'] },
  { key: 'income', id: 'tblQ5gPuRREWk7fL', fields: ['Ngày', 'Nội dung', 'Khách trả', 'Thực nhận', 'Đã thối tiền', 'Số tiền nhân viên ứng', 'Nhân viên ứng tiền thối', 'Toà', 'Phòng', 'Ghi chú', 'Không bỏ quỹ', 'Lịch sử bỏ quỹ'] },
  { key: 'expense', id: 'tblFrWyocxkXMhAL', fields: ['Ngày', 'Nội dung', 'Số tiền', 'Toà', 'Vị trí', 'Ghi chú', 'Lịch sử lấy quỹ'] },
  { key: 'location', id: 'tblIfcNOs24GKcpn', fields: ['Toà', 'Phòng hoặc khu vực', 'Vị trí'] },
  { key: 'cleaning', id: 'tbl43kOPJuusdrxM', fields: ['Date', 'Đã dọn', 'Ghi chú', 'Khách yêu cầu không dọn', 'Phòng', 'Toà nhà', 'Hình ảnh'] },
  { key: 'repairs', id: 'tblu4E7ZpuHYxiGb', fields: ['Ngày', 'Sự cố', 'Trạng thái', 'Toà', 'Vị trí', 'Người thực hiện', 'Chi phí', 'Ghi chú', 'Yêu cầu thanh toán', 'Hình ảnh'] },
  { key: 'contacts', id: 'tblab8uVzdqfTe6n', fields: ['Tên'] },
  { key: 'payments', id: 'tbl7KFKggPU6quoD', fields: ['Ngày', 'Nội dung', 'Số tiền', 'Đã chi', 'Thụ hưởng', 'Mục đích', 'Chi', 'Người yêu cầu', 'Sửa chữa', 'Mua sắm', 'Biên nhận', 'Hoá đơn', 'Thông tin thanh toán', 'Thông tin thanh toán (khác với danh bạ)', 'Liên hệ'] },
  { key: 'purchases', id: 'tblxtZdvxcbc7ewk', fields: ['Ngày mua', 'Tên tài sản', 'Tổng tiền', 'Số lượng', 'Ghi chú', 'Yêu cầu thanh toán', 'Loại tài sản'] },
  { key: 'assets', id: 'tbl34NNCueFPUwML', fields: ['Tên', 'Loại', 'Model và brand', 'Thông số', 'Sub', 'Ghi chú', 'Phòng', 'Lịch sử', 'Lịch sử sữa chữa', 'Ảnh'] },
  { key: 'reviews', id: 'tblxQ8XstkpuUT62', fields: ['Số lượng review', 'Ghi chú', 'Đường dẫn', 'Ngày cập nhật cuối', 'Toà nhà', 'OTA', 'Điểm review'] },
  { key: 'googleReviews', id: 'tblAhiUJVvB14VFH', fields: ['Ảnh review', 'Số lượng review', 'Ngày'] }
];
let cache = null;
let cacheAt = 0;
let pending = null;
let optionsCache = null;
let optionsAt = 0;
let optionsPending = null;

function text(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value == null ? '' : String(value);
}

function amount(value) {
  return Number.isFinite(value) ? value : null;
}

function ids(value) {
  return Array.isArray(value) ? value.map(item => item?.id).filter(Boolean) : [];
}
function images(value, label) {
  return Array.isArray(value) ? value.filter(item => item?.file_token && /\.(png|jpe?g|webp|gif|heic)$/i.test(item.name || '')).map(item => ({ token: item.file_token, name: item.name, label })) : [];
}

function values(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [String(value)] : [];
}

function people(value) {
  return Array.isArray(value) ? value.map(person => person?.name).filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(table, row) {
  if (table.key === 'reviews') return {
    id: row.record_id, source: 'reviews', building: values(row['Toà nhà'])[0] || '',
    platform: values(row['OTA'])[0] || '', count: amount(row['Số lượng review']),
    score: amount(row['Điểm review']), note: text(row['Ghi chú']),
    url: text(row['Đường dẫn']), updatedAt: row['Ngày cập nhật cuối'] || null
  };
  if (table.key === 'googleReviews') return {
    id: row.record_id, source: 'googleReviews', date: row['Ngày'] || null,
    count: Number(row['Số lượng review']) || 0, images: images(row['Ảnh review'], 'Ảnh review Google Maps')
  };
  if (table.key === 'companyFund') return {
    id: row.record_id, source: 'companyFund', date: row['Ngày'] || null,
    deposit: amount(row['Nộp tiền']), withdrawal: amount(row['Chi tiền']),
    depositNote: text(row['Nội dung nộp']), withdrawalNote: text(row['Nội dung chi']),
    paymentIds: ids(row['Lịch sử chi'])
  };
  if (table.key === 'contacts') return { id: row.record_id, name: text(row['Tên']) };
  if (table.key === 'assets') return {
    id: row.record_id, name: text(row['Tên']).trim(), type: (values(row['Loại'])[0] || '').trim(),
    model: text(row['Model và brand']).trim(), specification: text(row['Thông số']).trim(), sub: text(row['Sub']).trim(), note: text(row['Ghi chú']).trim(),
    locationIds: ids(row['Phòng']), purchaseIds: ids(row['Lịch sử']), repairIds: ids(row['Lịch sử sữa chữa']), images: images(row['Ảnh'], 'Ảnh')
  };
  if (table.key === 'purchases') return {
    id: row.record_id, source: 'purchases', date: row['Ngày mua'] || null, category: text(row['Tên tài sản']),
    amount: amount(row['Tổng tiền']), quantity: amount(row['Số lượng']), note: text(row['Ghi chú']),
    paymentIds: ids(row['Yêu cầu thanh toán']), assetIds: ids(row['Loại tài sản'])
  };
  if (table.key === 'payments') return {
    id: row.record_id, source: 'payments', date: row['Ngày'] || null,
    category: text(row['Nội dung']), amount: amount(row['Số tiền']), paid: row['Đã chi'] === true,
    contactIds: ids(row['Liên hệ']), paymentInfo: text(row['Thông tin thanh toán']).trim(), paymentInfoCustom: text(row['Thông tin thanh toán (khác với danh bạ)']).trim(),
    purpose: values(row['Mục đích'])[0] || '', channel: values(row['Chi'])[0] || '',
    requesterNames: people(row['Người yêu cầu']), requesterUsers: row['Người yêu cầu'] || [], beneficiaryIds: ids(row['Thụ hưởng']),
    repairIds: ids(row['Sửa chữa']), purchaseIds: ids(row['Mua sắm']), images: [...images(row['Biên nhận'], 'Biên nhận'), ...images(row['Hoá đơn'], 'Hoá đơn')]
  };
  if (table.key === 'repairs') return {
    id: row.record_id,
    source: 'repairs',
    date: row['Ngày'] || null,
    category: text(row['Sự cố']),
    status: values(row['Trạng thái'])[0] || '',
    buildings: values(row['Toà']),
    locationIds: ids(row['Vị trí']),
    performerIds: ids(row['Người thực hiện']),
    amount: amount(row['Chi phí']),
    note: text(row['Ghi chú']), paymentIds: ids(row['Yêu cầu thanh toán']), images: images(row['Hình ảnh'], 'Hình ảnh')
  };
  if (table.key === 'location') {
    return { id: row.record_id, building: text(row['Toà']), room: text(row['Phòng hoặc khu vực']), label: text(row['Vị trí']) };
  }
  if (table.key === 'cleaning') {
    const building = text(row['Toà nhà']);
    const room = text(row['Phòng']);
    return {
      id: row.record_id,
      source: 'cleaning',
      date: row.Date || null,
      category: 'Dọn phòng ngắn hạn',
      amount: null,
      done: row['Đã dọn'] === true,
      guestRequestedNoCleaning: row['Khách yêu cầu không dọn'] === true,
      building,
      buildings: values(row['Toà nhà']),
      room,
      rooms: values(room),
      location: [building, room].filter(Boolean).join('.'),
      note: text(row['Ghi chú']), images: images(row['Hình ảnh'], 'Hình ảnh')
    };
  }
  const linkName = table.key === 'fund' ? '' : table.key === 'income' ? 'Lịch sử bỏ quỹ' : 'Lịch sử lấy quỹ';
  return {
    id: row.record_id,
    source: table.key,
    date: row['Ngày'] || null,
    category: text(row['Nội dung']),
    amount: amount(row[table.key === 'income' ? 'Thực nhận' : 'Số tiền']),
    customerPaid: table.key === 'income' ? amount(row['Khách trả']) : null,
    changeGiven: table.key === 'income' ? row['Đã thối tiền'] === true : false,
    staffChangeAmount: table.key === 'income' ? amount(row['Số tiền nhân viên ứng']) : null,
    staffChangeNames: table.key === 'income' ? people(row['Nhân viên ứng tiền thối']) : [],
    staffChangeUsers: table.key === 'income' ? row['Nhân viên ứng tiền thối'] || [] : [],
    creatorNames: table.key === 'fund' ? people(row['Tạo bởi']) : [],
    creatorUsers: table.key === 'fund' ? row['Tạo bởi'] || [] : [],
    building: text(row['Toà']),
    location: text(row['Vị trí']),
    buildings: values(row['Toà']),
    rooms: table.key === 'expense' ? values(row['Vị trí']) : [],
    note: text(row['Ghi chú']),
    excludedFromFund: row['Không bỏ quỹ'] === true,
    linkedToFund: linkName ? Array.isArray(row[linkName]) && row[linkName].length > 0 : false,
    incomeIds: table.key === 'fund' ? ids(row['Thu']) : [],
    expenseIds: table.key === 'fund' ? ids(row['Chi']) : [],
    fundIds: table.key === 'income' ? ids(row['Lịch sử bỏ quỹ']) : table.key === 'expense' ? ids(row['Lịch sử lấy quỹ']) : [],
    roomIds: table.key === 'income' ? ids(row['Phòng']) : []
  };
}

function joinFundDetails(results) {
  const bySource = Object.fromEntries(results.map(result => [result.key, result.rows]));
  const staff = new Map();
  for (const user of [...bySource.payments.flatMap(row => row.requesterUsers), ...bySource.fund.flatMap(row => row.creatorUsers), ...bySource.income.flatMap(row => row.staffChangeUsers)]) if (user?.id && user?.name) staff.set(user.id, user.name);
  const locations = new Map(bySource.location.map(row => [row.id, row]));
  const contacts = new Map(bySource.contacts.map(row => [row.id, row.name]));
  const repairs = bySource.repairs.map(({ locationIds, performerIds, ...row }) => {
    const resolved = locationIds.map(id => locations.get(id)).filter(Boolean);
    const buildings = unique([...row.buildings, ...resolved.map(item => item.building)]);
    const rooms = unique(resolved.map(item => item.room));
    return {
      ...row,
      buildings,
      rooms,
      locations: unique(resolved.map(item => {
        const label = item.label || [item.building, item.room].filter(Boolean).join('.');
        return label.startsWith('.') ? `${item.building || (row.buildings.length === 1 ? row.buildings[0] : '')}${label}` : label;
      })),
      performers: unique(performerIds.map(id => contacts.get(id))),
      performerContacts: performerIds.filter(id => contacts.has(id)).map(id => ({ id, name: contacts.get(id) }))
    };
  });
  const repairById = new Map(repairs.map(row => [row.id, row]));
  const purchaseById = new Map(bySource.purchases.map(row => [row.id, row]));
  const paymentRepairIds = new Map(bySource.payments.map(row => [row.id, new Set(row.repairIds)]));
  const paymentPurchaseIds = new Map(bySource.payments.map(row => [row.id, new Set(row.purchaseIds)]));
  for (const row of repairs) for (const id of row.paymentIds) paymentRepairIds.get(id)?.add(row.id);
  for (const row of bySource.purchases) for (const id of row.paymentIds) paymentPurchaseIds.get(id)?.add(row.id);
  const payments = bySource.payments.map(({ beneficiaryIds, repairIds, purchaseIds, ...row }) => ({
    ...row,
    beneficiaryRecordIds: beneficiaryIds, repairRecordIds: repairIds, purchaseRecordIds: purchaseIds,
    beneficiaries: unique(beneficiaryIds.map(id => contacts.get(id))),
    linkedHistory: [
      ...[...(paymentRepairIds.get(row.id) || [])].map(id => repairById.get(id)).filter(Boolean).map(item => ({ type: 'Sửa chữa', date: item.date, title: item.category, status: item.status, locations: item.locations, note: item.note, amount: item.amount })),
      ...[...(paymentPurchaseIds.get(row.id) || [])].map(id => purchaseById.get(id)).filter(Boolean).map(item => ({ type: 'Mua sắm', date: item.date, title: item.category, quantity: item.quantity, note: item.note, amount: item.amount }))
    ]
  }));
  const paymentById = new Map(payments.map(row => [row.id, row]));
  const companyFund = bySource.companyFund.map(({ paymentIds, ...row }) => ({
    ...row,
    linkedPayments: paymentIds.map(id => paymentById.get(id)).filter(Boolean).map(payment => ({
      date: payment.date, category: payment.category, amount: payment.amount, paid: payment.paid,
      beneficiaries: payment.beneficiaries
    }))
  }));
  const purchasePaymentIds = new Map(bySource.purchases.map(row => [row.id, new Set(row.paymentIds)]));
  for (const [paymentId, purchaseIds] of paymentPurchaseIds) {
    for (const purchaseId of purchaseIds) purchasePaymentIds.get(purchaseId)?.add(paymentId);
  }
  const assetById = new Map(bySource.assets.map(row => [row.id, row]));
  const purchaseAssetIds = new Map(bySource.purchases.map(row => [row.id, new Set(row.assetIds)]));
  for (const asset of bySource.assets) for (const purchaseId of asset.purchaseIds) purchaseAssetIds.get(purchaseId)?.add(asset.id);
  const purchases = bySource.purchases.map(({ paymentIds, assetIds, ...row }) => ({
    ...row,
    linkedAssets: [...(purchaseAssetIds.get(row.id) || [])].map(id => assetById.get(id)).filter(Boolean).map(asset => ({
      name: asset.name, type: asset.type, model: asset.model, specification: asset.specification, sub: asset.sub
    })),
    linkedPayments: [...(purchasePaymentIds.get(row.id) || [])].map(id => paymentById.get(id)).filter(Boolean).map(payment => ({
      id: payment.id, date: payment.date, category: payment.category, amount: payment.amount,
      paid: payment.paid, purpose: payment.purpose, beneficiaries: payment.beneficiaries
    }))
  }));
  const assetPurchaseIds = new Map(bySource.assets.map(row => [row.id, new Set(row.purchaseIds)]));
  for (const [purchaseId, assetIds] of purchaseAssetIds) for (const assetId of assetIds) assetPurchaseIds.get(assetId)?.add(purchaseId);
  const assets = bySource.assets.map(({ locationIds, purchaseIds, repairIds, ...row }) => ({
    ...row, source: 'assets',
    locations: unique(locationIds.map(id => locations.get(id)?.label || [locations.get(id)?.building, locations.get(id)?.room].filter(Boolean).join('.'))),
    linkedPurchases: [...(assetPurchaseIds.get(row.id) || [])].map(id => purchaseById.get(id)).filter(Boolean).map(item => ({ date: item.date, title: item.category, amount: item.amount, quantity: item.quantity })),
    linkedRepairs: repairIds.map(id => repairById.get(id)).filter(Boolean).map(item => ({ date: item.date, title: item.category, status: item.status, amount: item.amount }))
  }));
  const incomeRows = bySource.income.map(({ roomIds, ...row }) => {
    const resolved = roomIds.map(id => locations.get(id)).filter(Boolean);
    const rooms = unique(resolved.map(item => item.room));
    const locationLabels = unique(resolved.map(item => item.label || [item.building, item.room].filter(Boolean).join('.')));
    const buildings = row.buildings.length ? row.buildings : unique(resolved.map(item => item.building));
    return { ...row, room: rooms.join(', '), rooms, location: locationLabels.join(', '), buildings, building: buildings.join(', ') };
  });
  const income = new Map(incomeRows.map(row => [row.id, row]));
  const expense = new Map(bySource.expense.map(row => [row.id, row]));
  const fundById = new Map(bySource.fund.map(row => [row.id, row]));
  const fundIdsByIncome = new Map();
  for (const row of incomeRows) fundIdsByIncome.set(row.id, new Set(row.fundIds));
  const fundIdsByExpense = new Map(bySource.expense.map(row => [row.id, new Set(row.fundIds)]));
  for (const fundRow of bySource.fund) {
    for (const incomeId of fundRow.incomeIds) {
      if (!fundIdsByIncome.has(incomeId)) fundIdsByIncome.set(incomeId, new Set());
      fundIdsByIncome.get(incomeId).add(fundRow.id);
    }
    for (const expenseId of fundRow.expenseIds) {
      if (!fundIdsByExpense.has(expenseId)) fundIdsByExpense.set(expenseId, new Set());
      fundIdsByExpense.get(expenseId).add(fundRow.id);
    }
  }
  for (const row of incomeRows) {
    row.fundEntries = [...(fundIdsByIncome.get(row.id) || [])]
      .map(id => fundById.get(id))
      .filter(Boolean)
      .map(item => ({ date: item.date, category: item.category, amount: item.amount, note: item.note }));
    row.fundLinkMissing = row.fundEntries.length === 0;
  }
  for (const row of bySource.expense) {
    row.fundEntries = [...(fundIdsByExpense.get(row.id) || [])]
      .map(id => fundById.get(id))
      .filter(Boolean)
      .map(item => ({ date: item.date, category: item.category, amount: item.amount, note: item.note }));
    row.fundLinkMissing = row.fundEntries.length === 0;
  }
  const linkedEntry = (source, id) => {
    const row = (source === 'income' ? income : expense).get(id);
    if (!row) return { source, missing: true, category: 'Bản ghi liên kết không còn tồn tại' };
    return { source, date: row.date, category: row.category, amount: row.amount, building: row.building, buildings: row.buildings, room: row.room, rooms: row.rooms, location: row.location, note: row.note };
  };
  const fund = bySource.fund.map(({ incomeIds, expenseIds, roomIds, ...row }) => {
    const linkedEntries = [
      ...incomeIds.map(id => linkedEntry('income', id)),
      ...expenseIds.map(id => linkedEntry('expense', id))
    ];
    const buildings = unique(linkedEntries.flatMap(item => item.buildings || []));
    const rooms = unique(linkedEntries.flatMap(item => item.rooms || []));
    return { ...row, buildings, rooms, linkedEntries };
  });
  return [...fund, ...companyFund, ...incomeRows, ...bySource.expense, ...bySource.location.map(row => ({ ...row, source: 'location' })), ...bySource.contacts.map(row => ({ ...row, source: 'contact' })), ...[...staff].map(([id,name]) => ({ id, name, source: 'staff' })), ...bySource.cleaning, ...repairs, ...payments, ...purchases, ...assets, ...bySource.reviews, ...bySource.googleReviews];
}

async function readTable(table) {
  if (cloud) {
    const raw = await adapter.records(table);
    const rows = raw.map(row => normalize(table, row));
    return { key:table.key, rows, count:rows.length, revision:adapter.revision(rows) };
  }
  const dir = await mkdtemp('/tmp/siris-cash-');
  const output = path.join(dir, `${table.key}.ndjson`);
  const args = ['--profile', profile, 'base', '+record-list', '--base-token', baseToken, '--table-id', table.id];
  for (const field of table.fields) args.push('--field-id', field);
  args.push('--as', 'user', '--format', 'ndjson', '--output', output);
  try {
    await execFileAsync('lark-cli', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
    const [body, manifestText] = await Promise.all([
      readFile(output, 'utf8'),
      readFile(output.replace(/\.ndjson$/, '.manifest.json'), 'utf8')
    ]);
    const manifest = JSON.parse(manifestText);
    if (manifest.has_more || manifest.query_context?.record_scope !== 'all_records') {
      throw new Error(`Incomplete result for ${table.key}`);
    }
    const rows = body.trim() ? body.trim().split('\n').map(line => normalize(table, JSON.parse(line))) : [];
    if (rows.length !== manifest.records_count) throw new Error(`Count mismatch for ${table.key}`);
    return { key: table.key, rows, count: rows.length, revision: manifest.rev };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function loadOptions(force = false) {
  if (cloud) return adapter.options(tables);
  if (!force && optionsCache && Date.now() - optionsAt < 60000) return optionsCache;
  if (optionsPending) return optionsPending;
  optionsPending = (async () => {
    const requests = [
      ['fundKinds', 'fund', 'Nội dung'],
      ['incomeKinds', 'income', 'Nội dung'],
      ['expenseKinds', 'expense', 'Nội dung'],
      ['buildings', 'location', 'Toà'],
      ['repairStatuses', 'repairs', 'Trạng thái'],
      ['paymentPurposes', 'payments', 'Mục đích'],
      ['paymentChannels', 'payments', 'Chi']
    ];
    const fieldsByTable = new Map();
    await Promise.all([...new Set(requests.map(([, key]) => key))].map(async key => {
      const table = tables.find(item => item.key === key);
      const args = ['--profile', profile, 'base', '+field-list', '--base-token', baseToken, '--table-id', table.id, '--as', 'user', '--format', 'json'];
      const { stdout } = await execFileAsync('lark-cli', args, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error(result.error?.message || `Không đọc được lựa chọn bảng ${key}.`);
      fieldsByTable.set(key, result.data?.fields || []);
    }));
    const options = Object.fromEntries(requests.map(([key, table, name]) => {
      const field = fieldsByTable.get(table).find(item => item.name === name && item.type === 'select');
      if (!field) throw new Error(`Không tìm thấy trường lựa chọn ${table}.${name}.`);
      return [key, [...new Set((field.options || []).map(option => option.name).filter(Boolean))]];
    }));
    optionsCache = options;
    optionsAt = Date.now();
    return options;
  })();
  try { return await optionsPending; } finally { optionsPending = null; }
}

async function loadData(force = false) {
  if (cloud) {
    const wanted = adapter.dependencies(view);
    const results = await Promise.all(tables.map(async table => {
      if (!wanted.includes(table.key)) return {key:table.key,rows:[],count:0,unloaded:true};
      try { return await readTable(table); }
      catch(error) { if (![403,404].includes(error.status)) throw error; return {key:table.key,rows:[],count:0,denied:true}; }
    }));
    return {fetchedAt:new Date().toISOString(), tables:Object.fromEntries(results.map(r=>[r.key,{count:r.count,revision:r.revision||null,denied:r.denied||false,unloaded:r.unloaded||false}])), options:await loadOptions(), rows:joinFundDetails(results)};
  }
  if (!force && cache && Date.now() - cacheAt < 60000) return cache;
  if (pending) return pending;
  pending = (async () => {
    const [results, options] = await Promise.all([Promise.all(tables.map(readTable)), loadOptions(force)]);
    const value = {
      fetchedAt: new Date().toISOString(),
      tables: Object.fromEntries(results.map(r => [r.key, { count: r.count, revision: r.revision }])),
      options,
      rows: joinFundDetails(results)
    };
    cache = value;
    cacheAt = Date.now();
    return value;
  })();
  try { return await pending; } finally { pending = null; }
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2' };
const assets = new Set(['/','/index.html','/styles.css','/taste.css','/app.js','/cloud-auth.js',
  '/assets/fonts/plex-sans-vi.woff2', '/assets/fonts/plex-sans-latin.woff2',
  '/assets/fonts/plex-mono-vi.woff2', '/assets/fonts/plex-mono-latin.woff2']);
async function activeStaff() {
  if (cloud) return adapter.activeStaff((await loadData()).rows);
  const data = await loadData();
  const ids = [...new Set(data.rows.filter(row => row.source === 'staff').map(row => row.id))];
  if (!ids.length) return [];
  const baseArgs = ['--profile', profile, 'contact', '+search-user', '--user-ids', ids.join(','), '--as', 'user', '--format', 'json'];
  const fetchUsers = async extra => {
    const { stdout } = await execFileAsync('lark-cli', [...baseArgs, ...extra], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!result.ok) throw new Error(result.error?.message || 'Không kiểm tra được trạng thái nhân viên.');
    return result.data?.users || [];
  };
  const current = await fetchUsers(['--exclude-external-users']);
  const departed = new Set((await fetchUsers(['--left-organization'])).map(user => user.open_id));
  return current.filter(user => user.is_activated === true && !user.is_cross_tenant && !departed.has(user.open_id)).map(user => ({ id: user.open_id, name: user.localized_name || user.open_id }));
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  if (cloud && status>=400 && adapter.lastError) { status=adapter.lastError.status; data=JSON.stringify({error:adapter.lastError.message}); }
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
  });
  res.end(data);
}

return async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/reviews/score' && req.method === 'PATCH') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, JSON.stringify({ error: 'Nguồn yêu cầu không hợp lệ.' }));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, JSON.stringify({ error: 'Dữ liệu không hợp lệ.' }));
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1024) return send(res, 413, JSON.stringify({ error: 'Dữ liệu quá lớn.' })); }
      let input;
      try { input = JSON.parse(raw); } catch { return send(res, 400, JSON.stringify({ error: 'Dữ liệu không hợp lệ.' })); }
      if (!input || !/^rec[A-Za-z0-9_-]{8,}$/.test(input.recordId || '') || typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 10) return send(res, 400, JSON.stringify({ error: 'Điểm review phải là số từ 0 đến 10.' }));
      const reviewData = await readTable(tables.find(table => table.key === 'reviews'));
      const row = reviewData.rows.find(row => row.id === input.recordId);
      if (!row) return send(res, 404, JSON.stringify({ error: 'Không tìm thấy link OTA.' }));
      const maximum = row.platform.toLowerCase() === 'airbnb' ? 5 : 10;
      if (input.score > maximum) return send(res, 400, JSON.stringify({ error: `Điểm ${row.platform} phải từ 0 đến ${maximum}.` }));
      const fields = { 'Điểm review': input.score };
      const { stdout } = await execFileAsync('lark-cli', ['--profile', profile, 'base', '+record-upsert', '--base-token', baseToken, '--table-id', 'tblxQ8XstkpuUT62', '--record-id', input.recordId, '--json', JSON.stringify(fields), '--as', 'user', '--format', 'json'], { timeout: 30000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error('Lark không xác nhận cập nhật.');
      cache = null;
      return send(res, 200, JSON.stringify({ ok: true, recordId: input.recordId, score: input.score, updatedAt: new Date().toISOString() }));
    } catch { return send(res, 502, JSON.stringify({ error: 'Chưa lưu được điểm vào Lark Base. Kiểm tra kết nối hoặc đăng nhập Lark rồi thử lại.' })); }
  }
  if (url.pathname === '/api/cleaning/date' && req.method === 'PATCH') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res,403,JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,JSON.stringify({error:'Dữ liệu không hợp lệ.'}));
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 1024) return send(res,413,JSON.stringify({error:'Dữ liệu quá lớn.'})); }
      const input = JSON.parse(raw);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') && Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) && new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10) === input.date;
      if (!/^rec[A-Za-z0-9_-]{8,}$/.test(input.recordId || '') || !validDate) return send(res,400,JSON.stringify({error:'Ngày hoặc lượt dọn không hợp lệ.'}));
      const data = await loadData(true);
      if (!data.rows.some(row => row.source === 'cleaning' && row.id === input.recordId)) return send(res,404,JSON.stringify({error:'Không tìm thấy lượt dọn.'}));
      const fields = { Date: `${input.date} 12:00` };
      const args = ['--profile',profile,'base','+record-upsert','--base-token',baseToken,'--table-id','tbl43kOPJuusdrxM','--record-id',input.recordId,'--json',JSON.stringify(fields),'--as','user','--format','json'];
      const {stdout} = await execFileAsync('lark-cli',args,{timeout:30000,maxBuffer:1024*1024});
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error(result.error?.message || 'Không cập nhật được Lark Base.');
      cache = null;
      return send(res,200,JSON.stringify({ok:true,recordId:input.recordId}));
    } catch (error) { (cloud ? (()=>{}) : console.error)('Cleaning date move failed:',error.message); return send(res,502,JSON.stringify({error:'Không chuyển được lượt dọn sang ngày mới.'})); }
  }
  if (url.pathname === '/api/cleaning' && req.method === 'PATCH') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res,403,JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,JSON.stringify({error:'Dữ liệu không hợp lệ.'}));
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(res,413,JSON.stringify({error:'Dữ liệu quá lớn.'})); }
      const input = JSON.parse(raw);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') && Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) && new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10) === input.date;
      if (!/^rec[A-Za-z0-9_-]{8,}$/.test(input.recordId || '') || !validDate || typeof input.note !== 'string' || input.note.length > 2000 || typeof input.done !== 'boolean' || typeof input.noCleaning !== 'boolean' || (input.done && input.noCleaning)) return send(res,400,JSON.stringify({error:'Kiểm tra lại thông tin lượt dọn.'}));
      const data = await loadData(true);
      const record = data.rows.find(row => row.source === 'cleaning' && row.id === input.recordId);
      const location = data.rows.find(row => row.source === 'location' && row.id === input.locationId);
      if (!record || !data.options.buildings.includes(input.building) || !location || location.building !== input.building || !location.room) return send(res,400,JSON.stringify({error:'Bản ghi, toà hoặc phòng không hợp lệ.'}));
      const fields = { 'Date': `${input.date} 12:00`, 'Toà nhà': [input.building], 'Phòng': location.room, 'Đã dọn': input.done, 'Khách yêu cầu không dọn': input.noCleaning, 'Ghi chú': input.note.trim() };
      const args = ['--profile',profile,'base','+record-upsert','--base-token',baseToken,'--table-id','tbl43kOPJuusdrxM','--record-id',input.recordId,'--json',JSON.stringify(fields),'--as','user','--format','json'];
      const {stdout} = await execFileAsync('lark-cli',args,{timeout:30000,maxBuffer:1024*1024});
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error(result.error?.message || 'Không cập nhật được Lark Base.');
      cache = null;
      return send(res,200,JSON.stringify({ok:true,recordId:input.recordId}));
    } catch (error) { (cloud ? (()=>{}) : console.error)('Cleaning update failed:',error.message); return send(res,502,JSON.stringify({error:'Không cập nhật được lượt dọn trong Lark Base.'})); }
  }
  if (url.pathname === '/api/payments/update' && req.method === 'PATCH') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res,403,JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,JSON.stringify({error:'Dữ liệu không hợp lệ.'}));
      let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>20000) return send(res,413,JSON.stringify({error:'Dữ liệu quá lớn.'})); }
      let input; try { input=JSON.parse(raw); } catch { return send(res,400,JSON.stringify({error:'Dữ liệu không hợp lệ.'})); }
      const data=await loadData(true), row=data.rows.find(r=>r.source==='payments'&&r.id===input.recordId);
      if (!row || !input.changes || typeof input.changes!=='object' || Array.isArray(input.changes)) return send(res,400,JSON.stringify({error:'Yêu cầu không hợp lệ.'}));
      const fields={}, names={date:'Ngày',category:'Nội dung',amount:'Số tiền',purpose:'Mục đích',channel:'Chi',paid:'Đã chi',paymentInfoCustom:'Thông tin thanh toán (khác với danh bạ)',beneficiaryRecordIds:'Thụ hưởng',contactIds:'Liên hệ',repairRecordIds:'Sửa chữa',purchaseRecordIds:'Mua sắm'};
      for (const [key,value] of Object.entries(input.changes)) {
        if (!names[key]) return send(res,400,JSON.stringify({error:'Trường không được chỉnh sửa.'}));
        if (JSON.stringify(row[key])!==JSON.stringify(input.original?.[key])) return send(res,409,JSON.stringify({error:'Bản ghi đã thay đổi. Hãy tải lại trước khi sửa.'}));
        if (key==='date') {
          if (typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value) return send(res,400,JSON.stringify({error:'Ngày không hợp lệ.'}));
          fields[names[key]]=value+' 12:00';
        } else if (key==='amount') {
          if (!Number.isSafeInteger(value)||value<=0) return send(res,400,JSON.stringify({error:'Số tiền phải lớn hơn 0.'})); fields[names[key]]=value;
        } else if (key==='paid') {
          if(typeof value!=='boolean') return send(res,400,JSON.stringify({error:'Trạng thái không hợp lệ.'})); fields[names[key]]=value;
        } else if (key==='purpose'||key==='channel') {
          if(value!=='' && !(key==='purpose'?data.options.paymentPurposes:data.options.paymentChannels).includes(value)) return send(res,400,JSON.stringify({error:'Lựa chọn không còn tồn tại trong Base.'})); fields[names[key]]=value?[value]:[];
        } else if (key.endsWith('Ids')) {
          const source=key==='repairRecordIds'?'repairs':key==='purchaseRecordIds'?'purchases':'contact';
          if(!Array.isArray(value)||value.length>100||new Set(value).size!==value.length||value.some(id=>!data.rows.some(r=>r.source===source&&r.id===id))) return send(res,400,JSON.stringify({error:'Liên kết không hợp lệ.'})); fields[names[key]]=value.map(id=>({id}));
        } else {
          if(typeof value!=='string'||value.length>5000||(key==='category'&&!value.trim())) return send(res,400,JSON.stringify({error:'Kiểm tra nội dung nhập.'})); fields[names[key]]=value.trim();
        }
      }
      if(Object.keys(fields).length) {
        const {stdout}=await execFileAsync('lark-cli',['--profile',profile,'base','+record-upsert','--base-token',baseToken,'--table-id','tbl7KFKggPU6quoD','--record-id',row.id,'--json',JSON.stringify(fields),'--as','user','--format','json'],{timeout:30000,maxBuffer:1024*1024});
        if(!JSON.parse(stdout).ok) throw new Error('Write failed'); cache=null;
      }
      return send(res,200,JSON.stringify({ok:true}));
    } catch { return send(res,502,JSON.stringify({error:'Không lưu được yêu cầu thanh toán. Vui lòng thử lại.'})); }
  }
  if (url.pathname === '/api/entry' && req.method === 'POST') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res,403,JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,JSON.stringify({error:'Dữ liệu không hợp lệ.'}));
      let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>4096) return send(res,413,JSON.stringify({error:'Dữ liệu quá lớn.'})); }
      const input=JSON.parse(raw);
      if (!['cleaning','repairs','payments'].includes(input.source)) return send(res,400,JSON.stringify({error:'Bảng không hợp lệ.'}));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10)!==input.date) return send(res,400,JSON.stringify({error:'Ngày không hợp lệ.'}));
      const data=await loadData(true);
      const { buildings, repairStatuses, paymentPurposes, paymentChannels } = data.options;
      const location=input.locationId ? data.rows.find(row=>row.source==='location'&&row.id===input.locationId) : null;
      if (input.source!=='payments' && (!buildings.includes(input.building) || (input.locationId && (!location || location.building!==input.building)))) return send(res,400,JSON.stringify({error:'Toà hoặc phòng không hợp lệ.'}));
      if (typeof input.text!=='string' || input.text.length>2000 || typeof input.note!=='string' || input.note.length>2000) return send(res,400,JSON.stringify({error:'Nội dung quá dài.'}));
      if (input.contactId && !data.rows.some(row=>row.source==='contact'&&row.id===input.contactId)) return send(res,400,JSON.stringify({error:'Liên hệ không hợp lệ.'}));
      const moneyOk=input.amount==null || Number.isSafeInteger(input.amount)&&input.amount>=0;
      if (!moneyOk) return send(res,400,JSON.stringify({error:'Số tiền không hợp lệ.'}));
      const when=`${input.date} 12:00`;
      let fields, tableId;
      if (input.source==='cleaning') {
        if (!location) return send(res,400,JSON.stringify({error:'Chọn phòng cần dọn.'}));
        if (input.done === true && input.noCleaning === true) return send(res,400,JSON.stringify({error:'Chỉ chọn một tình trạng dọn phòng.'}));
        fields={'Date':when,'Toà nhà':[input.building],'Phòng':location.room,'Đã dọn':input.done===true,'Khách yêu cầu không dọn':input.noCleaning===true,'Ghi chú':input.note.trim()};
        tableId='tbl43kOPJuusdrxM';
      } else if (input.source==='repairs') {
        if (!input.text.trim() || !repairStatuses.includes(input.kind)) return send(res,400,JSON.stringify({error:'Nhập sự cố và trạng thái.'}));
        fields={'Ngày':when,'Sự cố':input.text.trim(),'Trạng thái':[input.kind],'Toà':[input.building],'Ghi chú':input.note.trim()};
        if(location) fields['Vị trí']=[{id:location.id}]; if(input.amount!=null) fields['Chi phí']=input.amount;
        if(input.contactId) fields['Người thực hiện']=[{id:input.contactId}];
        tableId='tblu4E7ZpuHYxiGb';
      } else {
        if (!input.text.trim() || !Number.isSafeInteger(input.amount) || input.amount<=0 || !paymentPurposes.includes(input.kind) || !paymentChannels.includes(input.channel)) return send(res,400,JSON.stringify({error:'Nhập nội dung, mục đích, số tiền và đối tượng chi.'}));
        if (!Array.isArray(input.relatedIds) || input.relatedIds.length>20) return send(res,400,JSON.stringify({error:'Lịch sử liên kết không hợp lệ.'}));
        const relatedSource=input.kind==='sửa chữa'?'repairs':input.kind==='mua sắm'?'purchases':null;
        if(input.relatedIds.length && (!relatedSource || input.relatedIds.some(id=>!data.rows.some(row=>row.source===relatedSource&&row.id===id)))) return send(res,400,JSON.stringify({error:'Lịch sử liên kết không hợp lệ.'}));
        fields={'Ngày':when,'Nội dung':input.text.trim(),'Số tiền':input.amount,'Mục đích':[input.kind],'Chi':[input.channel],'Đã chi':input.paid===true};
        if(input.contactId) fields['Thụ hưởng']=[{id:input.contactId}];
        if(input.relatedIds.length) fields[relatedSource==='repairs'?'Sửa chữa':'Mua sắm']=input.relatedIds.map(id=>({id}));
        tableId='tbl7KFKggPU6quoD';
      }
      const args=['--profile',profile,'base','+record-upsert','--base-token',baseToken,'--table-id',tableId,'--json',JSON.stringify(fields),'--as','user','--format','json'];
      const {stdout}=await execFileAsync('lark-cli',args,{timeout:30000,maxBuffer:1024*1024});
      const result=JSON.parse(stdout); if(!result.ok) throw new Error(result.error?.message||'Không ghi được vào Lark Base.');
      cache=null; return send(res,201,JSON.stringify({ok:true, recordId:result.data?.record?.record_id || result.data?.record_id || result.data?.id || ''}));
    } catch(error) { (cloud ? (()=>{}) : console.error)('Entry create failed:',error.message); return send(res,502,JSON.stringify({error:'Không lưu được bản ghi vào Lark Base.'})); }
  }
  if (url.pathname === '/api/image-upload' && req.method === 'POST') {
    try {
      if (req.headers.origin && req.headers.origin !== origin) return send(res,403,JSON.stringify({error:'Nguồn yêu cầu không hợp lệ.'}));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res,415,JSON.stringify({error:'Dữ liệu không hợp lệ.'}));
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 11_000_000) return send(res,413,JSON.stringify({error:'Ảnh vượt quá 8 MB.'})); }
      const input = JSON.parse(raw);
      // These are existing attachment fields verified against the live Base schema.
      const destinations = {
        cleaning: { table: 'tbl43kOPJuusdrxM', fields: { 'Hình ảnh': 'fld4M7TwwQ' } },
        repairs: { table: 'tblu4E7ZpuHYxiGb', fields: { 'Hình ảnh': 'fld2OyWlPB' } },
        payments: { table: 'tbl7KFKggPU6quoD', fields: { 'Biên nhận': 'fldaZ2H4Kj', 'Hoá đơn': 'fld0EnhWQW' } }
      };
      const destination = destinations[input.source];
      const field = destination?.fields[input.field || (input.source === 'payments' ? 'Biên nhận' : 'Hình ảnh')];
      if (!destination || !field || !/^rec[A-Za-z0-9_-]{8,}$/.test(input.recordId || '')) return send(res,400,JSON.stringify({error:'Bản ghi hoặc trường ảnh không hợp lệ.'}));
      const types = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const extension = types[input.type];
      if (!extension || typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) return send(res,400,JSON.stringify({error:'Chỉ nhận ảnh JPG, PNG, WebP hoặc GIF.'}));
      const bytes = Buffer.from(input.data, 'base64');
      if (!bytes.length || bytes.length > 8_000_000) return send(res,413,JSON.stringify({error:'Ảnh phải nhỏ hơn 8 MB.'}));
      const valid = input.type === 'image/jpeg' ? bytes[0]===0xff && bytes[1]===0xd8 : input.type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : input.type === 'image/gif' ? bytes.subarray(0,3).toString()==='GIF' : bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
      if (!valid) return send(res,400,JSON.stringify({error:'Định dạng ảnh không hợp lệ.'}));
      const dir = await mkdtemp('/tmp/siris-upload-');
      try {
        const file = path.join(dir, `image${extension}`);
        await writeFile(file, bytes);
        const args = ['--profile',profile,'base','+record-upload-attachment','--base-token',baseToken,'--table-id',destination.table,'--record-id',input.recordId,'--field-id',field,'--file',file,'--as','user','--format','json'];
        const { stdout } = await execFileAsync('lark-cli', args, { timeout:60000, maxBuffer:1024*1024 });
        const result = JSON.parse(stdout);
        if (!result.ok) throw new Error(result.error?.message || 'Không tải được ảnh lên Lark Base.');
        cache = null;
        return send(res,200,JSON.stringify({ok:true}));
      } finally { await rm(dir,{recursive:true,force:true}); }
    } catch (error) { (cloud ? (()=>{}) : console.error)('Image upload failed:',error.message); return send(res,502,JSON.stringify({error:'Bản ghi đã lưu nhưng không tải được ảnh. Hãy thêm ảnh trong Lark Base.'})); }
  }
  if (url.pathname === '/api/staff' && req.method === 'GET') {
    try { return send(res, 200, JSON.stringify({ users: await activeStaff() })); }
    catch (error) { (cloud ? (()=>{}) : console.error)('Staff lookup failed:', error.message); return send(res, 503, JSON.stringify({ error: 'Chưa thể xác minh nhân viên còn hoạt động trên Lark. Cần cấp quyền đọc danh bạ.' })); }
  }
  if (url.pathname === '/api/history' && req.method === 'POST') {
    try {
      const origin = req.headers.origin;
      if (origin && origin !== origin) return send(res, 403, JSON.stringify({ error: 'Nguồn yêu cầu không hợp lệ.' }));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, JSON.stringify({ error: 'Dữ liệu không hợp lệ.' }));
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(res, 413, JSON.stringify({ error: 'Dữ liệu quá lớn.' })); }
      const input = JSON.parse(raw);
      const income = input.source === 'income';
      const expense = input.source === 'expense';
      if (!income && !expense) return send(res, 400, JSON.stringify({ error: 'Loại bản ghi không hợp lệ.' }));
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.date) && Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) && new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) === input.date;
      const validMoney = value => Number.isSafeInteger(value) && value >= 0;
      const data = await loadData(true);
      if (!validDate || !(income ? data.options.incomeKinds : data.options.expenseKinds).includes(input.category) || !validMoney(input.amount) || (income && input.customerPaid != null && !validMoney(input.customerPaid)) || typeof input.note !== 'string' || input.note.length > 2000 || (income && typeof input.changeGiven !== 'boolean') || (income && input.advanceAmount != null && !validMoney(input.advanceAmount))) return send(res, 400, JSON.stringify({ error: 'Kiểm tra lại thông tin nhập.' }));
      if (!Array.isArray(input.fundIds) || input.fundIds.length > 20 || input.fundIds.some(id => !data.rows.some(row => row.source === 'fund' && row.id === id))) return send(res, 400, JSON.stringify({ error: 'Liên kết quỹ không hợp lệ.' }));
      if (income && input.advanceAmount > 0 && (!input.changeGiven || !input.staffId)) return send(res, 400, JSON.stringify({ error: 'Nhập nhân viên và đánh dấu đã thối tiền khi có tiền ứng.' }));
      if (income && input.staffId && !(input.advanceAmount > 0)) return send(res, 400, JSON.stringify({ error: 'Nhập số tiền nhân viên đã ứng.' }));
      if (income && input.staffId && !(await activeStaff()).some(user => user.id === input.staffId)) return send(res, 400, JSON.stringify({ error: 'Nhân viên ứng không còn hoạt động trên Lark.' }));
      const buildings = data.options.buildings;
      if (input.building && !buildings.includes(input.building)) return send(res, 400, JSON.stringify({ error: 'Toà không hợp lệ.' }));
      const location = input.locationId ? data.rows.find(row => row.source === 'location' && row.id === input.locationId) : null;
      if (input.locationId && (!location || (input.building && location.building !== input.building))) return send(res, 400, JSON.stringify({ error: 'Phòng hoặc vị trí không hợp lệ.' }));
      const fields = { 'Ngày': `${input.date} 12:00`, 'Nội dung': [input.category], 'Ghi chú': input.note.trim() };
      if (income) {
        fields['Thực nhận'] = input.amount;
        if (input.customerPaid != null) fields['Khách trả'] = input.customerPaid;
        fields['Đã thối tiền'] = input.changeGiven;
        if (input.advanceAmount > 0) { fields['Số tiền nhân viên ứng'] = input.advanceAmount; fields['Nhân viên ứng tiền thối'] = [{ id: input.staffId }]; }
        if (input.building) fields['Toà'] = [input.building];
        if (location) fields['Phòng'] = [{ id: location.id }];
        if (input.fundIds.length) fields['Lịch sử bỏ quỹ'] = input.fundIds.map(id => ({ id }));
      } else {
        fields['Số tiền'] = input.amount;
        if (input.building) fields['Toà'] = [input.building];
        if (location) fields['Vị trí'] = [location.room];
        if (input.fundIds.length) fields['Lịch sử lấy quỹ'] = input.fundIds.map(id => ({ id }));
      }
      const tableId = income ? 'tblQ5gPuRREWk7fL' : 'tblFrWyocxkXMhAL';
      const args = ['--profile', profile, 'base', '+record-upsert', '--base-token', baseToken, '--table-id', tableId, '--json', JSON.stringify(fields), '--as', 'user', '--format', 'json'];
      const { stdout } = await execFileAsync('lark-cli', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error(result.error?.message || 'Không ghi được vào Lark Base.');
      cache = null;
      return send(res, 201, JSON.stringify({ ok: true }));
    } catch (error) { (cloud ? (()=>{}) : console.error)('History create failed:', error.message); return send(res, 502, JSON.stringify({ error: 'Không lưu được lịch sử vào Lark Base.' })); }
  }
  if (url.pathname === '/api/fund' && req.method === 'POST') {
    try {
      const origin = req.headers.origin;
      if (origin && origin !== origin) return send(res, 403, JSON.stringify({ error: 'Nguồn yêu cầu không hợp lệ.' }));
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, JSON.stringify({ error: 'Dữ liệu không hợp lệ.' }));
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return send(res, 413, JSON.stringify({ error: 'Dữ liệu quá lớn.' }));
      }
      const input = JSON.parse(raw);
      const { date, kind, amount, incomeIds, expenseIds } = input;
      const options = await loadOptions(true);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || !options.fundKinds.includes(kind) || !Number.isSafeInteger(amount) || amount <= 0) {
        return send(res, 400, JSON.stringify({ error: 'Kiểm tra lại ngày, loại giao dịch và số tiền.' }));
      }
      const fields = { 'Ngày': `${date} 12:00`, 'Nội dung': [kind], 'Số tiền': amount };
      if (!Array.isArray(incomeIds) || !Array.isArray(expenseIds) || incomeIds.length > 20 || expenseIds.length > 20) return send(res, 400, JSON.stringify({ error: 'Liên kết không hợp lệ.' }));
      if (incomeIds.length || expenseIds.length) {
        const data = await loadData(true);
        if ((incomeIds.length && kind !== 'Nạp tiền') || (expenseIds.length && kind !== 'Rút tiền')) return send(res, 400, JSON.stringify({ error: 'Loại liên kết không khớp giao dịch.' }));
        const linkIds = incomeIds.length ? incomeIds : expenseIds;
        const source = incomeIds.length ? 'income' : 'expense';
        if (linkIds.some(id => !data.rows.some(row => row.id === id && row.source === source))) return send(res, 400, JSON.stringify({ error: 'Lịch sử liên kết không hợp lệ.' }));
        fields[incomeIds.length ? 'Thu' : 'Chi'] = linkIds.map(id => ({ id }));
      }
      const args = ['--profile', profile, 'base', '+record-upsert', '--base-token', baseToken, '--table-id', tables[0].id, '--json', JSON.stringify(fields), '--as', 'user', '--format', 'json'];
      const { stdout } = await execFileAsync('lark-cli', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      if (!result.ok) throw new Error(result.error?.message || 'Không ghi được vào Lark Base.');
      cache = null;
      return send(res, 201, JSON.stringify({ ok: true }));
    } catch (error) {
      (cloud ? (()=>{}) : console.error)('Fund create failed:', error.message);
      return send(res, 502, JSON.stringify({ error: 'Không lưu được bút toán vào Lark Base.' }));
    }
  }
  if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
  if (cloud && url.pathname === '/api/review-sync-status') return send(res,200,JSON.stringify({disabled:true}));
  if (url.pathname === '/api/review-sync-status') {
    try {
      const raw = await readFile(path.join(os.homedir(), 'Library/Logs/Siris/review-ota.json'), 'utf8');
      return send(res, 200, raw);
    } catch {
      return send(res, 200, JSON.stringify({ lastAttemptAt: null, lastSuccessAt: null, lastRunStatus: 'not-run', results: [] }));
    }
  }
  if (url.pathname === '/api/data') {
    try {
      const data = await loadData(url.searchParams.get('refresh') === '1');
      return send(res, 200, JSON.stringify(data));
    } catch (error) {
      (cloud ? (()=>{}) : console.error)('Lark read failed:', error.message);
      if (cache) return send(res, 200, JSON.stringify({ ...cache, stale: true }));
      return send(res, 503, JSON.stringify({ error: 'Không đọc được Lark Base. Kiểm tra đăng nhập Lark CLI và quyền truy cập Base.' }));
    }
  }
  if (url.pathname === '/api/image') {
    const source = url.searchParams.get('source');
    const recordId = url.searchParams.get('id');
    const token = url.searchParams.get('token');
    const table = tables.find(item => item.key === source && ['cleaning', 'repairs', 'payments', 'assets', 'googleReviews'].includes(item.key));
    if (!table || !recordId || !token) return send(res, 400, 'Invalid image request', 'text/plain; charset=utf-8');
    const data = await loadData().catch(() => cache);
    const row = data?.rows.find(item => item.source === source && item.id === recordId);
    const attachment = row?.images?.find(item => item.token === token);
    if (!attachment) return send(res, 404, 'Image not found', 'text/plain; charset=utf-8');
    const dir = await mkdtemp('/tmp/siris-image-');
    const output = path.join(dir, 'attachment');
    try {
      const args = ['--profile', profile, 'base', '+record-download-attachment', '--base-token', baseToken, '--table-id', table.id, '--record-id', recordId, '--file-token', token, '--output', output, '--as', 'user', '--format', 'json'];
      const { stdout } = await execFileAsync('lark-cli', args, { timeout: 30000, maxBuffer: 1024 * 1024 });
      const result = JSON.parse(stdout);
      const type = result?.data?.downloaded?.[0]?.content_type;
      if (!type?.startsWith('image/')) return send(res, 415, 'Unsupported image', 'text/plain; charset=utf-8');
      const body = await readFile(output);
      if (body.length > 12 * 1024 * 1024) return send(res, 413, 'Image too large', 'text/plain; charset=utf-8');
      return send(res, 200, body, type);
    } catch (error) {
      (cloud ? (()=>{}) : console.error)('Image read failed:', error.message);
      return send(res, 502, 'Không tải được ảnh từ Lark Base.', 'text/plain; charset=utf-8');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (!assets.has(url.pathname)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const asset = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = await readFile(path.join(root, asset.slice(1)));
    return send(res, 200, body, mime[path.extname(asset)]);
  } catch {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
};
}

if (!process.env.VERCEL && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4173);
  const server=http.createServer(createApplication({origin:`http://127.0.0.1:${port}`}));
  server.listen(port,'127.0.0.1',()=>console.log(`Siris Cash Web: http://127.0.0.1:${port}`));
}

