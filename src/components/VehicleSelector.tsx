import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  Minus,
  Phone,
  Plus,
  UsersRound,
  X,
} from "lucide-react";
import {
  VEHICLES,
  calculatePricing,
  getVehicleCapacity,
  type CapacityReason,
  type VehicleId,
} from "../domain/booking";
import "./VehicleSelector.css";

type Language = "lt" | "en";

export type VehicleSelectorProps = {
  language: Language;
  passengers: number;
  luggage: number;
  selectedVehicleId: VehicleId | null;
  distanceMeters: number;
  onPassengersChange: (count: number) => void;
  onLuggageChange: (count: number) => void;
  onVehicleSelect: (vehicleId: VehicleId) => void;
  contactHref: string;
};

type VehicleCopy = {
  description: string;
  ideal: string;
  features: string[];
  capacity: string;
  shortCapacity: string;
  signature: string;
  marque: string;
};

const vehicleCopy: Record<Language, Record<VehicleId, VehicleCopy>> = {
  lt: {
    economy: {
      description:
        "Šiuolaikiškas, itin tvarkingas ir erdvus komfortiškas universalas.",
      ideal:
        "Idealus pasirinkimas 1–3 asmenų kelionėms, verslo išvykoms ar nedideliems šeimos transferams su standartiniu bagažu. Automobilis gali vežti iki 4 keleivių ir 4 standartinių lagaminų.",
      features: [
        "Dviejų zonų klimato kontrolė (Air Conditioning / Climate Control)",
        "Įkrovimo lizdai keleivių įrenginiams (USB / Type-C)",
        "Tamsinti galiniai langai privatumui ir apsaugai nuo saulės",
      ],
      capacity: "Iki 4 keleivių ir 4 standartinių lagaminų",
      shortCapacity: "4 keleiviai · 4 lagaminai",
      signature: "ASTRA ST",
      marque: "OPEL / BLACK EDITION 2025",
    },
    "executive-minivan": {
      description: "Premium lygio erdvė ir aukščiausios klasės komfortas.",
      ideal:
        "Idealus pasirinkimas šeimoms su daug bagažo, verslo delegacijoms, VIP transferams ar ilgoms tarptautinėms kelionėms.",
      features: [
        "Nappa odos salonas su individualiomis kapitono kėdėmis",
        "Atskiras klimato valdymas galinėse sėdynėse (Tri-zone Climate Control)",
        "Elektra valdomos šoninės durys – patogu įlipti su vaikais ar bagažu",
        "Miego ir poilsio komfortas tolimose kelionėse",
      ],
      capacity: "6 keleiviai ir 4 lagaminai arba 4 keleiviai ir 8 lagaminai",
      shortCapacity: "6 + 4 arba 4 + 8",
      signature: "PACIFICA",
      marque: "CHRYSLER / 2024",
    },
  },
  en: {
    economy: {
      description: "A modern, impeccably maintained and spacious estate car.",
      ideal:
        "Ideal for 1–3 travellers, business journeys or small family transfers with standard luggage. It can carry up to 4 passengers and 4 standard suitcases.",
      features: [
        "Dual-zone climate control",
        "USB and Type-C charging ports for passenger devices",
        "Tinted rear windows for privacy and sun protection",
      ],
      capacity: "Up to 4 passengers and 4 standard suitcases",
      shortCapacity: "4 passengers · 4 suitcases",
      signature: "ASTRA ST",
      marque: "OPEL / BLACK EDITION 2025",
    },
    "executive-minivan": {
      description: "Premium space and the highest level of comfort.",
      ideal:
        "Ideal for families with more luggage, business delegations, VIP transfers or long international journeys.",
      features: [
        "Nappa leather interior with individual captain's chairs",
        "Separate rear-seat climate control (Tri-zone Climate Control)",
        "Power-operated sliding doors for easy boarding with children or luggage",
        "Restful comfort on longer journeys",
      ],
      capacity: "6 passengers and 4 suitcases, or 4 passengers and 8 suitcases",
      shortCapacity: "6 + 4 or 4 + 8",
      signature: "PACIFICA",
      marque: "CHRYSLER / 2024",
    },
  },
};

