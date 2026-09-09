export type NightGardenPageKey = 'index' | 'work' | 'method' | 'demo' | 'owners' | 'pilot';

export const NIGHT_GARDEN_PAGES: Record<NightGardenPageKey, { pageClass: string; html: string }> = {
  index: { pageClass: "page-home", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work">Work</a>
      <a href="/method">Method</a>
      <a href="/demo">Demo</a>
      <a href="/owners">Owners</a>
      <a href="/pilot">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="/pilot">Request access</a></div>
  </header>

  <main id="top">
    <section class="hero">
      <div class="hero__art"></div><div class="hero__wash"></div><div class="hero__grain"></div>
      <div class="credit">Concept uses a public domain Monet work as temporary art direction evidence</div>
      <div class="hero__content">
        <div class="kicker">The night watch · property operations, live</div>
        <h1>The building sleeps.<br><em>Odesa doesn't.</em></h1>
        <p class="hero__dek">Tenant calls answered. Rent evidence checked. Maintenance records moved forward. By morning, you get one clear note, with only the decisions that need you.</p>
        <div class="hero__actions"><a class="button button--light" href="/pilot">Request pilot access</a><a class="button" href="/demo">Try the sample night</a></div>
      </div>
      <aside class="hero__proof"><div class="hero__proof-label">Illustrative portfolio</div><p>28 sample units · 4 sample properties<br>0 urgent decisions left overnight</p></aside>
    </section>

    <section id="watch" class="chapter watch">
      <div class="chapter__head"><h2>A quiet day,<br>fully observed.</h2><p class="chapter__intro">Odesa listens for the small signals that become expensive silence. It handles the routine, preserves the evidence, and brings judgment back to the owner at the right moment.</p></div>
      <div class="trace">
        <article class="moment"><span class="moment__time">06:48 · CALL</span><i class="moment__mark"></i><h3>Answered. Logged.</h3><p>Noise complaint routed without waking the owner.</p></article>
        <article class="moment"><span class="moment__time">09:12 · EMERGENCY</span><i class="moment__mark"></i><h3>Maintenance logged.</h3><p>Owner review prepared from one verified event.</p></article>
        <article class="moment"><span class="moment__time">11:30 · VENDOR</span><i class="moment__mark"></i><h3>Silence noticed.</h3><p>A backup vendor option surfaced before the quote window closed.</p></article>
        <article class="moment"><span class="moment__time">14:05 · RENT</span><i class="moment__mark"></i><h3>Two resolved.</h3><p>One remaining case held for owner judgment.</p></article>
        <article class="moment"><span class="moment__time">17:20 · LEASE</span><i class="moment__mark"></i><h3>Renewal drafted.</h3><p>Prepared, never sent without your approval.</p></article>
        <article class="moment"><span class="moment__time">22:41 · QUIET CHECK</span><i class="moment__mark"></i><h3>All clear.</h3><p>Rent, calls, work orders and lease dates checked.</p></article>
      </div>
    </section>

    <section id="portal" class="portal">
      <div class="portal__head"><h2>The work,<br>in three views.</h2><p>The overnight story lives inside the product. Three of the places Odesa operates. Open any of them to see the full chapter on Work.</p></div>
      <div class="portal__strip">
        <a class="portal__item" href="/work#calls">
          <img src="/night-garden/product-screens/calls-detail.png" alt="Odesa call detail showing a tenant transcript, structured call summary, and next action" />
          <div class="portal__scrim"></div>
          <div class="portal__label"><span class="act__num">VOICE + SMS</span><h3>Calls &amp; texts</h3><span class="portal__more">See the work</span></div>
        </a>
        <a class="portal__item" href="/work#rent">
          <img src="/night-garden/product-screens/rent.png" alt="Odesa rent operations page showing portfolio balances and follow up statuses" />
          <div class="portal__scrim"></div>
          <div class="portal__label"><span class="act__num">RENT</span><h3>Rent cadence</h3><span class="portal__more">See the work</span></div>
        </a>
        <a class="portal__item" href="/work#queue">
          <img src="/night-garden/product-screens/owner-queue.png" alt="Odesa Owner Queue showing a tenant message decision with evidence and approval controls" />
          <div class="portal__scrim"></div>
          <div class="portal__label"><span class="act__num">OWNER QUEUE</span><h3>Your decisions</h3><span class="portal__more">See the work</span></div>
        </a>
      </div>
    </section>

    <section id="morning" class="chapter morning">
      <div class="briefing">
        <div class="briefing__copy"><span class="kicker">Morning · 7:00 AM</span><h2>One note.<br>What changed.<br>What to do.</h2><p class="chapter__intro">The night's diffuse signals become one crisp sheet: what Odesa checked, what it handled, and the one decision that still belongs to you.</p><div class="hero__actions"><a class="button button--navy" href="/method#briefing">How the briefing works</a></div></div>
        <article class="sheet"><div class="sheet__top"><span>Monday operator briefing</span><span>May 25 · 7:00 AM</span></div><div class="sheet__lead">Three things changed.<br>One needs you.</div><div class="sheet__action">Approve the Unit 3B plumbing invoice ($420) and renew the preferred vendor backup list before Friday.</div><div class="sheet__rows"><div class="sheet__row"><span>Checked</span><span>Tenant inbox, rent ledger, work orders, lease dates</span><span>Clear</span></div><div class="sheet__row"><span>Watching</span><span>Unit 7A partial payment plan due Wednesday</span><span>Open</span></div><div class="sheet__row"><span>Quietly done</span><span>11 routine tenant answers prepared</span><span>None</span></div></div><div class="sheet__foot"><span>Prepared by Odesa · 7:00 AM</span><span>The watch resumes tonight</span></div></article>
      </div>
    </section>

    <section id="rules" class="chapter rules">
      <div class="chapter__head"><h2>Human judgment<br>stays visible.</h2><p class="chapter__intro">Odesa works through the night without pretending judgment is a background process. You choose the lanes, the thresholds, and the moments that must stop with you.</p></div>
      <div class="rules-grid">
        <article class="rule"><span class="rule__label">Odesa handles</span><h3>Routine conversations and follow through.</h3></article>
        <article class="rule"><span class="rule__label">Odesa watches</span><h3>Silence, drift, and approaching thresholds.</h3></article>
        <article class="rule"><span class="rule__label">You decide</span><h3>Money, legal exposure, access, and commitments.</h3></article>
      </div>
      <div class="rules__boundary"><span class="rules__boundary-label">Stops with you, always</span><span>Money movement</span><span>Legal exposure</span><span>Property access</span><span>Lease interpretation</span><span>True commitments</span></div>
      <div class="hero__actions" style="margin-top:40px"><a class="button" href="/method#rules">Read the human rules</a></div>
    </section>

    <section class="cta">
      <div class="cta__inner">
        <span class="kicker" style="color:var(--gold-ink)">Pilot cohort · Q3</span>
        <h2>Your nights back.<br>Your week briefed.</h2>
        <p>Odesa is onboarding a small cohort of owners with 5 to 50 units. Bring your number, your rules, and the work that keeps following you home.</p>
        <div class="cta__actions"><a class="button button--navy" href="/pilot">Request pilot access</a><a class="button button--ink" href="/owners">See if it fits you</a></div>
        <div class="cta__note">Small cohort · Guided onboarding · Your rules come first</div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">odesa</a>
        <p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p>
        <p class="footer__creed">Augmentation before autonomy</p>
      </div>
      <nav aria-label="Routes">
        <span class="footer__label">The site</span>
        <a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a>
      </nav>
      <div>
        <span class="footer__label">Access</span>
        <a href="/pilot">Request pilot access</a>
        <a href="/login">Sign in</a>
      </div>
      <div>
        <span class="footer__label">House rules</span>
        <div class="footer__rule">No money moves automatically</div>
        <div class="footer__rule">Emergencies never wait in a queue</div>
        <div class="footer__rule">Legal judgment stays human</div>
        <div class="footer__rule">Renewals are drafted, never sent</div>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>A calmer way to run the night.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>` },
  work: { pageClass: "page-work", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work" aria-current="page">Work</a>
      <a href="/method">Method</a>
      <a href="/demo">Demo</a>
      <a href="/owners">Owners</a>
      <a href="/pilot">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="/pilot">Request access</a></div>
  </header>

  <main id="top">
    <section class="page-hero">
      <div class="page-hero__inner">
        <div class="kicker">The work</div>
        <h1>The work that no longer waits for you.</h1>
        <p class="page-hero__dek">Four places the job used to interrupt your day: calls and texts, rent, maintenance, and the decisions that need you. Here they are in the product, shown with a seeded sample portfolio.</p>
      </div>
      <div class="page-hero__band"></div>
    </section>

    <section class="acts">
      <article class="act act--calls" id="calls">
        <div class="act__product"><img src="/night-garden/product-screens/calls-detail.png" alt="Odesa call detail showing a tenant transcript, structured call summary, and next action" /></div>
        <div class="act__copy"><span class="act__num">ACT I · VOICE + SMS</span><h3>The first ring belongs to Odesa.</h3><p>Calls, texts, lease questions and maintenance triage are handled in the tenant's language, then preserved as an operator record you can read after the fact.</p><ul class="facts"><li>English and Spanish coverage</li><li>Emergency rules set by the owner</li><li>Transcript and disposition after every call</li></ul></div>
      </article>
      <article class="act act--rent" id="rent">
        <div class="act__product"><img src="/night-garden/product-screens/rent.png" alt="Odesa rent operations page showing portfolio balances and follow up statuses" /></div>
        <div class="act__copy"><span class="act__num">ACT II · RENT</span><h3>Follow up without theatre.</h3><p>Odesa watches the rent lane and prepares calm reminders informed by evidence. Balances are named plainly; every message, payment request and legal threshold waits for owner review.</p><ul class="facts"><li>Rent evidence checked first</li><li>Late balances named clearly</li><li>Payment plans and legal thresholds escalate</li></ul></div>
      </article>
      <article class="act act--maintenance" id="maintenance">
        <div class="act__product act__product--narrow"><img src="/night-garden/product-screens/work-order.png" alt="Odesa maintenance work order showing vendor status, the next action, and a full work order audit trail" /></div>
        <div class="act__copy"><span class="act__num">ACT III · MAINTENANCE</span><h3>Silence becomes a signal.</h3><p>Urgency is classified against your rules, vendor options are surfaced, and every internal step is logged. Contact and cost commitments wait for your review.</p><ul class="facts"><li>Vendor follow up prepared with explicit timeouts</li><li>Tenant status updates drafted for review</li><li>Every change on the work order log</li></ul></div>
      </article>
      <article class="act act--queue" id="queue">
        <div class="act__product act__product--narrow"><img src="/night-garden/product-screens/owner-queue.png" alt="Odesa Owner Queue showing a tenant message decision with attached evidence and approval controls" /></div>
        <div class="act__copy"><span class="act__num">ACT IV · THE OWNER QUEUE</span><h3>Every decision, with its evidence.</h3><p>Anything touching money, access or legal exposure arrives as a drafted decision, never a done deed. Approve, edit or decline from one place, on your schedule.</p><ul class="facts"><li>Drafts arrive with the evidence attached</li><li>Approve, edit or decline in one place</li><li>Owner approval for true commitments</li></ul></div>
      </article>
    </section>

    <section id="capabilities" class="chapter ledger">
      <div class="chapter__head"><h2>A ledger of<br>what Odesa does.</h2><p class="chapter__intro">Every capability sits in a lane: handled outright, watched until it matters, or held for your decision. No capability crosses its lane quietly.</p></div>
      <div class="ledger-rows">
        <div class="ledger-row"><span class="ledger-row__idx">01</span><h3>Calls answered, texts preserved</h3><p>Tenant calls can be answered in English or Spanish. Messages are captured whole and tenant replies are drafted for review, with evidence preserved as an operator record.</p><span class="ledger-row__lane lane--handles">Odesa handles</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">02</span><h3>Maintenance triage</h3><p>Urgency classified against your emergency rules; work orders opened with photos, history and access notes attached.</p><span class="ledger-row__lane lane--handles">Odesa handles</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">03</span><h3>Vendor follow up</h3><p>Quote windows are tracked with explicit timeouts. Silence surfaces a backup option; vendor contact and cost commitments wait for you.</p><span class="ledger-row__lane lane--watches">Odesa watches</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">04</span><h3>Rent cadence</h3><p>Calm reminders and follow ups are prepared on schedule, with balances named plainly. Payment plans and legal thresholds escalate to you.</p><span class="ledger-row__lane lane--handles">Odesa handles</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">05</span><h3>Lease dates &amp; renewals</h3><p>Windows tracked, renewals drafted and held. Nothing is sent without your approval.</p><span class="ledger-row__lane lane--watches">Odesa watches</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">06</span><h3>The Owner Queue</h3><p>Decisions arrive with the evidence attached. Approve, edit or decline from one place, on your schedule.</p><span class="ledger-row__lane lane--yours">You decide</span></div>
        <div class="ledger-row"><span class="ledger-row__idx">07</span><h3>Morning &amp; weekly briefing</h3><p>One note at 7 AM and one weekly review of the whole portfolio: what changed, what was handled, what needs you.</p><span class="ledger-row__lane lane--handles">Odesa handles</span></div>
      </div>
    </section>

    <section class="cta">
      <div class="cta__inner">
        <span class="kicker" style="color:var(--gold-ink)">The same method, every hour</span>
        <h2>Powerful because<br>it is predictable.</h2>
        <p>Every one of these lanes runs the same four motions: listen, verify, act within rules, and brief the owner. This keeps the work explainable after the fact.</p>
        <div class="cta__actions"><a class="button button--navy" href="/method">See the method</a><a class="button button--ink" href="/pilot">Request pilot access</a></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">odesa</a>
        <p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p>
        <p class="footer__creed">Augmentation before autonomy</p>
      </div>
      <nav aria-label="Routes">
        <span class="footer__label">The site</span>
        <a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a>
      </nav>
      <div>
        <span class="footer__label">Access</span>
        <a href="/pilot">Request pilot access</a>
        <a href="/login">Sign in</a>
      </div>
      <div>
        <span class="footer__label">House rules</span>
        <div class="footer__rule">No money moves automatically</div>
        <div class="footer__rule">Emergencies never wait in a queue</div>
        <div class="footer__rule">Legal judgment stays human</div>
        <div class="footer__rule">Renewals are drafted, never sent</div>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>A calmer way to run the night.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>` },
  method: { pageClass: "page-method", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work">Work</a>
      <a href="/method" aria-current="page">Method</a>
      <a href="/demo">Demo</a>
      <a href="/owners">Owners</a>
      <a href="/pilot">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="/pilot">Request access</a></div>
  </header>

  <main id="top">
    <section class="page-hero">
      <div class="page-hero__inner">
        <div class="kicker">The method</div>
        <h1>The same method,<br>every hour.</h1>
        <p class="page-hero__dek">Odesa is not improvising at 2 AM. Every signal moves through the same four motions, so the work is explainable after the fact, and the boundaries hold under pressure.</p>
      </div>
      <div class="page-hero__band"></div>
    </section>

    <section class="chapter method">
      <div class="steps">
        <article class="step"><span class="step__num">01</span><h3>Listen.</h3><p>Tenant calls are answered in their language, day or night. Messages, voicemails and vendor replies are captured whole. Nothing summarized away, nothing lost in a personal phone.</p></article>
        <article class="step"><span class="step__num">02</span><h3>Verify.</h3><p>Lease terms, the rent ledger and work order history are checked before anyone is promised anything. When evidence is missing, Odesa says less and asks. It stays conservative by design.</p></article>
        <article class="step"><span class="step__num">03</span><h3>Act within rules.</h3><p>Read only inference and provider free internal records may move on their own. Tenant messages, money, access, lease, vendor and calendar commitments become drafted decisions in Owner Queue.</p></article>
        <article class="step"><span class="step__num">04</span><h3>Brief the owner.</h3><p>The night folds into one morning note: what changed, what was handled quietly, and the single decision waiting for you, with the evidence attached.</p></article>
      </div>
    </section>

    <section id="briefing" class="chapter morning">
      <div class="briefing">
        <div class="briefing__copy"><span class="kicker">The central artifact</span><h2>The briefing is<br>the payoff.</h2><p class="chapter__intro">Everything the method produces resolves into one sheet at 7 AM: what Odesa checked, what it handled quietly, and the one decision that still belongs to you. Each line traces back to the evidence that produced it. No summary you have to take on faith.</p></div>
        <article class="sheet"><div class="sheet__top"><span>Monday operator briefing</span><span>May 25 · 7:00 AM</span></div><div class="sheet__lead">Three things changed.<br>One needs you.</div><div class="sheet__action">Approve the Unit 3B plumbing invoice ($420) and renew the preferred vendor backup list before Friday.</div><div class="sheet__rows"><div class="sheet__row"><span>Checked</span><span>Tenant inbox, rent ledger, work orders, lease dates</span><span>Clear</span></div><div class="sheet__row"><span>Watching</span><span>Unit 7A partial payment plan due Wednesday</span><span>Open</span></div><div class="sheet__row"><span>Quietly done</span><span>11 routine tenant answers prepared</span><span>None</span></div></div><div class="sheet__foot"><span>Prepared by Odesa · 7:00 AM</span><span>The watch resumes tonight</span></div></article>
      </div>
    </section>

    <section class="chapter record">
      <div class="chapter__head"><h2>Every action<br>leaves a record.</h2><p class="chapter__intro">Trust is not a tone of voice; it is an audit trail. Odesa keeps the evidence so the briefing can be short and still be checked.</p></div>
      <div class="rows">
        <div class="rows__item"><span class="rows__k">Captured whole</span><div><h3>Nothing summarized away.</h3><p>Calls, texts, voicemails and vendor replies are kept in full, not paraphrased into a note that loses the detail you'd want at a dispute.</p></div></div>
        <div class="rows__item"><span class="rows__k">Verified first</span><div><h3>Checked before it's claimed.</h3><p>Lease terms, the rent ledger and work order history are read before anyone is told anything. Missing evidence means Odesa asks rather than assumes.</p></div></div>
        <div class="rows__item"><span class="rows__k">Logged</span><div><h3>Automatic internal captures are on the record.</h3><p>Every provider free record Odesa captures is logged with the evidence behind it, timestamped, and visible.</p></div></div>
        <div class="rows__item"><span class="rows__k">Attached</span><div><h3>Decisions arrive with their evidence.</h3><p>When something must stop with you, it reaches the Owner Queue as a draft with the transcript, ledger line or work order log that produced it.</p></div></div>
      </div>
    </section>

    <section id="rules" class="chapter rules">
      <div class="chapter__head"><h2>Human judgment<br>stays visible.</h2><p class="chapter__intro">Odesa can work through the night without pretending judgment is a background process. You choose the lanes, the thresholds, and the moments that must stop with you.</p></div>
      <div class="rules-grid"><article class="rule"><span class="rule__label">Odesa handles</span><h3>Evidence and internal follow through.</h3><p>Call evidence, maintenance records, rent checks, draft acknowledgements, and quiet monitoring.</p></article><article class="rule"><span class="rule__label">Odesa watches</span><h3>Silence, drift, and approaching thresholds.</h3><p>Unanswered vendors, late rent movement, lease windows, unresolved calls, and stale work orders.</p></article><article class="rule"><span class="rule__label">You decide</span><h3>Messages, money, access, and commitments.</h3><p>Tenant replies, payment plans, fee waivers, lease interpretation, dispatch costs, and legal or sensitive emergency claims.</p></article></div>
      <div class="rules__boundary"><span class="rules__boundary-label">Stops with you, always</span><span>Money movement</span><span>Legal exposure</span><span>Property access</span><span>Lease interpretation</span><span>True commitments</span></div>
    </section>

    <section id="faq" class="chapter faq">
      <div class="chapter__head"><h2>Autonomy,<br>answered plainly.</h2><p class="chapter__intro">The three questions owners ask first about control and emergencies. The full list lives on the Pilot page.</p></div>
      <div class="faq-list">
        <details class="qa"><summary><span class="qa__idx">01</span>How much control do I keep?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">All of it that matters. Internal record capture stays visible, and every tenant, money, lease, vendor, calendar, access or legal commitment arrives in Owner Queue for your review.</p></details>
        <details class="qa"><summary><span class="qa__idx">02</span>What happens in a real emergency?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">Deterministic emergency language is matched immediately and the owner alert path runs when notification is configured. Odesa records the evidence without promising vendor arrival, access, cost, or another external commitment.</p></details>
        <details class="qa"><summary><span class="qa__idx">03</span>What will Odesa never do automatically?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">Move money, waive fees, make or imply legal threats, grant property access, reinterpret a lease, or commit you to a vendor cost. Those stop with you by design, not by a setting.</p></details>
      </div>
    </section>

    <section class="cta">
      <div class="cta__inner">
        <span class="kicker" style="color:var(--gold-ink)">Built for owners who never left</span>
        <h2>See where you fit.</h2>
        <p>The method only helps if it's aimed at the right operator. Owners tells you whether Odesa is built for how you run your buildings.</p>
        <div class="cta__actions"><a class="button button--navy" href="/owners">Who it's for</a><a class="button button--ink" href="/pilot">Request pilot access</a></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">odesa</a>
        <p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p>
        <p class="footer__creed">Augmentation before autonomy</p>
      </div>
      <nav aria-label="Routes">
        <span class="footer__label">The site</span>
        <a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a>
      </nav>
      <div>
        <span class="footer__label">Access</span>
        <a href="/pilot">Request pilot access</a>
        <a href="/login">Sign in</a>
      </div>
      <div>
        <span class="footer__label">House rules</span>
        <div class="footer__rule">No money moves automatically</div>
        <div class="footer__rule">Emergencies never wait in a queue</div>
        <div class="footer__rule">Legal judgment stays human</div>
        <div class="footer__rule">Renewals are drafted, never sent</div>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>A calmer way to run the night.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>` },
  demo: { pageClass: "page-demo", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work">Work</a>
      <a href="/method">Method</a>
      <a href="/demo" aria-current="page">Demo</a>
      <a href="/owners">Owners</a>
      <a href="/pilot">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="/pilot#access">Request access</a></div>
  </header>

  <main id="top">
    <section class="demo-hero">
      <div class="demo-hero__copy">
        <div class="kicker">Seeded sample · nothing leaves this page</div>
        <h1>Take the night shift<br><em>without taking the call.</em></h1>
        <p>Run one fictional tenant issue through Odesa, from first ring to the 7 AM briefing. Inspect what it verifies, what it handles, and exactly where it stops for you.</p>
        <div class="demo-hero__facts"><span>No signup</span><span>No provider calls</span><span>No data sent</span></div>
      </div>
      <div class="demo-hero__art" role="img" aria-label="Monet water lilies crop used as temporary public domain art direction"></div>
    </section>

    <section class="demo-stage" aria-labelledby="demo-title">
      <div class="demo-stage__top">
        <div>
          <span class="kicker">Galaxy Estates · fictional local sample</span>
          <h2 id="demo-title">Kitchen leak at 11:42 PM.</h2>
        </div>
        <div class="demo-stage__status"><span class="demo-live-dot"></span><strong id="demo-status">Ready to begin</strong><small id="demo-clock">11:42 PM</small></div>
      </div>

      <div class="demo-progress" aria-label="Sample night progress">
        <span class="is-active">Answer</span><span>Verify</span><span>Act</span><span>Stop</span><span>Brief</span>
      </div>

      <div class="demo-console">
        <aside class="demo-rail" aria-label="Night event timeline">
          <div class="demo-panel-label">Night record</div>
          <button class="demo-event is-visible is-selected" type="button" data-step="0" data-title="The call arrives" data-body="A tenant reports water dripping under the kitchen sink. Odesa answers in the tenant’s language and records the exact words before drawing a conclusion."><span>23:42</span><strong>Incoming call</strong><small>Unit 3B · kitchen leak</small></button>
          <button class="demo-event" type="button" data-step="1" data-title="Evidence checked first" data-body="Odesa matches the caller to Unit 3B, checks the lease and property emergency rules, and confirms this is contained water—not a burst pipe or electrical hazard."><span>23:44</span><strong>Context verified</strong><small>Lease · unit · house rules</small></button>
          <button class="demo-event" type="button" data-step="2" data-title="Internal record stays in lane" data-body="A work order is opened, the preferred plumber is identified, and a bounded tenant acknowledgement is prepared for review. No provider is contacted."><span>23:46</span><strong>Work order opened</strong><small>WO 1042 · preferred vendor identified</small></button>
          <button class="demo-event" type="button" data-step="3" data-title="Missing confirmation becomes a signal" data-body="No verified vendor acceptance is on the record inside the owner’s 12-minute rule. Odesa surfaces an approved backup option without promising arrival or cost."><span>23:58</span><strong>Backup surfaced</strong><small>Timeout rule · no dispatch promise</small></button>
          <button class="demo-event" type="button" data-step="4" data-title="A cost commitment stops" data-body="The backup vendor can attend for a $420 minimum. Odesa does not commit the owner. It packages the transcript, work order, vendor response, and consequence of waiting into one decision."><span>00:03</span><strong>Owner decision</strong><small>$420 minimum · held</small></button>
          <button class="demo-event" type="button" data-step="5" data-title="The night folds into one note" data-body="The morning briefing separates what was checked, what was handled, what is still being watched, and the single decision that belongs to the owner."><span>07:00</span><strong>Briefing ready</strong><small>One decision · evidence attached</small></button>
        </aside>

        <section class="demo-evidence" aria-live="polite">
          <div class="demo-panel-label">Evidence desk</div>
          <div class="demo-evidence__header"><span id="evidence-kicker">CALL RECORD · 23:42</span><span class="demo-chip" id="evidence-state">Captured whole</span></div>
          <h3 id="evidence-title">The call arrives</h3>
          <p id="evidence-body">A tenant reports water dripping under the kitchen sink. Odesa answers in the tenant’s language and records the exact words before drawing a conclusion.</p>

          <div class="demo-transcript" id="demo-transcript" aria-live="polite">
            <p class="demo-transcript__empty" id="demo-transcript-empty">Press “Start sample night” to reveal the call as it happens.</p>
            <div class="demo-transcript__line" data-reveal-step="1" hidden><span>Odesa</span><p>Thanks for calling Galaxy Estates. Tell me what’s happening.</p></div>
            <div class="demo-transcript__line" data-reveal-step="2" hidden><span>Tenant</span><p>There’s water dripping under my kitchen sink. I put a bowl underneath it.</p></div>
            <div class="demo-transcript__line" data-reveal-step="3" hidden><span>Odesa</span><p>Is the water spraying, near an outlet, or spreading beyond the cabinet?</p></div>
            <div class="demo-transcript__line" data-reveal-step="4" hidden><span>Tenant</span><p>No. It’s a steady drip and it’s staying inside the cabinet.</p></div>
          </div>

          <div class="demo-proof-grid">
            <div><span>Caller</span><strong>Tenant matched</strong><small>Unit 3B · lease active</small></div>
            <div><span>Emergency rule</span><strong>Contained leak</strong><small>Escalate if spread changes</small></div>
            <div><span>Authority</span><strong>No owner action yet</strong><small>Inside approved triage lane</small></div>
          </div>
        </section>

        <aside class="demo-boundary" aria-label="Odesa action and owner decision">
          <div class="demo-panel-label">Next move</div>
          <div class="demo-lane"><span id="lane-label">Odesa handles</span><strong id="lane-title">Answer and preserve the call.</strong><p id="lane-copy">No commitment is being made. The original conversation stays available as evidence.</p></div>

          <div class="demo-decision" id="demo-decision" hidden>
            <span class="demo-decision__label">Stops with you · cost commitment</span>
            <h3>Approve the $420 minimum?</h3>
            <p>The backup plumber can attend at 8:00 AM. Waiting keeps the tenant on containment guidance until the preferred vendor responds.</p>
            <div class="demo-decision__actions">
              <button type="button" data-choice="hold">Hold for morning</button>
              <button type="button" data-choice="approve">Approve in sample</button>
              <button type="button" data-choice="context">Show more context</button>
            </div>
            <small>Sample only. No vendor is contacted and no money moves.</small>
          </div>

          <div class="demo-choice-result" id="demo-choice-result" role="status" hidden></div>

          <article class="demo-brief" id="demo-brief" hidden>
            <div class="demo-brief__top"><span>Morning operator briefing</span><span>7:00 AM</span></div>
            <h3>Four things changed.<br>One needed you.</h3>
            <div class="demo-brief__row"><span>Handled</span><p>Call answered, evidence captured, work order opened</p></div>
            <div class="demo-brief__row"><span>Watched</span><p>Preferred vendor timeout; backup availability</p></div>
            <div class="demo-brief__row"><span>Your call</span><p id="brief-choice">Vendor minimum held for review</p></div>
          </article>

          <div class="demo-controls">
            <button class="button button--navy" id="demo-next" type="button">Start sample night</button>
            <button class="demo-reset" id="demo-reset" type="button">Reset</button>
          </div>
        </aside>
      </div>
    </section>

    <section class="chapter demo-explain">
      <div class="chapter__head"><h2>A demo of the boundary,<br>not a magic trick.</h2><p class="chapter__intro">The sample is deterministic and fictional. Its job is to make Odesa’s operating contract testable: original evidence stays visible, routine work can move, silence gets noticed, and money or commitments stop with the owner.</p></div>
      <div class="rules-grid">
        <article class="rule"><span class="rule__label">Inspect</span><h3>Every event keeps its source.</h3><p>Click any timestamp to reopen the evidence and reason for the next move.</p></article>
        <article class="rule"><span class="rule__label">Test</span><h3>Choose the owner decision.</h3><p>Hold, approve in the sample, or ask for context and see the briefing change.</p></article>
        <article class="rule"><span class="rule__label">Trust</span><h3>Nothing happens outside this page.</h3><p>No provider, tenant, vendor, payment system, or production workspace is touched.</p></article>
      </div>
    </section>

    <section class="cta">
      <div class="cta__inner"><span class="kicker" style="color:var(--gold-ink)">Seen the boundary work?</span><h2>Bring your own rules.</h2><p>The real pilot starts in review mode, with your properties, phone line, records, and approval lanes.</p><div class="cta__actions"><a class="button button--navy" href="/pilot#access">Request pilot access</a><a class="button button--ink" href="/method">Read the method</a></div></div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div><a class="brand" href="/">odesa</a><p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p><p class="footer__creed">Augmentation before autonomy</p></div>
      <nav aria-label="Routes"><span class="footer__label">The site</span><a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a></nav>
      <div><span class="footer__label">Access</span><a href="/pilot#access">Request pilot access</a><a href="/login">Sign in</a></div>
      <div><span class="footer__label">House rules</span><div class="footer__rule">No money moves automatically</div><div class="footer__rule">Emergencies never wait in a queue</div><div class="footer__rule">Legal judgment stays human</div><div class="footer__rule">Renewals are drafted, never sent</div></div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>Sample night is fictional and local; no data is sent.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>
  ` },
  owners: { pageClass: "page-owners", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work">Work</a>
      <a href="/method">Method</a>
      <a href="/demo">Demo</a>
      <a href="/owners" aria-current="page">Owners</a>
      <a href="/pilot">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="/pilot">Request access</a></div>
  </header>

  <main id="top">
    <section class="page-hero">
      <div class="page-hero__inner">
        <div class="kicker">Owners</div>
        <h1>Built for owners<br>who never left.</h1>
        <p class="page-hero__dek">Odesa is made for owners who manage their own properties and for small teams, roughly five to fifty units, who kept the judgment and lost their evenings.</p>
      </div>
      <div class="page-hero__band"></div>
    </section>

    <section class="chapter fit">
      <div class="chapter__head"><h2>You still answer<br>your own phone.</h2><p class="chapter__intro">You know every unit, every tenant, and every promise because you made them. Odesa keeps that standard of care running through the night without keeping you up.</p></div>
      <div class="fit-grid">
        <div><span class="fit__label">Who it fits</span><h3>The owner operator.</h3><p>You run the buildings yourself, or with a small team, and the quality bar is personal. Odesa extends your attention; it does not replace your authority.</p>
          <ul class="fit__list"><li>Managing roughly 5 to 50 units, alone or with a small team</li><li>Final say on money, leases and property access stays with you</li><li>You want every call, promise and follow up written down</li></ul></div>
        <div><span class="fit__label">What it replaces</span><h3>The interruption, not the judgment.</h3><p>Odesa is not a property manager and does not want your authority. It replaces the parts of the job that punish attention:</p>
          <ul class="fit__list"><li>The overnight call that could have waited, answered, logged, triaged</li><li>Fragmented follow up scattered across texts, voicemail and spreadsheets</li><li>An operator memory that lives in one person's head</li></ul></div>
      </div>
    </section>

    <section class="chapter">
      <div class="chapter__head"><h2>The same care,<br>a different day.</h2><p class="chapter__intro">Nothing about your standard changes. What changes is where the work lands, and whether it has to land on you the moment it happens.</p></div>
      <div class="compare">
        <div class="compare__col compare__col--before">
          <span class="compare__label">Before Odesa</span>
          <ul class="compare__list">
            <li>The 2 AM call woke you, or went unanswered until morning.</li>
            <li>Follow up scattered across texts, voicemail and memory.</li>
            <li>The operating history lived in one person's head.</li>
            <li>Vendor silence surfaced only when the tenant called back.</li>
            <li>Rent reminders were one more thing you kept meaning to send.</li>
          </ul>
        </div>
        <div class="compare__col compare__col--after">
          <span class="compare__label">With Odesa</span>
          <ul class="compare__list">
            <li>The 2 AM call is answered, logged and triaged without waking you.</li>
            <li>Every promise lands in one record you can read back.</li>
            <li>The history is written down, not remembered.</li>
            <li>Silence is noticed, and a backup vendor option is surfaced in time.</li>
            <li>Reminders are prepared on schedule; balances are named plainly.</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="chapter notfit">
      <div class="chapter__head"><h2>When Odesa<br>isn't the tool.</h2><p class="chapter__intro">Honesty is part of the fit. Odesa augments an owner who keeps the judgment, so some situations are a poor match, and we would rather say so now.</p></div>
      <ul class="notfit__list">
        <li>You need a licensed property manager of record. Odesa augments an owner operator; it is not a management company and takes no fiduciary or legal role.</li>
        <li>You want money moved, fees waived, or leases signed autonomously. Those stop with you by design, not by a setting.</li>
        <li>Your portfolio is far outside roughly 5 to 50 units, or already run by a full operations team. The fit thins at both ends.</li>
        <li>You don't want a written record of tenant conversations. Odesa's value is the audit trail; it won't operate blind.</li>
      </ul>
    </section>

    <section class="cta">
      <div class="cta__inner">
        <span class="kicker" style="color:var(--gold-ink)">Pilot cohort · Q3</span>
        <h2>If that's you,<br>bring your rules.</h2>
        <p>Odesa is onboarding a small cohort of owners with 5 to 50 units. The pilot starts with your number, your properties, and the boundaries you set.</p>
        <div class="cta__actions"><a class="button button--navy" href="/pilot">Request pilot access</a><a class="button button--ink" href="/work">See the work first</a></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">odesa</a>
        <p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p>
        <p class="footer__creed">Augmentation before autonomy</p>
      </div>
      <nav aria-label="Routes">
        <span class="footer__label">The site</span>
        <a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a>
      </nav>
      <div>
        <span class="footer__label">Access</span>
        <a href="/pilot">Request pilot access</a>
        <a href="/login">Sign in</a>
      </div>
      <div>
        <span class="footer__label">House rules</span>
        <div class="footer__rule">No money moves automatically</div>
        <div class="footer__rule">Emergencies never wait in a queue</div>
        <div class="footer__rule">Legal judgment stays human</div>
        <div class="footer__rule">Renewals are drafted, never sent</div>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>A calmer way to run the night.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>` },
  pilot: { pageClass: "page-pilot", html: `<header class="masthead">
    <a class="brand" href="/">odesa</a>
    <nav class="nav" aria-label="Primary">
      <a href="/work">Work</a>
      <a href="/method">Method</a>
      <a href="/demo">Demo</a>
      <a href="/owners">Owners</a>
      <a href="/pilot" aria-current="page">Pilot</a>
    </nav>
    <div class="masthead__right"><a href="/login">Sign in</a><a class="masthead__cta" href="#access">Request access</a></div>
  </header>

  <main id="top">
    <section class="page-hero">
      <div class="page-hero__inner">
        <div class="kicker">Pilot access · Q3 cohort</div>
        <h1>Your nights back.<br>Your week briefed.</h1>
        <p class="page-hero__dek">Odesa is onboarding a small cohort of owners with 5 to 50 units. Guided setup, your rules first, and a real operator watching from night one.</p>
        <div class="hero__actions"><a class="button button--navy" href="#access">Request pilot access</a><a class="button button--ink" href="/work">See the work</a></div>
      </div>
      <div class="page-hero__band"></div>
    </section>

    <section class="chapter">
      <div class="chapter__head"><h2>What the pilot<br>actually is.</h2><p class="chapter__intro">A small, closely supported cohort, not an instant signup. You get the product, the onboarding, and a direct line while Odesa learns your buildings.</p></div>
      <div class="pilot-two">
        <div>
          <span class="spec__label">What's included</span>
          <ul class="spec__list">
            <li>A guided phone setup for calls, with text evidence and reply drafts preserved</li>
            <li>Rent records checked and follow up drafted on a cadence you approve</li>
            <li>Maintenance triage, vendor follow up, and a full work order record</li>
            <li>The Owner Queue, the 7 AM briefing, and the weekly portfolio review</li>
            <li>Your own workspace, scoped to your organization and visible to no one else</li>
          </ul>
        </div>
        <div>
          <span class="spec__label">What you bring</span>
          <ul class="spec__list">
            <li>Your properties, units, tenants and leases</li>
            <li>Your house rules: quiet hours, emergency handling, escalation thresholds</li>
            <li>Your existing phone line and rent records to connect during onboarding</li>
            <li>The lanes you're willing to let Odesa run once you've watched it work</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="chapter method">
      <div class="chapter__head"><h2>How onboarding<br>runs.</h2><p class="chapter__intro">Odesa starts in review mode. Read only inference and provider free internal records can earn a bounded automatic lane; consequential commitments always stay with you.</p></div>
      <div class="steps">
        <article class="step"><span class="step__num">01</span><h3>Wire it up.</h3><p>You bring your properties, units, tenants and house rules; we connect your phone line and rent records during onboarding. Nothing goes live until you've seen it.</p></article>
        <article class="step"><span class="step__num">02</span><h3>Start in review.</h3><p>Odesa begins in review mode, drafting every reply, reminder and commitment for your approval, so you can see exactly how it handles your operation before anything consequential happens.</p></article>
        <article class="step"><span class="step__num">03</span><h3>Graduate a safe lane.</h3><p>Only read only inference or provider free internal record capture can graduate after you have watched it work. Consequential actions remain review first.</p></article>
        <article class="step"><span class="step__num">04</span><h3>Wake up briefed.</h3><p>The 7 AM note begins, followed by the weekly portfolio review: what changed, what was handled quietly, and the decisions still waiting for you.</p></article>
      </div>
    </section>

    <section class="chapter rules">
      <div class="chapter__head"><h2>The safety model,<br>up front.</h2><p class="chapter__intro">Autonomy is bounded on purpose. Some things never move without you, not as a setting you might change, but as a rule of the product.</p></div>
      <div class="rules__boundary"><span class="rules__boundary-label">Stops with you, always</span><span>Money movement</span><span>Legal exposure</span><span>Property access</span><span>Lease interpretation</span><span>True commitments</span></div>
      <ul class="creed-list">
        <li>No money moves automatically. No payments, no waivers, no fee changes.</li>
        <li>Emergencies never wait in a queue; you're called and texted in parallel.</li>
        <li>Legal judgment stays human. No threats, no lease reinterpretation.</li>
        <li>Renewals and commitments are drafted, never sent without your approval.</li>
      </ul>
    </section>

    <section class="chapter record">
      <div class="chapter__head"><h2>What it costs.</h2><p class="chapter__intro">Odesa is early, and honest about it.</p></div>
      <div class="note">
        <span class="note__label">Pricing</span>
        <p>Pilot pricing is finalized with each owner during intake, based on your portfolio and the lanes you turn on, not sold as fixed tiers today. No card is required to request access.</p>
      </div>
    </section>

    <section id="faq" class="chapter faq">
      <div class="chapter__head"><h2>Asked before<br>every pilot.</h2><p class="chapter__intro">Plain answers, in the same voice your tenants will hear at 2 AM.</p></div>
      <div class="faq-list">
        <details class="qa"><summary><span class="qa__idx">01</span>What does setup look like?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">You bring your properties, units, tenants and house rules; we guide phone and rent record setup during onboarding. Odesa starts in review mode, and consequential actions stay there by default.</p></details>
        <details class="qa"><summary><span class="qa__idx">02</span>How much control do I keep?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">All of it that matters. Internal record capture stays visible, and every tenant, money, lease, vendor, calendar, access or legal commitment arrives in Owner Queue for your review.</p></details>
        <details class="qa"><summary><span class="qa__idx">03</span>What happens in a real emergency?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">Deterministic emergency language is matched immediately and the owner alert path runs when notification is configured. Odesa records the evidence without promising vendor arrival, access, cost, or another external commitment.</p></details>
        <details class="qa"><summary><span class="qa__idx">04</span>Where does my data live, and what does Odesa connect to?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">Your portfolio lives in your own Odesa workspace, scoped to your organization and visible to no one else. Calls and texts run on a dedicated number; rent follow up is aware of Stripe and ACH. Your tenants' conversations belong to your operation, not to anyone else.</p></details>
        <details class="qa"><summary><span class="qa__idx">05</span>What will Odesa never do automatically?<span class="qa__mark" aria-hidden="true"></span></summary><p class="qa__a">Move money, waive fees, make or imply legal threats, grant property access, reinterpret a lease, or commit you to a vendor cost. Those stop with you by design, not by a setting.</p></details>
      </div>
    </section>

    <section id="access" class="chapter access">
      <div class="chapter__head"><h2>Request pilot<br>access.</h2><p class="chapter__intro">Tell us a little about your portfolio. We'll follow up to start intake and walk you through onboarding.</p></div>
      <div class="access-grid">
        <div class="access__intro">
          <span class="spec__label">The path in</span>
          <p>A short note is enough. Pilot intake is a conversation. We finalize scope, connect your number and rent records, and Odesa begins in review mode. Your rules come first.</p>
        </div>
        <form class="access__form" action="/api/waitlist" method="post">
          <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" autocomplete="name" /></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" required /></div>
          <div class="field"><label for="f-units">Units under management</label><input id="f-units" name="units" type="number" inputmode="numeric" min="1" max="5000" /></div>
          <div class="field"><label for="f-note">Anything we should know?</label><textarea id="f-note" name="note"></textarea></div>
          <div class="access__actions"><button class="button button--navy" type="submit">Request access</button><span class="access__note">Secure request · no card required</span></div>
        </form>
        <div id="access-status" class="access__sent" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">odesa</a>
        <p>The AI property operations assistant for small landlords. It answers every call, keeps the record, and brings judgment back to the owner.</p>
        <p class="footer__creed">Augmentation before autonomy</p>
      </div>
      <nav aria-label="Routes">
        <span class="footer__label">The site</span>
        <a href="/work">Work</a><a href="/method">Method</a><a href="/demo">Demo</a><a href="/owners">Owners</a><a href="/pilot">Pilot</a>
      </nav>
      <div>
        <span class="footer__label">Access</span>
        <a href="#access">Request pilot access</a>
        <a href="/login">Sign in</a>
      </div>
      <div>
        <span class="footer__label">House rules</span>
        <div class="footer__rule">No money moves automatically</div>
        <div class="footer__rule">Emergencies never wait in a queue</div>
        <div class="footer__rule">Legal judgment stays human</div>
        <div class="footer__rule">Renewals are drafted, never sent</div>
      </div>
    </div>
    <div class="footer-bottom"><span>© 2026 Odesa Operations, Inc.</span><span>A calmer way to run the night.</span><span>Made for owners who still answer their own phone.</span></div>
  </footer>` },
};
