import {
  evaluateCoverage,
  GeographicServiceArea
} from './geo-coverage';

export interface JobNotificationCandidate {
  categoryIds: string[];
  serviceAreas: GeographicServiceArea[];
}

export interface JobNotificationLocation {
  categoryId: string;
  latitude: number | null;
  longitude: number | null;
}

export interface JobNotificationEligibility {
  eligible: boolean;
  distanceMiles: number | null;
}

export function evaluateJobNotificationEligibility(
  job: JobNotificationLocation,
  specialist: JobNotificationCandidate
): JobNotificationEligibility {
  const excluded = {
    eligible: false,
    distanceMiles: null
  };

  if (!specialist.categoryIds.includes(job.categoryId)) {
    return excluded;
  }

  if (
    job.latitude === null ||
    job.longitude === null
  ) {
    return excluded;
  }

  if (!specialist.serviceAreas.some(area => area.isActive)) {
    return excluded;
  }

  const coverage = evaluateCoverage(
    job.latitude,
    job.longitude,
    specialist.serviceAreas
  );

  if (!coverage.covered) {
    return excluded;
  }

  return {
    eligible: true,
    distanceMiles: coverage.distanceMiles
  };
}
