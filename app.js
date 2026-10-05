(() => {
  'use strict';

  const SUPABASE_URL = 'https://lgqglihtxpexuhndeimo.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mHQon-OPIGD1PaF9NP-nTw_4dL7C5CR';
  const GROUP_EMAIL = 'connoisseur.pro@gmx.de';
  const MEMBER_STORAGE_KEY = 'connoisseure.member-id';
  const CATEGORY_DEFS = [
    {key: 'food', label: 'Essen'},
    {key: 'service', label: 'Service'},
    {key: 'ambience', label: 'Ambiente'},
    {key: 'value_for_money', label: 'Preis-Leistung'}
  ];
  const AVATAR_COLORS = ['#e1ae60', '#f0d49c', '#e4beb2', '#bfd1ca', '#b8c6df', '#d8c3df'];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);

  let supabase;
  let authSubscription;
  let activeToken = null;
  let activationFailed = false;
  let activationId = 0;
  let currentMember = null;
  let members = [];
  let meals = [];
  let participants = [];
  let ratings = [];
  let selectedMealId = null;
  let ratingValues = {};
  let toastTimer;
  let placesLibraryPromise = null;
  let placeAutocomplete = null;
  let restaurantSearchInitializing = false;

  function setMessage(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3800);
  }

  function authErrorMessage(error) {
    const message = String(error?.message || '');
    if (error?.code === 'invalid_credentials' || /invalid login credentials|invalid email or password/i.test(message)) {
      return 'Der Gruppen-PIN ist nicht korrekt. Bitte versuche es erneut.';
    }
    if (/email not confirmed/i.test(message)) {
      return 'Das Gruppen-Konto ist noch nicht bestätigt. Bitte prüfe die Supabase-Auth-Einstellung.';
    }
    return `Anmeldung fehlgeschlagen: ${message || 'Unbekannter Authentifizierungsfehler.'}`;
  }

  function databaseErrorMessage(action, error) {
    const message = String(error?.message || 'Unbekannter Datenbankfehler.');
    if (error?.code === '23505' || /duplicate key|unique constraint/i.test(message)) {
      return 'Dieser Vorname wird bereits verwendet (Groß-/Kleinschreibung wird ignoriert). Wähle den vorhandenen aktiven Vornamen oder trage einen anderen ein.';
    }
    if (error?.code === '42501' || /row-level security|permission denied|not allowed|policy/i.test(message)) {
      return `${action} wurde durch Supabase-RLS abgelehnt. Prüfe die Gruppenmitgliedschaft und Richtlinien. (${message})`;
    }
    return `${action} fehlgeschlagen: ${message}`;
  }

  function showAuth(message = '', authenticated = false) {
    document.body.classList.remove('is-authenticated');
    $('#authScreen').hidden = false;
    $('#memberScreen').hidden = true;
    setMessage($('#authMessage'), message);
    if ($('#failedLogout')) $('#failedLogout').hidden = !authenticated;
  }

  function showMemberGate(message = '') {
    document.body.classList.remove('is-authenticated');
    $('#authScreen').hidden = true;
    $('#memberScreen').hidden = false;
    setMessage($('#memberMessage'), message);
    $('#cancelMemberChange').hidden = !currentMember;
    $('#memberLogout').hidden = false;
    populateMemberSelect();
  }

  function showApplication() {
    $('#authScreen').hidden = true;
    $('#memberScreen').hidden = true;
    document.body.classList.add('is-authenticated');
    updateProfile();
  }

  function memberAvatar(member, className = 'avatar') {
    const name = String(member?.display_name || '?').trim();
    const initials = name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toLocaleUpperCase('de-DE') || '?';
    const hash = Array.from(String(member?.id || name)).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
    const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
    return `<span class="${className}" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</span>`;
  }

  function updateProfile() {
    const profile = $('.profile');
    if (!profile || !currentMember) return;
    profile.innerHTML = `${memberAvatar(currentMember)}<div><strong>${escapeHtml(currentMember.display_name)}</strong><div class="small">Team Connoisseure</div></div><div class="account-actions"><button type="button" data-account-action="change">Vorname wechseln</button><button type="button" data-account-action="logout">Abmelden</button></div>`;
  }

  function populateMemberSelect() {
    const select = $('#memberSelect');
    const activeMembers = members.filter(member => member.is_active);
    $('#memberChoiceWrap').hidden = activeMembers.length === 0;
    $('#chooseMember').hidden = activeMembers.length === 0;
    select.replaceChildren();
    activeMembers.forEach(member => {
      const option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.display_name;
      if (member.id === currentMember?.id || member.id === getStoredMemberId()) option.selected = true;
      select.appendChild(option);
    });
  }

  function getStoredMemberId() {
    try {
      return localStorage.getItem(MEMBER_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function storeMemberId(id) {
    try {
      localStorage.setItem(MEMBER_STORAGE_KEY, id);
    } catch {
      toast('Der Browser kann die Mitgliedsauswahl nicht speichern. Wähle den Namen nach dem nächsten Login erneut aus.');
    }
  }

  async function fetchMembers() {
    const {data, error} = await supabase
      .from('members')
      .select('id,display_name,is_active,created_at')
      .order('display_name', {ascending: true});
    if (error) throw new Error(databaseErrorMessage('Mitglieder konnten nicht geladen werden', error));
    members = data || [];
  }

  async function fetchWorkspaceData() {
    const [mealsResult, participantsResult, ratingsResult] = await Promise.all([
      supabase.from('meals')
        .select('id,restaurant_name,place,maps_url,note,creator_member_id,status,created_at,started_at,completed_at')
        .order('created_at', {ascending: false}),
      supabase.from('meal_participants')
        .select('meal_id,member_id,selected_at'),
      supabase.from('ratings')
        .select('meal_id,member_id,food,service,ambience,value_for_money,comment,rated_at')
    ]);
    if (mealsResult.error) throw new Error(databaseErrorMessage('Fressungen konnten nicht geladen werden', mealsResult.error));
    if (participantsResult.error) throw new Error(databaseErrorMessage('Teilnehmende konnten nicht geladen werden', participantsResult.error));
    if (ratingsResult.error) throw new Error(databaseErrorMessage('Bewertungen konnten nicht geladen werden', ratingsResult.error));
    meals = mealsResult.data || [];
    participants = participantsResult.data || [];
    ratings = ratingsResult.data || [];
  }

  async function enterApplication(member) {
    setMessage($('#memberMessage'), '');
    $('#chooseMember').disabled = true;
    $('#createMember').disabled = true;
    try {
      await fetchWorkspaceData();
      currentMember = member;
      storeMemberId(member.id);
      showApplication();
      setView('dashboard');
      render();
    } catch (error) {
      showMemberGate(error.message);
    } finally {
      $('#chooseMember').disabled = false;
      $('#createMember').disabled = false;
    }
  }

  async function activateSession(nextSession) {
    if (nextSession && nextSession.access_token === activeToken && !activationFailed) return;
    const id = ++activationId;
    if (!nextSession) {
      activeToken = null;
      activationFailed = false;
      currentMember = null;
      members = [];
      meals = [];
      participants = [];
      ratings = [];
      showAuth();
      return;
    }
    activeToken = nextSession.access_token;
    activationFailed = false;
    try {
      await fetchMembers();
      if (id !== activationId) return;
      const savedId = getStoredMemberId();
      const savedMember = members.find(member => member.id === savedId && member.is_active);
      if (savedMember) {
        await enterApplication(savedMember);
      } else {
        currentMember = null;
        showMemberGate();
      }
    } catch (error) {
      if (id === activationId) {
        activationFailed = true;
        showAuth(error.message, true);
      }
    }
  }

  function setView(viewId) {
    $$('.view').forEach(view => view.classList.toggle('active', view.id === viewId));
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === viewId));
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function openModal(id) {
    $(`#${id}`).classList.add('open');
  }

  function closeModal(id) {
    $(`#${id}`).classList.remove('open');
  }

  function memberById(id) {
    return members.find(member => member.id === id) || {id, display_name: 'Unbekanntes Mitglied'};
  }

  function mealById(id) {
    return meals.find(meal => meal.id === id);
  }

  function mealParticipants(mealId) {
    return participants.filter(participant => participant.meal_id === mealId);
  }

  function mealRatings(mealId) {
    return ratings.filter(rating => rating.meal_id === mealId);
  }

  function memberRating(mealId, memberId) {
    return ratings.find(rating => rating.meal_id === mealId && rating.member_id === memberId);
  }

  function formatScore(score) {
    return Number(score).toLocaleString('de-DE', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  }

  function formatDate(value, options = {day: 'numeric', month: 'long', year: 'numeric'}) {
    if (!value) return 'Datum unbekannt';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Datum unbekannt' : date.toLocaleDateString('de-DE', options);
  }

  function mealStatus(meal) {
    if (meal.status === 'waiting') return '<span class="status waiting">● Wartet auf Start</span>';
    if (meal.status === 'running') return '<span class="status running">● Bewertung läuft</span>';
    return '<span class="status complete">✓ Abgeschlossen</span>';
  }

  function validMapsUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function mealScore(meal) {
    const externalScores = mealRatings(meal.id)
      .filter(rating => rating.member_id !== meal.creator_member_id)
      .map(rating => {
        const values = CATEGORY_DEFS.map(category => Number(rating[category.key]));
        return values.every(Number.isFinite)
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null;
      })
      .filter(score => score !== null);
    return externalScores.length
      ? externalScores.reduce((sum, score) => sum + score, 0) / externalScores.length
      : null;
  }

  function renderStars(score) {
    if (!Number.isFinite(score)) return '';
    return Array.from({length: 5}, (_, index) => {
      const remaining = score - index;
      const state = remaining >= 1 ? '' : remaining >= 0.5 ? 'half' : 'empty';
      return `<span class="${state}">★</span>`;
    }).join('');
  }

  function renderPendingCard(meal) {
    const creator = memberById(meal.creator_member_id);
    const isCreator = meal.creator_member_id === currentMember.id;
    const selected = mealParticipants(meal.id).some(participant => participant.member_id === currentMember.id);
    const hasRated = Boolean(memberRating(meal.id, currentMember.id));
    const selectedParticipants = mealParticipants(meal.id);
    const ratedCount = selectedParticipants.filter(participant => memberRating(meal.id, participant.member_id)).length;
    let action = '';
    if (meal.status === 'waiting') {
      action = isCreator
        ? `<button class="start-btn" data-action="start" data-id="${escapeHtml(meal.id)}">Fressung starten</button>`
        : '<span class="status">Wartet auf den Ersteller</span>';
    } else if (selected && !hasRated) {
      action = `<button class="rate-btn" data-action="rate" data-id="${escapeHtml(meal.id)}">Bewerten</button>`;
    } else if (selected) {
      action = '<span class="status complete">✓ Du hast bewertet</span>';
    } else {
      action = '<span class="status">Nicht dabei</span>';
    }
    const progress = meal.status === 'waiting'
      ? 'Noch keine Teilnehmenden ausgewählt'
      : `${ratedCount} von ${selectedParticipants.length} Bewertungen`;
    const percent = selectedParticipants.length ? Math.round(ratedCount / selectedParticipants.length * 100) : 0;
    const place = meal.place ? escapeHtml(meal.place) : 'Ort nicht angegeben';
    const note = meal.note ? `<p>${escapeHtml(meal.note)}</p>` : '';
    return `<article class="pending ${meal.status === 'running' ? 'started' : ''}">
      <div class="pending-top"><div><h3>${escapeHtml(meal.restaurant_name)}</h3><p>${place} · vorgeschlagen von ${escapeHtml(creator.display_name)}</p>${note}</div>${mealStatus(meal)}</div>
      <div class="small" style="display:block;margin-top:11px">${progress}</div>
      ${meal.status === 'running' ? `<div class="progress-line"><i style="width:${percent}%"></i></div>` : ''}
      <div class="pending-actions">${action}<button class="details-btn" data-action="details" data-id="${escapeHtml(meal.id)}">Details ansehen</button></div>
    </article>`;
  }

  function renderLatestMeal(meal) {
    const creator = memberById(meal.creator_member_id);
    const score = mealScore(meal);
    const reviewCount = mealRatings(meal.id).filter(review => review.member_id !== meal.creator_member_id).length;
    return `<article class="meal">
      <div><h3>${escapeHtml(meal.restaurant_name)}</h3><p>${escapeHtml(meal.place || 'Ort nicht angegeben')} · vorgeschlagen von ${escapeHtml(creator.display_name)}</p><span class="pill">${escapeHtml(formatDate(meal.completed_at || meal.created_at))}</span></div>
      <div class="score">${score === null ? '<span class="small">Kein Restaurant-Score</span>' : `<div class="stars">${renderStars(score)}</div><small>${formatScore(score)} aus ${reviewCount} Bewertungen</small>`}
        <button class="link" data-action="details" data-id="${escapeHtml(meal.id)}">Details →</button>
      </div>
    </article>`;
  }

  function renderHistoryCard(meal) {
    const creator = memberById(meal.creator_member_id);
    const score = mealScore(meal);
    const count = mealRatings(meal.id).length;
    return `<article class="card">
      <div class="eyebrow">${escapeHtml(formatDate(meal.completed_at || meal.created_at))}</div>
      <h2>${escapeHtml(meal.restaurant_name)}</h2>
      <p class="intro">${escapeHtml(meal.note || meal.place || 'Keine Notiz hinterlegt.')}</p>
      ${score === null ? '<p class="small">Noch kein Restaurant-Score verfügbar.</p>' : `<div class="stars">${renderStars(score)} <small style="color:var(--muted)">${formatScore(score)}</small></div>`}
      <span class="pill">${count} ${count === 1 ? 'Bewertung' : 'Bewertungen'} · ${escapeHtml(creator.display_name)}</span>
      <button class="details-btn" data-action="details" data-id="${escapeHtml(meal.id)}" style="margin-top:14px;width:100%;padding:10px 12px;border-radius:9px;font-weight:700">Ergebnisse ansehen →</button>
    </article>`;
  }

  function renderActivity(meal) {
    const creator = memberById(meal.creator_member_id);
    const label = meal.status === 'running' ? 'Bewertung läuft' : meal.status === 'waiting' ? 'Wartet auf den Start' : 'Abgeschlossen';
    return `<div class="notification">${memberAvatar(creator)}<div><b>${escapeHtml(creator.display_name)} · ${escapeHtml(meal.restaurant_name)}</b><span>${label}</span></div></div>`;
  }

  function renderDashboard() {
    const pending = meals.filter(meal => meal.status !== 'completed');
    const completed = meals.filter(meal => meal.status === 'completed');
    $('#pendingList').innerHTML = pending.length
      ? pending.map(renderPendingCard).join('')
      : '<div class="empty-state">Keine offenen Fressungen. Zeit für einen neuen Vorschlag!</div>';
    $('#pendingCount').textContent = String(pending.length);
    $('#pendingSummary').textContent = `${pending.length} offen`;
    const completedScores = completed.map(mealScore).filter(score => score !== null);
    const groupAverage = completedScores.length
      ? completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length
      : null;
    $('#dashboardGroupAverage').textContent = groupAverage === null ? '—' : `${formatScore(groupAverage)} ★`;

    const grid = $('#dashboard .grid');
    grid.innerHTML = `<div class="card">
      <div class="card-head"><div><h2>Letzte Fressungen</h2><span class="small">Abgeschlossene gemeinsame Erlebnisse</span></div><button class="link" data-view-link="history">Alle ansehen →</button></div>
      <div id="latestMeals"></div>
    </div><div>
      <div class="card"><div class="card-head"><div><h2>Leaderboard</h2><span class="small">Ø-Restaurant-Score abgeschlossener Empfehlungen</span></div></div><div id="leaderboardList"></div></div>
      <div class="card activity" style="margin-top:22px"><h2>Aktivität</h2><div class="activity-list" id="activityList"></div></div>
    </div>`;
    const latest = completed.slice().sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)).slice(0, 3);
    $('#latestMeals').innerHTML = latest.length ? latest.map(renderLatestMeal).join('') : '<div class="empty-state">Noch keine abgeschlossenen Fressungen.</div>';
    const activity = meals.slice(0, 4);
    $('#activityList').innerHTML = activity.length ? activity.map(renderActivity).join('') : '<div class="empty-state">Noch keine Aktivität vorhanden.</div>';
    renderStatistics();
  }

  function renderHistory() {
    const completed = meals.filter(meal => meal.status === 'completed')
      .slice()
      .sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));
    $('#history .history-grid').innerHTML = completed.length
      ? completed.map(renderHistoryCard).join('')
      : '<div class="empty-state">Es gibt noch keine abgeschlossenen Fressungen. Sobald alle ausgewählten Personen bewertet haben, erscheinen sie hier.</div>';
  }

  function renderRatingRow(category) {
    return `<div class="rating-row"><span>${category.label}</span><span class="rating-stars" data-rating="${category.key}"></span></div>`;
  }

  function setupRatingStars(row) {
    let value = ratingValues[row.dataset.rating] ?? null;
    row.replaceChildren();
    const draw = () => {
      const zero = row.querySelector('.zero-rating');
      zero.classList.toggle('on', value === 0);
      zero.setAttribute('aria-pressed', String(value === 0));
      row.querySelectorAll('button[data-score]').forEach(button => {
        if (button.className === 'zero-rating') return;
        const score = Number(button.dataset.score);
        button.classList.toggle('on', value !== null && score <= Math.floor(value));
        button.classList.toggle('half', value !== null && value % 1 !== 0 && score === Math.ceil(value));
        button.setAttribute('aria-pressed', String(value === score || (score === Math.ceil(value) && value % 1 !== 0)));
      });
    };
    const zero = document.createElement('button');
    zero.type = 'button';
    zero.className = 'zero-rating';
    zero.dataset.score = '0';
    zero.textContent = '0';
    zero.setAttribute('aria-label', '0 Sterne');
    zero.addEventListener('click', () => {
      value = 0;
      ratingValues[row.dataset.rating] = value;
      draw();
    });
    row.appendChild(zero);
    for (let score = 1; score <= 5; score += 1) {
      const star = document.createElement('button');
      star.type = 'button';
      star.dataset.score = String(score);
      star.textContent = '★';
      star.setAttribute('aria-label', `${score} Sterne; linke Hälfte für ${formatScore(score - 0.5)} Sterne`);
      star.addEventListener('click', event => {
        const bounds = star.getBoundingClientRect();
        const half = event.clientX < bounds.left + bounds.width / 2;
        value = half ? score - 0.5 : score;
        ratingValues[row.dataset.rating] = value;
        draw();
      });
      row.appendChild(star);
    }
    draw();
  }

  function openRating(meal) {
    selectedMealId = meal.id;
    ratingValues = {};
    $('#ratingTitle').textContent = `${meal.restaurant_name} bewerten`;
    $('#ratingModal .rating-list').innerHTML = CATEGORY_DEFS.map(renderRatingRow).join('');
    $$('#ratingModal .rating-stars').forEach(setupRatingStars);
    $('#ratingComment').value = '';
    openModal('ratingModal');
  }

  function renderParticipantList(meal) {
    const selected = mealParticipants(meal.id);
    if (!selected.length) return '<p class="small">Noch keine Teilnehmenden eingetragen.</p>';
    return `<h2 style="margin-top:24px">Teilnehmende</h2><div class="member-list">${selected.map(participant => {
      const member = memberById(participant.member_id);
      const review = memberRating(meal.id, participant.member_id);
      return `<div class="member">${memberAvatar(member)}<span class="member-info"><b>${escapeHtml(member.display_name)}</b><span class="member-state">${review ? 'Bewertung abgegeben' : 'Bewertung ausstehend'}</span></span><span class="${review ? 'check' : 'pending-state'}">${review ? '✓ Fertig' : '● Offen'}</span></div>`;
    }).join('')}</div>`;
  }

  function renderReview(review, meal) {
    const member = memberById(review.member_id);
    const isCreator = review.member_id === meal.creator_member_id;
    const values = CATEGORY_DEFS.map(category => Number(review[category.key]));
    return `<article class="history-result-person">
      <div class="history-result-person-head">${memberAvatar(member)}<div class="history-result-person-title"><b>${escapeHtml(member.display_name)}</b>${isCreator ? '<span class="creator-badge">Ersteller · nicht im Durchschnitt</span>' : '<span class="small">Teilnehmerbewertung</span>'}</div></div>
      <div class="history-result-categories">${CATEGORY_DEFS.map((category, index) => `
        <div class="history-result-category"><small>${category.label}</small>
          <span class="history-result-stars" role="img" aria-label="${formatScore(values[index])} von 5 Sternen">${renderStars(values[index])}</span>
          <span class="history-result-score">${formatScore(values[index])}</span>
        </div>`).join('')}
      </div>
      ${review.comment ? `<p class="history-result-comment">„${escapeHtml(review.comment)}“</p>` : ''}
    </article>`;
  }

  function renderDetails(meal) {
    selectedMealId = meal.id;
    const creator = memberById(meal.creator_member_id);
    const reviews = mealRatings(meal.id).slice().sort((a, b) => new Date(a.rated_at) - new Date(b.rated_at));
    const score = mealScore(meal);
    const externalReviews = reviews.filter(review => review.member_id !== meal.creator_member_id);
    const summaries = meal.status === 'completed' && externalReviews.length
      ? `<div class="rating-summary">${CATEGORY_DEFS.map(category => {
        const values = externalReviews.map(review => Number(review[category.key])).filter(Number.isFinite);
        const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        return `<div><b>${average === null ? '—' : `${formatScore(average)} ★`}</b>${category.label}</div>`;
      }).join('')}</div><p class="small" style="margin-top:15px">Restaurant-Ø: ${score === null ? '—' : `${formatScore(score)} ★`}. Erstellerbewertungen bleiben sichtbar, zählen aber nicht in die Durchschnitte.</p>`
      : meal.status === 'completed'
        ? '<p class="small">Kein Restaurant-Durchschnitt verfügbar: Es gibt keine Bewertung von einem anderen Teilnehmenden.</p>'
        : '<p class="small">Restaurant-Durchschnitte erscheinen nach Abschluss und schließen Erstellerbewertungen aus.</p>';
    const mapUrl = validMapsUrl(meal.maps_url);
    const location = mapUrl
      ? `<a class="maps-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">In Google Maps öffnen ↗</a>`
      : escapeHtml(meal.place || 'Kein Ort hinterlegt');
    const reviewContent = reviews.length
      ? `<div class="history-result-list">${reviews.map(review => renderReview(review, meal)).join('')}</div>`
      : '<div class="empty-state">Noch keine Bewertungen eingetragen.</div>';
    const waitingInfo = meal.status === 'waiting'
      ? '<div class="confirm-box">Die Teilnehmenden werden beim Start festgelegt. Nur der Ersteller kann die Fressung starten.</div>'
      : renderParticipantList(meal);
    $('#detailContent').innerHTML = `<div class="eyebrow">Fressung im Überblick</div>
      <div class="topbar"><div><h1 class="headline">${escapeHtml(meal.restaurant_name)}</h1><p class="intro">${escapeHtml(meal.place || 'Ort nicht angegeben')} · vorgeschlagen von ${escapeHtml(creator.display_name)}</p></div>${mealStatus(meal)}</div>
      <div class="detail-layout"><div><div class="card">
        <div class="detail-meta"><div class="meta-box"><b>Ort</b>${location}</div><div class="meta-box"><b>Vorgeschlagen</b>${escapeHtml(formatDate(meal.created_at))}</div><div class="meta-box"><b>Notiz</b>${escapeHtml(meal.note || 'Keine Notiz hinterlegt.')}</div><div class="meta-box"><b>Status</b>${mealStatus(meal)}</div></div>
        ${waitingInfo}
      </div></div>
      <div class="card"><h2>Bewertungen</h2>${summaries}${reviewContent}</div></div>`;
    setView('details');
  }

  function renderStatistics() {
    const completedMeals = meals.filter(meal => meal.status === 'completed');
    const totals = new Map(members.map(member => [member.id, {
      recommendations: 0,
      scores: [],
      receivedRatings: 0
    }]));
    const categoryTotals = CATEGORY_DEFS.map(() => ({sum: 0, count: 0}));
    const restaurants = new Set();
    let totalRatings = 0;
    const mealScores = [];

    completedMeals.forEach(meal => {
      const creatorStats = totals.get(meal.creator_member_id);
      if (creatorStats) creatorStats.recommendations += 1;
      restaurants.add(meal.restaurant_name.trim().toLocaleLowerCase('de-DE'));
      const externalReviews = mealRatings(meal.id).filter(review => review.member_id !== meal.creator_member_id);
      totalRatings += mealRatings(meal.id).length;
      const validScores = [];
      externalReviews.forEach(review => {
        const values = CATEGORY_DEFS.map(category => Number(review[category.key]));
        if (!values.every(Number.isFinite)) return;
        validScores.push(values.reduce((sum, value) => sum + value, 0) / values.length);
        values.forEach((value, index) => {
          categoryTotals[index].sum += value;
          categoryTotals[index].count += 1;
        });
        if (creatorStats) creatorStats.receivedRatings += 1;
      });
      if (validScores.length) {
        const average = validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
        mealScores.push(average);
        if (creatorStats) creatorStats.scores.push(average);
      }
    });

    $('#statsMeals').textContent = String(completedMeals.length);
    $('#statsRatings').textContent = String(totalRatings);
    $('#statsRestaurants').textContent = String(restaurants.size);
    $('#dashboardGroupAverage').textContent = mealScores.length
      ? `${formatScore(mealScores.reduce((sum, score) => sum + score, 0) / mealScores.length)} ★`
      : '—';

    const ranking = members.map(member => {
      const stats = totals.get(member.id);
      const average = stats?.scores.length
        ? stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length
        : null;
      return {member, ...stats, average};
    }).sort((left, right) => {
      if (left.average === null) return right.average === null
        ? left.member.display_name.localeCompare(right.member.display_name, 'de')
        : 1;
      if (right.average === null) return -1;
      return right.average - left.average || left.member.display_name.localeCompare(right.member.display_name, 'de');
    });
    let rank = 0;
    let priorRoundedScore = null;
    ranking.forEach((person, index) => {
      const roundedScore = person.average === null ? null : Number(person.average.toFixed(1));
      if (roundedScore !== null && roundedScore !== priorRoundedScore) rank = index + 1;
      person.rank = roundedScore === null ? null : rank;
      priorRoundedScore = roundedScore;
    });
    $('#leaderboardList').innerHTML = ranking.some(person => person.average !== null)
      ? ranking.map(person => {
        const label = person.average === null ? '—' : `${formatScore(person.average)} ★`;
        const barWidth = person.average === null ? 0 : Math.round(person.average / 5 * 100);
        return `<div class="rank"><div class="rank-num">${person.rank ?? '—'}</div>${memberAvatar(person.member)}<div class="rank-info"><strong>${escapeHtml(person.member.display_name)}${person.member.id === currentMember.id ? ' · du' : ''}</strong><span class="small">${person.recommendations} ${person.recommendations === 1 ? 'Empfehlung' : 'Empfehlungen'} · ${person.receivedRatings} Bewertungen anderer</span><div class="progress"><i style="width:${barWidth}%"></i></div></div><strong>${label}</strong></div>`;
      }).join('')
      : '<div class="empty-state">Noch keine bewerteten Empfehlungen für das Leaderboard.</div>';
    const myStats = ranking.find(person => person.member.id === currentMember.id);
    $('#dashboardPersonalRank').textContent = myStats?.rank ? `#${myStats.rank}` : '—';
    $('#dashboardPersonalAverage').textContent = `dein Platz · Ø ${myStats?.average === null || !myStats ? '—' : `${formatScore(myStats.average)} ★`} für deine Empfehlungen`;

    $('#categoryStats').innerHTML = completedMeals.length
      ? categoryTotals.map((category, index) => {
        const average = category.count ? category.sum / category.count : null;
        return average === null
          ? `<div class="stats-category"><span class="stats-category-label">${CATEGORY_DEFS[index].label}</span><span class="small">Noch keine Bewertungen</span><span class="stats-category-value">—</span></div>`
          : `<div class="stats-category"><span class="stats-category-label">${CATEGORY_DEFS[index].label}</span><div class="progress"><i style="width:${average / 5 * 100}%"></i></div><span class="stats-category-value">${formatScore(average)} ★</span></div>`;
      }).join('')
      : '<div class="empty-state">Noch keine abgeschlossenen Fressungen.</div>';
    $('#memberStats').innerHTML = completedMeals.length
      ? ranking.map(person => {
        const average = person.average === null ? '—' : `${formatScore(person.average)} ★`;
        return `<article class="member-stat-card"><div class="member-stat-head">${memberAvatar(person.member)}<div><strong>${escapeHtml(person.member.display_name)}</strong><span class="small">Abgeschlossene Empfehlungen</span></div></div>
          <div class="member-stat-metrics"><div class="member-stat-metric"><b>${person.recommendations}</b><span>Empfehlungen</span></div><div class="member-stat-metric"><b>${average}</b><span>Ø Restaurant-Score</span></div><div class="member-stat-metric"><b>${person.receivedRatings}</b><span>Bewertungen anderer Mitglieder</span></div></div>
          <p class="member-stat-note">Ø der Restaurant-Scores deiner abgeschlossenen Empfehlungen; jede Fressung zählt gleich.</p></article>`;
      }).join('')
      : '<div class="empty-state">Mitgliederstatistiken erscheinen nach der ersten abgeschlossenen Fressung.</div>';
  }

  function render() {
    const date = new Date().toLocaleDateString('de-DE', {weekday: 'long', day: '2-digit', month: 'long'});
    $('#dashboard > .topbar .eyebrow').textContent = date;
    $('#dashboard .headline').textContent = `Schön, dich zu sehen, ${currentMember.display_name.split(/\s+/)[0]}.`;
    renderDashboard();
    renderHistory();
    updateProfile();
    bindNavigation();
  }

  function bindNavigation() {
    $$('[data-view], [data-view-link]').forEach(button => {
      if (button.dataset.navBound) return;
      button.dataset.navBound = 'true';
      button.addEventListener('click', () => setView(button.dataset.view || button.dataset.viewLink));
    });
  }

  function openStart(meal) {
    selectedMealId = meal.id;
    const selectedIds = new Set(mealParticipants(meal.id).map(participant => participant.member_id));
    selectedIds.add(meal.creator_member_id);
    $('#memberPicker').innerHTML = members.filter(member => member.is_active).map(member => `
      <label class="member-option"><input type="checkbox" value="${escapeHtml(member.id)}" ${selectedIds.has(member.id) ? 'checked' : ''}>
        ${memberAvatar(member)}<span><b>${escapeHtml(member.display_name)}</b><small class="small">${member.id === meal.creator_member_id ? 'Ersteller' : ''}</small></span>
      </label>`).join('');
    openModal('startModal');
  }

  function openCreateModal() {
    $('#creatorName').value = currentMember?.display_name || '';
    openModal('createModal');
    void initializeRestaurantSearch();
  }

  async function startMeal() {
    const meal = mealById(selectedMealId);
    if (!meal || !currentMember) return;
    const participantIds = $$('#memberPicker input:checked').map(input => input.value);
    if (!participantIds.length) {
      toast('Wähle mindestens eine teilnehmende Person aus.');
      return;
    }
    const button = $('#confirmStart');
    button.disabled = true;
    try {
      const {error} = await supabase.rpc('start_meal', {
        p_meal_id: meal.id,
        p_actor_member_id: currentMember.id,
        p_participant_ids: participantIds
      });
      if (error) throw new Error(databaseErrorMessage('Fressung konnte nicht gestartet werden', error));
      closeModal('startModal');
      await refreshAndRender();
      toast('Fressung gestartet. Die ausgewählten Personen können jetzt bewerten.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function submitRating() {
    const meal = mealById(selectedMealId);
    if (!meal || !currentMember) return;
    if (CATEGORY_DEFS.some(category => !Number.isFinite(ratingValues[category.key]))) {
      toast('Bitte bewerte alle vier Kategorien.');
      return;
    }
    const button = $('#saveRating');
    button.disabled = true;
    try {
      const {error} = await supabase.rpc('submit_meal_rating', {
        p_meal_id: meal.id,
        p_member_id: currentMember.id,
        p_food: ratingValues.food,
        p_service: ratingValues.service,
        p_ambience: ratingValues.ambience,
        p_value_for_money: ratingValues.value_for_money,
        p_comment: $('#ratingComment').value.trim() || null
      });
      if (error) throw new Error(databaseErrorMessage('Bewertung konnte nicht gespeichert werden', error));
      closeModal('ratingModal');
      const waitingFor = mealParticipants(meal.id).filter(participant => participant.member_id !== currentMember.id && !memberRating(meal.id, participant.member_id)).length;
      await refreshAndRender();
      toast(waitingFor === 0
        ? 'Bewertung gespeichert. Die Fressung ist abgeschlossen!'
        : `Bewertung gespeichert. Noch ${waitingFor} ${waitingFor === 1 ? 'Bewertung steht' : 'Bewertungen stehen'} aus.`);
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function createMeal() {
    const restaurant = $('#restaurant').value.trim();
    const place = $('#mealPlace').value.trim();
    const mapsUrl = $('#mapsUrl').value.trim();
    if (!restaurant || !place) {
      toast('Bitte gib Restaurant und Ort an.');
      return;
    }
    if (mapsUrl && !validMapsUrl(mapsUrl)) {
      toast('Der Maps-Link muss eine gültige HTTP- oder HTTPS-Adresse sein.');
      return;
    }
    const button = $('#saveCreate');
    button.disabled = true;
    try {
      const {error} = await supabase.from('meals').insert({
        restaurant_name: restaurant,
        place,
        maps_url: mapsUrl || null,
        note: $('#note').value.trim() || null,
        creator_member_id: currentMember.id,
        status: 'waiting'
      });
      if (error) throw new Error(databaseErrorMessage('Fressung konnte nicht angelegt werden', error));
      closeModal('createModal');
      $('#restaurant').value = '';
      $('#mealPlace').value = '';
      $('#mapsUrl').value = '';
      $('#note').value = '';
      resetRestaurantSearch();
      await refreshAndRender();
      toast('Fressung angelegt und für die Gruppe bereitgestellt.');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function refreshAndRender() {
    await fetchWorkspaceData();
    render();
  }

  async function createMember() {
    const name = $('#newMemberName').value.trim();
    if (!name) {
      setMessage($('#memberMessage'), 'Bitte gib deinen Vornamen ein.');
      return;
    }
    if (members.some(member => member.display_name.trim().toLocaleLowerCase('de-DE') === name.toLocaleLowerCase('de-DE'))) {
      setMessage($('#memberMessage'), 'Dieser Vorname wird bereits verwendet (Groß-/Kleinschreibung wird ignoriert). Wähle ihn oben aus oder trage einen anderen ein.');
      return;
    }
    $('#createMember').disabled = true;
    setMessage($('#memberMessage'), '');
    try {
      const {data, error} = await supabase.from('members')
        .insert({display_name: name, is_active: true})
        .select('id,display_name,is_active,created_at')
        .single();
      if (error) throw error;
      members = [...members, data].sort((left, right) => left.display_name.localeCompare(right.display_name, 'de'));
      $('#newMemberName').value = '';
      await enterApplication(data);
    } catch (error) {
      setMessage($('#memberMessage'), databaseErrorMessage('Vorname konnte nicht eingetragen werden', error));
    } finally {
      $('#createMember').disabled = false;
    }
  }

  async function signOut() {
    if (!supabase) return;
    const {error} = await supabase.auth.signOut();
    if (error) toast(authErrorMessage(error));
  }

  function handleAction(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const meal = mealById(target.dataset.id);
    if (action === 'start' && meal) openStart(meal);
    if (action === 'rate' && meal) openRating(meal);
    if (action === 'details' && meal) renderDetails(meal);
  }

  function bindUi() {
    $('#loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!supabase) {
        setMessage($('#authMessage'), 'Die Supabase-Verbindung ist nicht bereit. Prüfe den CDN-Zugriff und lade die Seite erneut.');
        return;
      }
      const pin = $('#groupPin').value;
      if (!pin) {
        setMessage($('#authMessage'), 'Bitte gib den Gruppen-PIN ein.');
        return;
      }
      const button = $('#loginButton');
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Anmeldung läuft …';
      setMessage($('#authMessage'), 'Anmeldung wird geprüft …');
      try {
        const {data, error} = await supabase.auth.signInWithPassword({email: GROUP_EMAIL, password: pin});
        if (error) throw error;
        if (!data?.session) {
          setMessage($('#authMessage'), 'Supabase hat keine Sitzung zurückgegeben. Prüfe, ob das Gruppen-Konto aktiv ist.');
          return;
        }
        $('#groupPin').value = '';
        setMessage($('#authMessage'), 'Anmeldung erfolgreich. Gruppenmitglieder werden geladen …');
        await activateSession(data.session);
      } catch (error) {
        setMessage($('#authMessage'), authErrorMessage(error));
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
    $('#chooseMember').addEventListener('click', () => {
      const member = members.find(candidate => candidate.id === $('#memberSelect').value && candidate.is_active);
      if (!member) {
        setMessage($('#memberMessage'), 'Wähle bitte einen aktiven Vornamen aus.');
        return;
      }
      void enterApplication(member);
    });
    $('#createMember').addEventListener('click', () => void createMember());
    $('#newMemberName').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void createMember();
      }
    });
    $('#cancelMemberChange').addEventListener('click', () => {
      if (!currentMember) return;
      $('#memberScreen').hidden = true;
      showApplication();
    });
    $('#memberLogout').addEventListener('click', () => void signOut());
    $('#failedLogout').addEventListener('click', () => void signOut());
    $('#confirmStart').addEventListener('click', () => void startMeal());
    $('#saveRating').addEventListener('click', () => void submitRating());
    $('#saveCreate').addEventListener('click', () => void createMeal());
    $('#openCreate').addEventListener('click', openCreateModal);
    $('#openCreateHistory').addEventListener('click', openCreateModal);
    $$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
    document.addEventListener('click', event => {
      const accountAction = event.target.closest('[data-account-action]');
      if (accountAction?.dataset.accountAction === 'change') showMemberGate();
      if (accountAction?.dataset.accountAction === 'logout') void signOut();
      handleAction(event);
    });
    bindNavigation();
  }

  function configureCreateForm() {
    $('#createModal .form-grid').innerHTML = `
      <div class="field restaurant-search"><label>Restaurant auf Google Maps suchen</label><div id="restaurantSearch"></div><div id="restaurantSearchStatus" class="small places-status" role="status" aria-live="polite"></div></div>
      <div class="field"><label for="restaurant">Restaurant</label><input id="restaurant" maxlength="160" placeholder="z. B. Ramen Jun"></div>
      <div class="field"><label for="creatorName">Ersteller</label><input id="creatorName" value="" disabled></div>
      <div class="field"><label for="mealPlace">Ort</label><input id="mealPlace" maxlength="200" placeholder="z. B. Berlin-Kreuzberg" required></div>
      <div class="field"><label for="mapsUrl">Google-Maps-Link (optional)</label><input id="mapsUrl" type="url" placeholder="https://maps.google.com/..."></div>
      <div class="field full"><label for="note">Notiz für die Gruppe (optional)</label><textarea id="note" maxlength="2000" placeholder="Warum müssen wir genau dort hin?"></textarea></div>`;
    $('#ratingModal .modal-head .small').textContent = 'Klicke links auf einen Stern für einen halben, rechts für einen ganzen Stern.';
  }

  function loadPlacesLibrary() {
    const apiKey = document.querySelector('meta[name="google-maps-api-key"]')?.content.trim();
    if (!apiKey) {
      return Promise.reject(new Error('Die Google-Maps-Suche ist noch nicht konfiguriert. Restaurant, Ort und Maps-Link kannst du weiterhin manuell eintragen.'));
    }
    if (!placesLibraryPromise) {
      placesLibraryPromise = new Promise((resolve, reject) => {
        if (window.google?.maps?.importLibrary) {
          window.google.maps.importLibrary('places').then(resolve, reject);
          return;
        }
        const callbackName = '__connoisseureGoogleMapsReady';
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          delete window[callbackName];
          callback(value);
        };
        const timeoutId = window.setTimeout(() => {
          finish(reject, new Error('Google Maps hat nicht rechtzeitig geladen. Prüfe den API-Key und die Netzwerkverbindung.'));
        }, 15000);
        window[callbackName] = () => {
          try {
            if (!window.google?.maps?.importLibrary) {
              throw new Error('Die Google-Maps-Bibliothek wurde nicht verfügbar.');
            }
            window.google.maps.importLibrary('places').then(
              library => finish(resolve, library),
              error => finish(reject, error)
            );
          } catch (error) {
            finish(reject, error);
          }
        };
        const previousAuthFailure = window.gm_authFailure;
        window.gm_authFailure = () => {
          $('#restaurantSearchStatus').textContent = 'Google Maps hat den API-Key abgelehnt. Prüfe die API- und Referrer-Beschränkungen.';
          if (typeof previousAuthFailure === 'function') previousAuthFailure();
        };
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
        script.onerror = () => finish(reject, new Error('Google Maps konnte nicht geladen werden. Prüfe den API-Key und die Netzwerkverbindung.'));
        document.head.appendChild(script);
      }).catch(error => {
        placesLibraryPromise = null;
        throw error;
      });
    }
    return placesLibraryPromise;
  }

  async function initializeRestaurantSearch() {
    const container = $('#restaurantSearch');
    const status = $('#restaurantSearchStatus');
    if (!container || placeAutocomplete || restaurantSearchInitializing) return;
    restaurantSearchInitializing = true;
    status.textContent = 'Restaurant-Suche wird geladen …';
    try {
      const {PlaceAutocompleteElement} = await loadPlacesLibrary();
      placeAutocomplete = new PlaceAutocompleteElement();
      placeAutocomplete.setAttribute('placeholder', 'Restaurant oder Adresse eingeben');
      placeAutocomplete.setAttribute('aria-label', 'Restaurant oder Adresse suchen');
      placeAutocomplete.includedPrimaryTypes = ['restaurant', 'cafe', 'bar'];
      placeAutocomplete.addEventListener('gmp-select', async event => {
        try {
          status.textContent = 'Restaurant wird übernommen …';
          const place = event.placePrediction.toPlace();
          await place.fetchFields({fields: ['displayName', 'formattedAddress', 'googleMapsURI', 'id']});
          if (!place.displayName) {
            throw new Error('Google Maps hat keinen Restaurantnamen zurückgegeben.');
          }
          $('#restaurant').value = place.displayName;
          $('#mealPlace').value = place.formattedAddress || '';
          $('#mapsUrl').value = place.googleMapsURI || (place.id
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName)}&query_place_id=${encodeURIComponent(place.id)}`
            : '');
          status.textContent = `Ausgewählt: ${place.displayName}`;
        } catch (error) {
          status.textContent = `Auswahl konnte nicht übernommen werden: ${error.message || 'Unbekannter Fehler.'}`;
        }
      });
      container.replaceChildren(placeAutocomplete);
      status.textContent = 'Suche nach Restaurant, Café oder Bar. Du kannst die Angaben danach bearbeiten.';
    } catch (error) {
      status.textContent = error.message || 'Google Maps konnte nicht geladen werden. Du kannst die Angaben manuell eintragen.';
    } finally {
      restaurantSearchInitializing = false;
    }
  }

  function resetRestaurantSearch() {
    const container = $('#restaurantSearch');
    if (container) container.replaceChildren();
    placeAutocomplete = null;
    $('#restaurantSearchStatus').textContent = '';
  }

  async function initialize() {
    configureCreateForm();
    bindUi();
    try {
      if (!window.supabase?.createClient) {
        showAuth('Die Supabase-Bibliothek konnte nicht geladen werden. Prüfe die Internetverbindung oder den CDN-Zugriff.');
        return;
      }
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const {data, error} = await supabase.auth.getSession();
      if (error) throw error;
      const {data: listenerData} = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          window.setTimeout(() => void activateSession(nextSession), 0);
        }
      });
      authSubscription = listenerData.subscription;
      await activateSession(data.session);
    } catch (error) {
      showAuth(`Supabase konnte nicht initialisiert werden: ${authErrorMessage(error)}`);
    }
  }

  window.addEventListener('beforeunload', () => authSubscription?.unsubscribe());
  void initialize();
})();
