/**
 * Turns the raw AI pictures in SSJ/public/images/advertisements/ into ready-to-upload ad creatives:
 *   <id>-banner.jpg      1940 x 500   (the 970 x 250 slot at 2x)
 *   <id>-rectangle.jpg    600 x 500   (the 300 x 250 slot at 2x)
 *   <id>-leaderboard.jpg 1456 x 180   (the 728 x 90 slot at 2x)
 * written to SSJ/public/images/advertisements/ready/. Each one is the picture, cropped around its subjects, with a
 * maroon panel carrying the headline (English and Hindi) and a call-to-action button. The corner mark the image
 * generator adds is always cropped away.
 *
 * Needs the `sharp` package, which is not a project dependency:   npm i --no-save sharp   (or set NODE_PATH to a folder that has it)
 * Run:   node scripts/ads/build-creatives.cjs
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../SSJ/public/images/advertisements");
const OUT = path.join(ROOT, "ready");

/** One entry per picture. y0 / x0 say where, in the 1408 x 768 original, the subjects are for each crop. */
const SEVAS = [
  { id: "annadaan", file: "annadaan.png", en: ["Feed a family,", "serve with love"], enShort: "Feed a family today", hi: "अन्नदान – सेवा का सबसे बड़ा रूप", hiShort: "अन्नदान – महान सेवा", cta: "Donate Now", bannerY: 40, rectX: 60, leadY: 110 },
  { id: "education", file: "Education.png", en: ["Every child deserves", "to learn"], enShort: "Every child deserves to learn", hi: "हर बच्चे को शिक्षा का अधिकार", hiShort: "शिक्षा हर बच्चे का अधिकार", cta: "Support Education", bannerY: 40, rectX: 200, leadY: 190 },
  { id: "healthcare", file: "healthcare.png", en: ["Free health camps", "for those in need"], enShort: "Free health camps for all", hi: "ज़रूरतमंदों के लिए निःशुल्क स्वास्थ्य शिविर", hiShort: "निःशुल्क स्वास्थ्य शिविर", cta: "Help Us Heal", bannerY: 40, rectX: 100, leadY: 170 },
  { id: "women", file: "women_empowerment.png", en: ["Skills that build", "confident futures"], enShort: "Skills for confident futures", hi: "महिला सशक्तिकरण, आत्मनिर्भर भारत", hiShort: "महिला सशक्तिकरण", cta: "Empower a Woman", bannerY: 40, rectX: 250, leadY: 120 },
  { id: "shelter", file: "Safe shelter.png", en: ["A safe roof for", "every soul"], enShort: "A safe roof for every soul", hi: "हर बेघर को सुरक्षित आश्रय", hiShort: "हर बेघर को आश्रय", cta: "Give Shelter", bannerY: 0, rectX: 250, leadY: 40 },
  { id: "donation", file: "Donation and seva drive.png", en: ["Your small seva", "can change a life"], enShort: "Your small seva changes lives", hi: "आपकी छोटी सी सेवा, बड़ा सहारा", hiShort: "छोटी सेवा, बड़ा सहारा", cta: "Donate Now", bannerY: 0, rectX: 0, leadY: 0 },
];

