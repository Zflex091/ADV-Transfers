# ADV Transfers – duomenys ir sprendimai, reikalingi tęsimui

Šie punktai nėra spėjami, nes techninė užduotis aiškiai reikalauja juos suderinti.

1. Ką tiksliai laikome „standartiniu lagaminu“ (matmenys arba aiškus klientui skirtas aprašymas).
2. Ar `5 keleiviai + 5 lagaminai` Chrysler automobilyje yra leidžiama. Kol nepatvirtinta, kombinacija bus blokuojama.
3. Gyvos svetainės URL, Vercel projekto pavadinimas / prieiga ir pageidaujama preview aplinka.
4. Kur dabar realiai saugomi ankstesni užsakymai (Gmail, Stripe, Vercel, duomenų bazė ar kita sistema).
5. Pageidaujama patvari duomenų bazė. Rekomenduojamas variantas šiame Vercel projekte – valdoma PostgreSQL bazė (pvz., Neon / Vercel integracija), bet tiekėjas ir kaštai turi būti patvirtinti prieš diegimą.
6. Pageidaujamas serverinio el. pašto tiekėjas ir patvirtintas siuntėjo domenas / adresas. FormSubmit netinka patikimam mokėjimu patvirtintam srautui.
7. Stripe test/live konfigūracija ir webhook secret; taip pat paskyros patvirtinimas, kad 0,50 € mokėjimas leidžiamas ir ekonomiškai priimtinas.
8. Google Places / Routes API raktai, kvotos ir biudžeto ribos prieš naudojimą gyvoje svetainėje.

## Išspręsta

Pateiktos tikros automobilių nuotraukos `economy.png` ir `minivan.png`. Svetainėje naudojamos mažesnės WebP versijos, o originalūs PNG palikti kaip atsarginis formatas.

„Kauno oro uostas → miesto centras / senamiestis: 35–40 €“ svetainėje žymima kaip orientacinė **Economy** kaina. Galutinė abiejų klasių kaina apskaičiuojama pagal tikrą maršruto atstumą ir pasirinktą automobilį.

Telegram kontaktą naudotojas patvirtino kaip [@Algis_G](https://t.me/Algis_G). Adresams ir maršrutams projekte jau naudojamos Google Places / Routes paslaugos; lieka nustatyti paskyros raktus ir išlaidų ribas.

