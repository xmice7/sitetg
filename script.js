// =============================================
// Клієнт розкладу для браузера
//
// dekanat.lnu.edu.ua не віддає CORS і працює у windows-1251,
// тому браузер ходить не напряму, а через Cloudflare Worker (див. worker.js),
// який перекодовує відповідь і повертає готовий JSON.
//
// Використання:
//   const groups = await getSuggestionGroups('ФЕП');   // ['ФЕП-11с', ...]
//   const schedule = await getSchedule('ФЕП-13с');       // цей + наступний тиждень
//   const schedule = await getSchedule('ФЕП-13с', { sdate: '01.09.2026', edate: '07.09.2026' });
// =============================================

// Адреса задеплоєного worker.js (без слеша в кінці)
const SCHEDULE_API = 'https://telegram2.korglosa.workers.dev';

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

// Понеділок поточного тижня та неділя наступного
function getTwoWeekRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Нд=0 -> 6, Пн=1 -> 0
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  return { sdate: formatDate(start), edate: formatDate(end) };
}

async function apiGet(path, params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${SCHEDULE_API}${path}?${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

// Підказки назв груп за початком назви
async function getSuggestionGroups(title) {
  try {
    return await apiGet('/groups', { q: title });
  } catch (error) {
    console.error('getSuggestionGroups failed:', error.message);
    return [];
  }
}

// Розклад групи у вигляді JSON:
// { group, from, to, days: [{ date, weekday, slots: [{ number, start, end, lessons: [...] }] }] }
async function getSchedule(group, range=getTwoWeekRange()) {
  try {
    return await apiGet('/schedule', { group, ...(range || {}) });
  } catch (error) {
    console.error('getSchedule failed:', error.message);
    return null;
  }
}

window.getSuggestionGroups = getSuggestionGroups;
window.getSchedule = getSchedule;
window.getTwoWeekRange = getTwoWeekRange;
