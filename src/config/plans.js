/**
 * The registration fee a member can choose between. Amounts are in rupees; change them here
 * (the site reads them from GET /payments/plans, so it never hard-codes a price).
 */
export const REGISTRATION_PLANS = [
  { id: "basic", label: "Basic membership", amount: 501, description: "Join the Shyam Jagat community." },
  { id: "premium", label: "Premium membership", amount: 1100, description: "Join with extra support for the mission." },
];

export const planById = (id) => REGISTRATION_PLANS.find((plan) => plan.id === id);

/** Stamped on every Razorpay order so Shyam Jagat payments can always be told apart from other apps'. */
export const PAYMENT_APP = "shyam_jagat";
export const PAYMENT_PURPOSE = "registration_fee";
