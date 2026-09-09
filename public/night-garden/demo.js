(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const events = [...document.querySelectorAll('.demo-event')];
  const progress = [...document.querySelectorAll('.demo-progress span')];
  const next = document.querySelector('#demo-next');
  const reset = document.querySelector('#demo-reset');
  const decision = document.querySelector('#demo-decision');
  const result = document.querySelector('#demo-choice-result');
  const brief = document.querySelector('#demo-brief');
  const status = document.querySelector('#demo-status');
  const clock = document.querySelector('#demo-clock');
  const title = document.querySelector('#evidence-title');
  const body = document.querySelector('#evidence-body');
  const kicker = document.querySelector('#evidence-kicker');
  const evidenceState = document.querySelector('#evidence-state');
  const laneLabel = document.querySelector('#lane-label');
  const laneTitle = document.querySelector('#lane-title');
  const laneCopy = document.querySelector('#lane-copy');
  const briefChoice = document.querySelector('#brief-choice');
  const transcriptLines = [...document.querySelectorAll('.demo-transcript__line')];
  const transcriptEmpty = document.querySelector('#demo-transcript-empty');
  const evidencePanel = document.querySelector('.demo-evidence');
  const lanePanel = document.querySelector('.demo-lane');

  const states = [
    { clock: '11:42 PM', status: 'Ready to begin', kicker: 'CALL RECORD · 23:42', chip: 'Captured whole', lane: 'Odesa handles', move: 'Answer and preserve the call.', copy: 'No commitment is being made. The original conversation stays available as evidence.', button: 'Start sample night' },
    { clock: '11:44 PM', status: 'Evidence checked', kicker: 'VERIFICATION · 23:44', chip: 'Verified first', lane: 'Odesa handles', move: 'Classify inside your rules.', copy: 'The tenant, unit, lease, and emergency boundary agree: contained leak, not an immediate life safety event.', button: 'Open the work order' },
    { clock: '11:46 PM', status: 'Routine lane active', kicker: 'ACTION LOG · 23:46', chip: 'On the record', lane: 'Odesa watches', move: 'Wait inside the vendor rule.', copy: 'The preferred plumber has 12 minutes to confirm. Odesa can follow up, but cannot promise arrival or cost.', button: 'Advance 12 minutes' },
    { clock: '11:58 PM', status: 'Vendor silence noticed', kicker: 'WATCH SIGNAL · 23:58', chip: 'Timeout reached', lane: 'Odesa watches', move: 'Warm the approved backup.', copy: 'The tenant gets an honest update. The backup vendor is asked for availability, not dispatched.', button: 'Review the vendor response' },
    { clock: '12:03 AM', status: 'Owner decision required', kicker: 'DECISION PACKET · 00:03', chip: 'Held for you', lane: 'You decide', move: 'A $420 commitment stops here.', copy: 'Odesa has attached the call, rules, work order, vendor reply, and consequence of waiting. Choose the sample outcome below.', button: 'Choose an outcome' },
    { clock: '7:00 AM', status: 'Briefing ready', kicker: 'MORNING BRIEF · 07:00', chip: 'One note', lane: 'Briefing ready', move: 'The night is explainable.', copy: 'Handled work, watch signals, and owner judgment are separated so nothing important hides inside activity.', button: 'Run it again' },
  ];

  let step = 0;
  let choiceMade = false;

  function refresh(node) {
    if (!node || reduceMotion) return;
    node.classList.remove('is-refreshing');
    void node.offsetWidth;
    node.classList.add('is-refreshing');
  }

  function showSmoothly(node, shouldShow) {
    if (!node) return;
    if (!shouldShow) {
      node.classList.remove('is-revealed');
      node.hidden = true;
      return;
    }
    if (!node.hidden && node.classList.contains('is-revealed')) return;
    node.hidden = false;
    if (reduceMotion) {
      node.classList.add('is-revealed');
      return;
    }
    requestAnimationFrame(() => node.classList.add('is-revealed'));
  }

  function selectEvent(index) {
    const event = events[index];
    if (!event || index > step) return;
    events.forEach((node, i) => node.classList.toggle('is-selected', i === index));
    title.textContent = event.dataset.title;
    body.textContent = event.dataset.body;
    kicker.textContent = states[index].kicker;
    evidenceState.textContent = states[index].chip;
    refresh(evidencePanel);
  }

  function render() {
    const state = states[step];
    events.forEach((event, index) => {
      event.classList.toggle('is-visible', index <= step);
      event.disabled = index > step;
    });
    progress.forEach((item, index) => {
      item.classList.toggle('is-active', index <= Math.min(step, 4));
      item.classList.toggle('is-current', index === Math.min(step, 4));
    });
    status.textContent = state.status;
    clock.textContent = state.clock;
    laneLabel.textContent = state.lane;
    laneTitle.textContent = state.move;
    laneCopy.textContent = state.copy;
    next.textContent = state.button;
    next.disabled = step === 4 && !choiceMade;
    showSmoothly(decision, step === 4 && !choiceMade);
    showSmoothly(brief, step === 5);
    transcriptLines.forEach((line) => {
      showSmoothly(line, Number(line.dataset.revealStep) <= step);
    });
    transcriptEmpty.hidden = step > 0;
    refresh(lanePanel);
    selectEvent(step);
  }

  function choose(kind) {
    choiceMade = true;
    showSmoothly(result, true);
    const outcomes = {
      hold: ['Held for morning review.', 'Vendor minimum held for morning review'],
      approve: ['Approved inside the sample. Nothing was sent.', '$420 minimum approved in the local sample'],
      context: ['Context reopened: preferred vendor still silent; tenant remains on containment guidance; backup can attend at 8:00 AM.', 'More context requested before a commitment'],
    };
    const selected = outcomes[kind] || outcomes.hold;
    result.textContent = selected[0];
    briefChoice.textContent = selected[1];
    showSmoothly(decision, false);
    next.disabled = false;
    next.textContent = 'Build the morning brief';
  }

  events.forEach((event, index) => event.addEventListener('click', () => selectEvent(index)));
  document.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => choose(button.dataset.choice)));

  next.addEventListener('click', () => {
    if (step === 4 && !choiceMade) return;
    if (step === states.length - 1) {
      step = 0;
      choiceMade = false;
      showSmoothly(result, false);
      result.textContent = '';
      briefChoice.textContent = 'Vendor minimum held for review';
    } else {
      step += 1;
    }
    render();
  });

  reset.addEventListener('click', () => {
    step = 0;
    choiceMade = false;
    showSmoothly(result, false);
    result.textContent = '';
    briefChoice.textContent = 'Vendor minimum held for review';
    render();
  });

  render();
})();
