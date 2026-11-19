import { sql } from "../config/database.js";
import { NotificationModel } from "../models/notification.model.js";

/**
 * Verifies or un-verifies accounts and tells each person whose status actually changed.
 * Returns the ids that changed (an account already in the requested state is left alone and not notified).
 */
export async function setVerified(userIds, verified, adminId) {
  const rows = await sql(
    `UPDATE users
        SET is_verified = $2::boolean,
            verified_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
            verified_by = CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND role <> 'admin' AND is_verified <> $2::boolean
      RETURNING id`,
    [userIds, verified, adminId ?? null],
  );
  const changed = rows.map((row) => row.id);
  await Promise.all(
    changed.map((id) =>
      NotificationModel.notify(
        id,
        verified
          ? {
              kind: "success",
              category: "registration",
              title: "Your account is verified",
              message: "Our team has checked your details and verified your Shyam Jagat account. Thank you for being part of the community.",
              link: "/profile",
            }
          : {
              kind: "warning",
              category: "registration",
              title: "Verification removed",
              message: "Your account is no longer marked verified. Please check your details in your profile; our team may reach out.",
              link: "/profile",
            },
      ),
    ),
  );
  return changed;
}
