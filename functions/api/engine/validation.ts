import { UpstreamError } from '../_http';

export interface NifcFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: unknown; y?: unknown };
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nifcFeatureValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpstreamError('NIFC incident service', 'returned an unexpected shape');
  }
  return (value as { features?: unknown }).features;
}

function validatedFeatureArray(features: unknown, required: boolean): NifcFeature[] {
  if (features === undefined && !required) return [];
  if (!Array.isArray(features)) {
    throw new UpstreamError('NIFC incident service', 'returned invalid features');
  }
  return features as NifcFeature[];
}

export function nifcFeatures(value: unknown, required = false): NifcFeature[] {
  return validatedFeatureArray(nifcFeatureValue(value), required);
}

export function parseFireParam(value: string | null): string | null {
  const match = /^irwin:([0-9a-fA-F-]{20,40})$/.exec(value ?? '');
  return match?.[1] ?? null;
}
