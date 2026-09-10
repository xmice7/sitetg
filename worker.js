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

const DEKANAT = 'https://dekanat.lnu.edu.ua/cgi-bin/timetable.cgi';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const win1251Decoder = new TextDecoder('windows-1251');

const win1251Table = (() => {
  const map = new Map();
  for (let b = 0x80; b <= 0xff; b++) {
    map.set(win1251Decoder.decode(new Uint8Array([b])), b);
  }
  return map;
})();

function encodeWin1251Param(value) {
  let out = '';
  for (const ch of String(value)) {
    const code = ch.charCodeAt(0);
    const byte = code < 0x80 ? code : win1251Table.get(ch);
    if (byte === undefined) continue; 
    out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function encodeForm(params) {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeWin1251Param(value)}`)
    .join('&');
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function getTwoWeekRange() {
  const kyiv = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
  const start = new Date(kyiv.getFullYear(), kyiv.getMonth(), kyiv.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  return { sdate: formatDate(start), edate: formatDate(end) };
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstMatch(html, regex) {
  const m = html.match(regex);
  return m ? stripTags(m[1]) : null;
}

function parseLessonCell(cellHtml) {
  const lessons = [];
  for (const chunk of cellHtml.split(/<br>\s*<br>/i)) {
    const subject = firstMatch(chunk, /<span class="p_name">([\s\S]*?)<\/span>/);
    if (!subject) continue;

    const groupInfo = firstMatch(chunk, /<span class="gr2_name">([\s\S]*?)<\/span>/);
    const subgroupMatch = groupInfo && groupInfo.match(/підгр\.\s*(\d+)/i);

    lessons.push({
      subject,
      type: firstMatch(chunk, /<span class="p_type_name">([\s\S]*?)<\/span>/),
      teacher: firstMatch(chunk, /<span class="t_name">([\s\S]*?)<\/span>/),
      room: firstMatch(chunk, /<span class="room_name">([\s\S]*?)<\/span>/),
      subgroup: subgroupMatch ? Number(subgroupMatch[1]) : null,
      groupInfo: groupInfo || null, 
    });
  }
  return lessons;
}

function parseScheduleHtml(html) {
  const header = html.match(/Розклад групи\s*<a[^>]*>([^<]+)<\/a>\s*з\s*([\d.]+)\s*по\s*([\d.]+)/);
  const days = [];

  const dayRegex = /<h4>(\d{2}\.\d{2}\.\d{4})\s*<small>([^<]*)<\/small><\/h4><table[^>]*>([\s\S]*?)<\/table>/g;
  let dayMatch;
  while ((dayMatch = dayRegex.exec(html)) !== null) {
    const [, date, weekday, tableHtml] = dayMatch;
    const slots = [];

    const rowRegex = /<tr><td>(\d+)<\/td><td>(\d{2}:\d{2})<br>(\d{2}:\d{2})<\/td><td[^>]*>([\s\S]*?)<\/td><\/tr>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const [, number, start, end, cell] = rowMatch;
      slots.push({ number: Number(number), start, end, lessons: parseLessonCell(cell) });
    }

    days.push({ date, weekday: weekday.trim(), slots });
  }

  return {
    group: header ? header[1].trim() : null,
    from: header ? header[2] : null,
    to: header ? header[3] : null,
    days,
  };
}

async function fetchWin1251(url, init = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`dekanat responded ${response.status}`);
    return win1251Decoder.decode(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function getSuggestionGroups(title) {
  const query = new URLSearchParams({ n: 701, lev: 142, faculty: 0, course: 0, query: title }).toString();
  const json = JSON.parse(await fetchWin1251(`${DEKANAT}?${query}`));
  return json.suggestions || [];
}

async function getSchedule(group, range) {
  const body = encodeForm({ group, sdate: range.sdate, edate: range.edate, n: 700 });
  const html = await fetchWin1251(`${DEKANAT}?n=700`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseScheduleHtml(html);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;

async function handleScheduleRoutes(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== '/groups' && url.pathname !== '/schedule') return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  try {
    if (url.pathname === '/groups') {
      const q = url.searchParams.get('q') || '';
      return json(await getSuggestionGroups(q), 200, { 'Cache-Control': 'public, max-age=3600' });
    }

    if (url.pathname === '/schedule') {
      const group = url.searchParams.get('group');
      if (!group) return json({ error: 'group is required' }, 400);

      const sdate = url.searchParams.get('sdate');
      const edate = url.searchParams.get('edate');
      const range = DATE_RE.test(sdate || '') && DATE_RE.test(edate || '')
        ? { sdate, edate }
        : getTwoWeekRange();

      const kv = env?.PREFS_KV;
      const cleanGroup = String(group).trim();
      const cacheKey = `sched_cache:${cleanGroup}:${range.sdate}_${range.edate}`;
      const fallbackKey = `sched_fallback:${cleanGroup}`;

      let cachedEntry = null;
      if (kv) {
        try {
          const raw = await kv.get(cacheKey);
          if (raw) cachedEntry = JSON.parse(raw);
        } catch {}
      }

      const FRESH_TTL_MS = 900000;
      if (cachedEntry && cachedEntry.schedule && (Date.now() - (cachedEntry.ts || 0) < FRESH_TTL_MS)) {
        return json(cachedEntry.schedule, 200, {
          'Cache-Control': 'public, max-age=600',
          'X-Cache-Status': 'HIT'
        });
      }

      try {
        const fresh = await getSchedule(cleanGroup, range);
        if (fresh && Array.isArray(fresh.days) && fresh.days.length > 0) {
          if (kv) {
            const entry = JSON.stringify({ ts: Date.now(), schedule: fresh });
            const saveTask = Promise.all([
              kv.put(cacheKey, entry, { expirationTtl: 1209600 }),
              kv.put(fallbackKey, entry, { expirationTtl: 1209600 })
            ]);
            if (ctx?.waitUntil) ctx.waitUntil(saveTask); else await saveTask.catch(() => {});
          }
          return json(fresh, 200, {
            'Cache-Control': 'public, max-age=600',
            'X-Cache-Status': 'MISS'
          });
        }
      } catch (err) {
        console.warn('Dekanat fetch failed, trying fallback cache:', err.message);
      }

      if (cachedEntry && cachedEntry.schedule) {
        return json({
          ...cachedEntry.schedule,
          _isStaleFallback: true,
          _cachedAt: cachedEntry.ts || null
        }, 200, {
          'Cache-Control': 'public, max-age=60',
          'X-Cache-Status': 'STALE-FALLBACK'
        });
      }

      if (kv) {
        try {
          const rawFb = await kv.get(fallbackKey);
          if (rawFb) {
            const fb = JSON.parse(rawFb);
            if (fb && fb.schedule) {
              return json({
                ...fb.schedule,
                _isStaleFallback: true,
                _cachedAt: fb.ts || null
              }, 200, {
                'Cache-Control': 'public, max-age=60',
                'X-Cache-Status': 'STALE-FALLBACK'
              });
            }
          }
        } catch {}
      }

      return json({ error: 'Сервер деканату тимчасово недоступний, резервна копія для цієї групи ще не збережена' }, 502);
    }
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}

/* =========================================================================
   DEKANAT LNU JOURNAL & GRADES ENGINE
   ========================================================================= */

const DEKANAT_CLASSMAN_URL = 'https://dekanat.lnu.edu.ua/cgi-bin/classman.cgi';

const GRADE_CATEGORIES = {
  "Лек": { label: "Контроль на лекції", icon: "📖", color: "#3b82f6" },
  "ПрСем": { label: "Практич./Семін. зан.", icon: "✍️", color: "#8b5cf6" },
  "Лаб": { label: "Лабораторні роб.", icon: "🔬", color: "#10b981" },
  "ІнЗан": { label: "Інд. заняття", icon: "👤", color: "#06b6d4" },
  "Сам": { label: "Контроль самостійної", icon: "📝", color: "#f59e0b" },
  "ІндЗд": { label: "Інд. завд: КП, КР, РГР", icon: "📑", color: "#ec4899" },
  "Доп": { label: "Доповідь", icon: "🎤", color: "#6366f1" },
  "ПрЗд": { label: "Перездача (відпрац.)", icon: "🔄", color: "#f97316" },
  "МК": { label: "Модульний контроль", icon: "📊", color: "#ef4444" },
  "КтР": { label: "Контрольна робота", icon: "📋", color: "#e11d48" },
  "Тест": { label: "Тест", icon: "⏱️", color: "#14b8a6" },
  "Кол": { label: "Колоквіум", icon: "🗣️", color: "#a855f7" },
  "Інше": { label: "Інше", icon: "📌", color: "#64748b" },
  "Екз": { label: "Екзамен", icon: "🎓", color: "#dc2626" },
  "ЗалДз": { label: "Залік / диф. зал.", icon: "✅", color: "#059669" }
};

function extractStudentDossier(html, detectedGroup = "") {
  const plainText = stripTags(html);
  function matchField(regex) {
    const m = plainText.match(regex);
    return m ? m[1].replace(/^[":\s]+|[":\s]+$/g, "").trim() : "";
  }

  let faculty = matchField(/Факультет(?:\s+Факультет)?(?::|\s+)?([^\n\r|<]+?)(?=(?:Спеціальність|Ступінь|Освітній|Груп+а|Форма|Наказ|$))/i);
  if (!faculty) faculty = matchField(/Факультет(?::|\s+)?([^\n\r|<]+)/i);
  faculty = (faculty || "").replace(/^Факультет\s+/i, "").trim();
  if (faculty && !faculty.toLowerCase().startsWith("факультет")) {
    faculty = "Факультет " + faculty;
  }

  let specialty = matchField(/Спеціальність(?::|\s+)?([^\n\r|<]+?)(?=(?:Ступінь|Освітній|Груп+а|Форма|Наказ|$))/i);
  if (!specialty) specialty = matchField(/Спеціальність(?::|\s+)?([^\n\r|<]+)/i);
  if (specialty) specialty = specialty.replace(/^["«]|["»]$/g, '').trim();

  let degree = matchField(/(?:Ступінь(?:\s*\/\s*Освітньо-професійний ступінь)?|Освітній ступінь|Освітньо-професійний ступінь)(?::|\s+)?([^\n\r|<]+?)(?=(?:Груп+а|Форма|Наказ|$))/i);
  if (!degree) degree = matchField(/(?:Ступінь|Освітній ступінь)(?::|\s+)?([^\n\r|<]+)/i);

  let group = matchField(/Груп+а(?::|\s+)?([^\n\r|<|]+?)(?=(?:Форма|Наказ|Термін|$))/i);
  if (!group) group = matchField(/Груп+а(?::|\s+)?([^\n\r|<|]+)/i);
  if (!group && detectedGroup) group = detectedGroup;

  let studyForm = matchField(/Форма навчання(?::|\s+)?([^\n\r|<]+?)(?=(?:Форма оплати|Наказ|Термін|$))/i);
  if (!studyForm) studyForm = matchField(/Форма навчання(?::|\s+)?([^\n\r|<]+)/i);

  let paymentForm = matchField(/Форма оплати(?:\s+навчання)?(?::|\s+)?([^\n\r|<]+?)(?=(?:Наказ|Термін|Дата|$))/i);
  if (!paymentForm) paymentForm = matchField(/Форма оплати(?:\s+навчання)?(?::|\s+)?([^\n\r|<]+)/i);

  let enrollmentOrder = matchField(/Наказ на зарахування(?::|\s+)?([^\n\r|<]+?)(?=(?:Термін|Дата|$))/i);
  if (!enrollmentOrder) enrollmentOrder = matchField(/Наказ на зарахування(?::|\s+)?([^\n\r|<]+)/i);

  let studyTerm = matchField(/Термін навчання(?::|\s+)?([^\n\r|<]+?)(?=(?:Дата|$))/i);
  if (!studyTerm) studyTerm = matchField(/Термін навчання(?::|\s+)?([^\n\r|<]+)/i);

  let graduationDate = matchField(/Дата закінчення(?:\s+навчання)?(?::|\s+)?([^\n\r|<]+)/i);

  // Fallback defaults from group prefix if any field is not explicitly present in journal HTML table
  const grp = (group || detectedGroup || "").toUpperCase();
  if (!faculty && (grp.startsWith("ФЕ") || grp.startsWith("FE"))) {
    faculty = "Факультет електроніки та комп'ютерних технологій";
  }
  if (!specialty) {
    if (grp.startsWith("ФЕП")) specialty = "Інженерія програмного забезпечення";
    else if (grp.startsWith("ФЕІ")) specialty = "Інформаційні системи та технології";
    else if (grp.startsWith("ФЕС")) specialty = "Комп'ютерні науки";
    else if (grp.startsWith("ФЕК")) specialty = "Комп'ютерна інженерія";
    else if (grp.startsWith("ФЕА")) specialty = "Автоматизація та комп'ютерно-інтегровані технології";
    else if (grp.startsWith("ФЕМ")) specialty = "Мікро- та наносистемна техніка";
    else if (grp.startsWith("ФЕТ")) specialty = "Телекомунікації та радіотехніка";
  }
  if (!degree) {
    degree = grp.includes("М") && !grp.startsWith("ФЕМ") ? "магістр" : "бакалавр";
  }
  if (!studyForm) studyForm = "Денна";
  if (!studyTerm) studyTerm = degree.toLowerCase().includes("магістр") ? "1.5 роки" : "4 роки";

  return {
    university: "Львівський національний університет імені Івана Франка",
    faculty: faculty || "Львівський національний університет імені Івана Франка",
    specialty: specialty || "",
    degree: degree || "бакалавр",
    group: group || detectedGroup || "",
    studyForm: studyForm || "Денна",
    paymentForm: paymentForm || "",
    enrollmentOrder: enrollmentOrder || "",
    studyTerm: studyTerm || "",
    graduationDate: graduationDate || ""
  };
}

function findGradesTable(html) {
  const allTables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  if (!allTables.length) return null;

  // Prefer table that has grades indicators (бал, ects, grade category headers)
  for (const t of allTables) {
    const tableHtml = t[1];
    const hasScoreHeader = /<th>[^<]*(?:бал|ects|підсумок|разом)[^<]*<\/th>/i.test(tableHtml) ||
                           /class=["\x27][^"\x27]*(?:bal|ects|grade)/i.test(tableHtml);
    const hasGradeCategory = /<th>[^<]*(?:Лаб|ПрСем|Лек|МК|КтР|Тест|Кол|Зал)[^<]*<\/th>/i.test(tableHtml);
    const hasDiscipline = /<th>[^<]*(?:Дисципліна|Предмет)[^<]*<\/th>/i.test(tableHtml);

    if (hasScoreHeader || (hasGradeCategory && hasDiscipline) || hasGradeCategory) {
      return t;
    }
  }

  // Fallback: table with maximum row count > 1
  let bestTable = allTables[0];
  let maxCells = 0;
  for (const t of allTables) {
    const cellsCount = (t[1].match(/<(?:td|th)/gi) || []).length;
    if (cellsCount > maxCells) {
      maxCells = cellsCount;
      bestTable = t;
    }
  }
  return bestTable;
}

function extractStudentName(html, fallbackUserName = "") {
  function clean(s) {
    if (!s) return "";
    return s.replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/ПС-Журнал.*?Web/i, "")
            .replace(/Авторизація користувача/i, "")
            .replace(/\s+/g, " ")
            .trim();
  }

  const UKR_NAME_RE = /([А-ЯІЇЄҐ][а-яіїєґ'\-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'\-]+){1,2})/;

  // Strip all tags to plain text for reliable matching
  const plain = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  // 1. "Студент: Прізвище Ім'я По батькові" — most reliable pattern in plain text
  const studentTextMatch = plain.match(/(?:Студент|ПІБ)[\s:]+([А-ЯІЇЄҐ][а-яіїєґ'\-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'\-]+){1,2})/i);
  if (studentTextMatch) {
    const name = studentTextMatch[1].trim();
    if (name && name !== "Студент" && name.length > 4) return name;
  }

  // 2. "Прізвище, ім'я по батькові: Прізвище Ім'я По батькові"
  const pibTextMatch = plain.match(/Прізвище[,\s]*(?:ім['\x27`]я)?[,\s]*(?:по батькові)?[\s:]+([А-ЯІЇЄҐ][а-яіїєґ'\-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'\-]+){1,2})/i);
  if (pibTextMatch) {
    const name = pibTextMatch[1].trim();
    if (name && name !== "Студент" && name.length > 4) return name;
  }

  // 3. "Журнал успішності студента: Прізвище Ім'я По батькові"
  const journalTextMatch = plain.match(/Журнал успішності студента:?\s+([А-ЯІЇЄҐ][а-яіїєґ'\-]+(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'\-]+){1,2})/i);
  if (journalTextMatch) {
    const name = journalTextMatch[1].trim();
    if (name && name !== "Студент" && name.length > 4) return name;
  }

  // 4. Try table cell format in raw HTML: <th>Студент</th><td>NAME</td>
  const cellMatch = html.match(/<(?:th|td)[^>]*>\s*(?:Студент|ПІБ)\s*:?\s*<\/(?:th|td)>\s*<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/i);
  if (cellMatch) {
    const name = clean(cellMatch[1]);
    if (name && name !== "Студент" && name.length > 2) return name;
  }

  // 5. <h3> that contains a Ukrainian name (not the auth/title strings)
  const h3Matches = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  for (const m of h3Matches) {
    const text = clean(m[1]);
    if (!text || /Авторизація|ПС-Журнал|успішності-Web/i.test(text)) continue;
    const nameMatch = text.match(UKR_NAME_RE);
    if (nameMatch && nameMatch[1].length > 4) return nameMatch[1].trim();
  }

  // 6. <li class="active"> containing a Ukrainian name
  const liMatch = html.match(/<li[^>]*class=["\x27][^"'\x27]*active[^"'\x27]*["\x27][^>]*>([\s\S]*?)<\/li>/i);
  if (liMatch) {
    const text = clean(liMatch[1]);
    if (text && !/Авторизація|ПС-Журнал/i.test(text)) {
      const nameMatch = text.match(UKR_NAME_RE);
      if (nameMatch && nameMatch[1].length > 4) return nameMatch[1].trim();
    }
  }

  // 7. Fallback: capitalise the login surname
  if (fallbackUserName && fallbackUserName.trim()) {
    const trimmed = fallbackUserName.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  return "Студент";
}

function parseDekanatGrades(html, fallbackUserName = "") {
  const studentName = extractStudentName(html, fallbackUserName);

  const groupMatch = html.match(/Група:\s*<b>([^<]+)<\/b>/i) || html.match(/Група:\s*([^|<]+)/i);
  const group = groupMatch ? stripTags(groupMatch[1]).trim() : "";

  const dossier = extractStudentDossier(html, group);
  dossier.studentName = studentName;

  const tableMatch = findGradesTable(html);
  if (!tableMatch) return { studentName, group: dossier.group || group, dossier, subjects: [], average: "0" };

  const tableHtml = tableMatch[1];
  const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (trMatches.length < 2) return { studentName, group: dossier.group || group, dossier, subjects: [], average: "0" };

  const headerRow = trMatches[0][1];
  let thMatches = [...headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  if (!thMatches.length) {
    thMatches = [...headerRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
  }
  const headers = thMatches.map((m, idx) => {
    const raw = m[1];
    const titleMatch = m[0].match(/title=["\x27]([^"\x27]*)["\x27]/i);
    const title = titleMatch ? titleMatch[1] : "";
    const text = stripTags(raw);
    const dateMatch = raw.match(/(\d{2}\.\d{2}(?:\.\d{2,4})?)/);
    const date = dateMatch ? dateMatch[1] : "";

    let category = "Інше";
    const catList = ["Лек", "ПрСем", "Лаб", "ІнЗан", "Сам", "ІндЗд", "Доп", "ПрЗд", "МК", "КтР", "Тест", "Кол", "Екз", "ЗалДз"];
    for (const c of catList) {
      if (text.includes(c) || title.includes(c)) {
        category = c;
        break;
      }
    }

    const isBal = /бал|всього|разом/i.test(text) || /class=["\x27][^"\x27]*bal/i.test(m[0]);
    const isEcts = /ects/i.test(text) || /class=["\x27][^"\x27]*ects/i.test(m[0]);

    return { idx, text, title, date, category, isBal, isEcts };
  });

  const subjects = [];
  for (let i = 1; i < trMatches.length; i++) {
    const rowHtml = trMatches[i][1];
    const tdMatches = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;

    const firstTd = stripTags(tdMatches[0][1]);
    if (!firstTd || /разом|всього|підсумок/i.test(firstTd)) continue;

    let subject = firstTd;
    let teacher = "";
    if (tdMatches.length > 1 && !headers[1]?.isBal && !headers[1]?.isEcts && headers[1]?.category === "Інше") {
      teacher = stripTags(tdMatches[1][1]);
    }

    let total = 0;
    let ects = "";
    const grades = [];

    tdMatches.forEach((td, colIdx) => {
      const colHeader = headers[colIdx];
      if (!colHeader) return;
      const tdContent = stripTags(td[1]);
      const tdTitle = (td[0].match(/title=["\x27]([^"\x27]*)["\x27]/i) || [])[1] || "";

      if (colHeader.isBal) {
        const num = parseFloat(tdContent.replace(",", "."));
        if (!isNaN(num)) total = num;
      } else if (colHeader.isEcts) {
        ects = tdContent;
      } else if (colIdx > (teacher ? 1 : 0)) {
        if (tdContent && tdContent !== "-" && tdContent !== "0" && tdContent !== "&nbsp;") {
          const numVal = parseFloat(tdContent.replace(",", "."));
          grades.push({
            category: colHeader.category,
            categoryLabel: GRADE_CATEGORIES[colHeader.category]?.label || colHeader.title || colHeader.category,
            date: colHeader.date || "",
            value: isNaN(numVal) ? tdContent : numVal,
            note: tdTitle
          });
        }
      }
    });

    if (!ects) {
      if (total >= 90) ects = "A";
      else if (total >= 81) ects = "B";
      else if (total >= 71) ects = "C";
      else if (total >= 61) ects = "D";
      else if (total >= 51) ects = "E";
      else if (total >= 35) ects = "FX";
      else if (total > 0) ects = "F";
    }

    subjects.push({
      subject,
      teacher,
      total,
      ects,
      grades
    });
  }

  const average = subjects.length ? (subjects.reduce((sum, s) => sum + s.total, 0) / subjects.length).toFixed(1) : "0";
  return {
    studentName,
    group: dossier.group || group,
    dossier,
    subjects,
    average
  };
}

async function fetchDekanatGrades(user_name, user_pwd) {
  const initRes = await fetch(`${DEKANAT_CLASSMAN_URL}?n=999`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    }
  });
  if (!initRes.ok) throw new Error("DEKANAT_UNAVAILABLE");

  const initBuf = await initRes.arrayBuffer();
  const initHtml = win1251Decoder.decode(initBuf);

  const actionMatch = initHtml.match(/action=["\x27]([^"\x27]+)["\x27]/i);
  const tMatch = initHtml.match(/name=["\x27]t["\x27][^>]*value=["\x27]([^"\x27]*)["\x27]/i);
  const actionUrl = actionMatch
    ? (actionMatch[1].startsWith("http") ? actionMatch[1] : "https://dekanat.lnu.edu.ua/cgi-bin/" + actionMatch[1].replace("./", "").replace(/&amp;/g, "&"))
    : `${DEKANAT_CLASSMAN_URL}?n=1`;
  const tVal = tMatch ? tMatch[1] : "";

  const formBody = encodeForm({
    user_name: String(user_name).trim(),
    user_pwd: String(user_pwd).trim(),
    n: "1",
    rout: "",
    t: tVal,
    butsubm: "Увійти"
  });

  const postRes = await fetch(actionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": `${DEKANAT_CLASSMAN_URL}?n=999`,
      "User-Agent": 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    },
    body: formBody
  });

  const postBuf = await postRes.arrayBuffer();
  const postHtml = win1251Decoder.decode(postBuf);

  if (/Ви невірно вказали Прізвище або № залікової книжки/i.test(postHtml)) {
    throw new Error("AUTH_INVALID_CREDENTIALS");
  }

  if (/Access violation/i.test(postHtml) || /Internal Application Error/i.test(postHtml)) {
    throw new Error("DEKANAT_SERVER_ERROR");
  }

  return parseDekanatGrades(postHtml, user_name);
}

function findNewGrades(oldSubjects, newSubjects) {
  const newItems = [];
  const oldGradeKeys = new Set();

  for (const s of oldSubjects || []) {
    for (const g of s.grades || []) {
      oldGradeKeys.add(`${s.subject}__${g.category}__${g.date}__${g.value}`);
    }
  }

  for (const s of newSubjects || []) {
    for (const g of s.grades || []) {
      const key = `${s.subject}__${g.category}__${g.date}__${g.value}`;
      if (!oldGradeKeys.has(key)) {
        newItems.push({
          subject: s.subject,
          teacher: s.teacher,
          category: g.category,
          categoryLabel: g.categoryLabel || g.category,
          date: g.date,
          value: g.value,
          total: s.total
        });
      }
    }
  }

  return newItems;
}

async function notifyTelegramNewGrade(env, tgChatId, newGradeInfo) {
  if (!env.BOT_TOKEN || !tgChatId) return;
  const { subject, teacher, category, categoryLabel, value, date, total } = newGradeInfo;

  const text =
    `🎓 *Нова оцінка в Деканаті ЛНУ!*\n\n` +
    `📖 *Предмет:* ${subject}\n` +
    (teacher ? `👨‍🏫 *Викладач:* ${teacher}\n` : '') +
    `📊 *Оцінка:* *+${value} б.* (${category} — ${categoryLabel})\n` +
    (date ? `📅 *Дата:* ${date}\n` : '') +
    (total ? `📈 *Поточний бал з предмета:* *${total} / 100*\n` : '') +
    `\nПереглянути журнал: у додатку в розділі «Корисне» ➡️ «Мої бали» ↗️`;

  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tgChatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("notifyTelegramNewGrade error:", err);
  }
}

async function handleDekanatRoutes(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/dekanat')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const kv = env.PREFS_KV;

  // 1. POST /dekanat/login-check
  if (url.pathname === '/dekanat/login-check' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    const { user_name, user_pwd, userId } = body || {};

    if (!user_name || !user_pwd) {
      return json({ ok: false, error: 'Вкажіть прізвище та пароль (№ залікової книжки)' }, 400);
    }

    try {
      const parsedData = await fetchDekanatGrades(user_name, user_pwd);

      if (kv && userId) {
        await kv.put(`dekanat_creds:${userId}`, JSON.stringify({ user_name, user_pwd }));
        await kv.put(`dekanat_cache:${userId}`, JSON.stringify({ ts: Date.now(), data: parsedData }));
      }

      return json({
        ok: true,
        data: parsedData,
        lastSync: Date.now()
      });
    } catch (err) {
      if (err.message === 'AUTH_INVALID_CREDENTIALS') {
        return json({ ok: false, error: 'Ви невірно вказали прізвище або пароль (№ залікової книжки).' }, 401);
      }
      return json({ ok: false, error: 'Сервер Деканату ЛНУ тимчасово недоступний. Спробуйте пізніше.' }, 502);
    }
  }

  // 2. POST /dekanat/grades
  if (url.pathname === '/dekanat/grades' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
    let { user_name, user_pwd, userId, forceRefresh } = body || {};

    let cached = null;
    if (kv && userId) {
      try {
        const rawCache = await kv.get(`dekanat_cache:${userId}`);
        if (rawCache) cached = JSON.parse(rawCache);

        if (!user_name || !user_pwd) {
          const rawCreds = await kv.get(`dekanat_creds:${userId}`);
          if (rawCreds) {
            const creds = JSON.parse(rawCreds);
            user_name = creds.user_name;
            user_pwd = creds.user_pwd;
          }
        }
      } catch {}
    }

    if (!user_name || !user_pwd) {
      return json({ ok: false, error: 'NO_CREDENTIALS' }, 401);
    }

    // Cache TTL: 15 minutes if not forceRefresh
    const CACHE_TTL_MS = 15 * 60 * 1000;
    if (!forceRefresh && cached && cached.data && (Date.now() - (cached.ts || 0) < CACHE_TTL_MS)) {
      return json({
        ok: true,
        data: cached.data,
        cached: true,
        lastSync: cached.ts
      });
    }

    try {
      const freshData = await fetchDekanatGrades(user_name, user_pwd);

      // Check for new grades and send Telegram alerts
      if (cached && cached.data && Array.isArray(cached.data.subjects)) {
        const newGrades = findNewGrades(cached.data.subjects, freshData.subjects);
        if (newGrades.length > 0 && userId && env.BOT_TOKEN) {
          for (const ng of newGrades) {
            if (ctx && ctx.waitUntil) {
              ctx.waitUntil(notifyTelegramNewGrade(env, userId, ng));
            } else {
              notifyTelegramNewGrade(env, userId, ng).catch(() => {});
            }
          }
        }
      }

      if (kv && userId) {
        await kv.put(`dekanat_cache:${userId}`, JSON.stringify({ ts: Date.now(), data: freshData }));
      }

      return json({
        ok: true,
        data: freshData,
        cached: false,
        lastSync: Date.now()
      });
    } catch (err) {
      if (err.message === 'AUTH_INVALID_CREDENTIALS') {
        return json({ ok: false, error: 'AUTH_INVALID_CREDENTIALS' }, 401);
      }
      if (cached && cached.data) {
        return json({
          ok: true,
          data: cached.data,
          cached: true,
          offline: true,
          lastSync: cached.ts
        });
      }
      return json({ ok: false, error: 'Сервер Деканату ЛНУ тимчасово недоступний.' }, 502);
    }
  }

  // 3. POST /dekanat/logout
  if (url.pathname === '/dekanat/logout' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const { userId } = body || {};
    if (kv && userId) {
      await kv.delete(`dekanat_creds:${userId}`);
      await kv.delete(`dekanat_cache:${userId}`);
    }
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS,
      });
    }

    const scheduleResponse = await handleScheduleRoutes(request, env, ctx);
    if (scheduleResponse) return scheduleResponse;

    const dekanatResponse = await handleDekanatRoutes(request, env, ctx);
    if (dekanatResponse) return dekanatResponse;

    
    
    
    
    
    
    if (url.pathname === "/auth" && request.method === "GET") {
      const token = url.searchParams.get("token");
      const kv = env.PREFS_KV;
      if (!token) return new Response("Missing token", { status: 400 });
      if (!kv) return new Response("KV not configured", { status: 500 });

      try {
        const raw = await kv.get(`link_token:${token}`);
        if (!raw) {
          return new Response(JSON.stringify({ error: "Token not found or expired" }), {
            status: 404,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        
        await kv.delete(`link_token:${token}`);

        return new Response(raw, {
          headers: {
            "Content-Type": "application/json",
            
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        console.error("Auth endpoint error:", e);
        return new Response("Internal error", { status: 500 });
      }
    }

    
    
    
    
    

    
    
    
    
    if (url.pathname === "/gen-code" && request.method === "POST") {
      const kv = env.PREFS_KV;
      if (!kv) return new Response("KV not configured", { status: 500 });

      let body;
      try { body = await request.json(); }
      catch { return new Response("Bad JSON", { status: 400 }); }

      const code = String(body?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) {
        return new Response(JSON.stringify({ error: "Invalid code format" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      try {
        const key = `code_token:${code}`;
        const exists = await kv.get(key);
        if (exists) {
          return new Response(JSON.stringify({ error: "Code already exists" }), {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        await kv.put(key, "__pending__", { expirationTtl: 600 });

        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        console.error("gen-code endpoint error:", e);
        return new Response("Internal error", { status: 500 });
      }
    }

    
    
    
    
    if (url.pathname === "/auth-code" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const kv = env.PREFS_KV;
      if (!code) return new Response("Missing code", { status: 400 });
      if (!/^\d{6}$/.test(String(code))) return new Response("Bad code", { status: 400 });
      if (!kv) return new Response("KV not configured", { status: 500 });

      try {
        const key = `code_token:${code}`;
        const raw = await kv.get(key);
        if (!raw || raw === "__pending__") {
          return new Response(JSON.stringify({ error: "Code not found or not confirmed" }), {
            status: 404,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        
        await kv.delete(key);

        return new Response(raw, {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        console.error("auth-code endpoint error:", e);
        return new Response("Internal error", { status: 500 });
      }
    }

    if (url.pathname.startsWith("/avatar/")) {
      const userId = url.pathname.split("/")[2];
      const token = env.BOT_TOKEN;
      if (!userId || !token) return new Response("Not found", { status: 404 });

      try {
        const photoRes = await fetch(
          `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${userId}&limit=1`
        );
        const photoData = await photoRes.json();
        const fileId = photoData?.result?.photos?.[0]?.[0]?.file_id;
        if (!fileId) return new Response("No photo", { status: 404 });

        const fileRes = await fetch(
          `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
        );
        const fileData = await fileRes.json();
        const filePath = fileData?.result?.file_path;
        if (!filePath) return new Response("No file path", { status: 404 });

        
        const imgRes = await fetch(
          `https://api.telegram.org/file/bot${token}/${filePath}`
        );
        if (!imgRes.ok) return new Response("Fetch error", { status: 502 });

        const imgBuffer = await imgRes.arrayBuffer();
        return new Response(imgBuffer, {
          headers: {
            "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
            
            "Cache-Control": "public, max-age=3600, s-maxage=21600",
          },
        });
      } catch (e) {
        console.error("Avatar proxy error:", e);
        return new Response("Error", { status: 500 });
      }
    }

    
    
    
    
    
    if (url.pathname === "/user-sync") {
      const kv = env.PREFS_KV;
      const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
      if (!kv) return jsonRes({ error: "KV not configured" }, 500);

      if (request.method === "GET") {
        const uid = url.searchParams.get("uid");
        if (!uid) return jsonRes({ error: "Missing uid" }, 400);
        try {
          const raw = await kv.get(`user_sync:${uid}`);
          const parsed = raw ? JSON.parse(raw) : null;
          return jsonRes({ ok: true, data: parsed });
        } catch (e) {
          return jsonRes({ error: e.message }, 500);
        }
      }

      if (request.method === "POST") {
        let body;
        try { body = await request.json(); }
        catch { return jsonRes({ error: "Bad JSON" }, 400); }

        const { uid, data } = body || {};
        if (!uid || !data) return jsonRes({ error: "Missing uid or data" }, 400);

        try {
          const payload = {
            ...data,
            updatedAt: Date.now()
          };
          await kv.put(`user_sync:${uid}`, JSON.stringify(payload), { expirationTtl: 15552000 });

          if (data.activeGroup) {
            try {
              const currentBotPrefs = await kv.get(`u:${uid}`);
              const p = currentBotPrefs ? JSON.parse(currentBotPrefs) : {};
              const cleanG = String(data.activeGroup || "").trim().toLowerCase();
              const normG = (cleanG === "fep11" || cleanG === "феп-11с" || cleanG === "феп11" || cleanG === "феп 11") ? "fep11"
                : (cleanG === "fep12" || cleanG === "феп-12с" || cleanG === "феп12" || cleanG === "феп 12") ? "fep12"
                : (cleanG === "fep13" || cleanG === "феп-13с" || cleanG === "феп13" || cleanG === "феп 13") ? "fep13"
                : cleanG.replace(/[\s\-_с]/g, "");
              const gKey = data.activeGroupId || normG;
              const groupConf = (data.groupConfigs && (data.groupConfigs[gKey] || data.groupConfigs[normG] || data.groupConfigs[data.activeGroup])) || {};
              const updatedBot = {
                ...p,
                group: data.activeGroup,
                subgroup: groupConf.subgroup || p.subgroup || "all",
                eng: groupConf.eng || p.eng || "all",
                step: "done"
              };
              await kv.put(`u:${uid}`, JSON.stringify(updatedBot));
            } catch {}
          }

          return jsonRes({ ok: true, updatedAt: payload.updatedAt });
        } catch (e) {
          return jsonRes({ error: e.message }, 500);
        }
      }

      return jsonRes({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/donations" && request.method === "GET") {
      const kv = env.PREFS_KV;
      const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });

      let list = [];
      if (kv) {
        try {
          const raw = await kv.get("stars_leaderboard");
          if (raw) list = JSON.parse(raw);
        } catch {}
      }

      if (!list || list.length === 0) {
        list = [
          { name: "Олекса (@xmice)", group: "ФЕП-13с", stars: 50, badge: "👑 Автор / Топ-1" },
          { name: "Максим (@maksimko04)", group: "ФЕП-13с", stars: 25, badge: "🥈 Співавтор" },
          { name: "Студент ФЕП", group: "ФЕП-11с", stars: 15, badge: "🥉 Меценат" },
          { name: "Староста", group: "ФЕП-12с", stars: 10, badge: "⭐️ Друг розкладу" }
        ];
      }

      return jsonRes({ ok: true, donors: list });
    }

    if (url.pathname === "/create-stars-invoice" && request.method === "POST") {
      const token = env.BOT_TOKEN;
      const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
      if (!token) return jsonRes({ error: "BOT_TOKEN not configured" }, 500);

      let body;
      try { body = await request.json(); } catch { return jsonRes({ error: "Bad JSON" }, 400); }

      const stars = Number(body?.stars) || 5;
      const uid = String(body?.uid || "").trim();

      const title = stars === 1 ? "Кава для розкладу" : stars <= 5 ? "Піца для розкладу" : stars <= 15 ? "Меценат ФЕП" : "Легенда факультету";
      const desc = `${stars} ⭐️ на підтримку хостингу та розробки розкладу ФЕП`;
      const payload = JSON.stringify({ uid, stars, ts: Date.now() });

      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description: desc,
            payload,
            currency: "XTR",
            prices: [{ label: `${stars} Stars`, amount: stars }]
          })
        });
        const res = await r.json();
        if (!res.ok) {
          return jsonRes({ error: res.description || "Failed to create invoice link" }, 400);
        }
        return jsonRes({ ok: true, invoiceLink: res.result });
      } catch (e) {
        return jsonRes({ error: e.message }, 500);
      }
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const kv = env.PREFS_KV;
      const token = env.BOT_TOKEN;
      const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });

      if (!token) return jsonRes({ error: "BOT_TOKEN not configured" }, 500);
      if (!kv) return jsonRes({ error: "KV not configured" }, 500);

      let body;
      try { body = await request.json(); }
      catch { return jsonRes({ error: "Bad JSON" }, 400); }

      const { adminPass, adminUser, group = "all", text } = body || {};
      const broadcastPass = env.BROADCAST_PASSWORD ?? "0711";
      const adminPassHash = "d16e394090d88753b438e3285c7843113a67729ff93f0994d30cd80faa36f6ee";

      
      let isAuthed = false;
      if (adminUser) {
        const u = String(adminUser).toLowerCase().replace("@", "");
        if (u === "xmice" || String(adminUser) === String(env.ADMIN_USER_ID ?? "")) {
          isAuthed = true;
        }
      }
      if (!isAuthed && adminPass) {
        if (String(adminPass) === broadcastPass) {
          isAuthed = true;
        } else {
          try {
            const enc = new TextEncoder();
            const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(adminPass)));
            const hashHex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
            if (hashHex === adminPassHash) isAuthed = true;
          } catch {}
        }
      }

      if (!isAuthed) {
        return jsonRes({ error: "Unauthorized" }, 403);
      }

      const cleanText = String(text || "").trim();
      if (!cleanText) {
        return jsonRes({ error: "Повідомлення не може бути порожнім" }, 400);
      }

      const targetGroup = String(group || "all").trim();
      const isAll = !targetGroup || targetGroup.toLowerCase() === "all";

      const normGroup = (g) => {
        if (!g) return "";
        const s = String(g).trim().toLowerCase();
        if (s === "fep11" || s === "феп-11с" || s === "феп11" || s === "феп 11") return "fep11";
        if (s === "fep12" || s === "феп-12с" || s === "феп12" || s === "феп 12") return "fep12";
        if (s === "fep13" || s === "феп-13с" || s === "феп13" || s === "феп 13") return "fep13";
        return s.replace(/[\s\-_]/g, "");
      };

      const headerPrefix = !isAll
        ? `📢 *Оголошення для групи ${targetGroup}:*\n\n`
        : `📢 *Загальне оголошення:*\n\n`;
      const fullMessage = `${headerPrefix}${cleanText}`;

      const sendTg = async (chatId, msg) => {
        try {
          let r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
          });
          let res = await r.json();
          if (!res.ok) {
            
            r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chat_id: chatId, text: msg }),
            });
            res = await r.json();
          }
          return !!res.ok;
        } catch {
          return false;
        }
      };

      try {
        const result = { total: 0, sent: 0, failed: 0 };
        let cursor;
        do {
          const page = await kv.list({ prefix: "u:", cursor });
          for (const key of page.keys) {
            const uid = key.name.slice(2);
            if (!uid) continue;

            if (!isAll) {
              try {
                const rawPrefs = await kv.get(key.name);
                if (rawPrefs) {
                  const p = JSON.parse(rawPrefs);
                  const userGroup = (p && p.group) || "";
                  if (normGroup(userGroup) !== normGroup(targetGroup)) {
                    continue;
                  }
                } else {
                  continue;
                }
              } catch {
                continue;
              }
            }

            result.total++;
            const ok = await sendTg(uid, fullMessage);
            if (ok) result.sent++; else result.failed++;
          }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);

        return jsonRes({ ok: true, ...result });
      } catch (e) {
        console.error("broadcast error:", e);
        return jsonRes({ error: e.message || "Failed to broadcast" }, 500);
      }
    }

    
    
    
    if (request.method !== "POST") return new Response("OK");

    let update;
    try { update = await request.json(); }
    catch { return new Response("Bad JSON", { status: 400 }); }

    const token = env.BOT_TOKEN;
    if (!token) return new Response("Missing BOT_TOKEN", { status: 500 });

    if (update.pre_checkout_query) {
      await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true
        })
      });
      return new Response("OK");
    }

    
    
    
    
    
    
    const KV         = env.PREFS_KV ?? null;
    const WORKER_URL = env.WORKER_URL ?? "";
    const SITE_URL   = env.SITE_URL ?? "https://xmice7.github.io/sitetg/";

    
    
    
    const nowKyiv = () => {
      const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
      return new Date(Date.UTC(k.getFullYear(), k.getMonth(), k.getDate()));
    };
    const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
    const mondayOf = (d) => {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = x.getUTCDay();
      x.setUTCDate(x.getUTCDate() - (day === 0 ? 6 : day - 1));
      return x;
    };
    const isoOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

    const UA_DAYS   = ["Неділя","Понеділок","Вівторок","Середа","Четвер","П'ятниця","Субота"];
    const UA_MONTHS = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
    const dateLabel = (d) => `${UA_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${UA_MONTHS[d.getUTCMonth()]}`;

    
    const getWeekParity = (d) => {
      const mon = mondayOf(d);
      const refMon = new Date(Date.UTC(2026, 7, 31)); 
      const diffWeeks = Math.round((mon.getTime() - refMon.getTime()) / (7 * 86400000));
      return (((diffWeeks % 2) + 2) % 2) === 0 ? "Чисельник" : "Знаменник";
    };

    
    
    
    
    const LEGACY_GROUP_NAMES = { fep11: "ФЕП-11с", fep12: "ФЕП-12с", fep13: "ФЕП-13с" };
    const LESSON_TYPE_LABELS = { "Л": "Лекція", "Лаб": "Лабораторна", "ПрС": "Практична", "Сем": "Семінар", "Конс": "Консультація", "Екз": "Екзамен", "Зал": "Залік" };
    const TEACHER_RANKS = [["старший викладач", "ст. викл."], ["професор", "проф."], ["доцент", "доц."], ["асистент", "ас."], ["викладач", "викл."]];

    
    const shortTeacher = (full) => {
      if (!full) return "";
      let s = String(full).trim(), rank = "";
      for (const [long, short] of TEACHER_RANKS) {
        if (s.toLowerCase().startsWith(long)) { rank = short; s = s.slice(long.length).trim(); break; }
      }
      const parts = s.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) s = parts[0] + " " + parts.slice(1).map(p => p[0].toUpperCase() + ".").join("");
      return (rank ? rank + " " : "") + s;
    };

    
    const normalizeSchedule = (raw) => {
      const byDate = {}, engSet = new Set();
      let hasSubgroups = false, totalLessons = 0;
      for (const day of (raw && raw.days) || []) {
        const [dd, mm, yyyy] = day.date.split(".");
        const list = [];
        for (const slot of day.slots || []) {
          for (const l of slot.lessons || []) {
            const isCollective = /збірна/i.test(l.groupInfo || "");
            const isEng = isCollective && /іноземн|англійськ/i.test(l.subject || "");
            if (isEng && l.teacher) engSet.add(l.teacher);
            if (l.subgroup) hasSubgroups = true;
            list.push({
              start: slot.start, end: slot.end,
              title: l.subject || "", type: l.type || "", typeLabel: LESSON_TYPE_LABELS[l.type] || l.type || "",
              teacherFull: l.teacher || "", teacher: shortTeacher(l.teacher),
              room: (l.room || "").trim(), group: l.subgroup || null,
              potik: /потік/i.test(l.groupInfo || ""), isCollective, isEng,
            });
          }
        }
        totalLessons += list.length;
        byDate[`${yyyy}-${mm}-${dd}`] = list;
      }
      return { byDate, engTeachers: [...engSet], hasSubgroups, totalLessons };
    };

    
    const loadGroupSchedule = async (group) => {
      const key = `sched:${group}`;
      const fallbackKey = `sched_fallback:${group}`;
      if (KV) { try { const c = await KV.get(key); if (c) return JSON.parse(c); } catch {} }
      try {
        const raw = await getSchedule(group, getTwoWeekRange());
        if (raw && Array.isArray(raw.days) && raw.days.length > 0) {
          const info = normalizeSchedule(raw);
          if (KV) {
            try {
              await KV.put(key, JSON.stringify(info), { expirationTtl: 1800 });
              await KV.put(fallbackKey, JSON.stringify({ ts: Date.now(), schedule: raw }), { expirationTtl: 1209600 });
            } catch {}
          }
          return info;
        }
      } catch (e) {
        console.warn('Bot dekanat fetch failed, checking fallback:', e.message);
      }
      if (KV) {
        try {
          const fb = await KV.get(fallbackKey);
          if (fb) {
            const parsed = JSON.parse(fb);
            if (parsed?.schedule) return normalizeSchedule(parsed.schedule);
          }
        } catch {}
      }
      throw new Error("bad schedule");
    };

    
    
    
    
    const kvKey  = (uid) => `u:${uid}`;

    const getPrefs = async (uid) => {
      if (!KV) return null;
      try {
        const raw = await KV.get(kvKey(uid));
        const p = raw ? JSON.parse(raw) : null;
        if (p && LEGACY_GROUP_NAMES[p.group]) p.group = LEGACY_GROUP_NAMES[p.group]; 
        return p;
      } catch { return null; }
    };

    const setPrefs = async (uid, data) => {
      if (!KV) return;
      try { await KV.put(kvKey(uid), JSON.stringify(data)); } catch {}
    };

    
    const broadcastToAll = async (messageText) => {
      const result = { total: 0, sent: 0, failed: 0 };
      if (!KV) return result;
      let cursor;
      do {
        const page = await KV.list({ prefix: "u:", cursor });
        for (const key of page.keys) {
          const uid = key.name.slice(2);
          result.total++;
          const r = await api("sendMessage", { chat_id: uid, text: messageText });
          if (r?.ok) result.sent++; else result.failed++;
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return result;
    };

    
    const getInfoFor = async (uid, prefs) => {
      const info = await loadGroupSchedule(prefs.group);
      if (prefs.eng && prefs.eng !== "all" && !info.engTeachers.includes(prefs.eng)) {
        const match = info.engTeachers.find(t => t.includes(prefs.eng));
        prefs.eng = match || "all";
        await setPrefs(uid, prefs);
      }
      return info;
    };

    
    
    
    
    const esc = (s) => String(s ?? "").replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");

    const subLabel = (s) => s === "1" ? "Підгрупа 1" : s === "2" ? "Підгрупа 2" : "Всі";
    const engLabel = (e) => (!e || e === "all") ? "Всі" : shortTeacher(e);
    const typeEmoji = (type) => ({ "Л": "📖", "Лаб": "🔬", "ПрС": "✏️" })[type] || "📚";

    const filterLessons = (lessons, prefs) => lessons.filter(l => {
      if (prefs.subgroup && prefs.subgroup !== "all" && l.group && String(l.group) !== String(prefs.subgroup)) return false;
      if (l.isEng && prefs.eng && prefs.eng !== "all" && l.teacherFull !== prefs.eng) return false;
      return true;
    });

    const formatOneDayBlock = (d, info, prefs) => {
      const lessons = filterLessons(info.byDate[isoOf(d)] || [], prefs);
      const header = `*${esc(dateLabel(d))}* · _${esc(getWeekParity(d))}_`;
      if (!lessons.length) return `${header}\n\n_Пар немає_ 🎉`;

      const slots = new Map();
      for (const l of lessons) { if (!slots.has(l.start)) slots.set(l.start, []); slots.get(l.start).push(l); }

      let out = header + "\n";
      for (const [, items] of [...slots.entries()].sort()) {
        out += `\n🕐 *${esc(items[0].start)}* — ${esc(items[0].end)}\n`;
        for (const l of items) {
          out += `${typeEmoji(l.type)} *${esc(l.title)}*${l.typeLabel ? ` _${esc(l.typeLabel)}_` : ""}\n`;
          const tags = [];
          if (l.group) tags.push(`Підгр\\. ${l.group}`);
          if (l.potik) tags.push("Потік");
          if (l.isCollective && !(l.isEng && prefs.eng && prefs.eng !== "all")) tags.push("Збірна група");
          if (tags.length) out += `   ┣ 👥 _${tags.join(", ")}_\n`;
          if (l.room)    out += `   ┣ 🏛 ${esc(l.room)}\n`;
          if (l.teacher) out += `   ┗ 👤 ${esc(l.teacher)}\n`;
        }
      }
      return out.trim();
    };

    const formatDay = (d, info, prefs) => {
      const dow = d.getUTCDay();
      const has = (info.byDate[isoOf(d)] || []).length > 0;
      if ((dow === 0 || dow === 6) && !has) return `*${esc(dateLabel(d))}* · _${esc(getWeekParity(d))}_\n\n🏖 _Вихідний\\! Відпочивай\\._`;
      return formatOneDayBlock(d, info, prefs);
    };

    const formatWeek = (mon, info, prefs) => {
      let out = `🗓 *Тиждень з ${esc(mon.getUTCDate() + " " + UA_MONTHS[mon.getUTCMonth()])} · ${esc(getWeekParity(mon))}*\n`;
      out += `_Група: ${esc(prefs.group)} · Підгр\\.: ${esc(subLabel(prefs.subgroup))} · Англ\\.: ${esc(engLabel(prefs.eng))}_\n`;
      out += "─".repeat(20) + "\n\n";
      if (info.totalLessons === 0) out += `📭 _Деканат ще не опублікував розклад цієї групи на ці два тижні_\n\n`;
      for (let i = 0; i < 7; i++) {
        const day = addDays(mon, i);
        if (i >= 5 && !(info.byDate[isoOf(day)] || []).length) continue; 
        out += formatOneDayBlock(day, info, prefs) + "\n\n";
      }
      out = out.trim();
      return out.length > 3900 ? out.slice(0, 3900) + "\n\n_…розклад задовгий, решту дивись на сайті_" : out;
    };

    const SCHEDULE_ERROR = "😕 Не вдалося завантажити розклад з деканату\\. Спробуй трохи пізніше\\.";

    
    
    const api = async (method, body) => {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      try {
        const json = await r.json();
        if (!json.ok) console.error("Telegram API error:", method, json);
        return json;
      } catch { return null; }
    };

    const send = (chatId, text, reply_markup) =>
      api("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        ...(reply_markup ? { reply_markup } : {}),
      });

    const edit = (chatId, msgId, text, reply_markup) =>
      api("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: "MarkdownV2",
        ...(reply_markup ? { reply_markup } : {}),
      });

const sendPlain = (chatId, text, reply_markup) =>
  api("sendMessage", {
    chat_id: chatId,
    text,
    ...(reply_markup ? { reply_markup } : {}),
  });

const editPlain = (chatId, msgId, text, reply_markup) =>
  api("editMessageText", {
    chat_id: chatId,
    message_id: msgId,
    text,
    ...(reply_markup ? { reply_markup } : {}),
  });

    const answer = (id) => api("answerCallbackQuery", { callback_query_id: id });

    
    
    

    

    const getStableAvatarUrl = (userId) => {
      if (!WORKER_URL) return "";
      return `${WORKER_URL}/avatar/${userId}`;
    };

    const saveUserToFirebase = async (from) => {
      if (!from?.id || !env.FIREBASE_API_KEY) return;
      try {
        const photo_url = getStableAvatarUrl(String(from.id));
        const firestoreUrl =
          `https://firestore.googleapis.com/v1/projects/telegram-xmice/databases/(default)/documents/users/${from.id}` +
          `?key=${env.FIREBASE_API_KEY}`;

        const body = {
          fields: {
            id:         { stringValue: String(from.id) },
            first_name: { stringValue: from.first_name ?? "" },
            last_name:  { stringValue: from.last_name  ?? "" },
            username:   { stringValue: from.username   ?? "" },
            photo_url:  { stringValue: photo_url },
            last_seen:  { integerValue: String(Date.now()) },
          },
        };

        const res = await fetch(firestoreUrl, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`Firebase saveUser HTTP ${res.status}:`, errText);
        }
      } catch (e) {
        console.error("Firebase saveUser error:", e);
      }
    };

    
    
    
    const ONBOARD = {
      welcome: (name) =>
        `👋 Привіт, *${esc(name || "студенте")}\\!*\n\n` +
        `Я — бот розкладу ЛНУ\\. Покажу пари на сьогодні, завтра або на весь тиждень — прямо з розкладу деканату\\.\n\n` +
        `Напиши назву своєї групи, наприклад *ФЕП\\-13*, і я знайду її 👇`,

      askGroup:
        `🔎 Напиши назву групи \\(або її початок\\), наприклад *ФЕП\\-13* або *ПМІ\\-2*`,

      pickGroup: (q) =>
        `🔎 За запитом *${esc(q)}* знайшов такі групи\\. Обери свою:`,

      notFound: (q) =>
        `😕 За запитом *${esc(q)}* нічого не знайдено\\.\n\nСпробуй інакше, наприклад *ФЕП\\-1* — я покажу всі групи, що починаються так\\.`,

      loading: (g) => `⏳ Завантажую розклад групи *${esc(g)}*…`,

      subgroup:
        `👥 *Ваша підгрупа*\n\n` +
        `Лабораторні поділені між підгрупами\\. Обери свою, щоб не бачити зайвого\\.\n\n` +
        `_Змінити завжди можна через ⚙️ у головному меню_`,

      eng:
        `🇬🇧 *Англійська мова*\n\n` +
        `Заняття з іноземної йдуть у збірних групах з різними викладачами\\. ` +
        `Обери свого — і я показуватиму тільки твою пару\\.\n\n` +
        `_Якщо не знаєш — обери «Всі»_`,

      done: (prefs) =>
        `✅ *Все готово\\!*\n\n` +
        `┣ 🎓 Група: *${esc(prefs.group)}*\n` +
        `┣ 👥 Підгрупа: *${esc(subLabel(prefs.subgroup))}*\n` +
        `┗ 🇬🇧 Англійська: *${esc(engLabel(prefs.eng))}*\n\n` +
        `Натискай кнопки нижче — і розклад одразу тут 👇`,
    };

    const menuText = (prefs) =>
      `📋 *Розклад ${esc(prefs.group)}*\n\n` +
      `_${esc(subLabel(prefs.subgroup))} · Англ\\.: ${esc(engLabel(prefs.eng))}_\n` +
      `🗓 Зараз: *${esc(getWeekParity(today))}*\n\n` +
      `Обери що показати 👇`;

    
    
    
    
    const backRow = (to) => [{ text: "⬅️ Назад", callback_data: to }];

    const kb = {
      main: (prefs) => ({
        inline_keyboard: [
          [
            { text: "📌 Сьогодні",  callback_data: "sched:today"    },
            { text: "📍 Завтра",    callback_data: "sched:tomorrow"  },
          ],
          [
            { text: "📅 Цей тиждень",   callback_data: "sched:week"     },
            { text: "📆 Наст. тиждень", callback_data: "sched:nextweek" },
          ],
          [
            { text: "🔗 Прив'язати до сайту", callback_data: "link:site" },
          ],
          [
            { text: `⚙️ ${prefs?.group ?? "Налаштування"} · ${subLabel(prefs?.subgroup ?? "all")}`, callback_data: "settings:menu" },
          ],
          [
            { text: "📱 Відкрити додаток", web_app: { url: SITE_URL } },
          ],
        ],
      }),

      linkCancel: () => ({
        inline_keyboard: [
          [{ text: "❌ Скасувати", callback_data: "link:cancel" }],
        ],
      }),

      groupOptions: (options) => ({
        inline_keyboard: [
          ...options.map((g, i) => [{ text: `🎓 ${g}`, callback_data: `onboard:group:${i}` }]),
          [{ text: "🔎 Шукати інакше", callback_data: "onboard:group:again" }],
        ],
      }),

      retryGroup: () => ({
        inline_keyboard: [[{ text: "🔎 Обрати іншу групу", callback_data: "onboard:group:again" }]],
      }),

      pickSubgroup: (current, prefix, withBack) => ({
        inline_keyboard: [
          [
            { text: `${current === "1"   ? "✅ " : ""}Підгрупа 1`, callback_data: `${prefix}:1`   },
            { text: `${current === "2"   ? "✅ " : ""}Підгрупа 2`, callback_data: `${prefix}:2`   },
            { text: `${current === "all" ? "✅ " : ""}Всі`,        callback_data: `${prefix}:all` },
          ],
          ...(withBack ? [backRow("settings:menu")] : []),
        ],
      }),

      pickEng: (teachers, current, prefix, withBack) => {
        const rows = teachers.map((t, i) => [{ text: `${t === current ? "✅ " : ""}${shortTeacher(t)}`, callback_data: `${prefix}:${i}` }]);
        rows.push([{ text: `${(!current || current === "all") ? "✅ " : ""}👥 Не знаю / всі`, callback_data: `${prefix}:all` }]);
        if (withBack) rows.push(backRow("settings:menu"));
        return { inline_keyboard: rows };
      },

      settings: (info) => ({
        inline_keyboard: [
          [{ text: "🎓 Змінити групу", callback_data: "settings:group" }],
          ...(info?.hasSubgroups ? [[{ text: "👥 Змінити підгрупу", callback_data: "settings:subgroup" }]] : []),
          ...(info?.engTeachers?.length ? [[{ text: "🇬🇧 Викладач англійської", callback_data: "settings:eng" }]] : []),
          backRow("settings:back"),
        ],
      }),
    };

    
    const show = async (text, markup) => {
      if (msgId) {
        const r = await edit(chatId, msgId, text, markup);
        if (r?.ok) return;
      }
      await send(chatId, text, markup);
    };

    
    
    
    const msg = update.message;
    const cb  = update.callback_query;

    const chatId = String(msg?.chat?.id ?? cb?.message?.chat?.id ?? "");
    if (!chatId) return new Response("OK");

    const userId   = String(msg?.from?.id ?? cb?.from?.id ?? "");
    const userName = msg?.from?.first_name ?? cb?.from?.first_name ?? "";
    const msgId    = cb?.message?.message_id ?? null;

    const fromUser = msg?.from ?? cb?.from;
    if (fromUser) await saveUserToFirebase(fromUser);

    if (msg?.successful_payment) {
      const sp = msg.successful_payment;
      const stars = sp.total_amount;
      const donorName = fromUser?.first_name ? `${fromUser.first_name}${fromUser.last_name ? ' ' + fromUser.last_name : ''}` : (fromUser?.username ? `@${fromUser.username}` : "Студент");

      if (KV) {
        try {
          let list = [];
          const raw = await KV.get("stars_leaderboard");
          if (raw) list = JSON.parse(raw);
          const existing = list.find(d => String(d.id) === userId);
          if (existing) {
            existing.stars = (existing.stars || 0) + stars;
          } else {
            const p = await getPrefs(userId);
            list.push({
              id: userId,
              name: donorName,
              group: p?.group || "ФЕП",
              stars,
              badge: stars >= 25 ? "👑 Легенда" : stars >= 10 ? "🌟 Меценат" : "⭐️ Друг розкладу"
            });
          }
          list.sort((a, b) => (b.stars || 0) - (a.stars || 0));
          await KV.put("stars_leaderboard", JSON.stringify(list));
        } catch (e) {
          console.error("Failed to save donation to leaderboard:", e);
        }
      }

      await sendPlain(chatId, `⭐️ Щиро дякуємо за підтримку розкладу (${stars} Stars)!\n\nВи додані на Дошку пошани на сайті у розділі «Корисне». Бажаємо успішного семестру та високих оцінок! 🎉`);
      return new Response("OK");
    }

    const today    = nowKyiv();
    const tomorrow = addDays(today, 1);

    
    
    
    
    
    const askGroupSearch = async (prefs, intro) => {
      await setPrefs(userId, { ...(prefs ?? {}), await_group: true, group_options: undefined });
      await show(intro, null);
    };

    
    const handleGroupQuery = async (prefs, query) => {
      let options = [];
      try { options = (await getSuggestionGroups(query)).slice(0, 12); } catch {}
      if (!options.length) {
        await send(chatId, ONBOARD.notFound(query), null);
        return;
      }
      await setPrefs(userId, { ...(prefs ?? {}), await_group: true, group_options: options });
      await send(chatId, ONBOARD.pickGroup(query), kb.groupOptions(options));
    };

    
    const continueAfterGroup = async (prefs, info) => {
      if (info.hasSubgroups) {
        await setPrefs(userId, { ...prefs, step: "subgroup" });
        await show(ONBOARD.subgroup, kb.pickSubgroup(null, "onboard:sub", false));
        return;
      }
      await continueAfterSubgroup({ ...prefs, subgroup: "all" }, info);
    };

    const continueAfterSubgroup = async (prefs, info) => {
      if (info.engTeachers.length) {
        await setPrefs(userId, { ...prefs, step: "eng", eng_options: info.engTeachers });
        await show(ONBOARD.eng, kb.pickEng(info.engTeachers, null, "onboard:eng", false));
        return;
      }
      await finishSetup({ ...prefs, eng: "all" });
    };

    const finishSetup = async (prefs) => {
      const final = { ...prefs, step: "done" };
      delete final.await_group; delete final.group_options; delete final.eng_options;
      await setPrefs(userId, final);
      await show(ONBOARD.done(final), kb.main(final));
    };

    
    const chooseGroup = async (prefs, group) => {
      await show(ONBOARD.loading(group), null);
      let info;
      try { info = await loadGroupSchedule(group); }
      catch (e) {
        console.error("loadGroupSchedule:", e);
        await show(SCHEDULE_ERROR, kb.retryGroup());
        return;
      }
      const next = { ...(prefs ?? {}), group, subgroup: "all", eng: "all" };
      delete next.await_group; delete next.group_options;
      if (info.totalLessons === 0) {
        await send(chatId, `📭 _Деканат ще не опублікував розклад групи ${esc(group)} на ці два тижні\\. Я все одно її запам'ятаю\\._`, null);
      }
      await continueAfterGroup(next, info);
    };

    
    
    
    if (cb) {
      await answer(cb.id);
      const prefs = await getPrefs(userId) ?? {};
      const data  = cb.data ?? "";

      
      if (data === "onboard:group:again") {
        await askGroupSearch(prefs, ONBOARD.askGroup);
        return new Response("OK");
      }
      if (data.startsWith("onboard:group:")) {
        const group = (prefs.group_options ?? [])[Number(data.split(":")[2])];
        if (!group) { await askGroupSearch(prefs, ONBOARD.askGroup); return new Response("OK"); }
        await chooseGroup(prefs, group);
        return new Response("OK");
      }

      
      if (data.startsWith("onboard:sub:")) {
        const subgroup = data.split(":")[2];
        if (!prefs.group) { await askGroupSearch(prefs, ONBOARD.askGroup); return new Response("OK"); }
        let info;
        try { info = await loadGroupSchedule(prefs.group); }
        catch { await show(SCHEDULE_ERROR, kb.retryGroup()); return new Response("OK"); }
        await continueAfterSubgroup({ ...prefs, subgroup }, info);
        return new Response("OK");
      }

      
      if (data.startsWith("onboard:eng:")) {
        const v = data.split(":")[2];
        const eng = v === "all" ? "all" : (prefs.eng_options ?? [])[Number(v)];
        if (!eng) { await askGroupSearch(prefs, ONBOARD.askGroup); return new Response("OK"); }
        await finishSetup({ ...prefs, eng });
        return new Response("OK");
      }

      
      if (prefs.step !== "done" || !prefs.group) {
        await askGroupSearch(prefs, ONBOARD.welcome(userName));
        return new Response("OK");
      }

      
      if (data.startsWith("sched:")) {
        let info;
        try { info = await getInfoFor(userId, prefs); }
        catch { await show(SCHEDULE_ERROR, kb.main(prefs)); return new Response("OK"); }
        let text;
        if (data === "sched:today")         text = formatDay(today, info, prefs);
        else if (data === "sched:tomorrow") text = formatDay(tomorrow, info, prefs);
        else if (data === "sched:week")     text = formatWeek(mondayOf(today), info, prefs);
        else if (data === "sched:nextweek") text = formatWeek(addDays(mondayOf(today), 7), info, prefs);
        else                                text = menuText(prefs);
        await show(text, kb.main(prefs));
        return new Response("OK");
      }

      
      if (data === "settings:menu") {
        let info = null;
        try { info = await getInfoFor(userId, prefs); } catch {}
        const text =
          `⚙️ *Налаштування*\n\n` +
          `┣ 🎓 Група: *${esc(prefs.group)}*\n` +
          `┣ 👥 Підгрупа: *${esc(subLabel(prefs.subgroup))}*\n` +
          `┗ 🇬🇧 Англійська: *${esc(engLabel(prefs.eng))}*`;
        await show(text, kb.settings(info ?? { hasSubgroups: true, engTeachers: [] }));
        return new Response("OK");
      }

      if (data === "settings:group") {
        await setPrefs(userId, { ...(prefs ?? {}), await_group: true, group_options: undefined });
        const text = `⚙️ *Зміна групи*\n\n_Поточна: ${esc(prefs.group)}_\n\n` + ONBOARD.askGroup;
        await show(text, {
          inline_keyboard: [
            [{ text: "⬅️ Назад", callback_data: "settings:menu" }]
          ]
        });
        return new Response("OK");
      }

      if (data === "settings:subgroup") {
        await show(`⚙️ *Зміна підгрупи*\n\n_Поточна: ${esc(subLabel(prefs.subgroup))}_`, kb.pickSubgroup(prefs.subgroup, "set:sub", true));
        return new Response("OK");
      }

      if (data === "settings:eng") {
        let info;
        try { info = await getInfoFor(userId, prefs); }
        catch { await show(SCHEDULE_ERROR, kb.settings(null)); return new Response("OK"); }
        if (!info.engTeachers.length) {
          await show(`🇬🇧 У розкладі групи ${esc(prefs.group)} зараз немає англійської у збірних групах\\.`, kb.settings(info));
          return new Response("OK");
        }
        await setPrefs(userId, { ...prefs, eng_options: info.engTeachers });
        await show(`⚙️ *Викладач англійської*\n\n_Поточний: ${esc(engLabel(prefs.eng))}_`, kb.pickEng(info.engTeachers, prefs.eng, "set:eng", true));
        return new Response("OK");
      }

      if (data === "settings:back") {
        await show(menuText(prefs), kb.main(prefs));
        return new Response("OK");
      }

      if (data.startsWith("set:sub:")) {
        const updated = { ...prefs, subgroup: data.split(":")[2] };
        await setPrefs(userId, updated);
        await show(`✅ *Підгрупу змінено на: ${esc(subLabel(updated.subgroup))}*`, kb.settings({ hasSubgroups: true, engTeachers: prefs.eng_options ?? [] }));
        return new Response("OK");
      }

      if (data.startsWith("set:eng:")) {
        const v = data.split(":")[2];
        const eng = v === "all" ? "all" : (prefs.eng_options ?? [])[Number(v)];
        const updated = { ...prefs, eng: eng ?? "all" };
        delete updated.eng_options;
        await setPrefs(userId, updated);
        await show(`✅ *Викладач англійської: ${esc(engLabel(updated.eng))}*`, kb.settings({ hasSubgroups: true, engTeachers: prefs.eng_options ?? [] }));
        return new Response("OK");
      }

if (data === "link:site") {
  if (!KV) {
    await sendPlain(chatId, "KV не налаштовано.");
    return new Response("OK");
  }
  const updated = { ...(prefs ?? {}), await_link_code: true };
  await setPrefs(userId, updated);

  const prompt =
    "Прив'язка до сайту\n\n" +
    "1) На сайті натисни: Увійти через Telegram -> через код\n" +
    "2) Сайт покаже 6-значний код\n" +
    "3) Надішли цей код сюди одним повідомленням\n\n" +
    "Приклад: 123456";

  if (msgId) {
    await editPlain(chatId, msgId, prompt, kb.linkCancel()).catch(() => null);
  } else {
    await sendPlain(chatId, prompt, kb.linkCancel());
  }
  return new Response("OK");
}

      if (data === "link:cancel") {
        const updated = { ...(prefs ?? {}) };
        delete updated.await_link_code;
        await setPrefs(userId, updated);
        await show(menuText(updated), kb.main(updated));
        return new Response("OK");
      }

      if (data.startsWith("stars:")) {
        const amount = Number(data.split(":")[1]) || 5;
        const title = amount === 1 ? "Кава для розкладу" : amount <= 5 ? "Піца для розкладу" : amount <= 15 ? "Меценат ФЕП" : "Легенда факультету";
        await api("sendInvoice", {
          chat_id: chatId,
          title,
          description: `${amount} ⭐️ на підтримку хостингу та розробки розкладу ФЕП`,
          payload: JSON.stringify({ uid: userId, stars: amount, ts: Date.now() }),
          currency: "XTR",
          prices: [{ label: `${amount} Stars`, amount }]
        });
        return new Response("OK");
      }

      return new Response("OK");
    }

    if (!msg?.text) return new Response("OK");
    const text = msg.text.trim();

    const prefs = await getPrefs(userId);

    if (text === "/donate" || text.startsWith("/start donate")) {
      const textIntro = "*⭐️ Підтримка розкладу ФЕП*\n\nОберіть кількість зірочок Telegram Stars для підтримки проєкту:";
      await send(chatId, textIntro, {
        inline_keyboard: [
          [
            { text: "☕ 1 Star", callback_data: "stars:1" },
            { text: "🍕 5 Stars", callback_data: "stars:5" },
          ],
          [
            { text: "🌟 15 Stars", callback_data: "stars:15" },
            { text: "👑 25 Stars", callback_data: "stars:25" },
          ],
          [
            { text: "📱 Відкрити на сайті", web_app: { url: SITE_URL } }
          ]
        ]
      });
      return new Response("OK");
    }

    
    
    
    
    
    
    
    
    const BROADCAST_PASSWORD = env.BROADCAST_PASSWORD ?? "0711";
    const isXmice = (fromUser?.username ?? "").toLowerCase().replace("@", "") === "xmice" || userId === String(env.ADMIN_USER_ID ?? "");

    const clearBroadcastState = async () => {
      const updated = { ...(prefs ?? {}) };
      delete updated.await_mes;
      await setPrefs(userId, updated);
    };

    if (text === "/mes") {
      if (!KV) { await sendPlain(chatId, "KV не налаштовано, розсилка недоступна."); return new Response("OK"); }
      if (isXmice) {
        await setPrefs(userId, { ...(prefs ?? {}), await_mes: "text" });
        await sendPlain(chatId, "📣 Адмін-доступ (@xmice): надішли текст повідомлення — його отримають усі користувачі бота.\n\n/cancel — скасувати");
        return new Response("OK");
      }
      await setPrefs(userId, { ...(prefs ?? {}), await_mes: "password" });
      await sendPlain(chatId, "🔐 Введи пароль для розсилки.\n\n/cancel — скасувати");
      return new Response("OK");
    }

    if (text === "/admin") {
      if (isXmice) {
        await send(chatId, "🔐 *Вітаємо, @xmice\\!*\n\nВи маєте адмін\\-доступ без пароля\\. Натисніть нижче, щоб відкрити додаток і адмін\\-панель 👇", {
          inline_keyboard: [
            [{ text: "⚡ Відкрити додаток", web_app: { url: SITE_URL } }]
          ]
        });
        return new Response("OK");
      } else {
        await send(chatId, "⛔ У вас немає доступу до панелі адміністратора\\.", null);
        return new Response("OK");
      }
    }

    if (prefs?.await_mes) {
      if (text === "/cancel" || text.startsWith("/start")) {
        await clearBroadcastState();
        await sendPlain(chatId, "Розсилку скасовано.");
        return new Response("OK");
      }

      if (prefs.await_mes === "password") {
        await clearBroadcastState(); 
        if (text !== BROADCAST_PASSWORD) {
          await sendPlain(chatId, "❌ Невірний пароль.");
          return new Response("OK");
        }
        await setPrefs(userId, { ...(prefs ?? {}), await_mes: "text" });
        await sendPlain(chatId, "✅ Пароль прийнято.\n\nНадішли текст повідомлення — його отримають усі користувачі бота.\n\n/cancel — скасувати");
        return new Response("OK");
      }

      if (prefs.await_mes === "text") {
        await clearBroadcastState();
        await sendPlain(chatId, "📣 Розсилка запущена, звіт надійде після завершення.");
        
        
        const job = broadcastToAll(text).then(
          (r) => sendPlain(chatId, `📣 Розсилку завершено.\n\n✅ Доставлено: ${r.sent}\n❌ Не доставлено: ${r.failed}\n👥 Всього: ${r.total}`),
          (e) => sendPlain(chatId, "❌ Помилка розсилки: " + (e?.message ?? e))
        );
        if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
        return new Response("OK");
      }
    }

