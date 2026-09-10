import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryDisclosureState } from '../js/history-disclosure-state.mjs';

function card(id) {
  const listeners = [];
  return {
    open:false,
    getAttribute:() => id,
    addEventListener:(event, callback) => { if (event === 'toggle') listeners.push(callback); },
    toggle() { listeners.forEach(callback => callback()); },
  };
}
const root = (...cards) => ({ querySelectorAll:() => cards });

for (const attribute of ['data-history-id', 'data-lol-history-id']) {
  test(`${attribute}: refresh and navigation retain open matches`, () => {
    const state = createHistoryDisclosureState(attribute);
    const first = card('match-1');
    state.restore(root(first));
    first.open = true; // Intentionally no toggle event yet.
    const refreshed = card('match-1');
    state.restore(root(refreshed));
    assert.equal(refreshed.open, true);
    state.restore(root()); // Different filter/page.
    const returned = card('match-1');
    state.restore(root(returned));
    assert.equal(returned.open, true);
    returned.open = false;
    returned.toggle();
    const closed = card('match-1');
    state.restore(root(closed));
    assert.equal(closed.open, false);
  });
}

test('old detached toggle events cannot overwrite the current choice', () => {
  const state = createHistoryDisclosureState('data-history-id');
  const old = card('1');
  state.restore(root(old));
  const current = card('1');
  state.restore(root(current));
  current.open = true;
  current.toggle();
  old.toggle();
  const next = card('1');
  state.restore(root(next));
  assert.equal(next.open, true);
});

test('games have independent state and unknown matches stay closed', () => {
  const val = createHistoryDisclosureState('data-history-id');
  const lol = createHistoryDisclosureState('data-lol-history-id');
  const match = card('same-id');
  val.restore(root(match));
  match.open = true;
  match.toggle();
  const otherGame = card('same-id');
  lol.restore(root(otherGame));
  assert.equal(otherGame.open, false);
  const unknown = card('new');
  val.restore(root(unknown));
  assert.equal(unknown.open, false);
});
