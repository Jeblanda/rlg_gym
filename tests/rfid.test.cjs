const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const samples = [
  { id: 'expired', member_id: 'RLG-RFID-DEMO-01', name: 'Ava Santos', expiry: day(-3), uid: '4051388725' },
  { id: 'active', member_id: 'RLG-RFID-DEMO-02', name: 'Marco Reyes', expiry: day(45), uid: '3107939326' },
  { id: 'expiring', member_id: 'RLG-RFID-DEMO-03', name: 'Lia Cruz', expiry: day(7), uid: '3731461465' }
].map((row) => ({ ...row, dob: '1995-01-01', plan: 'Annual', membership_type: 'Standard', start_date: day(-300), face_photo_path: `${row.id}/face.jpg` }));

function setup(page = 'admin') {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: '', innerHTML: '', textContent: '', hidden: false, dataset: {}, listeners: {},
        classList: { add() {}, remove() {} },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        focus() { this.focused = true; },
        scrollIntoView() {}, reset() {}, showModal() {}, close() {},
        querySelector() { return element(`${selector} child`); }, querySelectorAll() { return []; }
      });
    }
    return elements.get(selector);
  }
  const formElements = {};
  for (const name of ['recordId', 'expiry', 'plan', 'membershipType', 'startDate', 'renewMembershipType', 'renewPlan', 'renewMonths']) {
    formElements[name] = element(`form ${name}`);
  }
  element('#memberForm').elements = formElements;
  element('#renewForm').elements = formElements;
  element('#appShell').hidden = true;

  const visits = [];
  const cards = samples.map((sample) => ({ member_id: sample.id, rfid_uid: sample.uid }));
  const tables = { member_rfid_cards: cards, members: samples, attendance: visits };
  const calls = [];
  function query(table) {
    const clauses = [];
    let sort = null;
    let limitCount = Infinity;
    return {
      select() { return this; }, eq(field, value) { clauses.push((row) => row[field] === value); return this; },
      is(field, value) { clauses.push((row) => row[field] === value); return this; },
      not(field, operator, value) { clauses.push((row) => row[field] !== value); return this; },
      order(field, options) { sort = [field, options.ascending]; return this; },
      limit(value) { limitCount = value; return this; },
      async result() {
        let rows = tables[table].filter((row) => clauses.every((check) => check(row)));
        if (sort) rows = rows.sort((a, b) => sort[1] ? String(a[sort[0]]).localeCompare(String(b[sort[0]])) : String(b[sort[0]]).localeCompare(String(a[sort[0]])));
        return { data: rows.slice(0, limitCount), error: null };
      },
      then(resolve, reject) { return this.result().then(resolve, reject); },
      async maybeSingle() { const result = await this.result(); return { data: result.data[0] || null, error: null }; },
      async single() { const result = await this.maybeSingle(); return result.data ? result : { data: null, error: { message: 'Not found' } }; }
    };
  }
  const client = {
    from: query,
    storage: { from: () => ({ createSignedUrl: async (file) => ({ data: { signedUrl: `signed:${file}` }, error: null }) }) },
    auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }) },
    async rpc(name, args) {
      calls.push({ name, ...args });
      const card = cards.find((item) => item.rfid_uid === args.p_uid);
      const member = samples.find((item) => item.id === card?.member_id);
      const open = visits.find((item) => item.member_id === member?.id && item.time_out === null);
      if (args.p_action === 'checkin') {
        if (open || member.expiry < day(0)) return { error: { message: 'Entry denied' } };
        visits.push({ id: `visit-${visits.length}`, member_id: member.id, checkin_method: 'rfid', time_in: new Date(Date.now() - 10000).toISOString(), time_out: null });
      } else if (open) open.time_out = new Date().toISOString();
      else return { error: { message: 'No open visit' } };
      return { data: { action: args.p_action, visit_id: open?.id || visits.at(-1)?.id, time: new Date().toISOString() }, error: null };
    }
  };
  const context = vm.createContext({
    window: { supabase: { createClient: () => client }, RLG_SUPABASE: { url: '', anonKey: '' }, location: { href: '' } },
    document: { body: { dataset: { page } }, querySelector: element, querySelectorAll: () => [] },
    setTimeout: () => 1, clearTimeout() {}, console
  });
  vm.runInContext(appCode, context);
  vm.runInContext('loadAdminData = async () => {}', context);
  return { elements, element, context, visits, calls, client };
}

async function scan(harness, uid) {
  harness.element('#rfidInput').value = uid;
  await harness.element('#rfidScanForm').listeners.submit({ preventDefault() {} });
  assert.equal(harness.element('#rfidInput').value, '');
  assert.equal(harness.element('#rfidInput').focused, true);
}

