import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, payPending, startAndVerify, startServer, stopServer } from "./helpers.js";

const TAG = "cat";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const PHOTO = "https://res.cloudinary.com/demo/image/upload/sample.jpg";
const performer = (specialty) => ({
  dateOfBirth: "1990-05-10",
  gender: "Male",
  city: "Jaipur",
  state: "Rajasthan",
  profilePhoto: PHOTO,
  primarySpecialty: specialty,
  secondarySpecialty: "Kirtan",
  experience: "5-10 Years",
  guruName: "Pt. Ramlal",
  bio: "A devoted performer with over ten years of stage experience.",
  portfolioLink: "https://example.com/portfolio",
  availableEvents: ["Jagran", "Satsang"],
  regions: ["Rajasthan", "Delhi"],
  honorarium: "5000",
  travelWillingness: "Across India",
  consentContact: true,
  workFiles: [PHOTO],
});

/** One complete, realistic registration per category: every field the site's form can send. */
const FULL = {
  artist: performer("Bhajan Singer"),
  dancer: performer("Kathak"),
  musician: performer("Tabla"),
  temple: {
    templeName: "Shri Shyam Mandir",
    deity: "Baba Shyam",
    templeType: "Mandir",
    yearEstablished: "1995",
    trustName: "Shyam Seva Trust",
    registrationNumber: "TR-2201",
    address: "Main Road, Khatu Shyam Ji",
    city: "Sikar",
    state: "Rajasthan",
    pinCode: "332602",
    mapsLink: "https://maps.google.com/?q=khatu",
    openingTime: "05:00 AM",
    closingTime: "09:00 PM",
    aartiTimings: "5:30 AM, 12:00 PM, 7:00 PM",
    services: ["Bhojan", "Dharamshala"],
    description: "An ancient temple dedicated to Baba Shyam, visited by lakhs of devotees.",
    consentComms: true,
    primaryPhoto: PHOTO,
    gallery: [PHOTO],
  },
  dharamshala: {
    name: "Shyam Vishram Dharamshala",
    trustName: "Shyam Seva Trust",
    licenseNumber: "LIC-4471",
    distanceFromTemple: "Within 1 Km",
    address: "Near Bus Stand, Khatu Shyam Ji",
    state: "Rajasthan",
    managerName: "Mahesh Sharma",
    totalRooms: 40,
    dormitoryBeds: "60",
    pricingMode: "Fixed Price",
    suggestedPrice: 500,
    amenities: ["Parking", "Water"],
    trustCertificate: PHOTO,
    propertyPhotos: [PHOTO],
    managerIdProof: PHOTO,
  },
  mandal: {
    mandalName: "Shri Shyam Bhajan Mandal",
    mandalType: "Bhajan Mandal & Kirtan Samiti",
    foundingYear: "2001",
    registrationNumber: "MN-889",
    state: "Rajasthan",
    city: "Jaipur",
    address: "12, Ram Nagar, Jaipur",
    officialPhone: "9876543210",
    presidentName: "Ramesh Gupta",
    presidentPhone: "9876543211",
    memberCountBand: "25 - 50 Active Members",
    spokespersonName: "Suresh Gupta",
    sevaTypes: ["Annadaan", "Bhajan Sandhya"],
    recurringEvents: "Monthly satsang on every Ekadashi",
    logo: PHOTO,
    registrationDocument: PHOTO,
  },
};

const CATEGORIES = Object.keys(FULL);
/** Only what the wizard's account step passes along with the first call (the mandal needs its president). */
const early = (category, who) => (category === "mandal" ? { presidentName: who.fullName } : {});

/** Money and counts come back from the database as text ("500.00"); compare them by value. */
const same = (actual, expected, label) => (typeof expected === "number" ? assert.equal(Number(actual), expected, label) : assert.deepEqual(actual, expected, label));

