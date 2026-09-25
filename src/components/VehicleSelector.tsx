import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
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
};

const vehicleCopy: Record<Language, Record<VehicleId, VehicleCopy>> = {
  lt: {
    economy: {
      description: "Patogus ir tvarkingas universalas kasdienėms kelionėms.",
      ideal: "Tinka individualiems keleiviams, poroms ir nedidelėms šeimoms.",
      features: [
        "Dviejų zonų klimato kontrolė",
        "USB / Type-C įkrovimas",
        "Tamsinti galiniai langai",
      ],
      capacity: "Iki 4 keleivių ir 4 standartinių lagaminų",
      shortCapacity: "Iki 4 keleivių · 4 lagaminai",
    },
    "executive-minivan": {
      description: "Erdvus minivenas šeimoms, grupėms ir ilgesnėms kelionėms.",
      ideal: "Daugiau vietos keleiviams ir bagažui, patogu oro uosto transferiams.",
      features: [
        "Nappa odos salonas",
        "Trijų zonų klimato kontrolė",
        "Elektra valdomos šoninės durys",
      ],
      capacity: "6 keleiviai ir 4 lagaminai arba 4 keleiviai ir 8 lagaminai",
      shortCapacity: "Iki 6 keleivių · daugiau bagažo",
    },
  },
  en: {
    economy: {
      description: "A clean, comfortable estate for everyday private transfers.",
      ideal: "A practical choice for solo travellers, couples and small families.",
      features: [
        "Dual-zone climate control",
        "USB / Type-C charging",
        "Tinted rear windows",
      ],
      capacity: "Up to 4 passengers and 4 standard suitcases",
      shortCapacity: "Up to 4 passengers · 4 bags",
    },
    "executive-minivan": {
      description: "A spacious minivan for families, groups and longer journeys.",
      ideal: "More room for passengers and luggage, ideal for airport transfers.",
      features: [
        "Nappa leather interior",
        "Tri-zone climate control",
        "Power sliding doors",
      ],
      capacity: "6 passengers and 4 suitcases, or 4 passengers and 8 suitcases",
      shortCapacity: "Up to 6 passengers · extra luggage",
    },
  },
};

