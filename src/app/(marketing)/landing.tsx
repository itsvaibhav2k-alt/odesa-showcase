/* eslint-disable @next/next/no-img-element */
/**
 * Odesa marketing landing (v3) — faithful port of the approved design
 * artifact ("Odesa Landing v3 + nano artifacts"). Warm paper / navy / gold,
 * editorial, operator-led. Styles live in landing.module.css (scoped under
 * .lp); the `c()` helper maps the artifact's BEM class strings to the scoped
 * module classes so the markup stays faithful to the source.
 *
 * Decorative 3D renders are positioned free-floating art, so they use plain
 * <img> with empty alt + aria-hidden rather than next/image.
 */

import Link from 'next/link';

import { c } from './cx';
import WaitlistForm from './waitlist-form';

const ASSETS = '/odesa_landing_3d_assets';

const SKYLINE = [38, 62, 46, 74, 58, 42, 70, 50, 64, 38, 58];
const WINDOWS_OFF = new Set([2, 9, 10, 18, 21, 32]);

export default function Landing() {
  return (
    <div className={c('lp')}>
      <div className={c('anno')} role="region" aria-label="Announcement">
        <b>Now in pilot</b>
        Onboarding a small cohort of owners with 5–50 units this quarter.
        <a href="#waitlist">Request access →</a>
      </div>

      <header className={c('nav')}>
        <div className={c('wrap nav__inner')}>
          <a className={c('brand')} href="#top" aria-label="Odesa home">
            <span className={c('mark')} aria-hidden="true" />
            Odesa
          </a>
          <nav className={c('nav__links')} aria-label="Primary">
            <a href="#operator">Operator</a>
            <a href="#examples">Examples</a>
            <a href="#briefing">Briefing</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className={c('nav__right')}>
            <Link className={c('nav__signin')} href="/login">
              Sign in
            </Link>
            <a className={c('btn btn--primary')} href="#waitlist">
              Request access
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ============ HERO ============ */}
        <section className={c('hero')} aria-labelledby="hero-title">
          <div className={c('wrap hero__grid')}>
            <div>
              <p className={c('eyebrow')}>24/7 property operations, live</p>
              <h1 id="hero-title" className={c('hero__title')}>
                The AI operator for landlords who{' '}
                <span className={c('italic-navy')}>want their nights back.</span>
              </h1>
              <p className={c('lead')}>
                Odesa answers tenant calls and texts, follows rent, coordinates maintenance, and
                sends one operator briefing with the few things that actually need your attention.
              </p>
              <div className={c('hero__actions')}>
                <a className={c('btn btn--primary btn--lg')} href="#waitlist">
                  Request access
                </a>
                <a className={c('btn btn--secondary btn--lg')} href="#briefing">
                  See a Monday briefing
                </a>
                <span className={c('hero__meta')}>
                  <span className={c('dot')} aria-hidden="true" />
                  Live in 6 portfolios this week
                </span>
              </div>
              <div className={c('trust-row')} aria-label="What Odesa covers">
                <div className={c('trust')}>
                  <strong>24/7</strong>
                  <span>Tenant voice &amp; SMS coverage in English and Spanish</span>
                </div>
                <div className={c('trust')}>
                  <strong>3 lanes</strong>
                  <span>Calls, rent, maintenance — handled, not just logged</span>
                </div>
                <div className={c('trust')}>
                  <strong>1 brief</strong>
                  <span>One weekly note with the decisions only you can make</span>
                </div>
              </div>
            </div>

            <div className={c('stage')} aria-label="Odesa operator preview">
              <div className={c('stage__atmosphere')} aria-hidden="true">
                <span className={c('atmosphere-tag')}>
                  <i />
                  Portfolio watched
                </span>
                <span className={c('units-tag')}>
                  <b>28</b> units · 4 properties
                </span>
                <div className={c('skyline')}>
                  {SKYLINE.map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <img
                  className={c('artifact-img stage__asset stage__asset--building')}
                  src={`${ASSETS}/hero-building.png`}
                  alt=""
                  aria-hidden="true"
                />
                <img
                  className={c('artifact-img stage__asset stage__asset--orb')}
                  src={`${ASSETS}/orb-operator.png`}
                  alt=""
                  aria-hidden="true"
                />
                <div className={c('building')}>
                  <div className={c('building__cornice')} />
                  <div className={c('building__windows')}>
                    {Array.from({ length: 35 }).map((_, i) => (
                      <i key={i} className={WINDOWS_OFF.has(i) ? c('off') : undefined} />
                    ))}
                  </div>
                  <div className={c('building__base')} />
                  <div className={c('building__door')} />
                </div>
                <div className={c('ground')} />
              </div>

              <article className={c('operator-card')} aria-label="Odesa operator desk example">
                <div className={c('operator-top')}>
                  <span className={c('operator-title')}>
                    <span className={c('dot')} aria-hidden="true" />
                    Odesa operator desk
                  </span>
                  <span className={c('live')}>Live now</span>
                </div>
                <div className={c('operator-body')}>
                  <div className={c('call')}>
                    <div className={c('call-row')}>
                      <span className={c('call-label')}>Tenant</span>
                      <p className={c('bubble')}>
                        Water is coming through the bathroom ceiling — Unit 3B.
                      </p>
                    </div>
                    <div className={c('call-row')}>
                      <span className={c('call-label')}>Odesa</span>
                      <p className={c('bubble bubble--navy')}>
                        <span className={c('tag')}>Emergency · classified</span>
                        Plumber dispatched. Owner notified. Tenant told 38 min ETA.
                      </p>
                    </div>
                    <div className={c('call-row')}>
                      <span className={c('call-label')}>Vendor</span>
                      <p className={c('bubble')}>
                        On site. Stopped active leak. Drywall photo attached.
                      </p>
                    </div>
                  </div>
                  <div className={c('metric-stack')} aria-label="Today">
                    <div className={c('mini-metric')}>
                      <b>14s</b>
                      <span>median pickup</span>
                    </div>
                    <div className={c('mini-metric')}>
                      <b>8</b>
                      <span>items handled today</span>
                    </div>
                    <div className={c('mini-metric')}>
                      <b>0</b>
                      <span>urgent left for you</span>
                    </div>
                  </div>
                </div>
              </article>

              <aside className={c('briefing-badge')} aria-label="Monday briefing preview">
                <small>Monday briefing · 7:00 AM</small>
                <p>Three things changed. One needs you.</p>
                <span>Odesa turns the week into decisions, not another dashboard.</span>
              </aside>
            </div>
          </div>
        </section>

        {/* ============ LOGO STRIP ============ */}
        <section className={c('logos')} aria-label="Plays nicely with">
          <div className={c('wrap logos__inner')}>
            <p className={c('logos__label')}>
              Connects to the tools small landlords already run on
            </p>
            <div className={c('logos__row')}>
              {['Stripe', 'Plaid', 'Twilio', 'QuickBooks', 'Google Cal', 'Buildium'].map((name) => (
                <span key={name} className={c('logo-pill')}>
                  <span className={c('word')}>{name}</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ============ NOT A DASHBOARD ============ */}
        <section className={c('section')} id="operator">
          <div className={c('wrap')}>
            <div className={c('section-head')}>
              <div>
                <span className={c('eyebrow eyebrow--quiet section-head__top')}>
                  The shape of the product
                </span>
                <h2>
                  Not a dashboard.
                  <br />
                  An operator.
                </h2>
              </div>
              <p>
                Most landlord software stores work. Odesa moves it — listening, classifying,
                routing, following up, and only interrupting you when judgment is actually required.
              </p>
            </div>

            <div className={c('cap-grid')}>
              <article className={c('cap')}>
                <div className={c('cap__visual cap__visual--voice')} aria-hidden="true">
                  <img
                    className={c('artifact-img cap__artifact')}
                    src={`${ASSETS}/feat-tenant-messages.png`}
                    alt=""
                  />
                </div>
                <div className={c('cap__body')}>
                  <span className={c('num')}>01 / Voice + SMS</span>
                  <h3>Answers tenants first.</h3>
                  <p className={c('cap__lede')}>
                    Calls, texts, lease questions, maintenance triage. Odesa handles the routine and
                    hands you the summary.
                  </p>
                  <ul>
                    <li>English and Spanish coverage</li>
                    <li>Emergency rules you set, never invented</li>
                    <li>Transcript and disposition after every call</li>
                  </ul>
                </div>
              </article>

              <article className={c('cap')}>
                <div className={c('cap__visual cap__visual--rent')} aria-hidden="true">
                  <img
                    className={c('artifact-img cap__artifact')}
                    src={`${ASSETS}/feat-rent.png`}
                    alt=""
                  />
                </div>
                <div className={c('cap__body')}>
                  <span className={c('num')}>02 / Rent operations</span>
                  <h3>Keeps rent moving.</h3>
                  <p className={c('cap__lede')}>
                    Reminders, follow-ups, late-fee windows, payment-plan prompts, and one clean
                    status line for every unit.
                  </p>
                  <ul>
                    <li>Stripe and ACH-aware follow-up cadence</li>
                    <li>Late balances named clearly, never theatrical</li>
                    <li>Legal thresholds always escalate to you</li>
                  </ul>
                </div>
              </article>

              <article className={c('cap')}>
                <div className={c('cap__visual cap__visual--maint')} aria-hidden="true">
                  <img
                    className={c('artifact-img cap__artifact')}
                    src={`${ASSETS}/feat-maintenance.png`}
                    alt=""
                  />
                </div>
                <div className={c('cap__body')}>
                  <span className={c('num')}>03 / Maintenance</span>
                  <h3>Dispatches without drama.</h3>
                  <p className={c('cap__lede')}>
                    Urgency is classified, preferred vendors are contacted, tenants get updates, and
                    silence gets surfaced before it becomes a second problem.
                  </p>
                  <ul>
                    <li>Vendor follow-up loops with timeouts</li>
                    <li>Tenant status pings without you typing</li>
                    <li>Owner escalation for true emergencies</li>
                  </ul>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ============ EXAMPLES ============ */}
        <section
          className={c('section section--warm')}
          id="examples"
          style={{ paddingTop: 80, paddingBottom: 80 }}
        >
          <div className={c('wrap')}>
            <div className={c('examples__title')}>
              <h3>A real Tuesday on Odesa.</h3>
              <div className={c('examples__rule')} />
              <p className={c('examples__caption')}>
                Six moments from one operator day. Specific, small, real.
              </p>
            </div>
            <div className={c('examples__grid')}>
              <article className={c('example')}>
                <span className={c('when')}>
                  <i />
                  06:48 · Call
                </span>
                <p className={c('meta')}>
                  Tenant called from Unit 2A about a noise complaint from next door.
                </p>
                <p className={c('what')}>Answered, logged, sent to owner inbox — no escalation.</p>
              </article>

              <article className={c('example')}>
                <span className={c('when urgent')}>
                  <i />
                  09:12 · Emergency
                </span>
                <p className={c('meta')}>
                  Active leak reported at Unit 3B. Classified as emergency by tenant keyword.
                </p>
                <p className={c('what')}>Plumber dispatched. Owner texted. Tenant updated.</p>
              </article>

              <article className={c('example')}>
                <span className={c('when routine')}>
                  <i />
                  11:30 · Vendor
                </span>
                <p className={c('meta')}>
                  Electrician silent on Unit 9 quote for 6 hours past window.
                </p>
                <p className={c('what')}>Nudge sent. Backup vendor warmed up.</p>
              </article>

              <article className={c('example')}>
                <span className={c('when')}>
                  <i />
                  14:05 · Rent
                </span>
                <p className={c('meta')}>
                  Three card declines this morning. Reminders sent with payment-plan link.
                </p>
                <p className={c('what')}>2 of 3 resolved by 6 PM. One owner ping.</p>
              </article>

              <article className={c('example')}>
                <span className={c('when')}>
                  <i />
                  17:20 · Lease
                </span>
                <p className={c('meta')}>Unit 11 lease ends in 47 days. Renewal sequence opened.</p>
                <p className={c('what')}>Renewal email drafted. Held for your sign-off.</p>
              </article>

              <article className={c('example')}>
                <span className={c('when')}>
                  <i />
                  22:41 · Quiet check
                </span>
                <p className={c('meta')}>
                  Portfolio scanned: rent ledger, work orders, vendor silence, lease expiries.
                </p>
                <p className={c('what')}>All clear. Logged for the Monday briefing.</p>
              </article>
            </div>
          </div>
        </section>

        {/* ============ BRIEFING ============ */}
        <section className={c('section')} id="briefing">
          <div className={c('wrap briefing')}>
            <div className={c('briefing-copy')}>
              <span className={c('eyebrow')}>The signature surface</span>
              <h2 className={c('section-title')}>
                One briefing.
                <br />
                What changed.
                <br />
                What to do.
              </h2>
              <p>
                When there is nothing urgent, Odesa still shows what it checked. Rent, calls, work
                orders, vendor silence, expiring leases, and tenant messages compress into a short
                operator note.
              </p>
              <ul className={c('briefing-list')}>
                <li>
                  <b>Concrete checks, not empty states</b>
                  <span>If the portfolio is quiet, the product still feels alive.</span>
                </li>
                <li>
                  <b>Owner judgment stays visible</b>
                  <span>
                    Evictions, legal threats, disputes, and exceptions never go autonomous.
                  </span>
                </li>
                <li>
                  <b>Every week earns a decision</b>
                  <span>One recommended action with enough context to say yes or no.</span>
                </li>
              </ul>
            </div>

            <div className={c('briefing-panel')}>
              <img
                className={c('artifact-img briefing-artifact')}
                src={`${ASSETS}/portfolio-overview.png`}
                alt=""
                aria-hidden="true"
              />
              <div className={c('panel-head')}>
                <b>Monday operator briefing</b>
                <span className={c('stamp')}>May 25 · 7:00 AM</span>
              </div>
              <div className={c('panel-body')}>
                <div className={c('brief-grid')}>
                  <div className={c('brief-card is-attn')}>
                    <strong>2</strong>
                    <em>tenant issues need your review</em>
                  </div>
                  <div className={c('brief-card')}>
                    <strong>96%</strong>
                    <em>rent collected for May</em>
                  </div>
                  <div className={c('brief-card')}>
                    <strong>4</strong>
                    <em>vendor follow-ups sent</em>
                  </div>
                  <div className={c('brief-card')}>
                    <strong>0</strong>
                    <em>emergencies unresolved</em>
                  </div>
                </div>

                <div className={c('recommendation')}>
                  <small>Recommended action</small>
                  <p>
                    Approve the Unit 3B plumbing invoice ($420) and renew the preferred-vendor
                    backup list before Friday.
                  </p>
                  <div className={c('rec-actions')}>
                    <button className={c('rec-btn')} type="button">
                      Approve
                    </button>
                    <button className={c('rec-btn ghost')} type="button">
                      See context
                    </button>
                  </div>
                </div>

                <div className={c('timeline')} role="list">
                  <div role="listitem">
                    <time>Checked</time>
                    <span>Tenant inbox, rent ledger, work orders, lease dates</span>
                    <b className={c('clear')}>Clear</b>
                  </div>
                  <div role="listitem">
                    <time>Watching</time>
                    <span>Unit 7A partial payment plan due Wednesday</span>
                    <b className={c('open')}>Open</b>
                  </div>
                  <div role="listitem">
                    <time>Escalated</time>
                    <span>Vendor silence on landscaping quote · 2 days</span>
                    <b className={c('owner')}>Owner</b>
                  </div>
                  <div role="listitem">
                    <time>Quietly done</time>
                    <span>11 routine tenant questions answered</span>
                    <b className={c('clear')}>—</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ DARK SECTION (no building image behind proof grid) ============ */}
        <section className={c('dark')}>
          <div className={c('wrap dark-grid')}>
            <div>
              <h2>Built for owners with 5–50 units.</h2>
              <p className={c('lead-d')}>
                Small enough that every call still hits your phone. Big enough that doing everything
                yourself is no longer cute. Odesa is the operating layer between tenant chaos and
                your week — not a CRM, not a chatbot, not another tab.
              </p>
              <div className={c('dark__cta')}>
                <a className={c('btn btn--primary btn--lg')} href="#waitlist">
                  Request access
                </a>
                <a className={c('btn btn--ghost btn--lg')} href="#examples">
                  See an operator day
                </a>
              </div>
            </div>
            <div className={c('proof-grid')}>
              <div className={c('proof')}>
                <strong>first ring</strong>
                <span>Tenant calls are answered instead of rolling to voicemail.</span>
              </div>
              <div className={c('proof')}>
                <strong>human rules</strong>
                <span>You decide what Odesa can handle and what must escalate.</span>
              </div>
              <div className={c('proof')}>
                <strong>weekly</strong>
                <span>The product compresses portfolio noise into an owner note.</span>
              </div>
              <div className={c('proof')}>
                <strong>quiet</strong>
                <span>No feed, no red-dot treadmill, no dashboard babysitting.</span>
              </div>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section className={c('section')}>
          <div className={c('wrap')}>
            <div className={c('section-head')}>
              <div>
                <span className={c('eyebrow eyebrow--quiet section-head__top')}>
                  The operating loop
                </span>
                <h2>How it actually works.</h2>
              </div>
              <p>
                A simple loop: connect the channels, set rules in plain English, let Odesa work,
                review only the exceptions.
              </p>
            </div>
            <div className={c('how')}>
              <article className={c('step')}>
                <div className={c('step__num')}>
                  <span className={c('pill')}>Step 01</span>
                  <span className={c('rule')} />
                </div>
                <h3>Forward calls and texts.</h3>
                <p>
                  Give tenants one number. Odesa answers, labels intent, and creates the operating
                  record — no app for the tenant.
                </p>
              </article>
              <article className={c('step')}>
                <div className={c('step__num')}>
                  <span className={c('pill')}>Step 02</span>
                  <span className={c('rule')} />
                </div>
                <h3>Set owner rules.</h3>
                <p>
                  Emergency keywords, vendor preferences, rent-follow-up tone, and categories that
                  always escalate to you.
                </p>
              </article>
              <article className={c('step')}>
                <div className={c('step__num')}>
                  <span className={c('pill')}>Step 03</span>
                  <span className={c('rule')} />
                </div>
                <h3>Run the week.</h3>
                <p>
                  Routine tenant questions, rent reminders, maintenance dispatch, and vendor
                  follow-up happen in the background.
                </p>
              </article>
              <article className={c('step')}>
                <div className={c('step__num')}>
                  <span className={c('pill')}>Step 04</span>
                  <span className={c('rule')} />
                </div>
                <h3>Read the briefing.</h3>
                <p>
                  Odesa summarizes what changed, what was checked, and the one thing that genuinely
                  needs your judgment.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ============ PRICING ============ */}
        <section className={c('section section--soft')} id="pricing">
          <div className={c('wrap')}>
            <div className={c('section-head')}>
              <div>
                <span className={c('eyebrow eyebrow--quiet section-head__top')}>Pricing</span>
                <h2>Pricing that scales with your doors.</h2>
              </div>
              <p>
                Start with the operating lane you need most. Expand as Odesa earns more trust across
                the portfolio.
              </p>
            </div>
            <div className={c('pricing')}>
              <article className={c('price')}>
                <h3>Starter</h3>
                <div className={c('price-tag')}>
                  <strong>$199</strong>
                  <em>/ month + $6 per unit</em>
                </div>
                <p className={c('desc')}>
                  Voice + maintenance triage for solo landlords up to 15 units.
                </p>
                <ul>
                  <li>24/7 voice and SMS coverage</li>
                  <li>Maintenance triage and dispatch</li>
                  <li>Weekly owner briefing</li>
                  <li>Owner escalation rules</li>
                </ul>
                <a className={c('btn btn--primary')} href="#waitlist">
                  Request access
                </a>
                <p className={c('price__foot')}>14-day operator pilot</p>
              </article>

              <article className={c('price price--featured')}>
                <span className={c('price__tag')}>Most owners pick this</span>
                <h3>Operator</h3>
                <div className={c('price-tag')}>
                  <strong>$299</strong>
                  <em>/ month + $6 per unit</em>
                </div>
                <p className={c('desc')}>
                  Everything in Starter, plus rent operations and portfolio signal monitoring.
                </p>
                <ul>
                  <li>Everything in Starter</li>
                  <li>Rent follow-up workflows</li>
                  <li>Vendor follow-up loops with timeouts</li>
                  <li>Portfolio signal monitoring</li>
                  <li>Lease renewal sequences</li>
                </ul>
                <a className={c('btn btn--primary')} href="#waitlist">
                  Request access
                </a>
                <p className={c('price__foot')}>14-day operator pilot</p>
              </article>

              <article className={c('price')}>
                <h3>Managed</h3>
                <div className={c('price-tag')}>
                  <strong>Custom</strong>
                  <em>for higher-touch portfolios</em>
                </div>
                <p className={c('desc')}>
                  A human reviewer pairs with Odesa on the calls that matter most.
                </p>
                <ul>
                  <li>Human reviewer on escalations</li>
                  <li>Exception handling support</li>
                  <li>Move-out and renewal support</li>
                  <li>Monthly operator review with founder</li>
                </ul>
                <a className={c('btn btn--secondary')} href="#waitlist">
                  Talk to us
                </a>
                <p className={c('price__foot')}>For owners with 50–200 units</p>
              </article>
            </div>
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section className={c('section')} id="faq">
          <div className={c('wrap faq')}>
            <div className={c('faq__head')}>
              <span className={c('eyebrow eyebrow--quiet section-head__top')}>
                Common questions
              </span>
              <h2 className={c('section-title')}>What owners actually ask before pilots.</h2>
              <p>
                Short answers. Long ones, including the legal and escalation logic, ship before
                pilot kickoff.
              </p>
            </div>
            <div className={c('faq__list')}>
              <details className={c('faq__item')} open>
                <summary>
                  Does Odesa make legal or eviction decisions on its own?
                  <span className={c('plus')} aria-hidden="true" />
                </summary>
                <p className={c('faq__answer')}>
                  No. Legal thresholds, eviction filings, lease disputes, and anything tied to
                  ledger corrections always escalate to you. Odesa drafts; you decide.
                </p>
              </details>

              <details className={c('faq__item')}>
                <summary>
                  What if a tenant just wants a human?
                  <span className={c('plus')} aria-hidden="true" />
                </summary>
                <p className={c('faq__answer')}>
                  Odesa is trained to hear that and route to you (or your team) with full context —
                  caller, unit, intent, transcript so far. The tenant never has to re-explain.
                </p>
              </details>

              <details className={c('faq__item')}>
                <summary>
                  How do you handle emergencies at 3 AM?
                  <span className={c('plus')} aria-hidden="true" />
                </summary>
                <p className={c('faq__answer')}>
                  Emergency keywords trigger your escalation tree first: page the on-call vendor,
                  text you, update the tenant, and post the incident to the briefing. Nothing waits
                  for morning.
                </p>
              </details>

              <details className={c('faq__item')}>
                <summary>
                  Will it work with my existing PM software?
                  <span className={c('plus')} aria-hidden="true" />
                </summary>
                <p className={c('faq__answer')}>
                  Yes. Odesa connects to Stripe, Plaid, Twilio, QuickBooks, and the common PM systems
                  (Buildium, AppFolio). It sits in front of them, not on top of them.
                </p>
              </details>

              <details className={c('faq__item')}>
                <summary>
                  Can I listen to a real call before pilot?
                  <span className={c('plus')} aria-hidden="true" />
                </summary>
                <p className={c('faq__answer')}>
                  Yes — pilot kickoff includes recorded examples (with consent) across the three
                  lanes: a Spanish maintenance call, a rent follow-up, and an after-hours emergency.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section className={c('cta')} id="waitlist">
          <div className={c('wrap cta__inner')}>
            <img
              className={c('artifact-img cta__artifact cta__artifact--left')}
              src={`${ASSETS}/feat-tenant-messages.png`}
              alt=""
              aria-hidden="true"
            />
            <img
              className={c('artifact-img cta__artifact cta__artifact--right')}
              src={`${ASSETS}/orb-operator.png`}
              alt=""
              aria-hidden="true"
            />
            <span className={c('eyebrow')}>Pilot cohort · Q3</span>
            <h2 style={{ marginTop: 18 }}>
              Your tenants answered. <span className={c('italic-navy')}>Your week briefed.</span>
            </h2>
            <p>
              Odesa is onboarding small landlords and lightweight portfolio operators. Leave your
              email and door count — we&apos;ll walk through exactly what Odesa can safely run for
              you.
            </p>
            <WaitlistForm />
            <p className={c('cta__fineprint')}>No demo theatre · 14-day pilot · You keep your number</p>
          </div>
        </section>
      </main>

      <footer className={c('footer')}>
        <div className={c('wrap')}>
          <div className={c('footer__inner')}>
            <div>
              <a className={c('brand')} href="#top">
                <span className={c('mark')} aria-hidden="true" />
                Odesa
              </a>
              <p className={c('footer__tag')}>
                The AI property operator for landlords who want their nights back.
              </p>
            </div>
            <div className={c('footer__col')}>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#operator">Operator desk</a>
                </li>
                <li>
                  <a href="#examples">A day on Odesa</a>
                </li>
                <li>
                  <a href="#briefing">Monday briefing</a>
                </li>
                <li>
                  <a href="#pricing">Pricing</a>
                </li>
              </ul>
            </div>
            <div className={c('footer__col')}>
              <h4>Company</h4>
              <ul>
                <li>
                  <a href="#">About</a>
                </li>
                <li>
                  <a href="#">Operating principles</a>
                </li>
                <li>
                  <a href="#">Security &amp; data</a>
                </li>
                <li>
                  <a href="#">Contact</a>
                </li>
              </ul>
            </div>
            <div className={c('footer__col')}>
              <h4>Get started</h4>
              <ul>
                <li>
                  <a href="#waitlist">Request access</a>
                </li>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
                <li>
                  <Link href="/login">Sign in</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className={c('footer__bottom')}>
            <span>© 2026 Odesa Operations, Inc.</span>
            <span>Made for owners who answer their own phone.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
