// Server-side filters. MacroDroid already drops OTPs on the phone; these are the second line of defence.

const OTP = /\b(?:OTP|one[\s-]?time[\s-]?password|verification code|security code)\b/i;

// Wording common in bank marketing SMS. Only consulted when no parser matched, so a transaction SMS
// containing one of these words is never thrown away.
const PROMO =
  /\b(?:pre-?approved|apply now|offer|cashback|reward points?|congratulations|upgrade|EMI conversion|loan of|insta ?loan|limit increase|click|download)\b|https?:\/\//i;

export const isOtp = (body: string) => OTP.test(body);
export const isPromo = (body: string) => PROMO.test(body);
