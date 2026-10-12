import type { StudioCameraProSettings } from '../../../modules/classfy-studio-media';

/** A newer Auto intent must remove queued manual values for that subsystem. */
export function mergeStudioCameraProSettings(previous: StudioCameraProSettings | null, patch: StudioCameraProSettings): StudioCameraProSettings {
  const next = { ...previous, ...patch };
  if (patch.autoExposure === true) { delete next.iso; delete next.shutterSeconds; }
  if (patch.autoWhiteBalance === true) { delete next.redGain; delete next.greenGain; delete next.blueGain; delete next.temperatureKelvin; delete next.whiteBalanceTint; }
  else if (patch.temperatureKelvin !== undefined || patch.whiteBalanceTint !== undefined) { delete next.redGain; delete next.greenGain; delete next.blueGain; }
  else if (patch.redGain !== undefined || patch.greenGain !== undefined || patch.blueGain !== undefined) { delete next.temperatureKelvin; delete next.whiteBalanceTint; }
  if (patch.autoFocus === true) delete next.lensPosition;
  return next;
}
