# SMS fixtures

Real bank SMS formats with **fake** digits and names. The repo is public: never commit a real account
number, card number, ref/RRN, phone number or a person's name. Keep spacing, punctuation, line breaks and
`Rs.`/`INR` exactly as the bank sends them. Files prefixed `synthetic_` are made up (negative cases).

Expected parse results live in `tests/parsers.test.ts`, keyed by path.
