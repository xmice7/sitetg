// api/render.js — Vercel Edge Function
// Високоякісний рендер 1200px, дизайн як на сайті

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
    if (title.includes("(Лаб)")) return "#22C55E";
    if (title.includes("(ПрС)")) return "#F97316";
    return "#3B82F6";
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

  const weekBadgeColor = weekType.includes("Чисельник") ? "#3B82F6" : "#F97316";
  const hasLessons = slotEntries.length > 0;
  const totalCards = slotEntries.reduce((acc, [, items]) => acc + items.length, 0);

  // 1200px ширина, висота динамічна
  const W = 1200;
  const PADDING = 48;
  const CARD_H = 160;
  const estimatedHeight = hasLessons ? 180 + totalCards * (CARD_H + 20) : 400;

  const lessonCards = slotEntries.flatMap(([, items]) =>
    items.map((l) => {
      const color = typeColor(l.title);
      const title = cleanTitle(l.title);
      const label = typeLabel(l.title);
      const tags = [];
      if (l.group) tags.push(`ПІДГРУПА ${l.group}`);
      if (l.potik)  tags.push("ПОТІК");
      const teacher = (l.teacher ?? "").replace(/\s*\(Потік\)/g, "").trim();

      return {
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "row", marginBottom: 20, width: "100%" },
          children: [
            // ── Час ──
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  justifyContent: "flex-start",
                  width: 130,
                  paddingTop: 20,
                  paddingRight: 20,
                  flexShrink: 0,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: { fontSize: 38, fontWeight: "bold", color: "#ffffff", lineHeight: 1, letterSpacing: -1 },
                      children: l.start,
                    },
                  },
                  {
                    type: "div",
                    props: {
                      style: { fontSize: 22, color: "#4B5563", marginTop: 6 },
                      children: l.end,
                    },
                  },
                ],
              },
            },
            // ── Вертикальна лінія ──
            {
              type: "div",
              props: {
                style: {
                  width: 3,
                  minHeight: CARD_H,
                  background: "#1F2937",
                  borderRadius: 2,
                  marginRight: 20,
                  marginTop: 24,
                  flexShrink: 0,
                },
              },
            },
            // ── Картка ──
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  background: "#111827",
                  borderRadius: 20,
                  padding: "20px 28px",
                  gap: 10,
                  border: "1px solid #1F2937",
                },
                children: [
                  // Badges рядок
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", gap: 10 },
                      children: [
                        label
                          ? {
                              type: "div",
                              props: {
                                style: {
                                  fontSize: 18,
                                  fontWeight: "bold",
                                  color: color,
                                  background: color + "20",
                                  borderRadius: 8,
                                  padding: "4px 14px",
                                  letterSpacing: 1,
                                },
                                children: label,
                              },
                            }
                          : null,
                        ...tags.map((tag) => ({
                          type: "div",
                          props: {
                            style: {
                              fontSize: 18,
                              fontWeight: "bold",
                              color: "#22C55E",
                              background: "#22C55E20",
                              borderRadius: 8,
                              padding: "4px 14px",
                              letterSpacing: 1,
                            },
                            children: tag,
                          },
                        })),
                      ].filter(Boolean),
                    },
                  },
                  // Назва предмету
                  {
                    type: "div",
                    props: {
                      style: { fontSize: 30, fontWeight: "bold", color: "#F9FAFB", lineHeight: 1.2 },
                      children: title,
                    },
                  },
                  // Аудиторія і викладач
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", gap: 32, marginTop: 4 },
                      children: [
                        {
                          type: "div",
                          props: {
                            style: { display: "flex", alignItems: "center", gap: 8, fontSize: 20, color: "#6B7280" },
                            children: [
                              { type: "div", props: { style: { fontSize: 20 }, children: "⌂" } },
                              { type: "div", props: { children: l.room ?? "—" } },
                            ],
                          },
                        },
                        {
                          type: "div",
                          props: {
                            style: { display: "flex", alignItems: "center", gap: 8, fontSize: 20, color: "#6B7280" },
                            children: [
                              { type: "div", props: { style: { fontSize: 18 }, children: "◦" } },
                              { type: "div", props: { children: teacher } },
                            ],
                          },
                        },
                      ],
                    },
                  },
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
          background: "#0B0F1A",
          width: "100%",
          height: "100%",
          padding: `${PADDING}px`,
          fontFamily: "sans-serif",
        },
        children: [
          // ── Заголовок ──
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: { fontSize: 48, fontWeight: "bold", color: "#F9FAFB", letterSpacing: -1 },
                    children: date,
                  },
                },
                // Badge тижня
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "#111827",
                      borderRadius: 40,
                      padding: "10px 22px",
                      border: "1px solid #1F2937",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background: weekBadgeColor,
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: { fontSize: 22, color: "#D1D5DB", fontWeight: 600 },
                          children: weekType.replace(" 🔢", "").replace(" 🔡", ""),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          // Група
          {
            type: "div",
            props: {
              style: { fontSize: 22, color: "#374151", marginBottom: 20 },
              children: group,
            },
          },
          // Розділювач
          {
            type: "div",
            props: {
              style: { height: 1, background: "#1F2937", marginBottom: 24 },
            },
          },
          // ── Пари або порожньо ──
          hasLessons
            ? {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: lessonCards,
                },
              }
            : {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: 1,
                    fontSize: 36,
                    color: "#374151",
                  },
                  children: "Пар немає — відпочивай! 🎉",
                },
              },
        ],
      },
    },
    { width: W, height: estimatedHeight }
  );
}