const MAROON = "#6b1f1f";
const MAROON_DARK = "#4a1212";
const ORANGE = "#e87722";
const SERIF = "Georgia, 'Times New Roman', serif";
const HINDI = "'Nirmala UI', Mangal, 'Noto Sans Devanagari', sans-serif";
const SANS = "'Segoe UI', Arial, sans-serif";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pill = (x, y, label, size) => {
  const w = Math.round(label.length * size * 0.56 + size * 2.6);
  const h = Math.round(size * 2.3);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${ORANGE}"/>
<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" font-family="${SANS}" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle">${esc(label)}  ›</text>`;
};

/** The picture, cropped from the original at (left, top, width, height) and scaled to w x h. */
const crop = (src, left, top, width, height, w, h) =>
  sharp(src).extract({ left, top, width, height }).resize(w, h, { fit: "fill" }).jpeg({ quality: 92 }).toBuffer();

const panelBg = (w, h) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${MAROON}"/><stop offset="1" stop-color="${MAROON_DARK}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>`;

const fade = (w, h) =>
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${MAROON_DARK}" stop-opacity="0.85"/><stop offset="1" stop-color="${MAROON_DARK}" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#f)"/></svg>`;

async function banner(s, src) {
  const W = 1940, H = 500, PANEL = 720;
  const img = await crop(src, 0, s.bannerY, 1408, 577, W - PANEL, H);
  const text = `<svg width="${PANEL}" height="${H}" xmlns="http://www.w3.org/2000/svg">${panelBg(PANEL, H)}
<rect x="56" y="64" width="64" height="4" fill="${ORANGE}"/>
<text x="56" y="112" font-family="${SANS}" font-size="22" font-weight="700" letter-spacing="6" fill="#f0b072">SHYAM JAGAT</text>
<text x="56" y="196" font-family="${SERIF}" font-size="56" font-weight="700" fill="#fff">${esc(s.en[0])}</text>
<text x="56" y="262" font-family="${SERIF}" font-size="56" font-weight="700" fill="#fff">${esc(s.en[1])}</text>
<text x="56" y="322" font-family="${HINDI}" font-size="34" fill="#ffd9a8">${esc(s.hi)}</text>
${pill(56, 362, s.cta, 30)}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: MAROON } })
    .composite([
      { input: img, left: PANEL, top: 0 },
      { input: Buffer.from(fade(110, H)), left: PANEL, top: 0 },
      { input: Buffer.from(text), left: 0, top: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function rectangle(s, src) {
  const W = 600, H = 500, IMG_H = 340;
  const cropW = Math.round((610 * W) / IMG_H);
  const img = await crop(src, s.rectX, 0, cropW, 610, W, IMG_H);
  const text = `<svg width="${W}" height="${H - IMG_H}" xmlns="http://www.w3.org/2000/svg">${panelBg(W, H - IMG_H)}
<text x="28" y="46" font-family="${SERIF}" font-size="31" font-weight="700" fill="#fff">${esc(s.enShort)}</text>
<text x="28" y="86" font-family="${HINDI}" font-size="23" fill="#ffd9a8">${esc(s.hiShort)}</text>
${pill(28, 104, s.cta, 21)}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: MAROON } })
    .composite([
      { input: img, left: 0, top: 0 },
      { input: Buffer.from(text), left: 0, top: IMG_H },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function leaderboard(s, src) {
  const W = 1456, H = 180, PANEL = 860;
  const cropH = Math.round((1408 * H) / (W - PANEL));
  const img = await crop(src, 0, s.leadY, 1408, cropH, W - PANEL, H);
  const text = `<svg width="${PANEL}" height="${H}" xmlns="http://www.w3.org/2000/svg">${panelBg(PANEL, H)}
<text x="36" y="76" font-family="${SERIF}" font-size="36" font-weight="700" fill="#fff">${esc(s.enShort)}</text>
<text x="36" y="124" font-family="${HINDI}" font-size="26" fill="#ffd9a8">${esc(s.hiShort)}</text>
${pill(668, 56, "Donate", 24)}
</svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: MAROON } })
    .composite([
      { input: img, left: PANEL, top: 0 },
      { input: Buffer.from(fade(90, H)), left: PANEL, top: 0 },
      { input: Buffer.from(text), left: 0, top: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SEVAS) {
    const src = path.join(ROOT, s.file);
    if (!fs.existsSync(src)) {
      console.log("missing", s.file);
      continue;
    }
    for (const [slot, make] of [["banner", banner], ["rectangle", rectangle], ["leaderboard", leaderboard]]) {
      fs.writeFileSync(path.join(OUT, `${s.id}-${slot}.jpg`), await make(s, src));
    }
    console.log("built", s.id);
  }
})();
