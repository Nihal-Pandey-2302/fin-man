import { cardParser } from "./card";
import { hdfcParser } from "./hdfc";
import { idfcParser } from "./idfc";
import { indianParser } from "./indian";
import type { ParseResult, SmsParser } from "./types";

export type { ParsedNotice, ParsedTxn, ParseResult, SmsParser } from "./types";

// Every pattern is anchored on bank-specific wording, so trying all parsers is safe and doesn't depend on
// the (operator-dependent) sender ID. Card first: its SMS also mention "IDFC FIRST Bank".
export const PARSERS: SmsParser[] = [cardParser, idfcParser, indianParser, hdfcParser];

export function parseSms(body: string, receivedAt: Date): { parser: string; result: ParseResult } | null {
  for (const parser of PARSERS) {
    const result = parser.parse(body, receivedAt);
    if (result) return { parser: parser.name, result };
  }
  return null;
}
