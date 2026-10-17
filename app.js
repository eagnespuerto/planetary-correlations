/* Planetary Correlations: NASA Exoplanet Archive x Gaia DR3 explorer. */
'use strict';

// ---------- classification ----------
const CLASS_ORDER = ['O/B', 'A', 'F', 'G', 'K', 'M', 'Brown dwarf'];
const GAIA_CLASSES = ['O/B', 'A', 'F', 'G', 'K', 'M'];
const PTYPES = ['Earth-size', 'Super-Earth', 'Sub-Neptune', 'Neptune-like', 'Gas giant'];
const MULT_ORDER = ['1', '2', '3', '4', '5+'];

// Effective temperature -> class (after Pecaut & Mamajek dwarf sequence).
function teffClass(t) {
  if (t == null) return null;
  if (t >= 10000) return 'O/B';
  if (t >= 7300) return 'A';
  if (t >= 6000) return 'F';
  if (t >= 5300) return 'G';
  if (t >= 3850) return 'K';
  if (t >= 2300) return 'M';
  return 'Brown dwarf';
}
// Gaia BP-RP colour -> class. Edges are multiples of the census bin width (0.05 mag).
function colorClass(bprp) {
  if (bprp < 0) return 'O/B';
  if (bprp < 0.40) return 'A';
  if (bprp < 0.75) return 'F';
  if (bprp < 1.00) return 'G';
  if (bprp < 1.85) return 'K';
  return 'M';
}
function planetType(r) {
  if (r == null) return null;
  if (r < 1.25) return 'Earth-size';
  if (r < 2) return 'Super-Earth';
  if (r < 4) return 'Sub-Neptune';
  if (r < 8) return 'Neptune-like';
  return 'Gas giant';
}
const multBucket = n => n == null ? null : (n >= 5 ? '5+' : String(n));

// ---------- attributes ----------
const ATTRS = {
  pl_orbsmax: { label: 'Semi-major axis', unit: 'AU', log: true },
  pl_orbper: { label: 'Orbital period', unit: 'days', log: true },
  pl_rade: { label: 'Planet radius', unit: 'R⊕', log: true },
  pl_bmasse: { label: 'Planet mass', unit: 'M⊕', log: true },
  pl_dens: { label: 'Planet density', unit: 'g/cm³', log: true },
  pl_orbeccen: { label: 'Eccentricity', unit: '' },
  pl_insol: { label: 'Insolation', unit: 'S⊕', log: true },
  pl_eqt: { label: 'Equilibrium temperature', unit: 'K' },
  st_teff: { label: 'Star temperature', unit: 'K' },
  st_mass: { label: 'Star mass', unit: 'M☉', log: true },
  st_rad: { label: 'Star radius', unit: 'R☉', log: true },
  st_met: { label: 'Star metallicity [Fe/H]', unit: 'dex' },
  st_logg: { label: 'Star surface gravity log g', unit: 'cgs' },
  st_age: { label: 'Star age', unit: 'Gyr' },
  sy_dist: { label: 'Distance', unit: 'pc', log: true },
  sy_pnum: { label: 'Planets in system', unit: '' },
  sy_snum: { label: 'Stars in system', unit: '' },
  disc_year: { label: 'Discovery year', unit: '' },
  star_class: { label: 'Star type (from Teff)', cat: true, order: CLASS_ORDER },
  planet_type: { label: 'Planet type (from radius)', cat: true, order: PTYPES },
  multiplicity: { label: 'Planets in system (grouped)', cat: true, order: MULT_ORDER },
  discoverymethod: { label: 'Discovery method', cat: true, order: null },
};
const attrTitle = k => ATTRS[k].label + (ATTRS[k].unit ? ` (${ATTRS[k].unit})` : '');

const PRESETS = [
  ['Mass vs radius', 'pl_bmasse', 'pl_rade', 'planet_type'],
  ['Period vs radius', 'pl_orbper', 'pl_rade', 'discoverymethod'],
  ['Distance from star vs star type', 'star_class', 'pl_orbsmax', 'none'],
  ['Metallicity vs mass (giant-planet effect)', 'st_met', 'pl_bmasse', 'star_class'],
  ['Star type × planet type', 'star_class', 'planet_type', 'none'],
  ['Star type × number of planets', 'star_class', 'multiplicity', 'none'],
  ['Eccentricity vs semi-major axis', 'pl_orbsmax', 'pl_orbeccen', 'planet_type'],
  ['Discovery year vs distance', 'disc_year', 'sy_dist', 'discoverymethod'],
];

