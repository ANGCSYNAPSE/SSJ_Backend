/** Every successful response shares this envelope so clients can parse uniformly. */
export function sendSuccess(res, { status = 200, message = "OK", data = null }) {
  return res.status(status).json({ success: true, message, data });
}

export function sendError(res, { status = 500, message, errors = null }) {
  return res.status(status).json({ success: false, message, errors });
}
