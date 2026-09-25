import type { PricingSnapshot, TripPreferences, VehicleId } from './domain/booking'

export type Place = {
  provider: 'google'
  providerPlaceId: string
  label: string
  latitude: number
  longitude: number
  placeToken: string
}
export type PaymentMethod = 'driver' | 'stripe'
export type Booking = {
  pickup: Place | null
  destination: Place | null
  date: string
  time: string
  passengers: number
  luggage: number
  firstName: string
  lastName: string
  email: string
  phone: string
  paymentMethod: PaymentMethod
  distanceKm: number
  durationMin: number
  distanceMeters: number
  durationSeconds: number
  routePolyline: string
  routeProvider: 'google' | null
  routeToken: string
  vehicleId: VehicleId | null
  preferences: TripPreferences
  pricing: PricingSnapshot | null
  price: number
}

export type {
  CustomerDetails,
  LegacyBooking,
  PartyDetails,
  PaymentPlan,
  PaymentSnapshot,
  PickupSchedule,
  PricingSnapshot,
  ReservationDraft,
  ReservationPaymentStatus,
  ReservationRecord,
  ReservationStatus,
  RouteSnapshot,
  SelectedPlace,
  StoredReservation,
  TripPreferences,
  VehicleDefinition,
  VehicleId,
} from './domain/booking'
