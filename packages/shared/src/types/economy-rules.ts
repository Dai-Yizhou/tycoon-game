import { PlayerStatus } from './player';

export function participatesInEconomy(status: PlayerStatus): boolean {
  return status === PlayerStatus.Normal || status === PlayerStatus.Frozen;
}

export function canCollectRent(status: PlayerStatus): boolean {
  return participatesInEconomy(status);
}

export function canReceiveInvestmentImpact(status: PlayerStatus): boolean {
  return participatesInEconomy(status);
}

export function isBankruptcyCheckable(status: PlayerStatus): boolean {
  return participatesInEconomy(status);
}
