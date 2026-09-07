/*
      ██╗          ██╗     ██╗
      ██║          ╚██╗   ██╔╝
      ██║           ╚██╗ ██╔╝ 
      ██║            ╚████╔╝  
      ██║             ╚██╔╝   
      ██║             ██╔██╗  
      ██║            ██╔╝ ╚██╗ 
      ██║           ██╔╝   ╚██╗
      ██████████╗  ██╔╝     ╚██╗
      ██████████║  ╚═╝       ╚═╝
      ╚═════════╝               
*/

const SCHEDULE_API = 'https://telegram2.korglosa.workers.dev';

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function getTwoWeekRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); 
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

async function getSuggestionGroups(title) {
  try {
    return await apiGet('/groups', { q: title });
  } catch (error) {
    console.error('getSuggestionGroups failed:', error.message);
    return [];
  }
}

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
