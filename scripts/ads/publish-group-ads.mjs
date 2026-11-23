/**
 * Puts the group companies' advertisements on the website: one per company in each of the three slot sizes. Each ad goes
 * in ONE place (a page and a spot on it, see PLACES) and nowhere else, and no page shows the same company twice. The
 * timing of ads that share a spot is set in the admin, Advertisement page. It replaces the earlier seva appeals and any
 * group ads this script made before, so it is safe to run again. Ads made by hand in the admin are left alone.
 *
 * The pictures (one 2:1 .jpg per company, named as in COMPANIES) are read from the folder you give:
 *
 *   node scripts/ads/publish-group-ads.mjs <pictures-folder>            # uploads and publishes
 *   node scripts/ads/publish-group-ads.mjs <pictures-folder> --dry-run  # shows what it would do
 *   node scripts/ads/publish-group-ads.mjs --placements-only            # only moves the existing group ads to the places below
 *
 * Everything written here (headline, line, button, colour, link) can be changed afterwards in the admin panel.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sql } from "../../src/config/database.js";
import { uploadBufferToCloudinary } from "../../src/services/cloudinary.service.js";

const DRY = process.argv.includes("--dry-run");
const PLACEMENTS_ONLY = process.argv.includes("--placements-only");
const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!dir && !PLACEMENTS_ONLY) {
  console.error("Give the folder that holds the pictures: node scripts/ads/publish-group-ads.mjs <folder>");
  process.exit(1);
}

const MARK = "group-ads-v1";
const SEVA_ADVERTISER = "Shyam Jagat Seva";

/** theme: a named colour scheme, or [from, to] for a custom one. ctaColor: the button colour, chosen to suit the picture. Wording per slot: the small ones get the short version. */
const COMPANIES = [
  {
    name: "ANGC Synapse",
    ctaColor: "#e5384f",
    file: "angc-synapse.jpg",
    link: "https://angcsynapse.com/",
    theme: ["#3b0d14", "#150507"],
    cta: "Start your project",
    leaderboard: { headline: "Trusted software for ideas ready to grow", subline: "ANGC Synapse · web, mobile, AI & cloud development" },
    banner: {
      headline: "Trusted software for ideas ready to grow",
      subline: "ANGC Synapse turns business requests into secure portals, AI workflows, mobile apps and cloud systems.",
    },
    rectangle: { headline: "Software built to scale", subline: "ANGC Synapse · AI, web, mobile & cloud" },
  },
  {
    name: "Ittarwala",
    ctaColor: "#d4a73a",
    file: "ittarwala.jpg",
    link: "https://ittarwala.com/",
    theme: ["#1c1608", "#0b0b0b"],
    cta: "Shop attars",
    leaderboard: { headline: "Authentic natural attars", subline: "Ittarwala · the timeless art of natural fragrance" },
    banner: { headline: "Authentic natural attars", subline: "Ittarwala celebrates the timeless art of natural fragrance through a collection of authentic attars." },
    rectangle: { headline: "Natural attars, the timeless way", subline: "Ittarwala · authentic fragrance oils" },
  },
  {
    name: "Chivalree",
    ctaColor: "#e0457b",
    file: "chivalree.jpg",
    link: "https://www.chivalree.com/",
    theme: "royal",
    cta: "Discover the set",
    leaderboard: { headline: "Six scents. Six personalities.", subline: "Chivalree · perfumes & discovery sets, one vial at a time" },
    banner: { headline: "Six scents. Six personalities.", subline: "Chivalree perfumes and discovery sets: find the one that was made for you." },
    rectangle: { headline: "Six scents. Six personalities.", subline: "Chivalree perfumes" },
  },
  {
    name: "BrokrsHouse",
    ctaColor: "#0193d4",
    file: "brokrshouse.jpg",
    link: "https://brokrshouse.com/",
    theme: ["#0c2d4a", "#0f172a"],
    cta: "Join the network",
    leaderboard: { headline: "India's verified broker network", subline: "BrokrsHouse · more projects, more connections, more opportunities" },
    banner: {
      headline: "India's verified broker network",
      subline: "BrokrsHouse helps brokers discover property opportunities, connect with verified professionals and grow.",
    },
    rectangle: { headline: "India's verified broker network", subline: "BrokrsHouse" },
  },
  {
    name: "The Brokrs",
    ctaColor: "#f08a24",
    file: "the-brokrs.jpg",
    link: "https://www.thebrokrs.com/",
    theme: "navy",
    cta: "Start growing",
    leaderboard: { headline: "Where skills, business & opportunity meet", subline: "The Brokrs · join the future of collaborative wealth" },
    banner: { headline: "Where skills, business & opportunity meet", subline: "The Brokrs · join the future of collaborative wealth and brand growth." },
    rectangle: { headline: "Where business & opportunity meet", subline: "The Brokrs · collaborative growth" },
  },
  {
    name: "ANGC Infra",
    ctaColor: "#f5b800",
    file: "angc-infra.jpg",
    link: "https://angcinfra.com/",
    theme: ["#1a1405", "#080808"],
    cta: "Inquire now",
    leaderboard: { headline: "We build what's next.", subline: "ANGC Infra · Nivara Grand plots, 100–186 sq. yds. on the NH-48 growth belt" },
    banner: {
      headline: "We build what's next.",
      subline: "ANGC Infra · Nivara Grand plots of 100–186 sq. yds. at Keshwana-Rajput, on the NH-48 industrial corridor.",
    },
    rectangle: { headline: "Nivara Grand plots", subline: "ANGC Infra · 100–186 sq. yds. on NH-48" },
  },
  {
    name: "GSIPL Group",
    ctaColor: "#2f9be0",
    file: "gsipl.jpg",
    link: "https://gsiplgroup.com/",
    theme: ["#10294a", "#0a1730"],
    cta: "Discover more",
    leaderboard: { headline: "Great places for perfection and class", subline: "GSIPL Group · real estate for brokers & investors across NCR and Rajasthan" },
    banner: {
      headline: "Great places for perfection and class",
      subline: "GSIPL Group · residential, commercial and mixed-use projects for brokers and investors across Delhi NCR and Rajasthan.",
    },
    rectangle: { headline: "Great places for perfection", subline: "GSIPL Group · real estate across NCR & Rajasthan" },
  },
];

