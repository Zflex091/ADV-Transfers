export type RoutePoint = { lat: number; lng: number };

export function decodeGooglePolyline(encoded: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function decodeValue() {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      if (index >= encoded.length) {
        throw new Error("Nebaigta maršruto geometrija.");
      }

      byte = encoded.charCodeAt(index++) - 63;

      if (byte < 0 || byte > 63 || shift > 30) {
        throw new Error("Netinkama maršruto geometrija.");
      }

      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }

  if (points.length < 2) {
    throw new Error("Maršrute nepakanka taškų.");
  }

  return points;
}
