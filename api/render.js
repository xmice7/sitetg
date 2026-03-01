// api/render.js — Vercel Edge Function
// Дизайн як на сайті: великий час зліва, badges зверху, вертикальна лінія

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const { lessons = [], date = "", weekType = "", group = "" } = body;

  const typeColor = (title) => {
    if (title.includes("(Л)"))   return "#7C6AF7";
    if (title.includes("(Лаб)")) return "#27AE60";
    if (title.includes("(ПрС)")) return "#E67E22";
    return "#4A90D9";
  };

  const typeLabel = (title) => {
    if (title.includes("(Л)"))   return "ЛЕКЦІЯ";
    if (title.includes("(Лаб)")) return "ЛАБОРАТОРНА";
    if (title.includes("(ПрС)")) return "ПРАКТИЧНА";
    return "";
  };

  const cleanTitle = (title) =>
    title.replace(/\s*\(Потік\)/g, "").replace(/\s*\(Л\)|\s*\(Лаб\)|\s*\(ПрС\)/g, "").trim();

  const slots = new Map();
  for (const l of lessons) {
    if (!slots.has(l.start)) slots.set(l.start, []);
    slots.get(l.start).push(l);
  }
  const slotEntries = [...slots.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const isNumerator = weekType.includes("Чисельник");
  const weekBadgeColor = isNumerator ? "#4A90D9" : "#E67E22";
  const hasLessons = slotEntries.length > 0;

  const totalCards = slotEntries.reduce((acc, [, items]) => acc + items.length, 0);
  const estimatedHeight = hasLessons ? 120 + totalCards * 128 : 220;

  const lessonCards = slotEntries.flatMap(([, items]) =>
    items.map((l) => {
      const color = typeColor(l.title);
      const title = cleanTitle(l.title);
      const label = typeLabel(l.title);
      const tags = [];
      if (l.group) tags.push(`ПІДГРУПА ${l.group}`);
      if (l.potik) tags.push("ПОТІК");
      const teacher = (l.teacher ?? "").replace(/\s*\(Потік\)/g, "").trim();

      return {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "row", marginBottom: 10 },
          children: [
            // Час зліва
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  justifyContent: "flex-start",
                  width: 68,
                  paddingTop: 14,
                  paddingRight: 10,
                  flexShrink: 0,
                },
                children: [
                  { type: "div", props: { style: { fontSize: 20, fontWeight: "bold", color: "#fff", lineHeight: 1 }, children: l.start } },
                  { type: "div", props: { style: { fontSize: 12, color: "#555", marginTop: 3 }, children: l.end } },
                ],
              },
            },
            // Вертикальна лінія
            {
              type: "div",
              props: {
                style: { width: 2, background: "#2a2a3e", borderRadius: 1, marginRight: 10, marginTop: 18, flexShrink: 0 },
              },
            },
            // Картка
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  background: "#1a1a2e",
                  borderRadius: 12,
                  padding: "10px 14px",
                  gap: 5,
                },
                children: [
                  // Badges
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", gap: 6 },
                      children: [
                        label ? { type: "div", props: { style: { fontSize: 10, fontWeight: "bold", color: color, background: color + "22", borderRadius: 5, padding: "2px 7px", letterSpacing: 0.5 }, children: label } } : null,
                        ...tags.map(tag => ({ type: "div", props: { style: { fontSize: 10, fontWeight: "bold", color: "#27AE60", background: "#27AE6022", borderRadius: 5, padding: "2px 7px", letterSpacing: 0.5 }, children: tag } })),
                      ].filter(Boolean),
                    },
                  },
                  // Назва
                  { type: "div", props: { style: { fontSize: 15, fontWeight: "bold", color: "#fff" }, children: title } },
                  // Аудиторія
                  { type: "div", props: { style: { fontSize: 12, color: "#777" }, children: "⌂  " + (l.room ?? "—") } },
                  // Викладач
                  { type: "div", props: { style: { fontSize: 12, color: "#777" }, children: "•  " + teacher } },
                ],
              },
            },
          ],
        },
      };
    })
  );

  return new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          background: "#0f0f1a",
          width: "100%",
          height: "100%",
          padding: "22px 18px",
          fontFamily: "sans-serif",
        },
        children: [
          // Заголовок
          {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
              children: [
                { type: "div", props: { style: { fontSize: 24, fontWeight: "bold", color: "#fff" }, children: date } },
                {
                  type: "div",
                  props: {
                    style: { display: "flex", alignItems: "center", gap: 6, background: "#1a1a2e", borderRadius: 20, padding: "5px 12px", border: "1px solid #2a2a3e" },
                    children: [
                      { type: "div", props: { style: { width: 7, height: 7, borderRadius: "50%", background: weekBadgeColor } } },
                      { type: "div", props: { style: { fontSize: 12, color: "#ccc", fontWeight: 600 }, children: weekType.replace(" 🔢","").replace(" 🔡","") } },
                    ],
                  },
                },
              ],
            },
          },
          // Група
          { type: "div", props: { style: { fontSize: 12, color: "#444", marginBottom: 12 }, children: group } },
          // Лінія
          { type: "div", props: { style: { height: 1, background: "#1e1e2e", marginBottom: 14 } } },
          // Пари
          hasLessons
            ? { type: "div", props: { style: { display: "flex", flexDirection: "column" }, children: lessonCards } }
            : { type: "div", props: { style: { display: "flex", alignItems: "center", justifyContent: "center", flex: 1, fontSize: 18, color: "#444" }, children: "Пар немає — відпочивай!" } },
        ],
      },
    },
    { width: 620, height: estimatedHeight }
  );
}
