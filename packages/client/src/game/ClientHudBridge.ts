type HudRefresh = () => void;

let refreshHud: HudRefresh = () => undefined;

export function registerHudRefresh(refresh: HudRefresh): () => void {
  refreshHud = refresh;
  return () => {
    if (refreshHud === refresh) refreshHud = () => undefined;
  };
}

export function requestHudRefresh(): void {
  refreshHud();
}
