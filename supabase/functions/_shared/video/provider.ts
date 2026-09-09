import { BunnyVideoProvider } from './bunny.ts';
import { MockVideoProvider } from './mock.ts';
import { MuxVideoProvider } from './mux.ts';
import type { VideoProvider, VideoProviderName } from './types.ts';

export function getVideoProvider(name = Deno.env.get('VIDEO_PROVIDER')): VideoProvider {
  switch ((name ?? 'mux').toLowerCase() as VideoProviderName) {
    case 'mux': return new MuxVideoProvider();
    case 'bunny': return new BunnyVideoProvider();
    case 'mock': return new MockVideoProvider();
    default: throw new Error(`Unsupported VIDEO_PROVIDER: ${name}`);
  }
}
