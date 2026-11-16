// A guided tour in six steps: the record seen from space, the jump when VIIRS joins, the harmonized
// scale, the Paraná Delta in 2020, the latest month against normal, and the downloads. Each step sets
// the map, the timeline and the calendar; every number in the text is read from the bundle with the
// same functions the panels use.
import { useEffect, useMemo, useRef } from 'react';
import { annualTotals, observability, readMonth, stepRatio } from '../lib/analytics.ts';
import { indexOf, monthOf, yearOf } from '../lib/months.ts';
import { defaultRegion } from '../state.ts';
import { presetRegion } from '../lib/region.ts';
import { useI18n } from '../i18n.tsx';
import type { I18n } from '../i18n.tsx';
import type { Model } from '../model.ts';
import { presetName, sensorStartIndex, useModel } from '../model.ts';
import type { Derived } from '../derived.tsx';
import { useDerived } from '../derived.tsx';
import { reducedMotion, useUi } from '../store.ts';
import type { Ui } from '../store.ts';

interface Ctx {
  model: Model;
  d: Derived;
  i18n: I18n;
  viirsYear: number;
}

interface Step {
  key: string;
  /** state to set when the step opens; null skips the step (data missing) */
  apply: (c: Ctx) => Partial<Ui> | null;
  title: (c: Ctx) => string;
  body: (c: Ctx) => string;
  after?: () => void;
}

const delta = (m: Model) => m.manifest.presets.find((p) => p.id === 'delta') ?? null;

const STEPS: Step[] = [
  {
    key: 'space',
    apply: ({ model }) => ({
      region: defaultRegion(model.manifest),
      range: [0, model.axis.n - 1],
      series: 'harmonized',
      mode: 'counts',
      mapColor: 'hotspots',
      plotsOpen: false,
    }),
    title: ({ i18n }) => i18n.t('story1Title'),
    body: ({ model, i18n }) => i18n.t('story1Body', { res: String(model.manifest.grid.res), start: i18n.monthYear(model.axis.startYear, model.axis.startMonth) }),
  },
  {
    key: 'jump',
    apply: () => ({ series: 'naive', plotsOpen: true }),
    title: ({ i18n, viirsYear }) => i18n.t('story2Title', { year: viirsYear }),
    body: ({ model, d, i18n, viirsYear }) => {
      const { manifest, axis } = model;
      const naive = stepRatio(annualTotals(d.rs.naive, axis, observability(manifest, axis, 'naive')), viirsYear);
      const harm = stepRatio(annualTotals(d.rs.harmonized, axis, d.harmObs), viirsYear);
      if (!naive || !harm) return i18n.t('story2BodyPlain', { year: viirsYear });
      return i18n.t('story2Body', { year: viirsYear, naive: i18n.fmt(naive.ratio, 2), harm: i18n.fmt(harm.ratio, 2) });
    },
  },
  {
    key: 'scale',
    apply: () => ({ series: 'harmonized', plotsOpen: false, mode: 'counts' }),
    title: ({ i18n }) => i18n.t('story3Title'),
    body: ({ i18n, viirsYear }) => i18n.t('story3Body', { year: viirsYear }),
  },
  {
    key: 'delta',
    apply: ({ model }) => {
      const p = delta(model);
      const a = indexOf(model.axis, 2020, 1);
      const b = indexOf(model.axis, 2020, 12);
      if (!p || a < 0 || b < 0 || b >= model.axis.n) return null;
      return { region: presetRegion(p, model.manifest), range: [a, b], mode: 'anomaly', series: 'harmonized' };
    },
    title: ({ model, i18n }) => {
      const p = delta(model);
      return i18n.t('story4Title', { name: p ? presetName(p, i18n) : '' });
    },
    body: ({ model, d, i18n }) => {
      const years = annualTotals(d.rs.harmonized, model.axis, d.harmObs);
      const y08 = years.find((y) => y.year === 2008 && y.complete);
      const y20 = years.find((y) => y.year === 2020 && y.complete);
      if (!y08 || !y20) return i18n.t('story4BodyPlain');
      return i18n.t('story4Body', { a: i18n.fmt(Math.round(y08.total)), b: i18n.fmt(Math.round(y20.total)) });
    },
  },
  {
    key: 'latest',
    apply: ({ model, d }) => {
      if (!d.latest) return null;
      return { region: defaultRegion(model.manifest), range: [d.latest.m, d.latest.m], mode: 'pct' };
    },
    title: ({ i18n }) => i18n.t('story5Title'),
    body: ({ model, d, i18n }) => {
      if (!d.latest) return '';
      const r = readMonth(d.rs.harmonized, model.axis, d.harmBase, d.latest.m);
      const month = i18n.monthLong(monthOf(model.axis, d.latest.m));
      const when = i18n.monthYear(yearOf(model.axis, d.latest.m), monthOf(model.axis, d.latest.m));
      const text = Number.isFinite(r.pct)
        ? i18n.t('latestText', { v: i18n.fmt(Math.round(r.x)), pct: i18n.fmt(Math.round(r.pct)), month, median: i18n.fmt(Math.round(r.median)) })
        : '';
      return i18n.t('story5Body', { when, text });
    },
  },
  {
    key: 'download',
    apply: () => ({ plotsOpen: false }),
    title: ({ i18n }) => i18n.t('story6Title'),
    body: ({ i18n }) => i18n.t('story6Body'),
    after: () => document.getElementById('download')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }),
  },
];