const uiCopy = {
  lt: {
    heading: "Pasirinkite automobilį",
    intro: "Kaina apskaičiuota pagal jūsų maršrutą. Pasirinkimą pritaikykite keleivių ir bagažo skaičiui.",
    passengers: "Keleiviai",
    luggage: "Lagaminai",
    decrease: "Sumažinti",
    increase: "Padidinti",
    fleet: "Automobiliai",
    tripPrice: "Kelionės kaina",
    fareUnavailable: "Kaina paaiškės apskaičiavus maršrutą",
    select: "Pasirinkti",
    selected: "Pasirinkta",
    unavailable: "Netinka",
    more: "Apie automobilį",
    detailsTitle: "Automobilio informacija",
    features: "Komfortas ir įranga",
    capacity: "Talpa",
    rate: "Kainodara",
    boardingFee: "Įsėdimo mokestis",
    minimumFare: "Minimali kelionės kaina (įskaitant įsėdimą)",
    preview: "Automobilio peržiūra",
    selectedShowcase: "Jūsų pasirinktas automobilis",
    noVehicles: "Šiam keleivių ir bagažo deriniui neturime patvirtinto automobilio.",
    contact: "Skambinti dėl individualaus sprendimo",
    close: "Uždaryti automobilio informaciją",
    reasons: {
      available: "",
      "invalid-passenger-count": "Pasirinkite bent vieną keleivį.",
      "invalid-luggage-count": "Patikrinkite lagaminų skaičių.",
      "passenger-limit": "Per daug keleivių šiam automobiliui.",
      "luggage-limit": "Per daug lagaminų šiam automobiliui.",
      "unsupported-combination": "Šis keleivių ir lagaminų derinys nepatvirtintas.",
    },
  },
  en: {
    heading: "Choose your vehicle",
    intro: "The price is based on your route. Match your choice to the number of passengers and suitcases.",
    passengers: "Passengers",
    luggage: "Suitcases",
    decrease: "Decrease",
    increase: "Increase",
    fleet: "Vehicles",
    tripPrice: "Journey price",
    fareUnavailable: "Price appears after route calculation",
    select: "Select",
    selected: "Selected",
    unavailable: "Unavailable",
    more: "Vehicle details",
    detailsTitle: "Vehicle information",
    features: "Comfort and equipment",
    capacity: "Capacity",
    rate: "Pricing",
    boardingFee: "Boarding fee",
    minimumFare: "Minimum trip fare (boarding included)",
    preview: "Vehicle preview",
    selectedShowcase: "Your chosen vehicle",
    noVehicles: "No vehicle has a confirmed capacity for this passenger and luggage combination.",
    contact: "Call for a tailored option",
    close: "Close vehicle information",
    reasons: {
      available: "",
      "invalid-passenger-count": "Select at least one passenger.",
      "invalid-luggage-count": "Check the number of suitcases.",
      "passenger-limit": "Too many passengers for this vehicle.",
      "luggage-limit": "Too many suitcases for this vehicle.",
      "unsupported-combination": "This passenger and suitcase combination has not been confirmed.",
    },
  },
} satisfies Record<
  Language,
  {
    reasons: Record<CapacityReason, string>;
    [key: string]: string | Record<CapacityReason, string>;
  }
>;

const vehicleIds: VehicleId[] = ["economy", "executive-minivan"];
const vehiclePhotos: Record<VehicleId, {
  png: string;
  webp: string;
  width: number;
  height: number;
}> = {
  economy: {
    png: "/economy.png",
    webp: "/economy.webp",
    width: 1448,
    height: 1086,
  },
  "executive-minivan": {
    png: "/minivan.png",
    webp: "/minivan.webp",
    width: 1670,
    height: 942,
  },
};

function money(cents: number, language: Language): string {
  return new Intl.NumberFormat(language === "lt" ? "lt-LT" : "en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function VehiclePhoto({
  vehicleId,
  language,
}: {
  vehicleId: VehicleId;
  language: Language;
}) {
  const [failed, setFailed] = useState(false);
  const information = vehicleCopy[language][vehicleId];
  const vehicle = VEHICLES[vehicleId];
  const photo = vehiclePhotos[vehicleId];

  return (
    <div className={"av-photo av-photo--" + vehicleId}>
      {!failed ? (
        <picture>
          <source srcSet={photo.webp} type="image/webp" />
          <img
            src={photo.png}
            alt={vehicle.model}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        </picture>
      ) : (
        <div className="av-photo-type" role="img" aria-label={vehicle.model}>
          <span>{information.marque}</span>
          <strong>{information.signature}</strong>
          <small>{vehicle.className}</small>
        </div>
      )}
    </div>
  );
}