const SIZES = ["leaderboard", "banner", "rectangle"];

/**
 * The page (placement area in the admin) and the spot on it (1 = the first spot of that size from the top of the page)
 * for each of the seven places in each size. Company number c goes to place (c - 2 x size number) mod 7, so every
 * company has one place per size and a page never shows the same company twice.
 */
const PLACES = {
  leaderboard: ["Homepage", "Events Page", "Donation Page", "Initiatives Page", "Temple Directory", "Blog Listing", "About Page"],
  banner: ["Homepage", "Events Page", "Donation Page", "Initiatives Page", "Temple Directory", "Blog Listing", "Artists Page"],
  rectangle: ["Homepage", "Events Page", "Donation Page", "Initiatives Page", "Temple Directory", "Blog Listing", "Baba Shyam Page"],
};
const placeFor = (companyIndex, size) => {
  const sizeIndex = SIZES.indexOf(size);
  return { page: PLACES[size][(((companyIndex - 2 * sizeIndex) % 7) + 7) % 7], position: 1 };
};
const total = COMPANIES.length * SIZES.length;
console.log(`${COMPANIES.length} companies x ${SIZES.length} sizes = ${total} ads, each in one place.`);

if (PLACEMENTS_ONLY) {
  let moved = 0;
  for (const [index, company] of COMPANIES.entries()) {
    for (const size of SIZES) {
      const place = placeFor(index, size);
      const rows = await sql(
        `UPDATE ads SET page = $1, slot_position = $2 WHERE advertiser = $3 AND placement = $4::ad_placement AND description LIKE $5 RETURNING id`,
        [place.page, place.position, company.name, size, `${MARK}%`],
      );
      moved += rows.length;
      console.log(`  ${company.name.padEnd(13)} ${size.padEnd(12)} -> ${place.page}, spot ${place.position}`);
    }
  }
  console.log(`Moved ${moved} ads.`);
  process.exit(0);
}

for (const company of COMPANIES) {
  const file = path.join(dir, company.file);
  if (!fs.existsSync(file)) throw new Error(`Missing picture: ${file}`);
}
if (DRY) {
  for (const c of COMPANIES) console.log(`  ${c.name.padEnd(14)} ${c.link}  "${c.banner.headline}"`);
  process.exit(0);
}

for (const company of COMPANIES) {
  const uploaded = await uploadBufferToCloudinary(fs.readFileSync(path.join(dir, company.file)), { folder: "ssj/ads/group", mimeType: "image/jpeg" });
  company.imageUrl = uploaded.secure_url;
  console.log("uploaded", company.name);
}

const removedOld = await sql(`DELETE FROM ads WHERE advertiser = $1 OR description LIKE $2 RETURNING id`, [SEVA_ADVERTISER, `${MARK}%`]);
console.log(`Removed ${removedOld.length} earlier ads.`);

for (const [companyIndex, company] of COMPANIES.entries()) {
  const custom = Array.isArray(company.theme);
  for (const size of SIZES) {
    const words = company[size];
    const place = placeFor(companyIndex, size);
    await sql(
      `INSERT INTO ads (placement, page, template, image_url, link_url, cta_label, headline, subline, theme, bg_from, bg_to, cta_color, slot_position,
                        is_active, is_draft, title, advertiser, ad_type, priority, description)
       VALUES ($1::ad_placement, $14, 'split', $2, $3, $4, $5, $6, $7, $8, $9, $13, $15, TRUE, FALSE, $10, $11, 'Group company', 'medium', $12)`,
      [
        size,
        company.imageUrl,
        company.link,
        company.cta,
        words.headline,
        words.subline,
        custom ? "custom" : company.theme,
        custom ? company.theme[0] : null,
        custom ? company.theme[1] : null,
        `${company.name} (${size})`,
        company.name,
        `${MARK}: written by the setup script. Change the text, colour, picture and link in the admin whenever you like.`,
        company.ctaColor,
        place.page,
        place.position,
      ],
    );
  }
}
console.log(`Published ${total} ads.`);
process.exit(0);
