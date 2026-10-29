import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginNextPage, finishNextPage, historyGeneration, historyReady } from '../lib/history-pagination';

test('failed next page can really retry the same cursor and does not admit duplicate inflight clicks', () => {
  const ready = historyReady(1, 'opaque-next-page');
  const loading = beginNextPage(ready, 1)!;
  assert.equal(loading.phase, 'loading-more');
  assert.equal(beginNextPage(loading, 1), null);
  const failed = finishNextPage(loading, 1, null, true);
  assert.equal(failed.phase, 'page-error');
  assert.equal(failed.cursor, ready.cursor);
  const retry = beginNextPage(failed, 1)!;
  assert.equal(retry.phase, 'loading-more');
  assert.equal(retry.cursor, ready.cursor);
  const complete = finishNextPage(retry, 1, 'next-after-retry');
  assert.deepEqual(complete, historyReady(1, 'next-after-retry'));
});

test('initial/refresh errors cannot append stale pages; old responses cannot change a new filter generation', () => {
  assert.equal(beginNextPage(historyGeneration(2), 2), null);
  assert.equal(beginNextPage({ ...historyGeneration(2), phase: 'initial-error' }, 2), null);
  assert.equal(beginNextPage(historyReady(1, 'old-filter-cursor'), 2), null);
  const oldInflight = beginNextPage(historyReady(1, 'old-filter-cursor'), 1)!;
  const newGeneration = historyGeneration(2);
  assert.equal(finishNextPage(newGeneration, oldInflight.generation, 'stale-next'), newGeneration);
  assert.equal(finishNextPage(newGeneration, oldInflight.generation, null, true), newGeneration);
  assert.equal(beginNextPage(historyReady(2, null), 2), null);
});
