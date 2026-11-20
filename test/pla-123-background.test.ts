// PLA-123: a background picked for an SVG that brings its own replaces it instead of framing it. Pure: sharp only.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { useTestEnv } from "./helpers.js";

useTestEnv();
const { compose } = await import("../src/brand/upload.js");
const { stripSvgBackground } = await import("../src/brand/detect.js");

const flower = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#F4EDE4"/><circle cx="50" cy="34" r="11" fill="#4A1F3D"/><circle cx="66" cy="50" r="11" fill="#4A1F3D"/><circle cx="50" cy="66" r="11" fill="#4A1F3D"/><circle cx="34" cy="50" r="11" fill="#4A1F3D"/><circle cx="50" cy="50" r="7" fill="#D9A7A0"/></svg>`;
const px = async (png: Buffer, x: number, y: number) => {
  const { data } = await sharp(png).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return `#${[data[0]!, data[1]!, data[2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

test("PLA-123 #1 a picked background replaces the SVG's own: no square of the old colour around the drawing", async () => {
  const png = await compose(Buffer.from(flower), "svg", 60, "#d9a7a0", 512);
  assert.equal(await px(png, 4, 4), "#d9a7a0", "corner");
  // Inside where the old ivory square sat (60 % tile: from 102 to 410), between petals: the new colour, not ivory.
  assert.equal(await px(png, 120, 120), "#d9a7a0");
  assert.equal(await px(png, 256, 175), "#4a1f3d", "the petals stay");
});

test("PLA-123 #2 with no background picked the SVG keeps its own; a rect that is only part of the drawing stays", async () => {
  const png = await compose(Buffer.from(flower), "svg", 100, null, 512);
  assert.equal(await px(png, 10, 10), "#f4ede4");
  const part = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="20" width="60" height="60" fill="#000"/></svg>`;
  assert.equal(stripSvgBackground(part), part);
  const masked = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><mask id="m"><rect width="100" height="100" fill="#fff"/></mask><rect width="100" height="100" fill="#123456" mask="url(#m)"/></svg>`;
  assert.equal(stripSvgBackground(masked), masked);
  assert.equal(stripSvgBackground(flower).includes("#F4EDE4"), false);
});