const uiCopy = {
  lt: {
    passengers: "Keleiviai",
    luggage: "Lagaminai",
    decrease: "Sumažinti",
    increase: "Padidinti",
    tripPrice: "Kelionės kaina",
    fareUnavailable: "Kaina po maršruto skaičiavimo",
    select: "Pasirinkti",
    selected: "Pasirinkta",
    unavailable: "Netinka",
    more: "Detalės",
    detailsTitle: "Automobilio informacija",
    features: "Komfortas",
    capacity: "Talpa",
    rate: "Kainodara",
    boardingFee: "Įsėdimas",
    minimumFare: "Minimali kelionės kaina",
    noVehicles: "Šiam keleivių ir bagažo kiekiui reikia individualaus sprendimo.",
    contact: "Susisiekti",
    close: "Uždaryti automobilio informaciją",
    reasons: {
      available: "",
      "invalid-passenger-count": "Pasirinkite bent vieną keleivį.",
      "invalid-luggage-count": "Patikrinkite lagaminų skaičių.",
      "passenger-limit": "Per daug keleivių šiam automobiliui.",
      "luggage-limit": "Per daug lagaminų šiam automobiliui.",
      "unsupported-combination": "Šis keleivių ir lagaminų derinys netinka.",
    },
  },
  en: {
    passengers: "Passengers",
    luggage: "Bags",
    decrease: "Decrease",
    increase: "Increase",
    tripPrice: "Trip price",
    fareUnavailable: "Price after route calculation",
    select: "Select vehicle",
    selected: "Selected",
    unavailable: "Unavailable",
    more: "Details",
    detailsTitle: "Vehicle details",
    features: "Comfort",
    capacity: "Capacity",
    rate: "Pricing",
    boardingFee: "Boarding fee",
    minimumFare: "Minimum trip fare",
    noVehicles: "This party size needs a tailored vehicle option.",
    contact: "Contact us",
    close: "Close vehicle details",
    reasons: {
      available: "",
      "invalid-passenger-count": "Select at least one passenger.",
      "invalid-luggage-count": "Check the number of bags.",
      "passenger-limit": "Too many passengers for this vehicle.",
      "luggage-limit": "Too many bags for this vehicle.",
      "unsupported-combination": "This passenger and bag combination is unavailable.",
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
const vehiclePhotos: Record<VehicleId, { src: string; width: number; height: number }> = {
  economy: { src: "/economy-cutout.png", width: 1409, height: 805 },
  "executive-minivan": { src: "/minivan-cutout.png", width: 1569, height: 861 },
};

function money(cents: number, language: Language): string {
  return new Intl.NumberFormat(language === "lt" ? "lt-LT" : "en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function VehiclePhoto({ vehicleId }: { vehicleId: VehicleId }) {
  const [failed, setFailed] = useState(false);
  const vehicle = VEHICLES[vehicleId];
  const photo = vehiclePhotos[vehicleId];

  return (
    <div className={`av-photo av-photo--${vehicleId}`}>
      {!failed ? (
        <img
          src={photo.src}
          alt={vehicle.model}
          width={photo.width}
          height={photo.height}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="av-photo-fallback" role="img" aria-label={vehicle.model}>
          <strong>{vehicle.model}</strong>
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
          aria-label={`${copy.decrease} ${label.toLowerCase()}`}
          onClick={() => onChange(value - 1)}
        >
          <Minus aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          disabled={value >= max}
          aria-label={`${copy.increase} ${label.toLowerCase()}`}
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
  const availableIds = vehicleIds.filter((id) =>
    getVehicleCapacity(id, passengers, luggage).available,
  );

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
  const detailInformation = detailVehicleId ? vehicleCopy[language][detailVehicleId] : null;
  const detailCapacity = detailVehicleId
    ? getVehicleCapacity(detailVehicleId, passengers, luggage)
    : null;
  const detailPrice =
    detailVehicleId && detailCapacity?.available && hasRoute
      ? calculatePricing(detailVehicleId, distanceMeters).totalCents
      : null;

  return (
    <section className="vehicle-selector av-fleet">
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

      <div className="av-card-grid" role="group" aria-label={language === "lt" ? "Automobiliai" : "Vehicles"}>
        {vehicleIds.map((id, index) => {
          const vehicle = VEHICLES[id];
          const information = vehicleCopy[language][id];
          const capacity = getVehicleCapacity(id, passengers, luggage);
          const isSelected = selectedVehicleId === id && capacity.available;
          const price = capacity.available && hasRoute
            ? calculatePricing(id, distanceMeters).totalCents
            : null;

          return (
            <article
              className={`av-card${isSelected ? " is-selected" : ""}${!capacity.available ? " is-unavailable" : ""}`}
              key={id}
            >
              <div className="av-card-topline">
                <span>{String(index + 1).padStart(2, "0")} / {vehicle.className}</span>
                {isSelected && <b><Check aria-hidden="true" /> {copy.selected}</b>}
              </div>

              <VehiclePhoto vehicleId={id} />

              <div className="av-card-body">
                <h3>{vehicle.model}</h3>
                <p className="av-capacity-line">{information.shortCapacity}</p>
                {!capacity.available && (
                  <p className="av-vehicle-reason" role="status">{copy.reasons[capacity.reason]}</p>
                )}

                <div className="av-card-price">
                  <span>{copy.tripPrice}</span>
                  <strong>{price !== null ? money(price, language) : "—"}</strong>
                </div>

                <div className="av-card-actions">
                  <button
                    className="av-vehicle-select"
                    type="button"
                    aria-pressed={isSelected}
                    disabled={!capacity.available || !hasRoute}
                    onClick={() => onVehicleSelect(id)}
                  >
                    {isSelected ? copy.selected : capacity.available ? copy.select : copy.unavailable}
                    {isSelected ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                  </button>
                  <button
                    className="av-details-link"
                    type="button"
                    onClick={(event) => openDetails(id, event.currentTarget)}
                  >
                    {copy.more} <ArrowUpRight aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {availableIds.length === 0 && (
        <div className="av-no-match" role="status">
          <p>{copy.noVehicles}</p>
          <a href={contactHref}><Phone aria-hidden="true" />{copy.contact}</a>
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
              <span className="av-dialog-kicker">{detailVehicle.className}</span>
              <h2 id="av-dialog-title">{detailVehicle.model}</h2>
              <VehiclePhoto vehicleId={detailVehicleId} />
              <p className="av-dialog-lead">{detailInformation.description}</p>
              <p>{detailInformation.ideal}</p>
              <h3>{copy.features}</h3>
              <ul className="av-dialog-features">
                {detailInformation.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <h3>{copy.capacity}</h3>
              <p>{detailInformation.capacity}</p>
              <h3>{copy.rate}</h3>
              <p>
                {money(detailVehicle.rateCentsPerKm, language)} / km · {copy.boardingFee} {money(detailVehicle.boardingFeeCents, language)} · {copy.minimumFare} {money(detailVehicle.minimumFareCents, language)}
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
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