test('RFID scanner loops through invalid, unknown, expired, active, expiring, check-in, duplicate and check-out states', async () => {
  const h = setup();
  await scan(h, '123');
  assert.match(h.element('#rfidResult').innerHTML, /Invalid card number/);
  await scan(h, 'not-a-card');
  assert.match(h.element('#rfidMessage').textContent, /Invalid or incomplete/);
  await scan(h, '9999999999');
  assert.match(h.element('#rfidResult').innerHTML, /Unknown card/);
  await scan(h, '4051388725');
  assert.match(h.element('#rfidResult').innerHTML, /Ava Santos/);
  assert.match(h.element('#rfidResult').innerHTML, /Entry denied/);
  assert.match(h.element('#rfidResult').innerHTML, /data-action="checkin" disabled/);
  assert.equal(h.visits.length, 0);

  await scan(h, '3107939326');
  assert.match(h.element('#rfidResult').innerHTML, /Marco Reyes/);
  assert.match(h.element('#rfidResult').innerHTML, /signed:active\/face.jpg/);
  assert.match(h.element('#rfidResult').innerHTML, /data-action="checkin"/);
  const click = h.element('#rfidResult').listeners.click;
  await click({ target: { closest: () => ({ dataset: { action: 'checkin' }, disabled: false }) } });
  assert.equal(h.visits.length, 1);
  assert.equal(h.calls[0].p_action, 'checkin');
  await scan(h, '3107939326');
  assert.match(h.element('#rfidMessage').textContent, /Duplicate tap ignored/);
  assert.equal(h.visits.length, 1);
  vm.runInContext('lastRfidAction.at -= 9000', h.context);
  await scan(h, '3107939326');
  assert.match(h.element('#rfidResult').innerHTML, /data-action="checkout"/);
  await click({ target: { closest: () => ({ dataset: { action: 'checkout' }, disabled: false }) } });
  assert.ok(h.visits[0].time_out);
  assert.equal(h.calls[1].p_action, 'checkout');

  await scan(h, '3731461465');
  assert.match(h.element('#rfidResult').innerHTML, /Lia Cruz/);
  assert.match(h.element('#rfidResult').innerHTML, /Membership expires soon/);
  assert.match(h.element('#rfidResult').innerHTML, /data-action="checkin"/);
});

test('admin portal sends staff users back to staff portal before displaying the scanner', async () => {
  const h = setup();
  await vm.runInContext('showApp({ user: { email: "staff@example.test", app_metadata: { role: "staff" } } })', h.context);
  assert.equal(h.context.window.location.href, 'index.html');
  assert.equal(h.element('#appShell').hidden, true);
});

test('assigning a card to an edited member preserves a separately renewed expiry date', () => {
  const h = setup();
  vm.runInContext('members = [{ id: "m1", startDate: "2026-01-01", plan: "Monthly", expiry: "2026-12-01" }]', h.context);
  h.element('form recordId').value = 'm1';
  h.element('form startDate').value = '2026-01-01';
  h.element('form plan').value = 'Monthly';
  h.element('form membershipType').value = 'Standard';
  vm.runInContext('updateExpiry()', h.context);
  assert.equal(h.element('form expiry').value, '2026-12-01');
});

test('slow lookup shows immediate feedback, then restores scan focus', async () => {
  const h = setup();
  const originalFrom = h.client.from;
  let finishLookup;
  h.client.from = (table) => {
    const q = originalFrom(table);
    if (table === 'member_rfid_cards') q.maybeSingle = () => new Promise((resolve) => { finishLookup = () => resolve({ data: { member_id: 'active' }, error: null }); });
    return q;
  };
  h.element('#rfidInput').value = '3107939326';
  const pending = h.element('#rfidScanForm').listeners.submit({ preventDefault() {} });
  assert.match(h.element('#rfidMessage').textContent, /Looking up card/);
  assert.equal(h.element('#rfidInput').value, '');
  finishLookup();
  await pending;
  assert.match(h.element('#rfidResult').innerHTML, /Marco Reyes/);
  assert.equal(h.element('#rfidInput').focused, true);
});

test('failed lookup and failed confirmation allow a new scan or retry', async () => {
  const h = setup();
  const originalFrom = h.client.from;
  h.client.from = (table) => {
    const q = originalFrom(table);
    if (table === 'member_rfid_cards') q.maybeSingle = async () => ({ data: null, error: { message: 'Connection lost' } });
    return q;
  };
  await scan(h, '3107939326');
  assert.match(h.element('#rfidResult').innerHTML, /Scan failed/);
  assert.equal(h.visits.length, 0);
  h.client.from = originalFrom;
  await scan(h, '3107939326');
  const originalRpc = h.client.rpc;
  h.client.rpc = async () => ({ data: null, error: { message: 'Temporary database failure' } });
  const click = h.element('#rfidResult').listeners.click;
  await click({ target: { closest: () => ({ dataset: { action: 'checkin' }, disabled: false }) } });
  assert.match(h.element('#rfidMessage').textContent, /Could not record visit/);
  assert.equal(h.visits.length, 0);
  h.client.rpc = originalRpc;
  await click({ target: { closest: () => ({ dataset: { action: 'checkin' }, disabled: false }) } });
  assert.equal(h.visits.length, 1);
  assert.match(h.element('#rfidMessage').textContent, /checked in/);
});
