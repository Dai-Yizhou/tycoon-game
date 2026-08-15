import { canCollectRent, canReceiveInvestmentImpact, isBankruptcyCheckable, participatesInEconomy } from '../src/types/economy-rules';
import { PlayerStatus } from '../src/types/player';

describe('offline economy rules', () => {
  it('keeps frozen in economy while excluding jail and bankrupt', () => {
    expect(participatesInEconomy(PlayerStatus.Normal)).toBe(true);
    expect(participatesInEconomy(PlayerStatus.Frozen)).toBe(true);
    expect(participatesInEconomy(PlayerStatus.Jail)).toBe(false);
    expect(participatesInEconomy(PlayerStatus.Bankrupt)).toBe(false);
  });

  it('shares the same frozen semantics across rent, investment, and bankruptcy', () => {
    expect(canCollectRent(PlayerStatus.Frozen)).toBe(true);
    expect(canReceiveInvestmentImpact(PlayerStatus.Frozen)).toBe(true);
    expect(isBankruptcyCheckable(PlayerStatus.Frozen)).toBe(true);
    expect(canCollectRent(PlayerStatus.Jail)).toBe(false);
    expect(canReceiveInvestmentImpact(PlayerStatus.Bankrupt)).toBe(false);
  });
});
