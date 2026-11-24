import { KiorexLogo } from '../brand/kiorex-logo/KiorexLogo.preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ApiError, call, get, hasBearer, post, setBearer, setWidgetToken } from './api';
import { connect, type Bridge } from './bridge';
import { fmtClock, fmtDay, fmtDayLong, fmtMoney, fmtTime, dayKey, name as nameOf } from './format';
import { t as tr, type Lang } from './i18n';
import { discover, isReady, startLogin } from './oidc';
import type { Boot, BookingView, Fee, ProviderCard, Slot, WidgetConfig } from './types';

type Step = 'doctor' | 'time' | 'review' | 'done';
type Fatal = 'errOrigin' | 'errFlag' | 'errNotFound' | 'errGeneric' | 'errSession' | 'errRate' | 'offline';

const fatalOf = (e: unknown): Fatal => {
  if (!(e instanceof ApiError)) return 'errGeneric';
  if (e.status === 0) return 'offline';
  if (e.code === 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED' || e.code === 'WIDGET_PARENT_ORIGIN_REQUIRED' || e.code === 'WIDGET_ORIGIN_MISMATCH') return 'errOrigin';
  if (e.code === 'FEATURE_DISABLED') return 'errFlag';
  if (e.code === 'WIDGET_NOT_FOUND' || e.code === 'WIDGET_DOCTOR_NOT_FOUND') return 'errNotFound';
  if (e.code === 'WIDGET_TOKEN_INVALID') return 'errSession';
  if (e.code === 'GROWTH_RATE_LIMITED' || e.status === 429) return 'errRate';
  return 'errGeneric';
};

export function App({ boot }: { boot: Boot }) {
  const lang: Lang = boot.locale;
  const T = (k: string) => tr(lang, k);
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [cfg, setCfg] = useState<WidgetConfig | null>(null);
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [attempt, setAttempt] = useState(0);
  const lt = useRef<string | null>(boot.lt);
  const ref = useRef<string | null>(boot.ref);

  // ---- boot: handshake -> session -> config -----------------------------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    setFatal(null); setCfg(null);
    (async () => {
      const b = await connect(boot.po, boot.self, boot.sandbox);
      if (!alive) return;
      setBridge(b);
      if (b.init?.lt) lt.current = b.init.lt;
      if (b.init?.ref) ref.current = b.init.ref;
      const s = await post<{ token: string }>('/widget/v1/session', { org: boot.org, parentOrigin: b.parentOrigin ?? '', sandbox: boot.sandbox || undefined });
      setWidgetToken(s.token);
      const qs = new URLSearchParams(); if (boot.doctor) qs.set('doctor', boot.doctor); if (boot.specialty) qs.set('specialty', boot.specialty);
      const c = await get<WidgetConfig>(`/widget/v1/config${qs.size ? `?${qs}` : ''}`);
      if (!alive) return;
      setCfg(c);
      b.send({ kx: 1, type: 'kx:ready' });
      void discover(boot.authority).catch(() => undefined);
    })().catch((e) => { if (alive) { setFatal(fatalOf(e)); bridge?.send({ kx: 1, type: 'kx:error', code: e instanceof ApiError ? e.code.replace(/[^A-Z0-9_]/g, '_').slice(0, 64) : 'ERROR' }); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);

  // ---- resize events to the parent ------------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!bridge) return;
    let last = 0;
    const push = () => { const h = Math.ceil(document.documentElement.scrollHeight); if (Math.abs(h - last) > 1) { last = h; bridge.send({ kx: 1, type: 'kx:resize', height: h }); } };
    const ro = new ResizeObserver(push); ro.observe(document.body); push();
    return () => ro.disconnect();
  }, [bridge]);

  const shell = { cfg, boot, lang, online };
  if (fatal) {
    return (
      <Shell {...shell}>
        <div class="alert err" role="alert"><strong>{T('errTitle')}</strong><div>{T(fatal)}</div></div>
        {fatal !== 'errOrigin' && fatal !== 'errFlag' && fatal !== 'errNotFound' && <div class="row"><button type="button" class="primary" onClick={() => setAttempt((n) => n + 1)}>{T('retry')}</button></div>}
      </Shell>
    );
  }
  if (!cfg) return <Shell {...shell}><div role="status" aria-live="polite"><span class="sr">{T('loading')}</span><div class="list" aria-hidden="true"><div class="skeleton" /><div class="skeleton" /><div class="skeleton" /></div></div></Shell>;
  if (!cfg.providers.length) return <Shell {...shell}><div class="card" role="status"><strong>{T('noDoctors')}</strong><div class="muted">{T('noDoctorsHelp')}</div></div></Shell>;
  return <Shell {...shell}><Flow boot={boot} cfg={cfg} lang={lang} bridge={bridge!} lt={lt} refCode={ref} /></Shell>;
}

/** Module-level on purpose: a component declared inside `App` would get a new identity on every render and remount (and reset) the whole flow. */
function Shell({ cfg, boot, lang, online, children }: { cfg: WidgetConfig | null; boot: Boot; lang: Lang; online: boolean; children: ComponentChildren }) {
  const T = (k: string) => tr(lang, k);
  return (
    <div class="kx">
      <div class="head">
        {cfg?.org.logoUrl && boot.brand.logo && <img src={cfg.org.logoUrl} alt={T('logoAlt')} />}
        <div><h1 id="kx-title" tabIndex={-1}>{T('title')}</h1>{cfg && <div class="muted">{nameOf(cfg.org, lang)}</div>}</div>
      </div>
      {!online && <div class="alert warn" role="status">{T('offline')}</div>}
      {children}
      <div class="foot"><KiorexLogo variant="mark" height={16} title="" class="foot-mark" /><span>{T('brandLine')}</span></div>
    </div>
  );
}

// ============================================================================================================================================
function Flow({ boot, cfg, lang, bridge, lt, refCode }: { boot: Boot; cfg: WidgetConfig; lang: Lang; bridge: Bridge; lt: { current: string | null }; refCode: { current: string | null } }) {
  const T = (k: string) => tr(lang, k);
  const single = cfg.providers.length === 1;
  const [specialty, setSpecialty] = useState<string>(boot.specialty ?? '');
  const [provider, setProvider] = useState<ProviderCard | null>(single ? cfg.providers[0]! : null);
  const [fee, setFee] = useState<Fee | null>(single && cfg.providers[0]!.fees.length === 1 ? cfg.providers[0]!.fees[0]! : null);
  const [step, setStep] = useState<Step>('doctor');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [announce, setAnnounce] = useState('');
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus({ preventScroll: false }); }, [step]);

  const labels = [T('step1'), T('step2'), T('step3'), T('step4')];
  const idx = ['doctor', 'time', 'review', 'done'].indexOf(step);

  return (
    <div>
      <ol class="steps" aria-label={T('steps')}>
        {labels.map((l, i) => <li key={l} class={i < idx ? 'done' : ''} aria-current={i === idx ? 'step' : undefined}>{l}</li>)}
      </ol>
      <div class="sr" role="status" aria-live="polite">{announce}</div>
      {step === 'doctor' && <ChooseStep {...{ boot, cfg, lang, specialty, setSpecialty, provider, setProvider, fee, setFee, head }} onNext={() => setStep('time')} />}
      {step === 'time' && provider && fee && <TimeStep {...{ boot, lang, provider, fee, head, setAnnounce }} onBack={() => { setSlot(null); setStep('doctor'); }} onPick={(s) => { setSlot(s); setStep('review'); }} />}
      {step === 'review' && provider && fee && slot && (
        <ReviewStep {...{ boot, cfg, lang, provider, fee, slot, head, lt, refCode, setAnnounce }}
          onBack={() => setStep('time')}
          onRepick={(s) => { setSlot(s); }}
          onDone={(b) => { setBooking(b); setStep('done'); bridge.send({ kx: 1, type: 'kx:booked', status: b.status.replace(/[^A-Z0-9_]/g, '_').slice(0, 32), bookingRef: b.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) }); }} />
      )}
      {step === 'done' && booking && provider && fee && <DoneStep {...{ boot, cfg, lang, provider, fee, booking, head }} onAgain={() => { setBooking(null); setSlot(null); setStep('time'); }} />}
    </div>
  );
}