// Solar System reference points (equilibrium temperature: zero albedo, 278 K / sqrt(a)).
const SOLAR = [
  ['Mercury', 0.387, 87.97, 0.383, 0.0553, 5.43, 0.2056],
  ['Venus', 0.723, 224.7, 0.949, 0.815, 5.24, 0.0068],
  ['Earth', 1.0, 365.25, 1.0, 1.0, 5.51, 0.0167],
  ['Mars', 1.524, 687.0, 0.532, 0.107, 3.93, 0.0934],
  ['Jupiter', 5.203, 4333, 11.21, 317.8, 1.33, 0.0489],
  ['Saturn', 9.537, 10759, 9.45, 95.16, 0.687, 0.0565],
  ['Uranus', 19.19, 30687, 4.01, 14.54, 1.27, 0.0457],
  ['Neptune', 30.07, 60190, 3.88, 17.15, 1.64, 0.0113],
].map(([name, a, p, r, m, d, e]) => ({
  pl_name: name, hostname: 'Sun', pl_orbsmax: a, pl_orbper: p, pl_rade: r, pl_bmasse: m, pl_dens: d,
  pl_orbeccen: e, pl_insol: 1 / (a * a), pl_eqt: 278.6 / Math.sqrt(a), st_teff: 5772, st_mass: 1, st_rad: 1,
  st_met: 0, st_logg: 4.44, st_age: 4.6, sy_pnum: 8, sy_snum: 1, star_class: 'G', planet_type: planetType(r),
  multiplicity: '5+',
}));

// ---------- state ----------
let PLANETS = [];
let CENSUS = null;
const state = {
  x: 'pl_bmasse', y: 'pl_rade', color: 'planet_type', xlog: true, ylog: true,
  classes: new Set(CLASS_ORDER.concat(['Unknown'])), trend: true, solar: true, rownorm: true,
  qClass: 'G', qDist: '100', qCrit: 'any',
};

const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => css(`--s${i}`));
const fmtPct = p => p == null ? '–' : (p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(3)) + '%';
const fmtNum = v => v == null ? '–' : Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  : +v.toPrecision(3) + '';

// ---------- load ----------
async function load() {
  const [p, c] = await Promise.all([
    fetch('data/planets.json').then(r => r.json()),
    fetch('data/census.json').then(r => r.json()),
  ]);
  const cols = p.cols, n = cols.pl_name.length;
  for (let i = 0; i < n; i++) {
    const row = {};
    for (const k in cols) row[k] = cols[k][i];
    row.star_class = teffClass(row.st_teff);
    row.planet_type = planetType(row.pl_rade);
    row.multiplicity = multBucket(row.sy_pnum);
    PLANETS.push(row);
  }
  // Fold rare discovery methods into "Other" so the palette never runs out.
  const counts = {};
  PLANETS.forEach(r => { counts[r.discoverymethod] = (counts[r.discoverymethod] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 5);
  PLANETS.forEach(r => { if (!top.includes(r.discoverymethod)) r.discoverymethod = 'Other'; });
  ATTRS.discoverymethod.order = top.concat('Other');

  CENSUS = c;
  $('n-planets').textContent = n.toLocaleString();
  $('sources').textContent = `Data: ${p.meta.sources.join('; ')}. Fetched ${p.meta.fetched}.`;
}

// ---------- plotly theming ----------
function baseLayout(extra = {}) {
  const ink = css('--text-primary'), muted = css('--text-secondary'), grid = css('--grid'), axis = css('--axis');
  const ax = { gridcolor: grid, linecolor: axis, zerolinecolor: axis, tickfont: { color: muted, size: 12 },
    title: { font: { color: muted, size: 13 } }, automargin: true };
  return Object.assign({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: ink, size: 13 },
    margin: { l: 60, r: 20, t: 10, b: 50 },
    legend: { font: { color: muted, size: 12 }, orientation: 'h', y: -0.18, x: 0 },
    hoverlabel: { bgcolor: css('--surface-1'), bordercolor: axis, font: { color: ink } },
    xaxis: { ...ax }, yaxis: { ...ax },
  }, extra);
}
const PCONF = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

// ---------- main explorer ----------
function filtered() {
  return PLANETS.filter(r => state.classes.has(r.star_class || 'Unknown'));
}
function catOrder(key, rows) {
  const ord = ATTRS[key].order;
  const present = new Set(rows.map(r => r[key]).filter(v => v != null));
  return ord.filter(v => present.has(v));
}
const tf = (v, log) => log ? Math.log10(v) : v;
const usable = (v, log) => v != null && (!log || v > 0);

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!sxx || !syy) return null;
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, icpt: my - (sxy / sxx) * mx };
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const out = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

