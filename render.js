// api/render.js — Vercel Serverless Function
// Отримує JSON з даними розкладу → повертає PNG картинку
// Деплоїться автоматично при push на GitHub

import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { join } from "path";
import { readFileSync } from "fs";

// ── WASM ініціалізація (один раз) ────────────────────────────
let wasmInited = false;
async function ensureWasm() {
  if (wasmInited) return;
  const wasmPath = join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm");
  const wasmData = readFileSync(wasmPath);
  await initWasm(wasmData);
  wasmInited = true;
}

// ── Шрифти (кеш між викликами) ───────────────────────────────
let fonts = null;
async function getFonts() {
  if (fonts) return fonts;
  const base = "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVu";
  const [r400, r700, r800] = await Promise.all([
    fetch(base + "LyfAZ9hiA.woff2").then(r => r.arrayBuffer()),
    fetch(base + "FuYAZ9hiA.woff2").then(r => r.arrayBuffer()),
    fetch(base + "DyfAZ9hiA.woff2").then(r => r.arrayBuffer()),
  ]);
  fonts = [
    { name: "Inter", data: r400, weight: 400 },
    { name: "Inter", data: r700, weight: 700 },
    { name: "Inter", data: r800, weight: 800 },
  ];
  return fonts;
}

// ── Кольори — точно з index.html ─────────────────────────────
const C = {
  bgBody:      "#0f172a",
  bgCard:      "#1e293b",
  textMain:    "#f8fafc",
  textMuted:   "#94a3b8",
  border:      "#334155",
  primary:     "#3b82f6",
  green:       "#10b981",
  bgGreen:     "rgba(16,185,129,0.15)",
  purple:      "#a78bfa",
  bgPurple:    "rgba(139,92,246,0.15)",
  bgBlue:      "rgba(59,130,246,0.15)",
};

// ── Утиліти ──────────────────────────────────────────────────
const detectType = (title) => {
  if (title.includes("(Лаб)")) return { bg: C.bgPurple, color: C.purple,  label: "Лабораторна" };
  if (title.includes("(Л)"))   return { bg: C.bgPurple, color: C.purple,  label: "Лекція"      };
  if (title.includes("(ПрС)")) return { bg: C.bgPurple, color: C.purple,  label: "Практична"   };
  return                               { bg: C.bgPurple, color: C.purple,  label: "Пара"        };
};

const clean = (t) =>
  t.replace(/\s*\(Лаб\)|\s*\(Л\)|\s*\(ПрС\)|\s*\(Потік\)/gi, "").trim();

// ── Компоненти (Satori vDOM) ─────────────────────────────────
const Badge = (text, bg, color) => ({
  type: "div",
  props: {
    style: {
      background: bg, color,
      fontSize: 10, fontWeight: 800,
      padding: "3px 8px", borderRadius: 6,
      textTransform: "uppercase", letterSpacing: 0.5,
      display: "flex", alignItems: "center",
    },
    children: text,
  },
});

const Meta = (icon, text) => ({
  type: "div",
  props: {
    style: { display: "flex", alignItems: "center", gap: 6,
             fontSize: 13, fontWeight: 500, color: C.textMuted },
    children: [
      { type: "span", props: { style: { opacity: 0.6 }, children: icon } },
      { type: "span", props: { children: text } },
    ],
  },
});

