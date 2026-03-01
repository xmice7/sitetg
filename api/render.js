// api/render.js — Vercel Edge Function
// Професійний дизайн, адаптивна висота, без emoji в SVG-елементах

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const { lessons = [], date = "", weekType = "", group = "" } = body;

  const typeColor = (title) => {
    if (title.includes("(Л)"))   return "#818CF8";
    if (title.includes("(Лаб)")) return "#34D399";
    if (title.includes("(ПрС)")) return "#FB923C";
    return "#60A5FA";
  };

  const typeLabel = (title) => {
    if (title.includes("(Л)"))   return "ЛЕКЦІЯ";
    if (title.includes("(Лаб)")) return "ЛАБОРАТОРНА";
    if (title.includes("(ПрС)")) return "ПРАКТИЧНА";
    return "";
  };

  const cleanTitle = (title) =>
    title.replace(/\s*\(Потік\)/g, "").replace(/\s*\(Л\)|\s*\(Лаб\)|\s*\(ПрС\)/g, "").trim();

  // Групуємо по часу
  const slots = new Map();
  for (const l of lessons) {
    if (!slots.has(l.start)) slots.set(l.start, []);
    slots.get(l.start).push(l);
  }
  const slotEntries = [...slots.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const totalCards = slotEntries.reduce((s, [, v]) => s + v.length, 0);

  const isNumerator = weekType.includes("Чисельник");
  const weekBadgeColor = isNumerator ? "#60A5FA" : "#FB923C";
  const hasLessons = totalCards > 0;

  const W = 1080;
  const PADDING = 52;
  // Адаптивна висота — розраховуємо точно
  const HEADER_H = 130;
  const CARD_H = 148;
  const CARD_GAP = 14;
  const FOOTER_PAD = 40;
  const totalH = hasLessons
    ? HEADER_H + totalCards * (CARD_H + CARD_GAP) - CARD_GAP + FOOTER_PAD
    : HEADER_H + 160;

  const cardNodes = slotEntries.flatMap(([, items]) =>
    items.map((l) => {
      const color = typeColor(l.title);
      const title = cleanTitle(l.title);
      const label = typeLabel(l.title);
      const tags = [];
      if (l.group) tags.push(`ПІДГРУПА ${l.group}`);
      if (l.potik) tags.push("ПОТІК");
      const teacher = (l.teacher ?? "").replace(/\s*\(Потік\)/g, "").trim();
      const room = l.room ?? "—";

      return {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "row",
            width: "100%",
            height: CARD_H,
            marginBottom: CARD_GAP,
            gap: 0,
          },
          children: [
            // Час
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  width: 110,
                  paddingRight: 18,
                  flexShrink: 0,
                  gap: 6,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        fontSize: 34,
                        fontWeight: "bold",
                        color: "#F1F5F9",
                        lineHeight: 1,
                        letterSpacing: "-1px",
                      },
                      children: l.start,
                    },
                  },
                  {
                    type: "div",
                    props: {
                      style: { fontSize: 18, color: "#475569", fontWeight: 400 },
                      children: l.end,
                    },
                  },
                ],
              },
            },
            // Лінія
            {
              type: "div",
              props: {
                style: {
                  width: 2,
                  height: CARD_H,
                  background: "#1E293B",
                  borderRadius: 2,
                  flexShrink: 0,
                  marginRight: 18,
                },
              },
            },
            // Картка
            {
              type: "div",
              props: {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  flex: 1,
                  height: CARD_H,
                  background: "#0F172A",
                  borderRadius: 16,
                  padding: "0 28px",
                  gap: 8,
                  border: "1px solid #1E293B",
                },
                children: [
                  // Badges
                  {
                    type: "div",
                    props: {
                      style: { display: "flex", flexDirection: "row", gap: 8, alignItems: "center" },
                      children: [
                        ...(label ? [{
                          type: "div",
                          props: {
                            style: {
                              fontSize: 13,
                              fontWeight: "bold",
                              color: color,
                              background: color + "18",
                              borderRadius: 6,
                              padding: "3px 10px",
                              letterSpacing: "0.8px",
                              border: `1px solid ${color}40`,
                            },
                            children: label,
                          },
                        }] : []),
                        ...tags.map(tag => ({
                          type: "div",
                          props: {
                            style: {
                              fontSize: 13,
                              fontWeight: "bold",
                              color: "#34D399",
                              background: "#34D39918",
                              borderRadius: 6,
                              padding: "3px 10px",
                              letterSpacing: "0.8px",
                              border: "1px solid #34D39940",
                            },
                            children: tag,
                          },
                        })),
                      ],
                    },
                  },
                  // Назва
                  {
                    type: "div",
                    props: {
                      style: {
                        fontSize: 26,
                        fontWeight: "bold",
                        color: "#F8FAFC",
                        lineHeight: 1.15,
                        letterSpacing: "-0.3px",
                      },
                      children: title,
                    },
                  },
                  // Мета рядок
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        flexDirection: "row",
                        gap: 28,
                        alignItems: "center",
                      },
                      children: [
                        // Аудиторія
                        {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              fontSize: 17,
                              color: "#64748B",
                            },
                            children: [
                              {
                                type: "div",
                                props: {
                                  style: {
                                    width: 18,
                                    height: 18,
                                    borderRadius: 4,
                                    background: "#1E293B",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    color: "#94A3B8",
                                    fontWeight: "bold",
                                  },
                                  children: "A",
                                },
                              },
                              { type: "div", props: { children: room } },
                            ],
                          },
                        },
                        // Роздільник
                        {
                          type: "div",
                          props: {
                            style: {
                              width: 4,
                              height: 4,
                              borderRadius: "50%",
                              background: "#1E293B",
                            },
                          },
                        },
                        // Викладач
                        {
                          type: "div",
                          props: {
                            style: {
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              fontSize: 17,
                              color: "#64748B",
                            },
                            children: [
                              {
                                type: "div",
                                props: {
                                  style: {
                                    width: 18,
                                    height: 18,
                                    borderRadius: "50%",
                                    background: "#1E293B",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    color: "#94A3B8",
                                    fontWeight: "bold",
                                  },
                                  children: "В",
                                },
                              },
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
          background: "#020817",
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
                marginBottom: 4,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: 42,
                      fontWeight: "bold",
                      color: "#F8FAFC",
                      letterSpacing: "-1px",
                    },
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
                      gap: 9,
                      background: "#0F172A",
                      borderRadius: 100,
                      padding: "9px 20px",
                      border: "1px solid #1E293B",
                    },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: weekBadgeColor,
                            boxShadow: `0 0 8px ${weekBadgeColor}`,
                          },
                        },
                      },
                      {
                        type: "div",
                        props: {
                          style: {
                            fontSize: 19,
                            color: "#CBD5E1",
                            fontWeight: 600,
                            letterSpacing: "0.2px",
                          },
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
              style: {
                fontSize: 18,
                color: "#334155",
                marginBottom: 20,
                fontWeight: 500,
              },
              children: group,
            },
          },
          // Розділювач
          {
            type: "div",
            props: {
              style: {
                height: 1,
                background: "#0F172A",
                marginBottom: 22,
                borderRadius: 1,
              },
            },
          },
          // Пари
          hasLessons
            ? {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", width: "100%" },
                  children: cardNodes,
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
                    fontSize: 30,
                    color: "#1E293B",
                    fontWeight: 500,
                  },
                  children: "Пар немає — відпочивай!",
                },
              },
        ],
      },
    },
    { width: W, height: totalH }
  );
}
