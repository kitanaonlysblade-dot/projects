// Tunable twin numbers live on the server (lumin-backend/app/twin_config.py) so
// they can be changed from real data without shipping the app. These defaults
// apply until the config loads, or if it can't be reached.
import { useEffect, useState } from 'react';
import { getTwinConfig, type ApiTwinConfig } from './api';

export const DEFAULT_TWIN_CONFIG: ApiTwinConfig = {
  min_twin_ms: 1000,
  max_request_clip_ms: 30_000,
};

let cached: ApiTwinConfig | null = null;
let inflight: Promise<ApiTwinConfig> | null = null;

function load(): Promise<ApiTwinConfig> {
  if (cached) return Promise.resolve(cached);
  inflight ??= getTwinConfig()
    .then((c) => (cached = { ...DEFAULT_TWIN_CONFIG, ...c }))
    .catch(() => DEFAULT_TWIN_CONFIG);
  return inflight;
}

export function useTwinConfig(): ApiTwinConfig {
  const [config, setConfig] = useState<ApiTwinConfig>(cached ?? DEFAULT_TWIN_CONFIG);
  useEffect(() => {
    let live = true;
    void load().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
