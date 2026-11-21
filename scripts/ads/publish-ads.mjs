/**
 * Uploads the finished ad creatives (SSJ/public/images/advertisements/ready/*.jpg, made by build-creatives.cjs) to
 * Cloudinary and creates the advertisements that show them on the right pages. Safe to run again: the ads this script
 * made before are replaced, anything made by hand in the admin panel is left alone.
 *
 *   node scripts/ads/publish-ads.mjs            # uploads and publishes
 *   node scripts/ads/publish-ads.mjs --dry-run  # shows what it would do
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../../src/config/database.js";
import { uploadBufferToCloudinary } from "../../src/services/cloudinary.service.js";

const READY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../SSJ/public/images/advertisements/ready");
const SITE = "https://www.shyamjagat.com";
const ADVERTISER = "Shyam Jagat Seva";
const DRY = process.argv.includes("--dry-run");

const SEVAS = {
  annadaan: { name: "Annadaan", cta: "Donate Now", link: `${SITE}/donation` },
  education: { name: "Education for children", cta: "Support Education", link: `${SITE}/donation` },
  healthcare: { name: "Free health camps", cta: "Help Us Heal", link: `${SITE}/donation` },
  women: { name: "Women empowerment", cta: "Empower a Woman", link: `${SITE}/donation` },
  shelter: { name: "Safe shelter", cta: "Give Shelter", link: `${SITE}/donation` },
  donation: { name: "Seva and donation drive", cta: "Donate Now", link: `${SITE}/donation` },
};

/**
 * Which picture goes in which slot of which page. `page` is the placement area the site and the admin panel share;
 * a page with several slots of one size (the homepage has two leaderboards) shares its ads out between them.
 */
const PLAN = [
  // Homepage
  ["Home Page Hero", "leaderboard", ["annadaan", "education", "healthcare"]],
  ["Homepage", "banner", ["donation"]],
  ["Home Page Sidebar", "rectangle", ["women"]],
  // Donation
  ["Donation Page", "leaderboard", ["healthcare"]],
  ["Donation Page", "rectangle", ["education"]],
  ["Donation Page", "banner", ["shelter"]],
  // Initiatives
  ["Initiatives Page", "leaderboard", ["women"]],
  ["Initiatives Page", "rectangle", ["annadaan"]],
  ["Initiatives Page", "banner", ["education"]],
  // About
  ["About Page", "leaderboard", ["shelter"]],
  ["About Page", "banner", ["women"]],
  // Events
  ["Events Page", "leaderboard", ["donation"]],
  ["Events Page", "rectangle", ["healthcare"]],
  ["Events Page", "banner", ["annadaan"]],
  // Blog
  ["Blog Listing", "leaderboard", ["education"]],
  ["Blog Listing", "rectangle", ["women"]],
  ["Blog Listing", "banner", ["donation"]],
  // Other pages
  ["Dharamshala Page", "leaderboard", ["shelter"]],
  ["Artists Page", "leaderboard", ["donation"]],
  ["Artists Page", "banner", ["annadaan"]],
  ["Organisations Page", "leaderboard", ["women"]],
  ["Baba Shyam Page", "leaderboard", ["annadaan"]],
  ["Baba Shyam Page", "rectangle", ["donation"]],
  ["Baba Shyam Page", "banner", ["healthcare"]],
  ["Registration Pages", "leaderboard", ["donation"]],
  ["Registration Pages", "rectangle", ["annadaan"]],
];

const wanted = PLAN.flatMap(([page, slot, ids]) => ids.map((id) => ({ page, slot, id })));
console.log(`${wanted.length} ads over ${new Set(wanted.map((w) => w.page)).size} page areas, using ${new Set(wanted.map((w) => `${w.id}-${w.slot}`)).size} pictures.`);
if (DRY) {
  for (const w of wanted) console.log(`  ${w.page.padEnd(20)} ${w.slot.padEnd(12)} ${w.id}`);
  process.exit(0);
}

// One upload per picture, however many pages use it.
const urls = new Map();
for (const key of new Set(wanted.map((w) => `${w.id}-${w.slot}`))) {
  const file = path.join(READY, `${key}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run build-creatives.cjs first.`);
  const result = await uploadBufferToCloudinary(fs.readFileSync(file), { folder: "ssj/ads", mimeType: "image/jpeg" });
  urls.set(key, result.secure_url);
  console.log("uploaded", key);
}

await sql(`DELETE FROM ads WHERE advertiser = $1`, [ADVERTISER]);
for (const w of wanted) {
  const seva = SEVAS[w.id];
  await sql(
    `INSERT INTO ads (placement, page, image_url, link_url, cta_label, is_active, is_draft, title, advertiser, ad_type, priority, description)
     VALUES ($1::ad_placement, $2, $3, $4, $5, TRUE, FALSE, $6, $7, $8, 'medium', $9)`,
    [
      w.slot,
      w.page,
      urls.get(`${w.id}-${w.slot}`),
      seva.link,
      seva.cta,
      `${seva.name}: ${w.page} (${w.slot})`,
      ADVERTISER,
      w.slot === "rectangle" ? "Sidebar Ad" : "Banner",
      `Seva message for ${w.page}. Made from the pictures in the advertisements folder.`,
    ],
  );
}
console.log(`Published ${wanted.length} ads.`);
process.exit(0);
