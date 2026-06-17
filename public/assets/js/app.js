(function () {
  const state = {
    config: null,
    context: null,
    building: 'A',
    start: 1,
    end: 12,
    buildingCache: new Map()
  };
  const elements = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    Object.assign(elements, {
      start: document.getElementById('period-start'),
      end: document.getElementById('period-end'),
      range: document.getElementById('range-control'),
      output: document.getElementById('time-output'),
      startLabel: document.getElementById('start-label'),
      endLabel: document.getElementById('end-label'),
      summary: document.getElementById('period-summary'),
      buildingGrid: document.getElementById('building-grid'),
      results: document.getElementById('results'),
      resultsTitle: document.getElementById('results-title'),
      resultsSubtitle: document.getElementById('results-subtitle'),
      count: document.getElementById('room-count'),
      dateLine: document.getElementById('date-line'),
      campusName: document.getElementById('campus-name'),
      dataVersion: document.getElementById('data-version')
    });

    bindRange();
    bindBuildings();

    try {
      state.config = window.CLASSROOM_CONFIG;
      if (!state.config) throw new Error('静态配置未加载。');
      state.context = todayContext(state.config);
      state.start = suggestedPeriod(state.context.minutes, state.config.periods);
      state.end = 12;
      elements.start.value = String(state.start);
      elements.end.value = String(state.end);
      elements.campusName.textContent = state.config.campus.name;
      elements.dateLine.textContent = `${state.context.month}月${state.context.day}日 · ${state.context.weekdayName} · 第${state.context.week}周`;
      elements.dataVersion.textContent = `课表学期 ${state.config.term} · 数据更新于 ${formatUpdatedAt(state.config.updatedAt)}`;
      configureBuildings();
      updateRange();
      selectBuilding('A');
    } catch (error) {
      showError(error.message);
    }
  }

  function bindRange() {
    elements.start.addEventListener('input', () => changeRange('start'));
    elements.end.addEventListener('input', () => changeRange('end'));
  }

  function bindBuildings() {
    elements.buildingGrid.querySelectorAll('[data-building]').forEach((button) => {
      button.addEventListener('click', () => selectBuilding(button.dataset.building));
    });
  }

  function configureBuildings() {
    state.config.buildings.forEach((building) => {
      const button = elements.buildingGrid.querySelector(`[data-building="${building.key}"]`);
      if (!button) return;
      button.disabled = !building.enabled;
      button.setAttribute('aria-disabled', String(!building.enabled));
    });
  }

  function changeRange(handle) {
    let start = Number(elements.start.value);
    let end = Number(elements.end.value);
    if (start > end) {
      if (handle === 'start') end = start;
      else start = end;
    }
    state.start = start;
    state.end = end;
    elements.start.value = String(start);
    elements.end.value = String(end);
    updateRange();
    renderCurrentBuilding();
  }

  function updateRange() {
    if (!state.config) return;
    const left = ((state.start - 1) / 11) * 100;
    const right = ((12 - state.end) / 11) * 100;
    const periods = state.config.periods;
    elements.range.style.setProperty('--range-left', `${left}%`);
    elements.range.style.setProperty('--range-right', `${right}%`);
    elements.output.textContent = `${periods[state.start - 1][0]} - ${periods[state.end - 1][1]}`;
    elements.startLabel.textContent = `第${state.start}节`;
    elements.endLabel.textContent = `第${state.end}节`;
    const count = state.end - state.start + 1;
    elements.summary.textContent = state.start === 1 && state.end === 12 ? '全天 · 12节' : `共 ${count} 节`;
  }

  async function selectBuilding(key) {
    const building = state.config.buildings.find((item) => item.key === key);
    if (!building || !building.enabled) return;

    state.building = key;
    elements.buildingGrid.querySelectorAll('[data-building]').forEach((button) => {
      const active = button.dataset.building === key;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.resultsTitle.textContent = `${building.label}空教室`;

    if (!state.buildingCache.has(key)) {
      showLoading(`正在加载${building.label}课表`);
      try {
        state.buildingCache.set(key, await loadBuilding(building));
      } catch (error) {
        showError(error.message);
        return;
      }
    }
    renderCurrentBuilding();
  }

  function renderCurrentBuilding() {
    const data = state.buildingCache.get(state.building);
    if (!data || !state.context) return;
    if (state.context.week < 1 || state.context.week > 30) {
      elements.count.textContent = '0';
      elements.resultsSubtitle.textContent = '当前日期不在已配置的教学周内';
      elements.results.innerHTML = '<div class="empty-state">请更新静态数据中的学期与开学日期</div>';
      return;
    }

    const freeRooms = data.rooms
      .filter(isRoomFree)
      .map((room) => ({ room: room[0], floor: room[1] }));
    const periods = state.config.periods;
    elements.resultsSubtitle.textContent = `${periods[state.start - 1][0]} - ${periods[state.end - 1][1]} 可用`;
    elements.count.textContent = String(freeRooms.length);
    renderRooms(freeRooms);
  }

  function isRoomFree(room) {
    const weekBit = 2 ** (state.context.week - 1);
    return !room[2].some((event) => {
      const [weekday, periodStart, periodEnd, weekMask] = event;
      const activeWeek = Math.floor(weekMask / weekBit) % 2 === 1;
      const activeDay = weekday === 0 || weekday === state.context.weekday;
      const overlaps = periodStart === 0 || periodEnd === 0 || (periodStart <= state.end && periodEnd >= state.start);
      return activeWeek && activeDay && overlaps;
    });
  }

  function renderRooms(rooms) {
    if (!rooms.length) {
      elements.results.innerHTML = '<div class="empty-state">这个时间段没有空教室</div>';
      return;
    }
    const groups = new Map();
    rooms.forEach((room) => {
      const floor = room.floor == null ? '其他' : `${room.floor}层`;
      if (!groups.has(floor)) groups.set(floor, []);
      groups.get(floor).push(room);
    });
    elements.results.innerHTML = [...groups.entries()].map(([floor, items]) => `
      <section class="floor-group">
        <h3>${escapeHtml(floor)}<span>${items.length}间</span></h3>
        <div class="room-grid">
          ${items.map((room) => `<div class="room-item" data-room="${escapeHtml(room.room)}" tabindex="0" role="button" aria-label="查看${escapeHtml(room.room)}课表">${escapeHtml(room.room)}</div>`).join('')}
        </div>
      </section>
    `).join('');

    elements.results.querySelectorAll('.room-item').forEach((item) => {
      item.addEventListener('click', () => openSchedule(item.dataset.room));
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSchedule(item.dataset.room); });
    });
  }

  function todayContext(config) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: config.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
    );
    const currentDay = Date.UTC(parts.year, parts.month - 1, parts.day);
    const [startYear, startMonth, startDay] = config.semesterStart.split('-').map(Number);
    const semesterDay = Date.UTC(startYear, startMonth - 1, startDay);
    const week = Math.floor((currentDay - semesterDay) / 604800000) + 1;
    const jsWeekday = new Date(currentDay).getUTCDay();
    const weekday = jsWeekday === 0 ? 7 : jsWeekday;
    return {
      ...parts,
      week,
      weekday,
      weekdayName: ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][weekday - 1],
      minutes: parts.hour * 60 + parts.minute
    };
  }

  function suggestedPeriod(minutes, periods) {
    for (let index = 0; index < periods.length; index += 1) {
      const [hour, minute] = periods[index][1].split(':').map(Number);
      if (minutes <= hour * 60 + minute) return index + 1;
    }
    return 12;
  }

  function loadBuilding(building) {
    const existing = window.CLASSROOM_BUILDINGS?.[building.key];
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(building.file, document.baseURI).href;
      script.onload = () => {
        const data = window.CLASSROOM_BUILDINGS?.[building.key];
        if (data) resolve(data);
        else reject(new Error(`${building.label}静态数据格式错误。`));
      };
      script.onerror = () => reject(new Error(`${building.label}静态数据加载失败。`));
      document.head.appendChild(script);
    });
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || '未知';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: state.config.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function showLoading(message) {
    elements.count.textContent = '--';
    elements.results.innerHTML = `<div class="loading-row"><span></span>${escapeHtml(message)}</div>`;
  }

  function showError(message) {
    elements.count.textContent = '--';
    elements.resultsSubtitle.textContent = '数据不可用';
    elements.results.innerHTML = `<div class="empty-state error">${escapeHtml(message)}</div>`;
  }

  function formatPeriodTime(index) {
    const periods = state.config.periods;
    if (index < 0 || index >= periods.length) return '--:--';
    return periods[index][0] + ' - ' + periods[index][1];
  }

  function openSchedule(roomName) {
    const data = state.buildingCache.get(state.building);
    if (!data || !state.context) return;
    const room = data.rooms.find((r) => r[0] === roomName);
    if (!room) return;

    const weekBit = 2 ** (state.context.week - 1);
    const todayEvents = room[2].filter((event) => {
      const [weekday, , , weekMask] = event;
      const activeWeek = Math.floor(weekMask / weekBit) % 2 === 1;
      const activeDay = weekday === 0 || weekday === state.context.weekday;
      return activeWeek && activeDay;
    }).sort((a, b) => a[1] - b[1]);

    const building = state.config.buildings.find((b) => b.key === state.building);
    const buildingLabel = building ? building.label : state.building + '教';

    let scheduleHtml;
    if (todayEvents.length === 0) {
      scheduleHtml = '<p class="schedule-empty">今天无课程安排</p>';
    } else {
      scheduleHtml = '<ul class="schedule-list">' + todayEvents.map((event) => {
        const content = event[4] || '（无课程名）';
        return `<li>
          <span class="schedule-time">${formatPeriodTime(event[1] - 1)} ~ ${formatPeriodTime(event[2] - 1)}</span>
          <span class="schedule-content">${escapeHtml(content)}</span>
        </li>`;
      }).join('') + '</ul>';
    }

    const modal = document.createElement('div');
    modal.className = 'schedule-modal-overlay';
    modal.innerHTML = `<div class="schedule-modal" role="dialog" aria-label="${escapeHtml(roomName)}课表">
      <div class="schedule-modal-header">
        <h2>${escapeHtml(buildingLabel)} ${escapeHtml(roomName)}</h2>
        <p>${state.context.weekdayName} · 第${state.context.week}周</p>
        <button class="schedule-modal-close" aria-label="关闭">&times;</button>
      </div>
      <div class="schedule-modal-body">${scheduleHtml}</div>
    </div>`;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.add('is-closing');
      setTimeout(() => modal.remove(), 200);
      document.removeEventListener('keydown', escHandler);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };

    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('.schedule-modal-close').addEventListener('click', close);
    document.addEventListener('keydown', escHandler);
    requestAnimationFrame(() => modal.classList.add('is-open'));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
