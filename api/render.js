// api/render.js — Vercel Edge Function
// Використовує @vercel/og — офіційна бібліотека Vercel для генерації PNG
// Не потребує нативних залежностей, працює на Edge Runtime

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
    if (title.includes("(Л)")) return "#4A90D9";
    if (title.includes("(Лаб)")) return "#27AE60";
    if (title.includes("(ПрС)")) return "#E67E22";
    return "#8E44AD";
  };

  const typeLabel = (title) => {
    if (title.includes("(Л)")) return "Лекція";
    if (title.includes("(Лаб)")) return "Лаб";
    if (title.includes("(ПрС)")) return "Практика";
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

  const weekBadgeColor = weekType.includes("Чисельник") ? "#4A90D9" : "#E67E22";
  const hasLessons = slotEntries.length > 0;

  const lessonCards = slotEntries.flatMap(([, items]) => {
    const l0 = items[0];
    return [
      {
        type: "div",
        props: {
          style: { display: "flex", fontSize: 13, color: "#666", fontWeight: 600, marginBottom: 6, marginTop: 8 },
          children: `${l0.start} – ${l0.end}`,
        },
      },
      ...items.map((l) => {
        const color = typeColor(l.title);
        const title = cleanTitle(l.title);
        const label = typeLabel(l.title);
        const tags = [];
        if (l.group) tags.push(`Підгр. ${l.group}`);
        if (l.potik) tags.push("Потік");
        const teacher = (l.teacher ?? "").replace(/\s*\(Потік\)/g, "").trim();

        return {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              background: "#1a1a2e",
              borderRadius: 12,
              border: `1.5px solid ${color}`,
              borderLeft: `5px solid ${color}`,
              padding: "10px 14px",
              marginBottom: 8,
              gap: 4,
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    { type: "div", props: { style: { fontSize: 15, fontWeight: "bold", color: "#fff" }, children: title } },
                    label
                      ? { type: "div", props: { style: { fontSize: 11, color, background: color + "22", border: `1px solid ${color}`, borderRadius: 10, padding: "2px 10px" }, children: label } }
                      : { type: "div", props: { children: "" } },
                  ],
                },
              },
              { type: "div", props: { style: { fontSize: 12, color: "#aaa" }, children: `${l.room ?? "—"}` } },
              { type: "div", props: { style: { fontSize: 12, color: "#777" }, children: `${teacher}${tags.length ? "   ·   " + tags.join(", ") : ""}` } },
            ],
          },
        };
      }),
    ];
  });

  const estimatedHeight = Math.max(200, 120 + slotEntries.reduce((acc, [, items]) => acc + items.length, 0) * 110 + slotEntries.length * 38);

  return new ImageResponse(
    {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", background: "#0f0f1a", width: "100%", height: "100%", padding: 20, fontFamily: "sans-serif" },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
              children: [
                {
                  type: "div",
                  props: {
                    style: { display: "flex", flexDirection: "column", gap: 6 },
                    children: [
                      { type: "div", props: { style: { fontSize: 22, fontWeight: "bold", color: "#fff" }, children: date } },
                      { type: "div", props: { style: { fontSize: 12, color: weekBadgeColor, background: weekBadgeColor + "22", border: `1px solid ${weekBadgeColor}`, borderRadius: 10, padding: "3px 12px", alignSelf: "flex-start" }, children: weekType } },
                    ],
                  },
                },
                { type: "div", props: { style: { fontSize: 13, color: "#555", marginTop: 6 }, children: group } },
              ],
            },
          },
          { type: "div", props: { style: { height: 1, background: "#2a2a3e", marginBottom: 12 } } },
          hasLessons
            ? { type: "div", props: { style: { display: "flex", flexDirection: "column" }, children: lessonCards } }
            : { type: "div", props: { style: { fontSize: 20, color: "#555", textAlign: "center", marginTop: 40 }, children: "Пар немає — відпочивай!" } },
        ],
      },
    },
    { width: 700, height: estimatedHeight }
  );
}