const Card = (lesson) => {
  const ts     = detectType(lesson.title);
  const title  = clean(lesson.title);
  const badges = [Badge(ts.label, ts.bg, ts.color)];
  if (lesson.group) badges.push(
    { type: "div", props: { style: { width: 6 }, children: "" } },
    Badge(`Підгрупа ${lesson.group}`, C.bgGreen, C.green)
  );
  if (lesson.potik) badges.push(
    { type: "div", props: { style: { width: 6 }, children: "" } },
    Badge("Потік", C.bgBlue, C.primary)
  );

  return {
    type: "div",
    props: {
      style: {
        display: "flex", background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 16,
      },
      children: [{
        type: "div",
        props: {
          style: { display: "flex", gap: 16, width: "100%" },
          children: [
            // Час
            {
              type: "div",
              props: {
                style: {
                  minWidth: 58, display: "flex", flexDirection: "column",
                  justifyContent: "center", alignItems: "center",
                  borderRight: `2px dashed ${C.border}`, paddingRight: 12,
                },
                children: [
                  { type: "div", props: { style: { fontSize: 18, fontWeight: 800, color: C.textMain, letterSpacing: -0.5 }, children: lesson.start } },
                  { type: "div", props: { style: { fontSize: 13, fontWeight: 500, color: C.textMuted, marginTop: 4 }, children: lesson.end } },
                ],
              },
            },
            // Контент
            {
              type: "div",
              props: {
                style: { display: "flex", flexDirection: "column", flex: 1 },
                children: [
                  { type: "div", props: { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: badges } },
                  { type: "div", props: { style: { fontSize: 15, fontWeight: 700, color: C.textMain, lineHeight: 1.3, marginBottom: 6 }, children: title } },
                  { type: "div", props: {
                      style: { display: "flex", flexDirection: "column", gap: 3 },
                      children: [
                        lesson.room    ? Meta("⌂", lesson.room) : null,
                        lesson.teacher ? Meta("✦", lesson.teacher.replace(/\s*\(Потік\)/gi,"").trim()) : null,
                      ].filter(Boolean),
                  }},
                ],
              },
            },
          ],
        },
      }],
    },
  };
};

const Layout = (dateLabel, weekLabel, lessons, groupLabel) => ({
  type: "div",
  props: {
    style: {
      display: "flex", flexDirection: "column",
      background: C.bgBody, padding: "20px 16px",
      width: 480, fontFamily: "Inter", gap: 10,
    },
    children: [
      // Заголовок дня
      {
        type: "div",
        props: {
          style: {
            display: "flex", justifyContent: "space-between", alignItems: "flex-end",
            paddingBottom: 8, borderBottom: `2px solid ${C.border}`, marginBottom: 2,
          },
          children: [
            {
              type: "div",
              props: {
                style: { display: "flex", flexDirection: "column", gap: 2 },
                children: [
                  { type: "div", props: { style: { fontSize: 18, fontWeight: 700, color: C.textMain }, children: dateLabel } },
                  { type: "div", props: { style: { fontSize: 12, color: C.textMuted }, children: groupLabel } },
                ],
              },
            },
            {
              type: "div",
              props: {
                style: {
                  fontSize: 12, fontWeight: 600, color: C.textMuted,
                  background: C.bgCard, padding: "4px 10px",
                  borderRadius: 8, border: `1px solid ${C.border}`,
                },
                children: weekLabel,
              },
            },
          ],
        },
      },
      // Картки
      ...(lessons.length === 0
        ? [{
            type: "div",
            props: {
              style: {
                textAlign: "center", padding: "32px 20px",
                color: C.textMuted, background: C.bgCard,
                borderRadius: 16, border: `2px dashed ${C.border}`,
                fontSize: 15, fontWeight: 500,
              },
              children: "🎉  Пар немає — відпочивай!",
            },
          }]
        : lessons.map(Card)
      ),
    ],
  },
});

// ══════════════════════════════════════════════════════════════
//  HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // CORS — щоб Worker міг звертатись
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { lessons, dateLabel, weekType, groupLabel } = req.body;
    if (!dateLabel) return res.status(400).json({ error: "Missing dateLabel" });

    await ensureWasm();
    const fontList = await getFonts();

    const weekLabel = weekType === "numerator" ? "Чисельник" : "Знаменник";
    const height    = lessons?.length === 0 ? 160 : 90 + (lessons?.length ?? 0) * 140;

    const svg = await satori(
      Layout(dateLabel, weekLabel, lessons ?? [], groupLabel ?? ""),
      { width: 480, height, fonts: fontList }
    );

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 480 } });
    const png   = resvg.render().asPng();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(png));

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
