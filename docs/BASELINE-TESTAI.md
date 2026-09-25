# ADV Transfers – bazinės versijos patikros

Data: 2026-09-22

## Atlikta

- `npm ci` – sėkminga; įdiegtos užrakintos priklausomybės.
- `npm run build` – sėkminga; TypeScript ir Vite produkcinis surinkimas baigtas be klaidų.
- Sukurtas 1440 × 1200 vietinės svetainės Edge headless atvaizdas; bazinis puslapis užsikrauna ir rodoma rezervacijos forma.
- `npm audit --omit=dev` – produkcinėse priklausomybėse rastas 1 vidutinio pavojingumo netiesioginis `qs` pažeidžiamumas, kuriam yra pataisa.
- Patikrinta Git istorija ir atskira `codex/adv-upgrade` šaka.
- Patikrinta, kad `economy.png` ir `minivan.png` nėra projekte ar `Downloads` aplanke.

## Bazinio atvaizdo pastabos

- Desktop išdėstymas funkcionuoja ir neturi akivaizdaus horizontalaus slinkimo.
- Telefonas matomas viršuje, tačiau rezervavimo/skambinimo CTA nėra pakankamai ryškūs pagal naują užduotį.
- Dabartinė estetika turi tamsiai mėlyną ir žalią pagrindą, tačiau daug dekoratyvių gradientų bei šabloniškų kortelių. 6 etape reikės nuoseklesnės premium sistemos.

## Dar nepatikrinta, nes trūksta konfigūracijos arba tai vėlesnio etapo darbai

- Vercel preview deployment ir gyvos svetainės palyginimas.
- Tikri Places / Routes scenarijai per pilną Vercel serverless aplinką.
- Stripe testinis ir gyvas mokėjimas, 0,50 € minimumas, webhook bei pakartotiniai įvykiai.
- Tikras el. laiškų pristatymas.
- iOS, Android ir realių mobilių naršyklių testai.
- Esamų išorėje saugomų užsakymų vientisumas.

Integruotas Codex naršyklės valdymo pagalbininkas nepasileido dėl vietinės Windows ACL klaidos `apply deny-read ACLs`; tai nėra projekto klaida. Vizualiam bazinės versijos patikrinimui panaudotas vietinis Microsoft Edge headless režimas.

