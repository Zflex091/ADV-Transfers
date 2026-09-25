# ADV Transfers – atkūrimo instrukcija

## Pilnos istorijos atkūrimas iš `.bundle`

```powershell
git clone ADV-services-baseline-1036000.bundle ADV-services-restored
cd ADV-services-restored
git switch main
```

## Greitas šaltinio atkūrimas

Išskleiskite `ADV-services-baseline-1036000-source.zip` į tuščią aplanką, tada paleiskite:

```powershell
npm ci
npm run build
```

Šaltinio archyvas atitinka prieš pakeitimus rastą darbo medį, todėl jame nėra vartotojo jau pašalinto `.env.example`. `.bundle` išsaugo pilną Git istoriją ir bazinį commit `1036000a29d79bb741105b91fa99ff17934f55c8`.

Prieš atkurdami patikrinkite failų kontrolines sumas pagal `SHA256SUMS.txt`.