function renderMain() {
  const { x, y, color } = state;
  const X = ATTRS[x], Y = ATTRS[y];
  const rows = filtered();
  $('xlog').disabled = !!X.cat; $('ylog').disabled = !!Y.cat;
  $('rownorm-wrap').hidden = !(X.cat && Y.cat);
  $('color').disabled = !!(X.cat || Y.cat);
  if (X.cat && Y.cat) return renderHeatmap(rows);
  if (X.cat || Y.cat) return renderBoxes(rows);
  renderScatter(rows);
}

function hoverFor(r) {
  return `<b>${r.pl_name}</b><br>${r.hostname}${r.star_class ? ' · ' + r.star_class + ' star' : ''}`
    + (r.planet_type ? ' · ' + r.planet_type : '');
}

// Log axes: label decades only when the data spans several, otherwise 1-2-5 steps.
function logTicks(log, vals) {
  if (!log) return { type: 'linear' };
  const span = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  return { type: 'log', dtick: span > 2.5 ? 1 : 'D2' };
}

function renderScatter(rows) {
  const { x, y, color, xlog, ylog } = state;
  const pts = rows.filter(r => usable(r[x], xlog) && usable(r[y], ylog));
  const traces = [];
  const series = SERIES();
  const mk = (sub, extra) => ({
    type: 'scattergl', mode: 'markers', x: sub.map(r => r[x]), y: sub.map(r => r[y]),
    text: sub.map(hoverFor), hovertemplate: `%{text}<br>${ATTRS[x].label}: %{x}<br>${ATTRS[y].label}: %{y}<extra></extra>`,
    marker: { size: 6, opacity: 0.75, line: { width: 0 } }, ...extra,
  });

  if (color === 'none') {
    traces.push(mk(pts, { name: 'Planets', marker: { size: 6, opacity: 0.7, color: series[0] }, showlegend: false }));
  } else if (ATTRS[color].cat) {
    const order = catOrder(color, pts);
    order.forEach((cat, i) => {
      const sub = pts.filter(r => r[color] === cat);
      const c = cat === 'Other' ? css('--other') : series[i % 8];
      traces.push(mk(sub, { name: `${cat} (${sub.length})`, marker: { size: 6, opacity: 0.75, color: c } }));
    });
    const rest = pts.filter(r => r[color] == null);
    if (rest.length) traces.push(mk(rest, { name: `Unknown (${rest.length})`, marker: { size: 5, opacity: 0.5, color: css('--other') } }));
  } else {
    const cl = ATTRS[color].log;
    const withC = pts.filter(r => usable(r[color], cl));
    const noC = pts.filter(r => !usable(r[color], cl));
    if (noC.length) traces.push(mk(noC, { name: `No ${ATTRS[color].label.toLowerCase()} (${noC.length})`, marker: { size: 5, opacity: 0.35, color: css('--other') } }));
    traces.push(mk(withC, {
      name: ATTRS[color].label, showlegend: false,
      marker: {
        size: 6, opacity: 0.85, color: withC.map(r => tf(r[color], cl)),
        colorscale: [[0, css('--seq-lo')], [0.5, css('--seq-mid')], [1, css('--seq-hi')]],
        colorbar: { title: { text: (cl ? 'log₁₀ ' : '') + attrTitle(color), side: 'right', font: { size: 12, color: css('--text-secondary') } },
          thickness: 10, tickfont: { color: css('--text-secondary'), size: 11 }, outlinewidth: 0 },
      },
    }));
  }

  // correlation on transformed values
  const xs = pts.map(r => tf(r[x], xlog)), ys = pts.map(r => tf(r[y], ylog));
  const pr = pearson(xs, ys);
  const sp = pts.length >= 3 ? pearson(ranks(xs), ranks(ys)) : null;

  if (state.trend && pr) {
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const lx = [lo, hi], ly = lx.map(v => pr.icpt + pr.slope * v);
    traces.push({
      type: 'scatter', mode: 'lines', name: 'Least-squares fit', hoverinfo: 'skip',
      x: lx.map(v => xlog ? 10 ** v : v), y: ly.map(v => ylog ? 10 ** v : v),
      line: { color: css('--text-secondary'), width: 2, dash: 'dash' },
    });
  }
  if (state.solar) {
    const sol = SOLAR.filter(r => usable(r[x], xlog) && usable(r[y], ylog));
    if (sol.length) traces.push({
      type: 'scatter', mode: 'markers+text', name: 'Solar System',
      x: sol.map(r => r[x]), y: sol.map(r => r[y]), text: sol.map(r => r.pl_name),
      textposition: 'top center', textfont: { size: 11, color: css('--text-primary') },
      hovertemplate: `<b>%{text}</b><br>${ATTRS[x].label}: %{x}<br>${ATTRS[y].label}: %{y}<extra></extra>`,
      marker: { symbol: 'star', size: 13, color: css('--text-primary'), line: { width: 2, color: css('--surface-1') } },
    });
  }

  const layout = baseLayout();
  layout.xaxis = { ...layout.xaxis, ...logTicks(xlog, xs), title: { ...layout.xaxis.title, text: attrTitle(x) } };
  layout.yaxis = { ...layout.yaxis, ...logTicks(ylog, ys), title: { ...layout.yaxis.title, text: attrTitle(y) } };
  Plotly.react('plot', traces, layout, PCONF);

  const t = (log, k) => log ? `log ${ATTRS[k].label.toLowerCase()}` : ATTRS[k].label.toLowerCase();
  const strength = r => { const a = Math.abs(r); return a > 0.7 ? 'strong' : a > 0.4 ? 'moderate' : a > 0.2 ? 'weak' : 'little or no'; };
  $('corr').innerHTML = pr ? [
    `Planets plotted: <b>${pts.length.toLocaleString()}</b> of ${rows.length.toLocaleString()}`,
    `Pearson r (${t(xlog, x)} vs ${t(ylog, y)}): <b>${pr.r.toFixed(3)}</b>`,
    `Spearman ρ: <b>${sp ? sp.r.toFixed(3) : '–'}</b> (${strength(sp ? sp.r : pr.r)} ${(sp ? sp.r : pr.r) >= 0 ? 'positive' : 'negative'} monotonic trend)`,
    xlog && ylog ? `Power-law fit: <b>y ∝ x<sup>${pr.slope.toFixed(2)}</sup></b>` : `Fit slope: <b>${fmtNum(pr.slope)}</b>`,
  ].map(s => `<span>${s}</span>`).join('') : `<span>Not enough planets have both values (${pts.length}).</span>`;
}

