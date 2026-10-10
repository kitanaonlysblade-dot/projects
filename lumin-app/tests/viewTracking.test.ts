// Run with: npm test   (Node's built-in runner via tsx)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPLETE_FRACTION, REPORT_EVERY_SECONDS, VIEW_AFTER_SECONDS, ViewTracker, type ViewApi } from '../lib/viewTracking';

function fakeApi(viewId: string | null = 'v1', fail = false) {
  const calls = { start: 0, reports: [] as { seconds: number; completed: boolean }[] };
  const api: ViewApi = {
    start: async () => {
      calls.start++;
      if (fail) throw new Error('offline');
      return { view_id: viewId };
    },
    report: async (_id, seconds, completed) => {
      calls.reports.push({ seconds, completed });
    },
  };
  return { api, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('no view is registered before the threshold', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < VIEW_AFTER_SECONDS - 1; i++) t.tick(1, 0.1);
  await settle();
  assert.equal(calls.start, 0);
});

test('view starts exactly once after the threshold', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < 8; i++) {
    t.tick(1, 0.1);
    await settle();
  }
  assert.equal(calls.start, 1);
});

test('seconds watched before the view started are carried over', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < VIEW_AFTER_SECONDS; i++) t.tick(1, 0.1);
  await settle();
  t.flush();
  assert.deepEqual(calls.reports, [{ seconds: VIEW_AFTER_SECONDS, completed: false }]);
});

test('progress is batched, not sent every second', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < VIEW_AFTER_SECONDS; i++) t.tick(1, 0.1);
  await settle(); // the first VIEW_AFTER_SECONDS seconds are now "unreported"
  const room = REPORT_EVERY_SECONDS - VIEW_AFTER_SECONDS;
  for (let i = 0; i < room - 1; i++) t.tick(1, 0.3);
  assert.equal(calls.reports.length, 0);
  t.tick(1, 0.4); // crosses the batch size
  assert.equal(calls.reports.length, 1);
  assert.equal(calls.reports[0].seconds, REPORT_EVERY_SECONDS);
});

test('completion is reported once', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < VIEW_AFTER_SECONDS; i++) t.tick(1, 0.1);
  await settle();
  t.tick(1, COMPLETE_FRACTION);
  t.tick(1, 1);
  t.flush();
  assert.equal(calls.reports.filter((r) => r.completed).length, 1);
});

test('a declined view (poster watching own post) sends nothing further', async () => {
  const { api, calls } = fakeApi(null);
  const t = new ViewTracker('p', api);
  for (let i = 0; i < 20; i++) {
    t.tick(1, 0.5);
    await settle();
  }
  t.flush();
  assert.equal(calls.start, 1);
  assert.equal(calls.reports.length, 0);
});

test('network failure never throws and stops tracking', async () => {
  const { api, calls } = fakeApi('v', true);
  const t = new ViewTracker('p', api);
  for (let i = 0; i < 10; i++) {
    t.tick(1, 0.5);
    await settle();
  }
  t.flush();
  assert.equal(calls.start, 1);
  assert.equal(calls.reports.length, 0);
});

test('flush with nothing unsent is a no-op', async () => {
  const { api, calls } = fakeApi();
  const t = new ViewTracker('p', api);
  for (let i = 0; i < VIEW_AFTER_SECONDS; i++) t.tick(1, 0.1);
  await settle();
  t.flush();
  t.flush();
  assert.equal(calls.reports.length, 1);
});
