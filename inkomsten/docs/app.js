(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const toMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (s, n) => iso(toMs(s) + n * DAY);
  const dow = (s) => (new Date(toMs(s)).getUTCDay() + 6) % 7; // 0 = maandag
  const weekStart = (s) => addDays(s, -dow(s));
  const monthStart = (s, back = 0) => { const [y, m] = s.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 - back, 1)); return iso(d.getTime()); };
  const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY) + 1;
  function isoWeek(s) {
    const d = new Date(toMs(s));
    d.setUTCDate(d.getUTCDate() - dow(s) + 3);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  }
  const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const WD = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  const WDL = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  const euro = (c) => (c / 100).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
  const euro0 = (c) => (c / 100).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const nf = (n) => n.toLocaleString('nl-BE');
  const be = (s) => { const [y, m, d] = s.split('-'); return `${+d}/${+m}/${y}`; };
  const short = (s) => { const [, m, d] = s.split('-'); return `${+d}/${+m}`; };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* geen opslag */ } },
  };
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* geen opslag */ } },
  };

  // ---------- state ----------
  let summary = null;
  const dayMap = new Map();
  let detail = null; // ontcijferde transacties
  const charts = {};
  const state = Object.assign(
    { preset: 'lastWeek', from: '', to: '', group: 'day', metric: 'cents', type: 'bar', compare: false, table: false },
    store.get('oemtata-view-v2', {})
  );

  function today() {
    // huidige cafédag in Brusselse tijd
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]));
    const d = `${parts.year}-${parts.month}-${parts.day}`;
    return +parts.hour < (summary?.cutoffHour ?? 6) ? addDays(d, -1) : d;
  }

  function presetRange(p) {
    const t = today();
    const first = summary.days[0]?.[0] ?? t;
    switch (p) {
      case 'thisWeek': return [weekStart(t), t];
      case 'lastWeek': return [addDays(weekStart(t), -7), addDays(weekStart(t), -1)];
      case 'last4w': return [addDays(weekStart(t), -21), t];
      case 'thisMonth': return [monthStart(t), t];
      case 'lastMonth': return [monthStart(t, 1), addDays(monthStart(t), -1)];
      case 'last3m': return [monthStart(t, 2), t];
      case 'thisYear': return [`${t.slice(0, 4)}-01-01`, t];
      case 'last12m': return [monthStart(t, 11), t];
      case 'all': return [first, t];
      default: return [state.from || monthStart(t, 2), state.to || t];
    }
  }

  // ---------- groeperen ----------
  const GROUPS = {
    day: { key: (s) => s, label: (k) => `${WD[dow(k)]} ${short(k)}`, title: (k) => `${WDL[dow(k)]} ${be(k)}`, name: 'dag' },
    week: { key: weekStart, label: (k) => `wk ${isoWeek(k)}`, title: (k) => `Week ${isoWeek(k)}: ${be(k)} – ${be(addDays(k, 6))}`, name: 'week' },
    month: { key: (s) => s.slice(0, 7), label: (k) => `${MONTHS[+k.slice(5) - 1]} '${k.slice(2, 4)}`, title: (k) => `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`, name: 'maand' },
    quarter: { key: (s) => `${s.slice(0, 4)}-K${Math.floor((+s.slice(5, 7) - 1) / 3) + 1}`, label: (k) => `${k.slice(5)} '${k.slice(2, 4)}`, title: (k) => `${k.slice(5)} ${k.slice(0, 4)}`, name: 'kwartaal' },
    year: { key: (s) => s.slice(0, 4), label: (k) => k, title: (k) => k, name: 'jaar' },
  };

  function aggregate(from, to, group) {
    const g = GROUPS[group];
    const buckets = new Map();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = g.key(d);
      const b = buckets.get(k) ?? { key: k, from: d, to: d, cents: 0, count: 0, openDays: 0 };
      const v = dayMap.get(d);
      if (v) { b.cents += v.cents; b.count += v.count; if (v.count) b.openDays += 1; }
      b.to = d;
      buckets.set(k, b);
    }
    return [...buckets.values()];
  }
  const totals = (rows) => rows.reduce((t, r) => ({ cents: t.cents + r.cents, count: t.count + r.count, openDays: t.openDays + r.openDays }), { cents: 0, count: 0, openDays: 0 });

  const METRICS = {
    cents: { name: 'Omzet', value: (r) => r.cents / 100, fmt: (v) => euro(v * 100), tick: (v) => euro0(v * 100) },
    count: { name: 'Aantal betalingen', value: (r) => r.count, fmt: (v) => nf(v), tick: (v) => nf(v) },
    avg: { name: 'Gem. bedrag', value: (r) => (r.count ? r.cents / r.count / 100 : null), fmt: (v) => (v == null ? '–' : euro(v * 100)), tick: (v) => euro0(v * 100) },
  };

  // ---------- charts ----------
  function baseOptions(tickFmt) {
    const text2 = css('--text-2');
    const grid = css('--grid');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false, labels: { color: text2, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
        tooltip: {
          backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: text2,
          borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text2, maxRotation: 0, autoSkipPadding: 12 }, border: { color: grid } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text2, callback: tickFmt, maxTicksLimit: 6 } },
      },
    };
  }

  function draw(id, config) {
    charts[id]?.destroy();
    charts[id] = new Chart($(id), config);
  }

  function dataset(label, data, color, type) {
    return type === 'line'
      ? { label, data, type: 'line', borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.25, pointRadius: data.length > 40 ? 0 : 3, pointHoverRadius: 5, spanGaps: true }
      : { label, data, type: 'bar', backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 44, categoryPercentage: 0.8, barPercentage: 0.9 };
  }

  // ---------- render: publiek ----------
  function kpiHtml(label, value, now, prev, fmtDelta = true, note = '') {
    let delta = '';
    if (fmtDelta && prev != null && prev !== 0 && now != null) {
      const pct = ((now - prev) / Math.abs(prev)) * 100;
      const cls = pct >= 0 ? 'up' : 'down';
      delta = `<div class="delta"><span class="${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1).replace('.', ',')}%</span> t.o.v. vorige periode</div>`;
    } else if (fmtDelta) {
      delta = '<div class="delta">&nbsp;</div>';
    }
    if (note) delta += `<div class="delta">${note}</div>`;
    return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${delta}</div>`;
  }

  function render() {
    const [from, to] = presetRange(state.preset);
    state.from = from; state.to = to;
    $('preset').value = state.preset;
    $('from').value = from; $('to').value = to;
    $('group').value = state.group;
    $('metric').value = state.metric;
    $('compare').checked = state.compare;
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.type === state.type));
    store.set('oemtata-view-v2', { preset: state.preset, from, to, group: state.group, metric: state.metric, type: state.type, compare: state.compare, table: state.table });

    const len = daysBetween(from, to);
    const pFrom = addDays(from, -len), pTo = addDays(from, -1);
    const rows = aggregate(from, to, state.group);
    const prevRows = aggregate(pFrom, pTo, state.group);
    const t = totals(rows), p = totals(prevRows);

    $('kpis').innerHTML =
      kpiHtml('Omzet', euro(t.cents), t.cents, p.cents) +
      kpiHtml('Betalingen', nf(t.count), t.count, p.count) +
      kpiHtml('Gem. per betaling', t.count ? euro(t.cents / t.count) : '–', t.count ? t.cents / t.count : null, p.count ? p.cents / p.count : null) +
      kpiHtml('Gem. per open dag', t.openDays ? euro(t.cents / t.openDays) : '–', t.openDays ? t.cents / t.openDays : null, p.openDays ? p.cents / p.openDays : null);

    const m = METRICS[state.metric];
    const g = GROUPS[state.group];
    $('chartTitle').textContent = `${m.name} per ${g.name}`;
    const datasets = [dataset(`${be(from)} – ${be(to)}`, rows.map(m.value), css('--series-1'), state.type)];
    if (state.compare) datasets.push(dataset(`${be(pFrom)} – ${be(pTo)}`, prevRows.slice(0, rows.length).map(m.value), css('--compare'), state.type));
    const opts = baseOptions(m.tick);
    opts.plugins.legend.display = state.compare;
    opts.plugins.legend.position = 'bottom';
    opts.plugins.tooltip.callbacks = {
      title: (items) => g.title(rows[items[0].dataIndex].key),
      label: (ctx) => {
        const src = ctx.datasetIndex === 0 ? rows[ctx.dataIndex] : prevRows[ctx.dataIndex];
        const extra = state.metric === 'cents' && src ? ` · ${nf(src.count)} betalingen` : '';
        return ` ${state.compare ? (ctx.datasetIndex === 0 ? 'Nu: ' : 'Vorige: ') : ''}${m.fmt(ctx.parsed.y)}${extra}`;
      },
    };
    draw('mainChart', { type: state.type, data: { labels: rows.map((r) => g.label(r.key)), datasets }, options: opts });

    // tabel
    $('tableToggle').textContent = state.table ? 'Verberg tabel' : 'Toon tabel';
    $('mainTable').hidden = !state.table;
    if (state.table) {
      $('mainTable').innerHTML = `<table><thead><tr><th>${g.name[0].toUpperCase() + g.name.slice(1)}</th><th class="num">Omzet</th><th class="num">Betalingen</th><th class="num">Gem. bedrag</th><th class="num">Open dagen</th></tr></thead><tbody>${
        rows.slice().reverse().map((r) => `<tr><td>${esc(g.title(r.key))}</td><td class="num">${euro(r.cents)}</td><td class="num">${nf(r.count)}</td><td class="num">${r.count ? euro(r.cents / r.count) : '–'}</td><td class="num">${r.openDays}</td></tr>`).join('')
      }</tbody><tfoot><tr><td>Totaal</td><td class="num">${euro(t.cents)}</td><td class="num">${nf(t.count)}</td><td class="num">${t.count ? euro(t.cents / t.count) : '–'}</td><td class="num">${t.openDays}</td></tr></tfoot></table>`;
    }

    // per weekdag: gemiddelde over de dagen met betalingen
    const wd = WD.map(() => ({ cents: 0, count: 0, days: 0 }));
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = dayMap.get(d);
      if (v && v.count) { const w = wd[dow(d)]; w.cents += v.cents; w.count += v.count; w.days += 1; }
    }
    const wdVal = (w) => (!w.days ? null : state.metric === 'count' ? w.count / w.days : state.metric === 'avg' ? (w.count ? w.cents / w.count / 100 : null) : w.cents / w.days / 100);
    const wOpts = baseOptions(m.tick);
    wOpts.plugins.tooltip.callbacks = {
      title: (items) => WDL[items[0].dataIndex],
      label: (ctx) => ` ${m.fmt(ctx.parsed.y)}`,
      afterLabel: (ctx) => ` gemiddeld over ${wd[ctx.dataIndex].days} open ${wd[ctx.dataIndex].days === 1 ? 'dag' : 'dagen'}`,
    };
    draw('weekdayChart', { type: 'bar', data: { labels: WD, datasets: [dataset(m.name, wd.map(wdVal), css('--series-1'), 'bar')] }, options: wOpts });

    if (detail) renderDetail(from, to);
  }

  // ---------- ontgrendelen ----------
  // Alle gegevens staan versleuteld in data/data.enc.json; zonder de code toont de site niets.
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decrypt(pin) {
    const res = await fetch('data/data.enc.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('niet geladen');
    const enc = await res.json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function load(raw) {
    const cutoff = raw.cutoffHour;
    detail = raw.tx.map(([ts, cents, fee, bi, cardType, country]) => {
      const [d, time] = ts.split('T');
      const hour = +time.slice(0, 2);
      return { ts, day: hour < cutoff ? addDays(d, -1) : d, hour, time: time.slice(0, 5), cents, fee, brand: raw.brands[bi] ?? '?', cardType, country };
    });
    dayMap.clear();
    for (const t of detail) {
      const v = dayMap.get(t.day) ?? { cents: 0, count: 0 };
      v.cents += t.cents;
      if (t.cents > 0) v.count += 1;
      dayMap.set(t.day, v);
    }
    summary = { cutoffHour: cutoff, lastTransaction: raw.lastTransaction, days: [...dayMap.keys()].sort().map((d) => [d]) };
  }

  async function unlock(pin) {
    load(await decrypt(pin));
    session.set('oemtata-pin', pin);
    $('lockScreen').hidden = true;
    $('app').hidden = false;
    $('lockBtn').hidden = false;
    if (summary.lastTransaction) {
      const [d, t] = summary.lastTransaction.split('T');
      $('updated').textContent = `Bijgewerkt tot ${be(d)} ${t.slice(0, 5)} · een dag loopt tot ${pad(summary.cutoffHour)}:00 's ochtends`;
    }
    render();
  }

  function lock() {
    session.set('oemtata-pin', null);
    location.reload(); // alles uit het geheugen
  }

  let txRows = [];
  function renderDetail(from, to) {
    const tx = detail.filter((t) => t.day >= from && t.day <= to);
    const sales = tx.filter((t) => t.cents > 0);
    const sum = tx.reduce((s, t) => s + t.cents, 0);
    const fees = tx.reduce((s, t) => s + t.fee, 0);
    const unsettled = sales.filter((t) => !t.fee).length; // commissie nog niet gekend
    const biggest = sales.reduce((m, t) => (t.cents > (m?.cents ?? 0) ? t : m), null);
    const foreign = sales.filter((t) => t.country && t.country !== 'BE').length;

    // per uur, in cafévolgorde (06u … 05u), lege uren aan de randen weg
    const cutoff = summary.cutoffHour;
    const order = [...Array(24)].map((_, i) => (i + cutoff) % 24);
    const perHour = new Map(order.map((h) => [h, { cents: 0, count: 0 }]));
    for (const t of tx) { const h = perHour.get(t.hour); h.cents += t.cents; if (t.cents > 0) h.count += 1; }
    let hs = order.slice();
    while (hs.length && !perHour.get(hs[0]).count) hs.shift();
    while (hs.length && !perHour.get(hs.at(-1)).count) hs.pop();
    const busiest = hs.reduce((m, h) => (perHour.get(h).cents > (perHour.get(m)?.cents ?? -1) ? h : m), hs[0]);

    $('detailKpis').innerHTML =
      kpiHtml('Netto (na commissie)', euro(sum - fees), 0, null, false) +
      kpiHtml('Commissie', euro(fees), 0, null, false, unsettled ? `${nf(unsettled)} betaling${unsettled === 1 ? '' : 'en'} nog niet verrekend` : '') +
      kpiHtml('Grootste betaling', biggest ? euro(biggest.cents) : '–', 0, null, false) +
      kpiHtml('Drukste uur', busiest == null ? '–' : `${pad(busiest)}:00–${pad((busiest + 1) % 24)}:00`, 0, null, false) +
      kpiHtml('Buitenlandse kaarten', sales.length ? `${nf(foreign)} (${Math.round((foreign / sales.length) * 100)}%)` : '–', 0, null, false);

    const hOpts = baseOptions((v) => euro0(v * 100));
    hOpts.plugins.tooltip.callbacks = {
      title: (items) => `${pad(hs[items[0].dataIndex])}:00 – ${pad((hs[items[0].dataIndex] + 1) % 24)}:00`,
      label: (ctx) => ` ${euro(ctx.parsed.y * 100)} · ${nf(perHour.get(hs[ctx.dataIndex]).count)} betalingen`,
    };
    draw('hourChart', { type: 'bar', data: { labels: hs.map((h) => `${h}u`), datasets: [dataset('Omzet', hs.map((h) => perHour.get(h).cents / 100), css('--series-1'), 'bar')] }, options: hOpts });

    const perBrand = new Map();
    for (const t of tx) { const b = perBrand.get(t.brand) ?? { cents: 0, count: 0 }; b.cents += t.cents; if (t.cents > 0) b.count += 1; perBrand.set(t.brand, b); }
    const brands = [...perBrand].sort((a, b) => b[1].cents - a[1].cents);
    const bOpts = baseOptions((v) => euro0(v * 100));
    bOpts.indexAxis = 'y';
    bOpts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
    [bOpts.scales.x, bOpts.scales.y] = [bOpts.scales.y, bOpts.scales.x];
    bOpts.plugins.tooltip.callbacks = {
      label: (ctx) => { const b = brands[ctx.dataIndex][1]; return ` ${euro(b.cents)} · ${nf(b.count)} betalingen · ${sum ? Math.round((b.cents / sum) * 100) : 0}%`; },
    };
    const brandDs = dataset('Omzet', brands.map(([, b]) => b.cents / 100), css('--series-1'), 'bar');
    brandDs.borderSkipped = 'start';
    draw('brandChart', { type: 'bar', data: { labels: brands.map(([n]) => n), datasets: [brandDs] }, options: bOpts });

    // dagkeuze voor de transactielijst
    const days = [...new Set(tx.map((t) => t.day))].sort().reverse();
    const sel = $('txDay');
    const prevSel = sel.value;
    const dayTotals = new Map();
    for (const t of tx) dayTotals.set(t.day, (dayTotals.get(t.day) ?? 0) + t.cents);
    sel.innerHTML = `<option value="all">Hele periode (${nf(tx.length)})</option>` +
      days.map((d) => `<option value="${d}">${WD[dow(d)]} ${be(d)} · ${euro(dayTotals.get(d))}</option>`).join('');
    sel.value = days.includes(prevSel) || prevSel === 'all' ? prevSel : (days[0] ?? 'all');
    renderTxTable(tx);
  }

  function renderTxTable(tx) {
    const day = $('txDay').value;
    txRows = (day === 'all' ? tx : tx.filter((t) => t.day === day)).slice().reverse();
    const s = txRows.reduce((a, t) => ({ c: a.c + t.cents, f: a.f + t.fee }), { c: 0, f: 0 });
    $('txTable').innerHTML = txRows.length
      ? `<table><thead><tr><th>Tijdstip</th><th>Cafédag</th><th class="num">Bedrag</th><th class="num">Commissie</th><th>Kaart</th><th>Land</th></tr></thead><tbody>${
        txRows.map((t) => `<tr><td>${be(t.ts.slice(0, 10))} ${t.time}</td><td>${WD[dow(t.day)]} ${short(t.day)}</td><td class="num">${euro(t.cents)}</td><td class="num">${t.cents > 0 && !t.fee ? '<span class="hint" title="Nog niet verrekend">–</span>' : euro(t.fee)}</td><td>${esc(t.brand)}${t.cardType ? ` <span class="hint">${esc(t.cardType)}</span>` : ''}</td><td>${esc(t.country || '')}</td></tr>`).join('')
      }</tbody><tfoot><tr><td>${nf(txRows.length)} ${txRows.length === 1 ? 'betaling' : 'betalingen'}</td><td></td><td class="num">${euro(s.c)}</td><td class="num">${euro(s.f)}</td><td></td><td></td></tr></tfoot></table>`
      : '<p class="hint">Geen transacties in deze periode.</p>';
  }

  function downloadCsv() {
    const head = 'Tijdstip;Cafedag;Bedrag;Commissie;Kaart;Kaarttype;Land';
    const fmt = (c) => (c / 100).toFixed(2).replace('.', ',');
    const lines = txRows.map((t) => [t.ts.replace('T', ' '), t.day, fmt(t.cents), fmt(t.fee), t.brand, t.cardType, t.country].join(';'));
    const blob = new Blob(['﻿' + [head, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `oemtata_${$('txDay').value === 'all' ? `${state.from}_${state.to}` : $('txDay').value}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- thema ----------
  const SUN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"/></svg>';
  const isDark = () => (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  function showThemeBtn() {
    const dark = isDark();
    $('themeBtn').innerHTML = dark ? SUN : MOON;
    const label = dark ? 'Licht thema' : 'Donker thema';
    $('themeBtn').title = label;
    $('themeBtn').setAttribute('aria-label', label);
  }
  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('oemtata-theme', next);
    showThemeBtn();
    if (detail) render();
  }

  // ---------- events ----------
  function bind() {
    $('preset').addEventListener('change', (e) => { state.preset = e.target.value; render(); });
    for (const id of ['from', 'to']) {
      $(id).addEventListener('change', (e) => {
        if (!e.target.value) return;
        state[id] = e.target.value;
        if (state.from > state.to) state[id === 'from' ? 'to' : 'from'] = e.target.value;
        state.preset = 'custom';
        render();
      });
    }
    $('group').addEventListener('change', (e) => { state.group = e.target.value; render(); });
    $('metric').addEventListener('change', (e) => { state.metric = e.target.value; render(); });
    $('compare').addEventListener('change', (e) => { state.compare = e.target.checked; render(); });
    document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { state.type = b.dataset.type; render(); }));
    $('tableToggle').addEventListener('click', () => { state.table = !state.table; render(); });

    $('pinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('pinOk').disabled = true;
      $('pinErr').textContent = '';
      try {
        await unlock($('pinInput').value);
      } catch (err) {
        $('pinErr').textContent = err.name === 'OperationError' ? 'Verkeerde code.' : 'Gegevens konden niet geladen worden.';
        $('pinInput').select();
      } finally {
        $('pinOk').disabled = false;
      }
    });
    $('lockBtn').addEventListener('click', lock);
    $('txDay').addEventListener('change', () => renderTxTable(detail.filter((t) => t.day >= state.from && t.day <= state.to)));
    $('csvBtn').addEventListener('click', downloadCsv);
    $('themeBtn').addEventListener('click', toggleTheme);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { showThemeBtn(); if (detail) render(); });
  }

  // ---------- start ----------
  function init() {
    bind();
    showThemeBtn();
    const pin = session.get('oemtata-pin');
    if (pin) unlock(pin).catch(() => { session.set('oemtata-pin', null); $('pinInput').focus(); });
  }

  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
  }
  init();
})();