const adminToken = async () => (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;

for (const category of CATEGORIES) {
  describe(`registering as: ${category}`, () => {
    let admin;
    let state;

    it("goes through signup (code, details, fee) and creates the account with the profile", async () => {
      admin = await adminToken();
      const { pendingId, who } = await startAndVerify(TAG, { category, profile: early(category, who0()) });
      const saved = await api("/auth/signup/profile", { body: { pendingId, profile: { ...FULL[category], ...(category === "mandal" ? { presidentName: FULL.mandal.presidentName } : {}) } } });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.data.category, category);

      const paid = await payPending(pendingId, 501);
      assert.equal(paid.done.status, 201, JSON.stringify(paid.done.body));
      const { user, accessToken } = paid.done.body.data;
      assert.deepEqual(user.profiles.map((p) => p.category), [category]);
      assert.equal(user.profiles[0].isComplete, true, `a complete form leaves nothing missing: ${JSON.stringify(user.profiles[0].missing)}`);
      state = { user, token: accessToken, who };
    });

    it("saves every detail the person gave, exactly as sent", async () => {
      const mine = (await api("/registrations/me", { token: state.token })).body.data.find((p) => p.category === category);
      assert.ok(mine, "the profile is on the member's own page");
      assert.equal(mine.status, "pending");
      assert.deepEqual(mine.missingFields ?? [], []);
      for (const [key, value] of Object.entries(FULL[category])) {
        if (key !== "dateOfBirth") same(mine[key], value, `${key} was saved`);
      }
      state.profileId = mine.id;
    });

    it("shows up for the admin with the person's account and every detail", async () => {
      const list = (await api(`/admin/registrations?type=${category}`, { token: admin })).body.data;
      const row = list.find((r) => r.id === state.profileId);
      assert.ok(row, "listed in the admin's registrations");
      assert.equal(row.status, "pending");
      assert.equal(row.isComplete, true);

      const detail = (await api(`/admin/registrations/${category}/${state.profileId}`, { token: admin })).body.data;
      assert.equal(detail.account.email, state.who.email);
      for (const [key, value] of Object.entries(FULL[category])) {
        if (key !== "dateOfBirth") same(detail[key], value, `${key} is visible to the admin`);
      }
    });

    it("stays off the public directory until approved, then appears without private fields", async () => {
      const before = (await api(`/registrations/public?type=${category}`)).body.data;
      assert.ok(!before.some((p) => p.id === state.profileId), "not public while pending");

      const approve = await api(`/admin/registrations/${category}/${state.profileId}/verify`, { method: "PATCH", token: admin, body: {} });
      assert.equal(approve.status, 200);
      const after = (await api(`/registrations/public?type=${category}`)).body.data;
      const listed = after.find((p) => p.id === state.profileId);
      assert.ok(listed, "public once approved");
      for (const secret of ["userId", "adminNote", "missingFields"]) assert.equal(listed[secret], undefined, `${secret} is never public`);
      if (["artist", "dancer", "musician"].includes(category)) assert.equal(listed.dateOfBirth, undefined, "a person's date of birth is never public");
    });

    it("the member can edit their own details later", async () => {
      const res = await api(`/registrations/me/${category}`, { method: "PATCH", token: state.token, body: { city: "Udaipur", state: "Rajasthan" } });
      // dharamshala has no city field of its own: unknown keys are ignored, the call still works
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    it("an existing member can add this category from their profile, once", async () => {
      const member = await createUser(TAG);
      const token = (await login(member)).body.data.accessToken;
      const body = { ...FULL[category] };
      const created = await api(`/registrations/${category}`, { token, body });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const again = await api(`/registrations/${category}`, { token, body });
      assert.equal(again.status, 409, "a second registration in the same category is refused");
    });

    it("an unfinished form is saved with what is missing listed, and a wrong value is refused per field", async () => {
      const token = (await login(await createUser(TAG))).body.data.accessToken;
      const minimal = category === "mandal" ? { presidentName: "Ramesh" } : {};
      const created = await api(`/registrations/${category}`, { token, body: minimal });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const mine = (await api("/registrations/me", { token })).body.data.find((p) => p.category === category);
      assert.ok(mine.missingFields.length > 0, "the missing details are listed so the person can finish later");

      const other = (await login(await createUser(TAG))).body.data.accessToken;
      const bad = { ...minimal, ...(category === "temple" ? { pinCode: "12" } : category === "dharamshala" ? { totalRooms: 0 } : category === "mandal" ? { foundingYear: "99" } : { experience: "forever" }) };
      const refused = await api(`/registrations/${category}`, { token: other, body: bad });
      assert.equal(refused.status, 400);
      assert.ok(refused.body.errors?.length > 0, "the answer says which field is wrong");
    });
  });
}

// A throwaway identity for the first call of each flow (the real one is created by the helper).
function who0() {
  return { fullName: "Auto Test" };
}
