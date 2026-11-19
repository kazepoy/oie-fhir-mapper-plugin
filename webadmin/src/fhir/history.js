// SPDX-License-Identifier: MPL-2.0
// Undo and redo of the editor's mapping state: snapshots of the maps, kept while
// the step is open. A snapshot is taken before every change.

export function snapshot(state) {
  return {
    values: [...state.values], iterations: [...state.iterations].map(([k, v]) => [k, { ...v }]),
    translations: [...state.translations].map(([k, v]) => [k, { ...v }]), conditions: [...state.conditions],
    notes: [...(state.notes || [])], disabled: [...(state.disabled || [])], instances: [...(state.instances || [])], ruleIds: [...(state.ruleIds || [])]
  };
}

export function restore(state, snap) {
  state.values = new Map(snap.values);
  state.iterations = new Map(snap.iterations.map(([k, v]) => [k, { ...v }]));
  state.translations = new Map(snap.translations.map(([k, v]) => [k, { ...v }]));
  state.conditions = new Map(snap.conditions);
  state.notes = new Map(snap.notes);
  state.disabled = new Set(snap.disabled);
  state.instances = new Map(snap.instances);
  state.ruleIds = new Map(snap.ruleIds || []);
}