function useCtx(): Ctx {
  const model = useModel();
  const d = useDerived();
  const i18n = useI18n();
  const s = sensorStartIndex(model.manifest, model.axis, 'viirs_snpp');
  const viirsYear = s !== null ? yearOf(model.axis, s) : 2012;
  return { model, d, i18n, viirsYear };
}

/** Applies a step's state when the tour moves to it. Mounted once. */
export function StoryDriver() {
  const story = useUi((s) => s.story);
  const c = useCtx();
  const ctx = useRef(c);
  ctx.current = c;
  useEffect(() => {
    if (story === null) return;
    const step = STEPS[story];
    if (!step) return;
    const patch = step.apply(ctx.current);
    if (!patch) {
      // this bundle lacks the data for the step: move on
      useUi.getState().set({ story: story + 1 < STEPS.length ? story + 1 : null });
      return;
    }
    useUi.getState().set({ ...patch, playing: false });
    step.after?.();
  }, [story]);
  useEffect(() => {
    if (story === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().set({ story: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [story]);
  return null;
}

/** The tour card. It can be shown in more than one place (map corner, phone panel); only the driver changes state. */
export function StoryCard() {
  const story = useUi((s) => s.story);
  const c = useCtx();
  const { t } = c.i18n;
  const step = story !== null ? STEPS[story] : null;
  const body = useMemo(() => (step ? step.body(c) : ''), [step, c]);
  if (story === null || !step) return null;
  const go = (n: number | null) => useUi.getState().set({ story: n });
  const last = story === STEPS.length - 1;
  return (
    <aside className="story overlay-card" aria-label={t('storyLabel')}>
      <div className="story-head">
        <span className="story-count">{t('storyCount', { k: story + 1, n: STEPS.length })}</span>
        <button type="button" className="btn small ghost" onClick={() => go(null)} aria-label={t('storyClose')}>
          {t('close')}
        </button>
      </div>
      <h2>{step.title(c)}</h2>
      <p aria-live="polite">{body}</p>
      <div className="story-dots" aria-hidden="true">
        {STEPS.map((s, i) => (
          <i key={s.key} className={i === story ? 'on' : i < story ? 'done' : ''} />
        ))}
      </div>
      <div className="story-nav">
        <button type="button" className="btn small" disabled={story === 0} onClick={() => go(story - 1)}>
          {t('storyBack')}
        </button>
        <button type="button" className="btn small primary" onClick={() => go(last ? null : story + 1)}>
          {last ? t('storyDone') : t('storyNext')}
        </button>
      </div>
    </aside>
  );
}

export function StoryButton({ className = 'btn small overlay-btn' }: { className?: string }) {
  const { t } = useI18n();
  const story = useUi((s) => s.story);
  if (story !== null) return null;
  return (
    <button type="button" className={className} onClick={() => useUi.getState().set({ story: 0, howToOpen: false })}>
      {t('storyStart')}
    </button>
  );
}