if (prefs?.await_link_code) {
  if (!KV) {
    await sendPlain(chatId, "KV не налаштовано.");
    return new Response("OK");
  }

  const code = text.replace(/\s+/g, "");
  if (!/^[0-9]{6}$/.test(code)) {
    await sendPlain(chatId, "Надішли 6-значний код цифрами. Наприклад: 123456");
    return new Response("OK");
  }

  try {
    const key = `code_token:${code}`;
    const raw = await KV.get(key);

    if (!raw) {
      await sendPlain(chatId, "Код не знайдено або він протермінований. Згенеруй новий код на сайті.");
      return new Response("OK");
    }
    if (raw !== "__pending__") {
      await sendPlain(chatId, "Цей код вже використано. Згенеруй новий код на сайті.");
      return new Response("OK");
    }

    const userData = JSON.stringify({
      id:         String(msg.from.id),
      first_name: msg.from.first_name ?? "",
      last_name:  msg.from.last_name  ?? "",
      username:   msg.from.username   ?? "",
      photo_url:  WORKER_URL ? `${WORKER_URL}/avatar/${msg.from.id}` : "",
    });

    await KV.put(key, userData, { expirationTtl: 600 });
    await saveUserToFirebase(msg.from);

    const updated = { ...(prefs ?? {}) };
    delete updated.await_link_code;
    await setPrefs(userId, updated);

    await sendPlain(chatId, "Готово. Акаунт прив'язано. Повернись у додаток/сайт - дані підтягнуться автоматично.", kb.main(updated));
    return new Response("OK");
  } catch (e) {
    console.error("await_link_code error:", e);
    await sendPlain(chatId, "Помилка. Спробуй ще раз.");
    return new Response("OK");
  }
}

