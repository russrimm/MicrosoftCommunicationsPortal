#!/usr/bin/env node
/**
 * Generates `static/worldmap.js` — a self-contained SVG world outline used by
 * the Feature Geography page.
 *
 * Source geometry: Natural Earth 1:110m "Admin 0 – Countries" (public domain),
 * distributed as TopoJSON via the `world-atlas` package. We decode the topology,
 * project it with a plate-carrée (equirectangular) projection, simplify it, and
 * emit a single SVG path so the portal needs no mapping library or tile server.
 *
 * Usage:
 *   node scripts/build-worldmap.js [path-to-countries-110m.json]
 *
 * With no argument the TopoJSON is downloaded from jsDelivr. The generated file
 * is committed, so this script only needs to be re-run to refresh the geometry.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const OUT_FILE = path.join(__dirname, '..', 'static', 'worldmap.js');

// ── Projection window ───────────────────────────────────────────────────────
// Antarctica is dropped and the southern edge clipped so the map reads as a
// wide dashboard banner rather than a stretched full-globe rectangle.
const LON_MIN = -180, LON_MAX = 180;
const LAT_MIN = -56, LAT_MAX = 84;
const WIDTH = 1000;
const HEIGHT = Math.round(WIDTH * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN));

const SKIP_COUNTRIES = new Set(['Antarctica']);
// Simplification thresholds, in projected units (viewBox pixels).
const MIN_POINT_DISTANCE = 0.35;
const MIN_RING_AREA = 0.45;

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString()));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// ── Minimal TopoJSON decoding ───────────────────────────────────────────────
// Arcs are delta-encoded integers; `transform` maps them back to lon/lat.
function decodeArcs(topology) {
  const { scale: [sx, sy], translate: [tx, ty] } = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
  });
}

// A negative arc index means "traverse arcs[~index] backwards".
function ringFromArcIndexes(indexes, arcs) {
  const points = [];
  for (const index of indexes) {
    const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
    // Drop the shared endpoint so joined arcs don't duplicate vertices.
    for (let i = points.length ? 1 : 0; i < arc.length; i++) points.push(arc[i]);
  }
  return points;
}

function polygonsOf(geometry, arcs) {
  if (geometry.type === 'Polygon') return [geometry.arcs.map((r) => ringFromArcIndexes(r, arcs))];
  if (geometry.type === 'MultiPolygon') {
    return geometry.arcs.map((poly) => poly.map((r) => ringFromArcIndexes(r, arcs)));
  }
  return [];
}

// ── Antimeridian handling ───────────────────────────────────────────────────
// Rings that straddle ±180° (Russia, Fiji) arrive with longitudes that jump
// from +179 to -179, which would draw a stripe across the whole map. Unwrapping
// makes each ring continuous; it is then emitted at whichever ±360° offsets
// actually overlap the visible window. Anything left outside is clipped by the
// SVG viewport at render time.
function unwrapRing(ring) {
  const out = [ring[0].slice()];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const delta = ring[i][0] - ring[i - 1][0];
    if (delta > 180) offset -= 360;
    else if (delta < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  return out;
}

function visibleCopies(ring) {
  const unwrapped = unwrapRing(ring);
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of unwrapped) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLat < LAT_MIN || minLat > LAT_MAX) return [];
  const copies = [];
  for (const shift of [-360, 0, 360]) {
    if (maxLon + shift < LON_MIN || minLon + shift > LON_MAX) continue;
    copies.push(shift === 0 ? unwrapped : unwrapped.map(([lon, lat]) => [lon + shift, lat]));
  }
  return copies;
}

// ── Projection + simplification ─────────────────────────────────────────────
function project([lon, lat]) {
  return [
    (lon - LON_MIN) / (LON_MAX - LON_MIN) * WIDTH,
    (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * HEIGHT,
  ];
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const x = Math.round(p[0] * 10) / 10;
    const y = Math.round(p[1] * 10) / 10;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - x) + Math.abs(prev[1] - y) < MIN_POINT_DISTANCE) continue;
    out.push([x, y]);
  }
  // A closed ring repeats its first point; the path `Z` command re-adds it.
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

function ringArea(points) {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// Compact number formatting: trims trailing ".0" and the leading "0" of "0.5".
function num(value) {
  let s = value.toFixed(1).replace(/\.0$/, '');
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

// Implicit-lineto path data: "M x y x y x yZ" — a negative number needs no
// separator because the minus sign already terminates the previous number.
function toPathData(rings) {
  let d = '';
  for (const ring of rings) {
    let segment = '';
    for (let i = 0; i < ring.length; i++) {
      const x = num(ring[i][0]);
      const y = num(ring[i][1]);
      if (i === 0) segment += 'M' + x;
      else segment += x.startsWith('-') ? x : ' ' + x;
      segment += y.startsWith('-') ? y : ' ' + y;
    }
    d += segment + 'Z';
  }
  return d;
}

async function main() {
  const localPath = process.argv[2];
  const raw = localPath
    ? fs.readFileSync(localPath, 'utf8')
    : await download(SOURCE_URL);
  const topology = JSON.parse(raw);
  const arcs = decodeArcs(topology);
  const collection = topology.objects.countries;

  const rings = [];
  let skipped = 0;
  for (const geometry of collection.geometries) {
    const name = (geometry.properties && geometry.properties.name) || '';
    if (SKIP_COUNTRIES.has(name)) continue;
    for (const polygon of polygonsOf(geometry, arcs)) {
      for (const ring of polygon) {
        for (const copy of visibleCopies(ring)) {
          const simplified = simplify(copy.map(project));
          if (simplified.length < 3 || ringArea(simplified) < MIN_RING_AREA) { skipped++; continue; }
          rings.push(simplified);
        }
      }
    }
  }

  const pathData = toPathData(rings);
  const banner = `// AUTO-GENERATED by scripts/build-worldmap.js — do not edit by hand.
// Geometry: Natural Earth 1:110m Admin 0 Countries (public domain),
// projected to plate carrée and simplified for use as a dashboard basemap.
`;
  const body = `(function () {
  'use strict';
  var LON_MIN = ${LON_MIN}, LON_MAX = ${LON_MAX}, LAT_MIN = ${LAT_MIN}, LAT_MAX = ${LAT_MAX};
  var WIDTH = ${WIDTH}, HEIGHT = ${HEIGHT};
  window.CPWorldMap = {
    width: WIDTH,
    height: HEIGHT,
    // Plate-carrée projection matching the baked path data. Returns viewBox units.
    project: function (lat, lon) {
      return {
        x: (lon - LON_MIN) / (LON_MAX - LON_MIN) * WIDTH,
        y: (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * HEIGHT
      };
    },
    path: ${JSON.stringify(pathData)}
  };
})();
`;
  fs.writeFileSync(OUT_FILE, banner + body, 'utf8');
  const kb = (Buffer.byteLength(banner + body) / 1024).toFixed(1);
  console.log(`wrote ${OUT_FILE} — ${rings.length} rings (${skipped} dropped as too small), ${kb} kB`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
