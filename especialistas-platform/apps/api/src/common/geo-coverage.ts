import { distanceMiles } from './geo-distance';

export interface GeographicServiceArea {
  centerLatitude: number;
  centerLongitude: number;
  radiusMiles: number;
  isActive: boolean;
}

export interface GeographicCoverage {
  covered: boolean;
  distanceMiles: number | null;
}

export function evaluateCoverage(
  latitude: number,
  longitude: number,
  areas: GeographicServiceArea[]
): GeographicCoverage {
  const distances: number[] = [];

  for (const area of areas) {
    if (!area.isActive) continue;

    if (
      !Number.isFinite(area.radiusMiles) ||
      area.radiusMiles <= 0
    ) {
      continue;
    }

    const distance = distanceMiles(
      latitude,
      longitude,
      area.centerLatitude,
      area.centerLongitude
    );

    if (distance <= area.radiusMiles) {
      distances.push(distance);
    }
  }

  if (distances.length === 0) {
    return {
      covered: false,
      distanceMiles: null
    };
  }

  return {
    covered: true,
    distanceMiles: Math.min(...distances)
  };
}
