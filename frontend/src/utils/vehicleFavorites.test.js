import assert from "node:assert/strict";
import { test } from "node:test";
import { createFavoritesStore, favoriteScope, readFavorites } from "./vehicleFavorites.js";

function memory() { const values = new Map(); return { key: "favorites", values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
test("guest and each account have distinct namespaces; unverified identity has no scope", () => {
  const guest = favoriteScope({ user: null });
  assert.notEqual(guest, favoriteScope({ user: { id: "a" } }));
  assert.notEqual(favoriteScope({ user: { id: "a" } }), favoriteScope({ user: { id: "b" } }));
  assert.equal(favoriteScope({ loading: true, user: { id: "a" } }), null);
  assert.equal(favoriteScope({ sessionError: "offline" }), null);
});
test("add/remove survives new store and external-tab changes, stores IDs only", () => {
  const storage = memory(), first = createFavoritesStore(storage);
  let notifications = 0; const unsubscribe = first.subscribe(() => notifications++);
  first.toggle("v1"); first.toggle("v2"); first.toggle("v1");
  assert.equal(storage.values.get(storage.key), '["v2"]');
  assert.deepEqual(createFavoritesStore(storage).getSnapshot().ids, ["v2"]);
  storage.setItem(storage.key, '["v3"]'); first.refresh();
  assert.deepEqual(first.getSnapshot().ids, ["v3"]); assert.equal(notifications, 4); unsubscribe();
  first.toggle("../bad"); assert.equal(notifications, 4);
});
test("blocked/quota storage keeps session choices without throwing or losing previous toggles", () => {
  const storage = { key: "x", getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const store = createFavoritesStore(storage);
  assert.ok(store.getSnapshot().issue);
  store.toggle("v1"); store.toggle("v2");
  assert.deepEqual(store.getSnapshot().ids, ["v1", "v2"]); assert.match(store.getSnapshot().issue, /phiên hiện tại/);
  store.toggle("v1"); assert.deepEqual(store.getSnapshot().ids, ["v2"]);
});
test("corrupt/object/invalid entries are rejected without deleting storage, duplicates normalized", () => {
  const storage = memory();
  for (const raw of ['broken', '{}', '["../bad"]', '[null]']) {
    storage.setItem(storage.key, raw);
    assert.deepEqual(readFavorites(storage, storage.key).ids, []);
    assert.ok(readFavorites(storage, storage.key).issue); assert.equal(storage.getItem(storage.key), raw);
  }
  storage.setItem(storage.key, '["v1","v1"]');
  assert.deepEqual(readFavorites(storage, storage.key).ids, ["v1"]);
});