type HeadRef = { current: HTMLHeadingElement | null };
const Heading = ({ h, children }: { h: HeadRef; children: ComponentChildren }) => <h2 ref={h as never} tabIndex={-1}>{children}</h2>;

// ---- step 1 ----------------------------------------------------------------------------------------------------------------------------------
function ChooseStep(p: { boot: Boot; cfg: WidgetConfig; lang: Lang; specialty: string; setSpecialty: (s: string) => void; provider: ProviderCard | null; setProvider: (x: ProviderCard | null) => void; fee: Fee | null; setFee: (f: Fee | null) => void; head: HeadRef; onNext: () => void }) {
  const { cfg, lang } = p; const T = (k: string) => tr(lang, k);
  const providers = useMemo(() => cfg.providers.filter((x) => !p.specialty || x.specialty === p.specialty), [cfg, p.specialty]);
  const specs = cfg.specialties;
  return (
    <div>
      {cfg.providers.length > 1 && specs.length > 1 && !p.boot.specialty && (
        <div class="field">
          <label for="kx-spec" class="muted">{T('chooseSpecialty')}</label>
          <select id="kx-spec" value={p.specialty} onChange={(e) => { p.setSpecialty((e.target as HTMLSelectElement).value); p.setProvider(null); p.setFee(null); }}>
            <option value="">{T('allSpecialties')}</option>
            {specs.map((s) => <option key={s.code} value={s.code}>{lang === 'ar' ? s.ar : s.en}</option>)}
          </select>
        </div>
      )}
      {cfg.providers.length > 1 && (
        <>
          <Heading h={p.head}>{T('chooseDoctor')}</Heading>
          <ul class="list">
            {providers.map((d) => (
              <li key={d.id}>
                <button type="button" class="choice" aria-pressed={p.provider?.id === d.id} onClick={() => { p.setProvider(d); p.setFee(d.fees.length === 1 ? d.fees[0]! : null); }}>
                  <span class="doc">
                    {d.photoUrl ? <img class="avatar" src={d.photoUrl} alt="" /> : <span class="avatar" aria-hidden="true">{(nameOf(d, lang) || '?').trim().charAt(0)}</span>}
                    <span><strong>{nameOf(d, lang)}</strong><br /><span class="muted">{specs.find((s) => s.code === d.specialty)?.[lang] ?? ''}{d.rating.count ? ` · ${d.rating.average.toFixed(1)} (${d.rating.count})` : ''}</span></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {p.provider && (
        <>
          {cfg.providers.length === 1 && <Heading h={p.head}>{nameOf(p.provider, lang)}</Heading>}
          <h3 class="muted" id="kx-visit-h" tabIndex={-1}>{T('chooseVisit')}</h3>
          <ul class="list" aria-labelledby="kx-visit-h">
            {p.provider.fees.map((f) => (
              <li key={f.typeId}>
                <button type="button" class="choice" aria-pressed={p.fee?.typeId === f.typeId} onClick={() => p.setFee(f)}>
                  <span>{(lang === 'ar' ? f.nameAr ?? f.nameEn : f.nameEn ?? f.nameAr) ?? T('visit')}</span>
                  <span class="muted">{T('fee')}: {fmtMoney(f.amountMinor, f.currency, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div class="row"><span class="spacer" /><button type="button" class="primary" disabled={!p.provider || !p.fee} onClick={p.onNext}>{T('next')}</button></div>
    </div>
  );
}

// ---- step 2 ----------------------------------------------------------------------------------------------------------------------------------
function TimeStep({ boot, lang, provider, fee, head, setAnnounce, onBack, onPick }: { boot: Boot; lang: Lang; provider: ProviderCard; fee: Fee; head: HeadRef; setAnnounce: (s: string) => void; onBack: () => void; onPick: (s: Slot) => void }) {
  const T = (k: string) => tr(lang, k);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<string>('');
  const [err, setErr] = useState<Fatal | null>(null);
  const load = useCallback(async () => {
    setState('loading');
    try {
      const from = new Date(Date.now() + offset * 86400_000); const to = new Date(from.getTime() + 14 * 86400_000);
      const r = await get<{ slots: Slot[] }>(`/providers/${encodeURIComponent(provider.id)}/slots?typeId=${encodeURIComponent(fee.typeId)}&from=${from.toISOString()}&to=${to.toISOString()}`);
      const s = r.slots.filter((x) => new Date(x.startsAt) > new Date()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setSlots(s); setDay(s[0] ? dayKey(s[0].startsAt, boot.tz) : ''); setState('ok'); setErr(null);
      setAnnounce(s.length ? `${s.length} ${T('free')}` : T('noSlots'));
    } catch (e) { setErr(fatalOf(e)); setState('error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, fee.typeId, offset]);
  useEffect(() => { void load(); }, [load]);
  const days = useMemo(() => { const m = new Map<string, Slot[]>(); for (const s of slots) { const k = dayKey(s.startsAt, boot.tz); (m.get(k) ?? m.set(k, []).get(k)!).push(s); } return m; }, [slots, boot.tz]);
  return (
    <div>
      <Heading h={head}>{T('chooseDay')}</Heading>
      {state === 'loading' && <div role="status"><span class="sr">{T('loading')}</span><div class="list" aria-hidden="true"><div class="skeleton" /><div class="skeleton" /></div></div>}
      {state === 'error' && <div class="alert err" role="alert">{T(err === 'offline' ? 'offline' : 'slotsFailed')} <button type="button" onClick={() => void load()}>{T('retry')}</button></div>}
      {state === 'ok' && !slots.length && <div class="card" role="status"><p>{T('noSlots')}</p><button type="button" onClick={() => setOffset((o) => o + 14)}>{T('moreDates')}</button></div>}
      {state === 'ok' && slots.length > 0 && (
        <>
          <ul class="days">
            {[...days.keys()].map((k) => (
              <li key={k}><button type="button" class="chip" aria-pressed={day === k} onClick={() => setDay(k)}><span>{fmtDay(days.get(k)![0]!.startsAt, lang, boot.tz)}</span><span class="muted">{days.get(k)!.length} {T('free')}</span></button></li>
            ))}
          </ul>
          <h3 class="muted" id="kx-time-h">{T('chooseTime')}{day && days.get(day) ? ` · ${fmtDayLong(days.get(day)![0]!.startsAt, lang, boot.tz)}` : ''}</h3>
          <ul class="times" aria-labelledby="kx-time-h">
            {(days.get(day) ?? []).map((s) => <li key={s.startsAt}><button type="button" class="chip" onClick={() => onPick(s)}>{fmtTime(s.startsAt, lang, boot.tz)}</button></li>)}
          </ul>
        </>
      )}
      <div class="row"><button type="button" onClick={onBack}>{T('back')}</button></div>
    </div>
  );
}

// ---- step 3 ----------------------------------------------------------------------------------------------------------------------------------
function ReviewStep(p: { boot: Boot; cfg: WidgetConfig; lang: Lang; provider: ProviderCard; fee: Fee; slot: Slot; head: HeadRef; lt: { current: string | null }; refCode: { current: string | null }; setAnnounce: (s: string) => void; onBack: () => void; onRepick: (s: Slot) => void; onDone: (b: BookingView) => void }) {
  const { boot, lang, provider, fee, slot } = p; const T = (k: string) => tr(lang, k);
  const [signed, setSigned] = useState(hasBearer());
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hold, setHold] = useState<BookingView | null>(null);
  const [alts, setAlts] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [consent, setConsent] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [showReq, setShowReq] = useState(false);
  const [expired, setExpired] = useState(false);
  const reserved = useRef('');
  const [profile, setProfile] = useState<'pending' | 'needName' | 'ready'>('pending');
  const [fullName, setFullName] = useState('');
  const [nameErr, setNameErr] = useState(false);

  const reserve = useCallback(async () => {
    setBusy(true); setMsg(null); setAlts(null); setExpired(false);
    try {
      const b = await post<BookingView>('/bookings', { providerId: provider.id, typeId: fee.typeId, startsAt: slot.startsAt, endsAt: slot.endsAt, channel: 'CLINIC_LINK', ...(p.lt.current ? { lt: p.lt.current } : {}) });
      setHold(b); p.setAnnounce(T('holding'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') { setAlts(((e.body.alternatives as Slot[] | undefined) ?? []).filter((s) => s && typeof s.startsAt === 'string').slice(0, 6)); setMsg(T('slotTaken')); }
      else if (e instanceof ApiError && e.status === 401) { setBearer(null); setSigned(false); }
      else if (e instanceof ApiError && e.code === 'WIDGET_HOLD_LIMIT') setMsg(T('errHold'));
      else if (e instanceof ApiError && (e.code === 'CLINIC_SYSTEM_BUSY')) setMsg(T('errUnavailable'));
      else setMsg(T(fatalOf(e) === 'offline' ? 'offline' : fatalOf(e) === 'errRate' ? 'errRate' : 'errGeneric'));
    } finally { setBusy(false); }
  }, [provider.id, fee.typeId, slot.startsAt, slot.endsAt, p.lt]);

  // low-friction registration: Passport knows the phone (and usually the name); creating the Kiorex profile is one read, a name is asked only when it is missing
  useEffect(() => {
    if (!signed || profile !== 'pending') return;
    get<{ nameEn: string | null }>('/me/profile').then((pr) => setProfile(pr.nameEn && pr.nameEn.trim() ? 'ready' : 'needName')).catch((e) => { if (e instanceof ApiError && e.status === 401) { setBearer(null); setSigned(false); } else setMsg(T('errGeneric')); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed, profile]);
  const saveName = async () => {
    if (!fullName.trim()) { setNameErr(true); return; }
    setBusy(true);
    try { await call('PUT', '/me/profile', { nameEn: fullName.trim(), preferredLocale: lang }); setProfile('ready'); } catch { setMsg(T('errGeneric')); } finally { setBusy(false); }
  };

  // hold the slot as soon as the visitor is signed in and has a profile (one hold per chosen time)
  useEffect(() => { if (signed && profile === 'ready' && reserved.current !== slot.startsAt) { reserved.current = slot.startsAt; setHold(null); void reserve(); } }, [signed, profile, slot.startsAt, reserve]);

  // countdown of the existing 5-minute hold
  useEffect(() => {
    if (!hold?.holdExpiresAt) return;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(hold.holdExpiresAt!).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 60 || s === 15) p.setAnnounce(`${T('timeLeft')} ${fmtClock(s)}`);
      if (s === 0) { setExpired(true); setHold(null); }
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold?.holdExpiresAt]);

  const signIn = () => {
    setMsg(null);
    if (!isReady()) { void discover(boot.authority).then(() => setMsg(null)).catch(() => setMsg(T('errGeneric'))); setMsg(T('loading')); return; }
    try {
      setSigning(true);
      const s = startLogin({ clientId: boot.clientId, redirectUri: `${boot.self}/v1/embed/auth/callback`, locale: lang, self: boot.self });
      s.done.then((r) => { setBearer(r.accessToken); setSigned(true); }).catch((e) => setMsg(e instanceof ApiError && e.code === 'CANCELLED' ? T('signInCancelled') : T('errGeneric'))).finally(() => setSigning(false));
    } catch (e) { setSigning(false); setMsg(e instanceof ApiError && e.code === 'POPUP_BLOCKED' ? T('signInBlocked') : T('errGeneric')); }
  };

  const confirm = async () => {
    if (!hold) return;
    if (!consent) { setShowReq(true); return; }
    setBusy(true); setMsg(null);
    try {
      const b = await post<BookingView>(`/bookings/${encodeURIComponent(hold.id)}/confirm`, { marketplaceConsent: true, remindersConsent: reminders });
      if (analytics) void post('/growth/v1/touch', { landingKind: 'WIDGET', ...(p.lt.current ? { lt: p.lt.current } : {}), ...(p.refCode.current ? { ref: p.refCode.current } : {}) }).catch(() => undefined);
      p.onDone(b);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') { setAlts(((e.body.alternatives as Slot[] | undefined) ?? []).slice(0, 6)); setHold(null); setMsg(T('slotTaken')); }
      else if (e instanceof ApiError && e.code === 'HOLD_EXPIRED') { setHold(null); setExpired(true); }
      else setMsg(T(e instanceof ApiError && e.status === 0 ? 'offline' : e instanceof ApiError && e.code === 'CLINIC_SYSTEM_BUSY' ? 'errUnavailable' : 'errGeneric')); // the same confirm may be repeated: it is idempotent
    } finally { setBusy(false); }
  };

  return (
    <div>
      <Heading h={p.head}>{signed ? T('holding') : T('signInTitle')}</Heading>
      <div class="card">
        <h3 class="muted">{T('summary')}</h3>
        <dl>
          <dt>{T('who')}</dt><dd>{nameOf(provider, lang)}</dd>
          <dt>{T('visit')}</dt><dd>{(lang === 'ar' ? fee.nameAr ?? fee.nameEn : fee.nameEn ?? fee.nameAr) ?? ''} · {fmtMoney(fee.amountMinor, fee.currency, lang)}</dd>
          <dt>{T('when')}</dt><dd>{fmtDayLong(slot.startsAt, lang, boot.tz)}, {fmtTime(slot.startsAt, lang, boot.tz)}</dd>
        </dl>
      </div>
      {msg && <div class="alert warn" role="alert">{msg}</div>}
      {expired && <div class="alert warn" role="alert">{T('expired')}</div>}
      {alts && alts.length > 0 && (
        <div><h3 class="muted">{T('alternatives')}</h3>
          <ul class="times">{alts.map((s) => <li key={s.startsAt}><button type="button" class="chip" onClick={() => { reserved.current = ''; p.onRepick(s); setAlts(null); setMsg(null); }}>{fmtDay(s.startsAt, lang, boot.tz)} {fmtTime(s.startsAt, lang, boot.tz)}</button></li>)}</ul>
        </div>
      )}
      {!signed && (
        <div class="card"><p>{T('signInBody')}</p>
          <button type="button" class="primary" onClick={signIn} disabled={signing}>{signing ? T('signingIn') : T('signIn')}</button>
        </div>
      )}
      {signed && profile === 'needName' && (
        <div class="card"><label for="kx-name">{T('nameLabel')}</label>
          <input id="kx-name" type="text" autocomplete="name" value={fullName} aria-required="true" aria-invalid={nameErr} aria-describedby="kx-name-h" onInput={(e) => { setFullName((e.target as HTMLInputElement).value); setNameErr(false); }} />
          <div id="kx-name-h" class="muted">{T('nameHelp')}</div>
          {nameErr && <div class="alert err" role="alert">{T('nameRequired')}</div>}
          <div class="row"><button type="button" class="primary" disabled={busy} onClick={() => void saveName()}>{T('saveContinue')}</button></div>
        </div>
      )}
      {signed && !hold && busy && <div role="status"><span class="sr">{T('loading')}</span><div class="skeleton" /></div>}
      {signed && hold && (
        <div>
          <p class="muted">{T('timeLeft')}: <span class="timer" role="timer" aria-label={`${T('timeLeft')} ${fmtClock(left)}`}>{fmtClock(left)}</span></p>
          <div class="field"><input id="kx-consent" type="checkbox" checked={consent} aria-required="true" aria-invalid={showReq && !consent} aria-describedby={showReq && !consent ? 'kx-req' : undefined} onChange={(e) => setConsent((e.target as HTMLInputElement).checked)} />
            <label for="kx-consent">{T('consent')} <span class="muted">({T('consentDraft')})</span></label></div>
          {showReq && !consent && <div id="kx-req" class="alert err" role="alert">{T('required')}</div>}
          <div class="field"><input id="kx-rem" type="checkbox" checked={reminders} onChange={(e) => setReminders((e.target as HTMLInputElement).checked)} /><label for="kx-rem">{T('reminders')}</label></div>
          <div class="field"><input id="kx-ana" type="checkbox" checked={analytics} onChange={(e) => setAnalytics((e.target as HTMLInputElement).checked)} /><label for="kx-ana">{T('analytics')}</label></div>
        </div>
      )}
      <div class="row">
        <button type="button" onClick={p.onBack}>{T('back')}</button><span class="spacer" />
        {signed && hold && <button type="button" class="primary" disabled={busy} onClick={() => void confirm()}>{busy ? T('confirming') : T('confirm')}</button>}
        {signed && !hold && !busy && (expired || alts) && <button type="button" onClick={p.onBack}>{T('pickAnother')}</button>}
      </div>
    </div>
  );
}

// ---- step 4 ----------------------------------------------------------------------------------------------------------------------------------
function DoneStep({ boot, cfg, lang, provider, fee, booking, head, onAgain }: { boot: Boot; cfg: WidgetConfig; lang: Lang; provider: ProviderCard; fee: Fee; booking: BookingView; head: HeadRef; onAgain: () => void }) {
  const T = (k: string) => tr(lang, k);
  const [pay, setPay] = useState<string | null>(null);
  const deepLink = `${cfg.patientUrl}/appointment/${encodeURIComponent(booking.id)}`;
  const payDeposit = async () => {
    try { const r = await post<{ checkoutUrl: string | null }>(`/bookings/${encodeURIComponent(booking.id)}/deposit-checkout`); if (r.checkoutUrl) window.open(r.checkoutUrl, '_blank', 'noopener,noreferrer'); } catch { setPay(T('errGeneric')); }
  };
  return (
    <div>
      <Heading h={head}>{T('doneTitle')}</Heading>
      <div class="alert ok" role="status"><strong>{booking.status === 'CONFIRMED' ? T('doneConfirmed') : T('donePending')}</strong></div>
      <div class="card"><dl>
        <dt>{T('who')}</dt><dd>{nameOf(provider, lang)}</dd>
        <dt>{T('visit')}</dt><dd>{(lang === 'ar' ? fee.nameAr ?? fee.nameEn : fee.nameEn ?? fee.nameAr) ?? ''}</dd>
        <dt>{T('when')}</dt><dd>{fmtDayLong(booking.startsAt, lang, boot.tz)}, {fmtTime(booking.startsAt, lang, boot.tz)}</dd>
      </dl></div>
      <p class="muted">{T('doneText')}</p>
      {booking.depositStatus === 'REQUIRED' && <div class="alert warn"><p>{T('depositNote')}</p><button type="button" class="primary" onClick={() => void payDeposit()}>{T('deposit')}</button>{pay && <div role="alert">{pay}</div>}</div>}
      <div class="row">
        <a class="btn primary" href={deepLink} target="_blank" rel="noopener noreferrer">{T('openApp')}</a>
        <button type="button" onClick={onAgain}>{T('bookAnother')}</button>
      </div>
      <p class="muted">{T('openAppHint')}</p>
    </div>
  );
}
