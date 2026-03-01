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

  const CARD_W = 700;
  const PADDING = 24;
  const HEADER_H = 90;
  const CARD_H = 88;
  const GAP = 10;
  const CORNER = 16;

  const typeColor = (title) => {
    if (title.includes("(Л)"))   return "#4A90D9";
    if (title.includes("(Лаб)")) return "#27AE60";
    if (title.includes("(ПрС)")) return "#E67E22";
    return "#8E44AD";
  };

  const typeEmoji = (title) => {
    if (title.includes("(Л)"))   return "📖";
    if (title.includes("(Лаб)")) return "🔬";
    if (title.includes("(ПрС)")) return "✏️";
    return "📚";
  };

  const cleanTitle = (title) =>
    title.replace(/\s*\(Потік\)/g, "").replace(/\s*\(Л\)|\s*\(Лаб\)|\s*\(ПрС\)/g, "").trim();

  const xmlEsc = (s) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const slots = new Map();
  for (const l of lessons) {
    const k = l.start;
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(l);
  }

  const slotEntries = [...slots.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let totalCards = 0;
  for (const [, items] of slotEntries) totalCards += items.length;

  const hasLessons = totalCards > 0;
  const contentH = hasLessons
    ? slotEntries.length * (CARD_H + GAP) * 1.2 + totalCards * (CARD_H + GAP) * 0.3
    : 80;

  const SVG_H = HEADER_H + PADDING + (hasLessons ? slotEntries.reduce((acc, [, items]) => acc + items.length, 0) * (CARD_H + GAP) + slotEntries.length * 36 : 80) + PADDING;
  const SVG_W = CARD_W + PADDING * 2;

  let cards = "";
  let y = HEADER_H + PADDING;

  if (!hasLessons) {
    cards += `<text x="${SVG_W / 2}" y="${y + 40}" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#888">🎉 Пар немає — відпочивай!</text>`;
  } else {
    for (const [time, items] of slotEntries) {
      const l0 = items[0];
      // Часовий рядок
      cards += `<text x="${PADDING}" y="${y + 18}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#aaa">🕐 ${xmlEsc(l0.start)} — ${xmlEsc(l0.end)}</text>`;
      y += 26;

      for (const l of items) {
        const color = typeColor(l.title);
        const title = cleanTitle(l.title);
        const emoji = typeEmoji(l.title);

        const tags = [];
        if (l.group) tags.push(`Підгр. ${l.group}`);
        if (l.potik) tags.push("Потік");
        const tagStr = tags.length ? tags.join(", ") + " · " : "";
        const meta = `${tagStr}${l.room ?? ""}${l.teacher ? " · " + l.teacher : ""}`;

        // Картка
        cards += `
        <rect x="${PADDING}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="${CORNER}" ry="${CORNER}" fill="#1e1e2e" stroke="${color}" stroke-width="2"/>
        <rect x="${PADDING}" y="${y}" width="6" height="${CARD_H}" rx="3" ry="3" fill="${color}"/>
        <text x="${PADDING + 18}" y="${y + 28}" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${xmlEsc(emoji + " " + title)}</text>
        <text x="${PADDING + 18}" y="${y + 50}" font-family="Arial, sans-serif" font-size="12" fill="#aaaaaa">${xmlEsc("🏛 " + (l.room ?? "—"))}</text>
        <text x="${PADDING + 18}" y="${y + 68}" font-family="Arial, sans-serif" font-size="12" fill="#888888">${xmlEsc("👤 " + (l.teacher ?? "").replace(/\s*\(Потік\)/g, ""))}</text>
        `;
        if (tags.length) {
          cards += `<text x="${CARD_W + PADDING - 10}" y="${y + 28}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="${color}">${xmlEsc(tags.join(", "))}</text>`;
        }

        y += CARD_H + GAP;
      }
      y += 8;
    }
  }

  const finalH = y + PADDING;

  const weekBadgeColor = weekType.includes("Чисельник") ? "#4A90D9" : "#E67E22";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${finalH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#12121f"/>
      <stop offset="100%" stop-color="#0d0d1a"/>
    </linearGradient>
  </defs>
  <rect width="${SVG_W}" height="${finalH}" fill="url(#bg)" rx="20" ry="20"/>

  <!-- Заголовок -->
  <text x="${PADDING}" y="36" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff">${xmlEsc(date)}</text>
  <rect x="${PADDING}" y="46" width="${Math.min(weekType.length * 9 + 20, 200)}" height="26" rx="13" ry="13" fill="${weekBadgeColor}22" stroke="${weekBadgeColor}" stroke-width="1"/>
  <text x="${PADDING + 10}" y="64" font-family="Arial, sans-serif" font-size="13" fill="${weekBadgeColor}">${xmlEsc(weekType)}</text>
  <text x="${SVG_W - PADDING}" y="36" text-anchor="end" font-family="Arial, sans-serif" font-size="14" fill="#666">${xmlEsc(group)}</text>

  <!-- Розділювач -->
  <line x1="${PADDING}" y1="${HEADER_H - 10}" x2="${SVG_W - PADDING}" y2="${HEADER_H - 10}" stroke="#333" stroke-width="1"/>

  ${cards}
</svg>`;

  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: SVG_W },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    return new Response(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e) {
    console.error("Resvg error:", e);
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  }
}
