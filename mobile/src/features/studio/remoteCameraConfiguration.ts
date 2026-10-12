import type {StudioRemoteConfiguration} from './remoteCameraProtocol';

/** Auto modes cannot carry manual values into AVFoundation's atomic setter. */
export function mergeRemoteCameraConfiguration(base:StudioRemoteConfiguration,patch:Partial<StudioRemoteConfiguration>):StudioRemoteConfiguration {
  const pro={...base.pro,...patch.pro};
  if(pro.autoExposure===true){delete pro.iso;delete pro.shutterSeconds;}
  if(pro.autoWhiteBalance===true)for(const key of ['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'])delete pro[key];
  if(pro.autoFocus===true)delete pro.lensPosition;
  return {...base,...patch,...(base.pro||patch.pro?{pro}:{})};
}
