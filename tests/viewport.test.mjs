// SPDX-License-Identifier: MIT
// Derived from Dense UI; copyright (c) 2026 Edward Aponasko.
// See LICENSE and provenance.json beside this local extension.
import test from "node:test";
import assert from "node:assert/strict";
import { RenderViewport } from "../extensions/viewport/index.js";
import { anchoredZoom, centeredView, constrainView, fitZoom, rasterTarget, resizedView, toContent, toViewport } from "../extensions/viewport/renderViewportGeometry.js";

const content = { width: 1000, height: 1500 };
const viewport = { width: 800, height: 600 };
const view = { zoom: 1, panX: -100, panY: -450, mode: "manual" };

test("RenderViewport fit, width, height and actual respect zoom limits", () => {
  assert.equal(fitZoom("fit", content, viewport, 0.01, 16), 0.4);
  assert.equal(fitZoom("fit-width", content, viewport, 0.01, 16), 0.8);
  assert.equal(fitZoom("fit-height", content, viewport, 0.01, 16), 0.4);
  assert.equal(fitZoom("actual", content, viewport, 0.01, 16), 1);
  assert.equal(fitZoom("fit", content, viewport, 0.5, 16), 0.5);
  assert.equal(fitZoom("fit-width", content, viewport, 0.01, 0.6), 0.6);
  assert.equal(fitZoom("fit", content, { width: 0, height: 0 }, 0.01, 16), null);
});

test("RenderViewport centers small axes and clamps large surfaces to their edges", () => {
  assert.deepEqual(centeredView({ ...view, zoom: 0.2 }, content, viewport), { ...view, zoom: 0.2, panX: 300, panY: 150 });
  assert.deepEqual(constrainView({ ...view, panX: 999, panY: -9999 }, content, viewport), { ...view, panX: 0, panY: -900 });
  assert.deepEqual(constrainView(view, { width: 0, height: 0 }, viewport), { ...view, panX: 0, panY: 0 });
});

test("RenderViewport anchored zoom preserves the logical point and conversions round trip", () => {
  const anchor = { x: 225, y: 175 };
  const point = toContent(view, anchor.x, anchor.y);
  const next = anchoredZoom(view, 1.75, anchor);
  assert.equal(next.mode, "manual");
  assert.deepEqual(toContent(next, anchor.x, anchor.y), point);
  assert.deepEqual(toViewport(next, point.x, point.y), anchor);
});

test("RenderViewport resize recalculates fit and preserves the manual center", () => {
  const nextSize = { width: 700, height: 800 };
  const next = resizedView(view, content, viewport, nextSize, 0.01, 16);
  assert.equal(next.zoom, view.zoom);
  assert.deepEqual(toContent(next, 350, 400), toContent(view, 400, 300));
  const fitted = resizedView({ ...view, mode: "fit-width" }, content, viewport, nextSize, 0.01, 16);
  assert.equal(fitted.zoom, 0.7);
  assert.equal(fitted.panX, 0);
  assert.equal(fitted.panY, -125);
});

test("RenderViewport requested raster accounts for DPR and bounds allocation", () => {
  assert.deepEqual(rasterTarget(content, 1.5, 2, 16777216, 8192), { width: 3000, height: 4500 });
  const limited = rasterTarget(content, 16, 3, 1000000, 1200);
  assert.ok(limited.width * limited.height <= 1000000);
  assert.ok(limited.height <= 1200);
  assert.ok(Math.abs(limited.width / limited.height - 2 / 3) < 0.002);
  assert.deepEqual(rasterTarget({ width: 1, height: 1 }, 0.01, 1, 100, 100), { width: 1, height: 1 });
  assert.deepEqual(rasterTarget({ width: 1, height: 1000000 }, 1, 1, 100, 8192), { width: 1, height: 100 });
});

test("RenderViewport numeric zoom selects manual mode; getters are snapshots", () => {
  const control = new RenderViewport({ contentWidth: 1000, contentHeight: 1500, minZoom: 0.1, maxZoom: 2 });
  control.setZoom(99);
  assert.equal(control.zoom, 2);
  assert.equal(control.fitMode, "manual");
  control.setZoom(0.001);
  assert.equal(control.zoom, 0.1);
  control.fit("actual");
  assert.equal(control.zoom, 1);
  const state = control.getViewportState();
  state.pan.x = 999;
  state.contentSize.width = 1;
  assert.equal(control.contentSize.width, 1000);
  assert.notEqual(control.pan.x, 999);
  control.destroy();
});

test("RenderViewport event cancellation, once/off, metadata and silent mutations", () => {
  const control = new RenderViewport();
  const events = [];
  control.events.once("beforeContentChange", event => { event.cancel = true; });
  assert.equal(control.setContentSize(100, 200), false);
  assert.equal(control.contentSize.width, 0);
  control.events.on("contentChange", event => events.push([event.type, event.origin, event.userAction, event.silent]));
  assert.equal(control.setContentSize(100, 200, { origin: "import" }), true);
  assert.deepEqual(events, [["contentChange", "import", false, false]]);
  const stop = control.events.on("beforeViewportChange", event => { event.cancel = true; });
  assert.equal(control.setZoom(2), false);
  stop.off();
  const types = [];
  for (const name of ["beforeViewportChange", "viewportChange", "afterViewportChange"]) control.events.on(name, event => types.push(event.type));
  control.setZoom(2);
  assert.deepEqual(types, ["beforeViewportChange", "viewportChange", "afterViewportChange"]);
  control.setContentSize(200, 300, { silent: true });
  control.setZoom(3, { silent: true });
  assert.equal(events.length, 1);
  assert.equal(types.length, 3);
  assert.equal(control.zoom, 3);
  control.destroy();
});

test("RenderViewport rejects invalid input and follows BaseControl destruction", () => {
  for (const options of [{ minZoom: 0 }, { maxZoom: 0.001 }, { wheelZoom: "magic" }, { renderer: 42 }, { contentWidth: 1 }, { contentWidth: NaN }]) {
    assert.throws(() => new RenderViewport(options));
  }
  const control = new RenderViewport();
  assert.throws(() => control.fit("manual"));
  assert.throws(() => control.panTo(Infinity, 0));
  control.disable();
  control.setZoom(2);
  assert.equal(control.zoom, 2);
  control.destroy();
  control.destroy();
  assert.equal(control.destroyed, true);
  assert.equal(control.renderStatus, "empty");
  for (const action of [() => control.setZoom(1), () => control.setContentSize(0, 0), () => control.setRenderer(null), () => control.refresh(), () => control.panBy(0, 0), () => control.fit(), () => control.enable()]) {
    assert.throws(action, { name: "LifecycleError" });
  }
});
