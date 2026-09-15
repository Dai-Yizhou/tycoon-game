import { resolveField } from '../../src/value-modifiers/eval';
import { DefaultRefResolver } from '../../src/value-modifiers/context';
import type { WorldView } from '../../src/value-modifiers/types';

const baseView = (partial: Partial<WorldView>): WorldView => ({
  base: { player: { money: 100, credit: 5 } },
  playerUct: { player: { money: 500 } },
  teamMemberCount: 2,
  teamValue: (f) => (f === 'money' ? 300 : undefined),
  regionUct: { region: { pros: 2 } },
  regionTime: 0,
  curCellLevel: 1,
  curCellOwnerCount: 1,
  ...partial,
});

describe('resolveField 覆盖合并', () => {
  it('UCT 未列出的子字段保持 base，列出的被替换', () => {
    const calc = {
      player: {
        money: { '$op': 'add', args: [{ '$ref': 'base.player.money' }, { '$op': 'mul', args: [{ '$ref': 'region.uct.pros' }, 50] }] },
      },
    };
    const result = resolveField(calc, baseView({}), new DefaultRefResolver(baseView({})));
    expect(result).not.toHaveProperty('region');
    expect((result as { player: Record<string, number> }).player?.money).toBe(200);
    expect((result as { player: Record<string, number> }).player?.credit).toBe(5);
  });

  it('自指 base 用于 number 字段', () => {
    const calc = { '$op': 'add', args: [{ '$ref': 'base' }, 10] };
    const result = resolveField(calc, { ...baseView({}), base: 5 });
    expect(result).toBe(15);
  });

  it('team.uct 聚合', () => {
    const calc = { player: { money: { '$ref': 'team.uct.money' } } };
    const result = resolveField(calc, baseView({}));
    expect((result as { player: Record<string, number> }).player?.money).toBe(300);
  });
});