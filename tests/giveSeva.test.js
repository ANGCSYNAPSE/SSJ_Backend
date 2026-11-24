import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, sql, startServer, stopServer } from "./helpers.js";

const TAG = "gsv";
const email = () => `autotest+${TAG}-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

before(startServer);
after(async () => {
  await sql(`DELETE FROM donations WHERE email LIKE 'autotest+${TAG}-%'`);
  await stopServer();
});

const base = (extra = {}) => ({ amount: 1100, cause: "Annadan Seva", donorName: "Gita Devi", email: email(), phone: "9876543210", ...extra });

describe("Give Seva donations", () => {
  it("keeps the seva details with the donation", async () => {
    const body = base({
      sevaType: "annadan",
      occasion: "Birthday",
      dedicatedTo: "My mother, Kamla Devi",
      message: "Jai Shree Shyam",
      preferredDate: "2027-02-20",
      city: "Jaipur",
      payMethod: "upi",
      instructions: "Serve the meal on Ekadashi to the elders",
      gotra: "Kashyap",
      attend: "maybe",
      updates: "whatsapp",
      witness: "live",
      witnessTime: "evening",
      videoNumber: "+91 98765 43210",
    });
    const res = await api("/donations/create-order", { body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = await sql(`SELECT *, preferred_date::text AS pd FROM donations WHERE razorpay_order_id = $1`, [res.body.data.orderId]);
    assert.equal(row.seva_type, "annadan");
    assert.equal(row.occasion, "Birthday");
    assert.equal(row.dedicated_to, "My mother, Kamla Devi");
    assert.equal(row.message, "Jai Shree Shyam");
    assert.equal(row.pd, "2027-02-20");
    assert.equal(row.city, "Jaipur");
    assert.equal(row.pay_method, "upi");
    assert.equal(row.instructions, "Serve the meal on Ekadashi to the elders");
    assert.equal(row.gotra, "Kashyap");
    assert.equal(row.attend, "maybe");
    assert.equal(row.updates, "whatsapp");
    assert.equal(row.witness, "live");
    assert.equal(row.witness_time, "evening");
    assert.equal(row.video_number, "+91 98765 43210");
  });

  it("still takes a plain donation with none of those details", async () => {
    const res = await api("/donations/create-order", { body: base() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = await sql(`SELECT seva_type, occasion, message FROM donations WHERE razorpay_order_id = $1`, [res.body.data.orderId]);
    assert.equal(row.seva_type, null);
    assert.equal(row.occasion, null);
    assert.equal(row.message, null);
  });

  it("turns a blank detail into 'not given'", async () => {
    const res = await api("/donations/create-order", { body: base({ sevaType: "gaushala", dedicatedTo: "   ", message: "" }) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = await sql(`SELECT dedicated_to, message FROM donations WHERE razorpay_order_id = $1`, [res.body.data.orderId]);
    assert.equal(row.dedicated_to, null);
    assert.equal(row.message, null);
  });

  it("refuses a bad seva name, a bad date, an unknown payment method and a silly amount", async () => {
    for (const extra of [{ sevaType: "Drop Table;" }, { preferredDate: "next friday" }, { payMethod: "bitcoin" }, { attend: "sometimes" }, { updates: "pigeon" }, { witness: "hologram" }, { witnessTime: "midnight" }, { videoNumber: "call me maybe" }, { amount: 999_999_999 }]) {
      const res = await api("/donations/create-order", { body: base(extra) });
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
  });
});
