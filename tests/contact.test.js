import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, createUser, login, mailOutbox, sql, startServer, stopServer } from "./helpers.js";

before(startServer);
after(async () => {
  await sql(`DELETE FROM contact_submissions WHERE email LIKE 'autotest+contact-%'`);
  await stopServer();
});

const TO = "shyamjagatindia@gmail.com";
const email = () => `autotest+contact-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
const send = (over = {}) => api("/contact", { body: { name: "Gitesh Negi", email: email(), phone: "8791172842", subject: "Volunteering", message: "I would like to volunteer for the next seva camp.", ...over } });
const sentTo = (visitor) => mailOutbox.filter((m) => m.to === TO && m.replyTo?.includes(visitor));

describe("the contact form", () => {
  it("is saved for the admin and emailed to the team inbox, with the visitor as the reply address", async () => {
    const visitor = email();
    const res = await send({ email: visitor });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const [row] = await sql(`SELECT name, subject, message, is_handled FROM contact_submissions WHERE email = $1`, [visitor]);
    assert.equal(row.name, "Gitesh Negi");
    assert.equal(row.is_handled, false);

    const [mail] = sentTo(visitor);
    assert.ok(mail, "an email went to the team inbox");
    assert.equal(mail.to, TO);
    assert.match(mail.subject, /^Website enquiry: Volunteering$/);
    assert.ok(mail.replyTo.includes(visitor), "replying answers the visitor");
    assert.match(mail.text, /I would like to volunteer for the next seva camp\./);
    assert.match(mail.text, /From: Gitesh Negi/);
    assert.match(mail.text, /Phone: 8791172842/);
  });

  it("shows up in the admin's list of inquiries", async () => {
    const visitor = email();
    await send({ email: visitor });
    const admin = (await login(await createUser("contact", { role: "admin" }))).body.data.accessToken;
    const list = await api("/admin/contact", { token: admin });
    assert.ok(list.body.data.some((item) => item.email === visitor));
    await sql(`DELETE FROM users WHERE email LIKE 'autotest+contact-%'`);
  });

  it("works without a phone or subject", async () => {
    const visitor = email();
    const res = await send({ email: visitor, phone: undefined, subject: undefined });
    assert.equal(res.status, 201);
    const [mail] = sentTo(visitor);
    assert.match(mail.subject, /No subject/);
    assert.match(mail.text, /Phone: not given/);
  });

  it("refuses a missing name, a bad email, an empty message and absurdly long text, with a reason", async () => {
    assert.equal((await send({ name: "" })).status, 400);
    const bad = await send({ email: "not-an-email" });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.errors.some((e) => e.field === "email"));
    assert.equal((await send({ message: "hi" })).status, 400);
    assert.equal((await send({ message: "x".repeat(2001) })).status, 400);
    assert.equal((await send({ subject: "y".repeat(201) })).status, 400);
  });

  it("cannot be used to inject mail headers or markup", async () => {
    const visitor = email();
    await send({
      email: visitor,
      name: 'Eve"\r\nBcc: victim@example.com',
      subject: "Hello\r\nBcc: victim@example.com",
      message: "<script>alert(1)</script> and <b>bold</b>",
    });
    const [mail] = sentTo(visitor);
    assert.ok(!/[\r\n]/.test(mail.subject), "no line breaks in the subject");
    assert.ok(!/[\r\n]/.test(mail.replyTo), "no line breaks in the reply address");
    assert.ok(!mail.html.includes("<script>"), "markup in the message is shown as text, not run");
    assert.ok(mail.html.includes("&lt;script&gt;"));
  });
});