function QuantityControl({
  id,
  label,
  value,
  min,
  max,
  language,
  icon: Icon,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  language: Language;
  icon: typeof UsersRound;
  onChange: (value: number) => void;
}) {
  const copy = uiCopy[language];
  return (
    <div className="av-quantity" role="group" aria-labelledby={id}>
      <div className="av-quantity-label" id={id}>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="av-quantity-actions">
        <button
          type="button"
          disabled={value <= min}
          aria-label={copy.decrease + " " + label.toLowerCase()}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          disabled={value >= max}
          aria-label={copy.increase + " " + label.toLowerCase()}
          onClick={() => onChange(value + 1)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function VehicleSelector({
  language,
  passengers,
  luggage,
  selectedVehicleId,
  distanceMeters,
  onPassengersChange,
  onLuggageChange,
  onVehicleSelect,
  contactHref,
}: VehicleSelectorProps) {
  const copy = uiCopy[language];
  const [detailVehicleId, setDetailVehicleId] = useState<VehicleId | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailOpenerRef = useRef<HTMLButtonElement | null>(null);
  const hasRoute = Number.isFinite(distanceMeters) && distanceMeters > 0;
  const availableIds = vehicleIds.filter(
    (id) => getVehicleCapacity(id, passengers, luggage).available,
  );
  const selectedIsAvailable =
    selectedVehicleId !== null &&
    getVehicleCapacity(selectedVehicleId, passengers, luggage).available;
  const featuredVehicleId = selectedIsAvailable
    ? selectedVehicleId
    : availableIds[0] ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailVehicleId && !dialog.open) dialog.showModal();
    if (!detailVehicleId && dialog.open) dialog.close();
  }, [detailVehicleId]);

  function openDetails(id: VehicleId, opener: HTMLButtonElement) {
    detailOpenerRef.current = opener;
    setDetailVehicleId(id);
  }

  function closeDetails() {
    dialogRef.current?.close();
  }

  const detailVehicle = detailVehicleId ? VEHICLES[detailVehicleId] : null;
  const detailInformation = detailVehicleId
    ? vehicleCopy[language][detailVehicleId]
    : null;
  const detailCapacity = detailVehicleId
    ? getVehicleCapacity(detailVehicleId, passengers, luggage)
    : null;
  const detailPrice =
    detailVehicleId && detailCapacity?.available && hasRoute
      ? calculatePricing(detailVehicleId, distanceMeters).totalCents
      : null;

  return (
    <section className="vehicle-selector av-fleet" aria-label={copy.heading}>

      <div className="av-quantities">
        <QuantityControl
          id="vehicle-passengers-label"
          label={copy.passengers}
          value={passengers}
          min={1}
          max={6}
          language={language}
          icon={UsersRound}
          onChange={onPassengersChange}
        />
        <QuantityControl
          id="vehicle-luggage-label"
          label={copy.luggage}
          value={luggage}
          min={0}
          max={8}
          language={language}
          icon={BriefcaseBusiness}
          onChange={onLuggageChange}
        />
      </div>

      <div className="av-fleet-list-heading">
        <span>{copy.fleet}</span>
        <small>
          {passengers} {copy.passengers.toLowerCase()} · {luggage}{" "}
          {copy.luggage.toLowerCase()}
        </small>
      </div>

      <div className="av-fleet-list" role="group" aria-label={copy.heading}>
        {vehicleIds.map((id, index) => {
          const vehicle = VEHICLES[id];
          const information = vehicleCopy[language][id];
          const capacity = getVehicleCapacity(id, passengers, luggage);
          const isSelected = selectedVehicleId === id && capacity.available;
          const price =
            capacity.available && hasRoute
              ? calculatePricing(id, distanceMeters).totalCents
              : null;

          return (
            <article
              className={
                "av-vehicle-row" +
                (isSelected ? " is-selected" : "") +
                (!capacity.available ? " is-unavailable" : "")
              }
              key={id}
              aria-label={vehicle.className + " — " + vehicle.model}
            >
              <span className="av-vehicle-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="av-vehicle-info">
                <span className="av-vehicle-class">
                  {vehicle.className}
                  {isSelected && (
                    <span className="av-vehicle-chosen">
                      <Check aria-hidden="true" /> {copy.selected}
                    </span>
                  )}
                </span>
                <h4>{vehicle.model}</h4>
                <p>{information.shortCapacity}</p>
                {!capacity.available && (
                  <p className="av-vehicle-reason" role="status">
                    {copy.reasons[capacity.reason]}
                  </p>
                )}
                <button
                  className="av-vehicle-details-link"
                  type="button"
                  onClick={(event) => openDetails(id, event.currentTarget)}
                >
                  {copy.more} <ArrowUpRight aria-hidden="true" />
                </button>
              </div>
              <div className="av-vehicle-side">
                {price !== null ? (
                  <div className="av-vehicle-price">
                    <span>{copy.tripPrice}</span>
                    <strong>{money(price, language)}</strong>
                  </div>
                ) : (
                  <span className="av-vehicle-no-price">
                    {capacity.available ? copy.fareUnavailable : copy.unavailable}
                  </span>
                )}
                <button
                  className="av-vehicle-select"
                  type="button"
                  aria-pressed={isSelected}
                  disabled={!capacity.available || !hasRoute}
                  onClick={() => onVehicleSelect(id)}
                >
                  {isSelected ? copy.selected : capacity.available ? copy.select : copy.unavailable}
                  {isSelected && <Check aria-hidden="true" />}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {featuredVehicleId && (
        <section
          className="av-showcase"
          aria-label={
            selectedIsAvailable ? copy.selectedShowcase : copy.preview
          }
        >
          <div className="av-showcase-media">
            <span className="av-showcase-caption">
              {selectedIsAvailable ? copy.selectedShowcase : copy.preview}
            </span>
            <VehiclePhoto
              key={featuredVehicleId}
              vehicleId={featuredVehicleId}
              language={language}
            />
          </div>
          <div className="av-showcase-body">
            <span className="av-showcase-kicker">
              {featuredVehicleId === "economy" ? "01" : "02"} /{" "}
              {VEHICLES[featuredVehicleId].className}
            </span>
            <h4>{VEHICLES[featuredVehicleId].model}</h4>
            <p className="av-showcase-description">
              {vehicleCopy[language][featuredVehicleId].description}
            </p>
            <ul>
              {vehicleCopy[language][featuredVehicleId].features
                .slice(0, 3)
                .map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
            </ul>
            <button
              className="av-showcase-details-link"
              type="button"
              onClick={(event) =>
                openDetails(featuredVehicleId, event.currentTarget)
              }
            >
              {copy.more} <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {availableIds.length === 0 && (
        <div className="av-no-match" role="status">
          <p>{copy.noVehicles}</p>
          <a href={contactHref}>
            <Phone aria-hidden="true" />
            {copy.contact}
          </a>
        </div>
      )}

      <dialog
        className="av-vehicle-dialog"
        ref={dialogRef}
        aria-labelledby="av-dialog-title"
        onClose={() => {
          setDetailVehicleId(null);
          requestAnimationFrame(() => detailOpenerRef.current?.focus());
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDetails();
        }}
      >
        {detailVehicle && detailInformation && detailVehicleId && (
          <div className="av-dialog-content">
            <div className="av-dialog-top">
              <span>ADV / {copy.detailsTitle}</span>
              <button type="button" onClick={closeDetails} aria-label={copy.close}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="av-dialog-scroll">
              <span className="av-dialog-kicker">
                {detailVehicleId === "economy" ? "01" : "02"} /{" "}
                {detailVehicle.className}
              </span>
              <h2 id="av-dialog-title">{detailVehicle.model}</h2>
              <VehiclePhoto
                key={detailVehicleId}
                vehicleId={detailVehicleId}
                language={language}
              />
              <p className="av-dialog-lead">{detailInformation.description}</p>
              <p>{detailInformation.ideal}</p>
              <h3>{copy.features}</h3>
              <ul className="av-dialog-features">
                {detailInformation.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <h3>{copy.capacity}</h3>
              <p>{detailInformation.capacity}</p>
              <h3>{copy.rate}</h3>
              <p>
                {money(detailVehicle.rateCentsPerKm, language)} / km ·{" "}
                {copy.boardingFee} {money(detailVehicle.boardingFeeCents, language)} ·{" "}
                {copy.minimumFare}{" "}
                {money(detailVehicle.minimumFareCents, language)}
              </p>
              {!detailCapacity?.available && (
                <p className="av-dialog-unavailable" role="status">
                  {copy.reasons[detailCapacity?.reason ?? "unsupported-combination"]}
                </p>
              )}
            </div>
            <div className="av-dialog-bottom">
              <strong>{detailPrice !== null ? money(detailPrice, language) : "—"}</strong>
              <button
                type="button"
                disabled={!detailCapacity?.available || !hasRoute}
                onClick={() => {
                  onVehicleSelect(detailVehicleId);
                  closeDetails();
                }}
              >
                {selectedVehicleId === detailVehicleId
                  ? copy.selected
                  : detailCapacity?.available
                    ? copy.select
                    : copy.unavailable}
                <ArrowUpRight aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