if (text.startsWith("/start code_")) {
  const code = text.replace("/start code_", "").trim();
  if (!/^[0-9]{6}$/.test(code) || !KV) {
    await sendPlain(chatId, "Невірний код.");
    return new Response("OK");
  }

  try {
    const key = `code_token:${code}`;
    const raw = await KV.get(key);

    if (!raw) {
      await sendPlain(chatId, "Код не знайдено або він протермінований. Згенеруй новий код на сайті.");
      return new Response("OK");
    }
    if (raw !== "__pending__") {
      await sendPlain(chatId, "Цей код вже використано. Згенеруй новий код на сайті.");
      return new Response("OK");
    }

    const userData = JSON.stringify({
      id:         String(msg.from.id),
      first_name: msg.from.first_name ?? "",
      last_name:  msg.from.last_name  ?? "",
      username:   msg.from.username   ?? "",
      photo_url:  WORKER_URL ? `${WORKER_URL}/avatar/${msg.from.id}` : "",
    });

    await KV.put(key, userData, { expirationTtl: 600 });
    await saveUserToFirebase(msg.from);

    await sendPlain(chatId, "Готово. Акаунт прив'язано. Повернись у додаток/сайт - дані підтягнуться автоматично.");
    return new Response("OK");
  } catch (e) {
    console.error("start code_ error:", e);
    await sendPlain(chatId, "Помилка. Спробуй ще раз.");
    return new Response("OK");
  }
}

    
    
    
    
    
    
    
    
    if (text.startsWith("/start link_")) {
      const linkToken = text.replace("/start link_", "").trim();

      if (linkToken && KV) {
        
        const userData = JSON.stringify({
          id:         String(msg.from.id),
          first_name: msg.from.first_name ?? "",
          last_name:  msg.from.last_name  ?? "",
          username:   msg.from.username   ?? "",
          
          photo_url:  WORKER_URL ? `${WORKER_URL}/avatar/${msg.from.id}` : "",
        });

        
        await KV.put(`link_token:${linkToken}`, userData, { expirationTtl: 600 });

        
        await saveUserToFirebase(msg.from);

        
        const returnUrl = SITE_URL
          ? `${SITE_URL.replace(/\/$/, "")}?tg_token=${linkToken}`
          : null;

        
        const successText = returnUrl
          ? `✅ *Готово\!* Telegram прив'язано до сайту розкладу\\.\n\n` +
            `👉 [Повернутись на сайт](${returnUrl})\n\n` +
            `_Посилання дійсне 10 хвилин_`
          : `✅ *Готово\\!* Telegram прив'язано\\.\n\n` +
            `Поверніться на сайт розкладу — він вже вас впізнає\\.`;

        await api("sendMessage", {
          chat_id: chatId,
          text: successText,
          parse_mode: "MarkdownV2",
          
          ...(returnUrl ? {
            reply_markup: {
              inline_keyboard: [[
                { text: "🌐 Повернутись на сайт", url: returnUrl }
              ]]
            }
          } : {}),
        });
      } else if (!KV) {
        await send(chatId,
          `⚠️ _KV не налаштовано\\. Зверніться до адміністратора\\._`,
          null
        );
      }

      return new Response("OK");
    }

    
    if (text.startsWith("/start")) {
      await setPrefs(userId, { step: "group", await_group: true });
      await send(chatId, ONBOARD.welcome(userName), null);
      return new Response("OK");
    }

    
    if (text === "/cancel" && prefs?.step === "done") {
      await send(chatId, menuText(prefs), kb.main(prefs));
      return new Response("OK");
    }

    
    if (prefs?.await_group) {
      if (text.startsWith("/")) {
        await send(chatId, ONBOARD.askGroup, null);
        return new Response("OK");
      }
      await handleGroupQuery(prefs, text);
      return new Response("OK");
    }

    
    if (!prefs?.step || prefs.step !== "done" || !prefs.group) {
      await setPrefs(userId, { ...(prefs ?? {}), step: "group", await_group: true });
      await send(chatId, ONBOARD.welcome(userName), null);
      return new Response("OK");
    }

    
    if (/^\/(today|tomorrow|week|nextweek)\b/.test(text)) {
      let info;
      try { info = await getInfoFor(userId, prefs); }
      catch { await send(chatId, SCHEDULE_ERROR, kb.main(prefs)); return new Response("OK"); }
      let out;
      if (text.startsWith("/today"))         out = formatDay(today, info, prefs);
      else if (text.startsWith("/tomorrow")) out = formatDay(tomorrow, info, prefs);
      else if (text.startsWith("/nextweek")) out = formatWeek(addDays(mondayOf(today), 7), info, prefs);
      else                                   out = formatWeek(mondayOf(today), info, prefs);
      await send(chatId, out, kb.main(prefs));
      return new Response("OK");
    }

    
    await send(chatId, menuText(prefs), kb.main(prefs));
    return new Response("OK");
  },

  // ─── HOURLY CRON: auto-check Dekanat grades for all users ───────────────────
  async scheduled(event, env, ctx) {
    const kv = env.PREFS_KV;
    if (!kv || !env.BOT_TOKEN) return;

    // Skip if cache was updated within last 50 min (user opened app themselves)
    const SKIP_IF_NEWER_MS = 50 * 60 * 1000;
    // Max users to process per cron run (stay within 30-sec wall-clock limit)
    const MAX_PER_RUN = 10;

    try {
      const listed = await kv.list({ prefix: 'dekanat_creds:' });
      const keys = (listed.keys || []).slice(0, MAX_PER_RUN);

      for (const key of keys) {
        const userId = key.name.replace('dekanat_creds:', '');
        try {
          // Load credentials
          const rawCreds = await kv.get(key.name);
          if (!rawCreds) continue;
          const { user_name, user_pwd } = JSON.parse(rawCreds);
          if (!user_name || !user_pwd) continue;

          // Load cached grades
          const rawCache = await kv.get(`dekanat_cache:${userId}`);
          const cached = rawCache ? JSON.parse(rawCache) : null;

          // Skip if recently synced — user just opened the app
          if (cached && cached.ts && (Date.now() - cached.ts) < SKIP_IF_NEWER_MS) {
            continue;
          }

          // Fetch fresh data from Dekanat
          let freshData;
          try {
            freshData = await fetchDekanatGrades(user_name, user_pwd);
          } catch (fetchErr) {
            // Wrong password or Dekanat down — skip silently, don't remove creds
            continue;
          }

          // Compare with cached — find new grades
          if (cached && cached.data && Array.isArray(cached.data.subjects)) {
            const newGrades = findNewGrades(cached.data.subjects, freshData.subjects);
            for (const ng of newGrades) {
              await notifyTelegramNewGrade(env, userId, ng);
            }
          }

          // Save fresh cache
          await kv.put(`dekanat_cache:${userId}`, JSON.stringify({ ts: Date.now(), data: freshData }));

        } catch (userErr) {
          console.error(`[cron:dekanat] userId=${userId} error:`, userErr.message);
        }
      }
    } catch (err) {
      console.error('[cron:dekanat] Fatal error:', err);
    }
  },
};