function renderBoxes(rows) {
  const { x, y, xlog, ylog } = state;
  const catKey = ATTRS[x].cat ? x : y, numKey = ATTRS[x].cat ? y : x;
  const numLog = ATTRS[x].cat ? ylog : xlog;
  const horizontal = !ATTRS[x].cat;
  const pts = rows.filter(r => r[catKey] != null && usable(r[numKey], numLog));
  const order = catOrder(catKey, pts);
  const series = SERIES();
  const traces = order.map((cat, i) => {
    const vals = pts.filter(r => r[catKey] === cat);
    const v = vals.map(r => r[numKey]);
    return {
      type: 'box', name: `${cat}`, [horizontal ? 'x' : 'y']: v, boxpoints: 'outliers',
      text: vals.map(hoverFor), hoveron: 'boxes+points',
      marker: { size: 4, opacity: 0.6, color: series[0] }, line: { width: 1.5, color: series[0] },
      fillcolor: 'rgba(0,0,0,0)', showlegend: false, orientation: horizontal ? 'h' : 'v',
    };
  });
  const layout = baseLayout();
  const numAxis = { ...logTicks(numLog, pts.map(r => tf(r[numKey], numLog))), title: { text: attrTitle(numKey) } };
  const catAxis = { type: 'category', title: { text: ATTRS[catKey].label }, categoryorder: 'array', categoryarray: order };
  layout.xaxis = { ...layout.xaxis, ...(horizontal ? numAxis : catAxis), title: { ...layout.xaxis.title, ...(horizontal ? numAxis : catAxis).title } };
  layout.yaxis = { ...layout.yaxis, ...(horizontal ? catAxis : numAxis), title: { ...layout.yaxis.title, ...(horizontal ? catAxis : numAxis).title } };
  Plotly.react('plot', traces, layout, PCONF);

  // Kruskal-style summary: medians per category
  const med = a => { const s = a.slice().sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  $('corr').innerHTML = `<span>Planets plotted: <b>${pts.length.toLocaleString()}</b></span>` + order.map(cat => {
    const v = pts.filter(r => r[catKey] === cat).map(r => r[numKey]);
    return `<span>${cat}: median <b>${fmtNum(med(v))}</b> ${ATTRS[numKey].unit} (n=${v.length})</span>`;
  }).join('');
}

function renderHeatmap(rows) {
  const { x, y, rownorm } = state;
  const pts = rows.filter(r => r[x] != null && r[y] != null);
  const xo = catOrder(x, pts), yo = catOrder(y, pts);
  // rows of the heatmap = X categories (so "% per row" answers "of X-type, what share is Y")
  const counts = xo.map(a => yo.map(b => pts.filter(r => r[x] === a && r[y] === b).length));
  const totals = counts.map(rw => rw.reduce((s, v) => s + v, 0));
  const z = rownorm ? counts.map((rw, i) => rw.map(v => totals[i] ? 100 * v / totals[i] : 0)) : counts;
  const text = counts.map((rw, i) => rw.map((v, j) => rownorm ? `${z[i][j].toFixed(1)}%` : `${v}`));
  const trace = {
    type: 'heatmap', x: yo, y: xo, z, text, texttemplate: '%{text}', textfont: { size: 12 },
    customdata: counts,
    hovertemplate: `${ATTRS[x].label}: %{y}<br>${ATTRS[y].label}: %{x}<br>%{customdata} planets` + (rownorm ? ' (%{z:.1f}% of row)' : '') + '<extra></extra>',
    colorscale: [[0, css('--surface-1')], [0.15, css('--seq-lo')], [0.6, css('--seq-mid')], [1, css('--seq-hi')]],
    xgap: 2, ygap: 2, showscale: false,
  };
  const layout = baseLayout();
  layout.xaxis = { ...layout.xaxis, type: 'category', title: { ...layout.xaxis.title, text: ATTRS[y].label }, side: 'top', gridcolor: 'rgba(0,0,0,0)' };
  layout.yaxis = { ...layout.yaxis, type: 'category', title: { ...layout.yaxis.title, text: ATTRS[x].label }, autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)',
    ticktext: xo.map((c, i) => `${c} (${totals[i]})`), tickvals: xo };
  layout.margin = { ...layout.margin, t: 60 };
  Plotly.react('plot', [trace], layout, PCONF);
  $('corr').innerHTML = `<span>Planets counted: <b>${pts.length.toLocaleString()}</b></span><span>Rows: ${ATTRS[x].label}; columns: ${ATTRS[y].label}. ${rownorm ? 'Each row sums to 100%.' : 'Cells are planet counts.'}</span>`;
}

