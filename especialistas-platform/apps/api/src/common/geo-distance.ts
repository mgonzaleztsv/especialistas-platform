export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const coordinates = [
    [lat1, lon1],
    [lat2, lon2]
  ];

  for (const [lat, lon] of coordinates) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      throw new Error('Coordenadas inválidas');
    }
  }

  const radians = (degrees: number) =>
    degrees * Math.PI / 180;

  const radius = 3958.7613;

  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
    Math.cos(radians(lat2)) *
    Math.sin(dLon / 2) ** 2;

  const safeA = Math.max(0, Math.min(1, a));

  return 2 * radius * Math.asin(Math.sqrt(safeA));
}
