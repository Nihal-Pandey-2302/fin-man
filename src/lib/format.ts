/** Paise → editable rupee string ("1250.50", "300"); empty for 0/null. Display-only conversion. */
export const paiseToInput = (p: number | null | undefined) => (p ? (p / 100).toFixed(2).replace(/\.00$/, "") : "");