// ---------- Gaia census ----------
const CRITERIA = [
  ['any', 'at least one known planet', () => true],
  ...PTYPES.map(t => [`type:${t}`, `a known ${t.toLowerCase()} planet`, ps => ps.some(p => p.planet_type === t)]),
  ['hotjup', 'a hot Jupiter', ps => ps.some(p => p.pl_rade >= 8 && p.pl_orbper != null && p.pl_orbper < 10)],
  ['temperate', 'a temperate rocky-size planet', ps => ps.some(p => p.pl_rade < 2 && p.pl_insol >= 0.35 && p.pl_insol <= 1.75)],
  ['n2', '2 or more known planets', ps => ps.length >= 2],
  ['n3', '3 or more known planets', ps => ps.length >= 3],
  ['n4', '4 or more known planets', ps => ps.length >= 4],
];
const CRIT_SHORT = { any: 'Any planet', hotjup: 'Hot Jupiter', temperate: 'Temperate', n2: '≥2 planets', n3: '≥3 planets', n4: '≥4 planets' };

let HOSTS = []; // [{cls, plx, planets[]}]
function buildHosts() {
  const byId = {};
  PLANETS.forEach(p => { if (p.gaia_dr3_id) (byId[p.gaia_dr3_id] = byId[p.gaia_dr3_id] || []).push(p); });
  HOSTS = Object.entries(CENSUS.hosts).filter(([id]) => byId[id])
    .map(([id, [bprp, plx]]) => ({ cls: colorClass(bprp), plx, planets: byId[id] }));
}
function censusStats(dist) {
  const bins = CENSUS.distances[dist], w = CENSUS.bin_width;
  const N = Object.fromEntries(GAIA_CLASSES.map(c => [c, 0]));
  for (const b in bins) N[colorClass((+b + 0.5) * w)] += bins[b];
  const minPlx = 1000 / +dist;
  const hosts = HOSTS.filter(h => h.plx > minPlx);
  const out = {};
  for (const c of GAIA_CLASSES.concat('all')) {
    const hs = c === 'all' ? hosts : hosts.filter(h => h.cls === c);
    const n = c === 'all' ? Object.values(N).reduce((s, v) => s + v, 0) : N[c];
    out[c] = { N: n, hits: Object.fromEntries(CRITERIA.map(([k, , f]) => [k, hs.filter(h => f(h.planets)).length])) };
  }
  return out;
}

