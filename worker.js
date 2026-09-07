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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

async function fetchWin1251(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`dekanat responded ${response.status}`);
  return win1251Decoder.decode(await response.arrayBuffer());
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

async function handleScheduleRoutes(request) {
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

      return json(await getSchedule(group, range), 200, { 'Cache-Control': 'public, max-age=600' });
    }
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    
    
    
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    
    
    
    
    const scheduleResponse = await handleScheduleRoutes(request);
    if (scheduleResponse) return scheduleResponse;

    
    
    
    
    
    
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
      if (KV) { try { const c = await KV.get(key); if (c) return JSON.parse(c); } catch {} }
      const raw = await getSchedule(group, getTwoWeekRange());
      if (!raw || !Array.isArray(raw.days)) throw new Error("bad schedule");
      const info = normalizeSchedule(raw);
      if (KV) { try { await KV.put(key, JSON.stringify(info), { expirationTtl: 1800 }); } catch {} }
      return info;
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

      return new Response("OK");
    }

    
    
    
    if (!msg?.text) return new Response("OK");
    const text = msg.text.trim();

    const prefs = await getPrefs(userId);

    
    
    
    
    
    
    
    
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
};