function renderGaia() {
  const st = censusStats(state.qDist);
  const crit = CRITERIA.find(c => c[0] === state.qCrit);
  const s = st[state.qClass], hits = s.hits[state.qCrit];
  const pct = s.N ? 100 * hits / s.N : null;
  const clsName = state.qClass === 'all' ? 'all' : `${state.qClass}-type`;
  $('q-answer').innerHTML = `<span class="big">${fmtPct(pct)}</span> ${hits.toLocaleString()} of ${s.N.toLocaleString()} ${clsName} dwarfs within ${state.qDist} pc host ${crit[1]}.`
    + (hits < 10 ? ' <em>Small numbers: treat as indicative only.</em>' : '');

  const series = SERIES();
  const vals = GAIA_CLASSES.map(c => st[c].N ? 100 * st[c].hits[state.qCrit] / st[c].N : 0);
  const trace = {
    type: 'bar', x: GAIA_CLASSES, y: vals,
    marker: { color: GAIA_CLASSES.map(c => c === state.qClass || state.qClass === 'all' ? series[0] : css('--seq-lo')), cornerradius: 4 },
    customdata: GAIA_CLASSES.map(c => [st[c].hits[state.qCrit], st[c].N]),
    text: vals.map(v => fmtPct(v)), textposition: 'outside', textfont: { size: 12, color: css('--text-secondary') }, cliponaxis: false,
    hovertemplate: '%{x} dwarfs: %{customdata[0]} of %{customdata[1]} (%{y:.3f}%)<extra></extra>',
  };
  const layout = baseLayout({ bargap: 0.35, margin: { l: 60, r: 20, t: 24, b: 40 } });
  layout.yaxis = { ...layout.yaxis, title: { ...layout.yaxis.title, text: `% of Gaia stars within ${state.qDist} pc` }, rangemode: 'tozero' };
  layout.xaxis = { ...layout.xaxis, title: { ...layout.xaxis.title, text: 'Spectral class (from Gaia BP−RP)' }, gridcolor: 'rgba(0,0,0,0)' };
  Plotly.react('gaia-plot', [trace], layout, PCONF);

  const head = ['Class', 'Gaia stars', ...CRITERIA.map(([k]) => CRIT_SHORT[k] || k.slice(5))];
  const body = GAIA_CLASSES.concat('all').map(c => {
    const r = st[c];
    const cells = CRITERIA.map(([k]) => {
      const v = r.N ? 100 * r.hits[k] / r.N : null;
      return `<td class="${k === state.qCrit ? 'hl' : ''}" title="${r.hits[k]} of ${r.N}">${fmtPct(v)}</td>`;
    }).join('');
    return `<tr class="${c === state.qClass ? 'sel' : ''}"><td>${c === 'all' ? 'All' : c}</td><td>${r.N.toLocaleString()}</td>${cells}</tr>`;
  }).join('');
  $('gaia-table').innerHTML = `<caption class="sr-only">Share of Gaia DR3 dwarfs within ${state.qDist} pc hosting each kind of planet</caption>`
    + `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
}

// ---------- archive-wide host stats ----------
function renderHosts() {
  const systems = {};
  PLANETS.forEach(p => { (systems[p.hostname] = systems[p.hostname] || []).push(p); });
  const sys = Object.values(systems);
  const multi = sys.filter(s => s[0].sy_pnum >= 2).length;
  const dists = sys.map(s => s[0].sy_dist).filter(v => v != null).sort((a, b) => a - b);
  $('tiles').innerHTML = [
    [PLANETS.length.toLocaleString(), 'confirmed planets'],
    [sys.length.toLocaleString(), 'host stars'],
    [fmtPct(100 * multi / sys.length), 'of systems have 2+ known planets'],
    [`${Math.round(dists[dists.length >> 1])} pc`, 'median distance to a host'],
  ].map(([v, k]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

  const classes = CLASS_ORDER.filter(c => PLANETS.some(p => p.star_class === c));
  const series = SERIES();
  // planet-type mix, % of planets per star class
  const mix = PTYPES.map((t, i) => {
    const cnt = classes.map(c => PLANETS.filter(p => p.star_class === c && p.planet_type === t).length);
    const tot = classes.map(c => PLANETS.filter(p => p.star_class === c && p.planet_type).length);
    return {
      type: 'bar', orientation: 'h', name: t, y: classes, x: cnt.map((v, j) => tot[j] ? 100 * v / tot[j] : 0),
      customdata: cnt, marker: { color: series[i], line: { width: 1, color: css('--surface-1') } },
      hovertemplate: `%{y} stars: ${t} %{x:.1f}% (%{customdata} planets)<extra></extra>`,
    };
  });
  const l1 = baseLayout({ barmode: 'stack', bargap: 0.3, margin: { l: 90, r: 10, t: 30, b: 60 },
    title: { text: 'Planet types (% of known planets)', font: { size: 14 }, x: 0, y: 0.98 } });
  l1.xaxis = { ...l1.xaxis, range: [0, 100], ticksuffix: '%' };
  l1.yaxis = { ...l1.yaxis, autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' };
  l1.legend = { ...l1.legend, y: -0.2, traceorder: 'normal' };
  Plotly.react('mix-plot', mix, l1, PCONF);

  // multiplicity, % of systems per star class (ordinal -> one-hue ramp)
  const ramp = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
  const sysCls = sys.map(s => [teffClass(s[0].st_teff), multBucket(s[0].sy_pnum)]);
  const mult = MULT_ORDER.map((m, i) => {
    const cnt = classes.map(c => sysCls.filter(([sc, sm]) => sc === c && sm === m).length);
    const tot = classes.map(c => sysCls.filter(([sc]) => sc === c).length);
    return {
      type: 'bar', orientation: 'h', name: m === '1' ? '1 planet' : `${m} planets`, y: classes,
      x: cnt.map((v, j) => tot[j] ? 100 * v / tot[j] : 0), customdata: cnt.map((v, j) => [v, tot[j]]),
      marker: { color: ramp[i], line: { width: 1, color: css('--surface-1') } },
      hovertemplate: `%{y} stars: %{customdata[0]} of %{customdata[1]} systems with ${m} known planet${m === '1' ? '' : 's'} (%{x:.1f}%)<extra></extra>`,
    };
  });
  const l2 = baseLayout({ barmode: 'stack', bargap: 0.3, margin: { l: 90, r: 10, t: 30, b: 60 },
    title: { text: 'Known planets per system (% of systems)', font: { size: 14 }, x: 0, y: 0.98 } });
  l2.xaxis = { ...l2.xaxis, range: [0, 100], ticksuffix: '%' };
  l2.yaxis = { ...l2.yaxis, autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' };
  l2.legend = { ...l2.legend, y: -0.2, traceorder: 'normal' };
  Plotly.react('mult-plot', mult, l2, PCONF);
}

// ---------- controls ----------
function fillSelect(el, opts, val) {
  el.innerHTML = opts.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');
}
function syncControls() {
  const attrOpts = Object.keys(ATTRS).map(k => [k, ATTRS[k].label]);
  fillSelect($('x'), attrOpts, state.x);
  fillSelect($('y'), attrOpts, state.y);
  fillSelect($('color'), [['none', 'Nothing']].concat(attrOpts.filter(([k]) => k !== state.x && k !== state.y)), state.color);
  $('xlog').checked = state.xlog; $('ylog').checked = state.ylog;
}
function setAxis(axis, key) {
  state[axis] = key;
  state[axis + 'log'] = !!ATTRS[key].log;
  if (state.color === state.x || state.color === state.y) state.color = 'none';
  syncControls(); renderMain(); saveHash();
}
function saveHash() {
  const h = new URLSearchParams({ x: state.x, y: state.y, c: state.color, xl: +state.xlog, yl: +state.ylog });
  history.replaceState(null, '', '#' + h);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (ATTRS[h.get('x')]) state.x = h.get('x');
  if (ATTRS[h.get('y')]) state.y = h.get('y');
  if (h.get('c') && (h.get('c') === 'none' || ATTRS[h.get('c')])) state.color = h.get('c');
  if (h.has('xl')) state.xlog = h.get('xl') === '1';
  if (h.has('yl')) state.ylog = h.get('yl') === '1';
}

function wire() {
  $('x').onchange = e => setAxis('x', e.target.value);
  $('y').onchange = e => setAxis('y', e.target.value);
  $('color').onchange = e => { state.color = e.target.value; renderMain(); saveHash(); };
  $('xlog').onchange = e => { state.xlog = e.target.checked; renderMain(); saveHash(); };
  $('ylog').onchange = e => { state.ylog = e.target.checked; renderMain(); saveHash(); };
  $('trend').onchange = e => { state.trend = e.target.checked; renderMain(); };
  $('solar').onchange = e => { state.solar = e.target.checked; renderMain(); };
  $('rownorm').onchange = e => { state.rownorm = e.target.checked; renderMain(); };
  $('swap').onclick = () => {
    [state.x, state.y, state.xlog, state.ylog] = [state.y, state.x, state.ylog, state.xlog];
    syncControls(); renderMain(); saveHash();
  };

  $('class-filter').innerHTML = CLASS_ORDER.concat('Unknown').map(c =>
    `<label class="chip"><input type="checkbox" value="${c}" checked>${c}</label>`).join('');
  $('class-filter').onchange = e => {
    const c = e.target.value;
    e.target.checked ? state.classes.add(c) : state.classes.delete(c);
    e.target.parentElement.classList.toggle('off', !e.target.checked);
    renderMain();
  };

  $('presets').innerHTML = '<span class="ctl-label">Try:</span>' + PRESETS.map(([l], i) => `<button type="button" data-i="${i}">${l}</button>`).join('');
  $('presets').onclick = e => {
    const i = e.target.dataset.i; if (i == null) return;
    const [, x, y, c] = PRESETS[i];
    state.x = x; state.y = y; state.xlog = !!ATTRS[x].log; state.ylog = !!ATTRS[y].log; state.color = c;
    syncControls(); renderMain(); saveHash();
  };

  fillSelect($('q-class'), GAIA_CLASSES.map(c => [c, `${c}-type`]).concat([['all', 'all']]), state.qClass);
  fillSelect($('q-dist'), Object.keys(CENSUS.distances).map(d => [d, `${d} pc`]), state.qDist);
  fillSelect($('q-crit'), CRITERIA.map(([k, l]) => [k, l]), state.qCrit);
  $('q-class').onchange = e => { state.qClass = e.target.value; renderGaia(); };
  $('q-dist').onchange = e => { state.qDist = e.target.value; renderGaia(); };
  $('q-crit').onchange = e => { state.qCrit = e.target.value; renderGaia(); };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
}
function renderAll() { renderMain(); renderGaia(); renderHosts(); }

load().then(() => {
  readHash();
  buildHosts();
  syncControls();
  wire();
  renderAll();
  $('loading').hidden = true;
}).catch(err => {
  $('loading').textContent = `Could not load data (${err.message}). Serve this folder over HTTP, e.g. "python -m http.server".`;
  console.error(err);
});
