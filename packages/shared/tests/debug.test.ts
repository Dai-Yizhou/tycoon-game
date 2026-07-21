import {
  getDebugFlags,
  isFeatureEnabled,
  withFeature,
  resetDebugFlagsCache,
  listEnabledFeatures,
  DebugFeatures,
  ALL_FEATURES_FLAG,
} from '../src/debug';

describe('debug flags', () => {
  const ORIGINAL_ENV = process.env.DEBUG_FLAGS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DEBUG_FLAGS;
    } else {
      process.env.DEBUG_FLAGS = ORIGINAL_ENV;
    }
    resetDebugFlagsCache();
  });

  describe('getDebugFlags', () => {
    it('returns empty set when DEBUG_FLAGS is not set', () => {
      delete process.env.DEBUG_FLAGS;
      resetDebugFlagsCache();
      expect(getDebugFlags().size).toBe(0);
    });

    it('returns empty set when DEBUG_FLAGS is empty string', () => {
      process.env.DEBUG_FLAGS = '';
      resetDebugFlagsCache();
      expect(getDebugFlags().size).toBe(0);
    });

    it('parses single flag', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      const flags = getDebugFlags();
      expect(flags.size).toBe(1);
      expect(flags.has('tutorial')).toBe(true);
    });

    it('parses multiple comma-separated flags', () => {
      process.env.DEBUG_FLAGS = 'tutorial,onboarding,cheat-economy';
      resetDebugFlagsCache();
      const flags = getDebugFlags();
      expect(flags.size).toBe(3);
      expect(flags.has('tutorial')).toBe(true);
      expect(flags.has('onboarding')).toBe(true);
      expect(flags.has('cheat-economy')).toBe(true);
    });

    it('trims whitespace around flags', () => {
      process.env.DEBUG_FLAGS = ' tutorial , onboarding , cheat-economy ';
      resetDebugFlagsCache();
      const flags = getDebugFlags();
      expect(flags.size).toBe(3);
      expect(flags.has('tutorial')).toBe(true);
      expect(flags.has('onboarding')).toBe(true);
      expect(flags.has('cheat-economy')).toBe(true);
    });

    it('ignores empty entries', () => {
      process.env.DEBUG_FLAGS = 'tutorial,,onboarding,';
      resetDebugFlagsCache();
      const flags = getDebugFlags();
      expect(flags.size).toBe(2);
    });

    it('caches results when env value has not changed', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      const first = getDebugFlags();
      const second = getDebugFlags();
      expect(first).toBe(second);
    });
  });

  describe('isFeatureEnabled', () => {
    it('returns false when feature not in flags', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      expect(isFeatureEnabled('onboarding')).toBe(false);
    });

    it('returns true when feature in flags', () => {
      process.env.DEBUG_FLAGS = 'tutorial,onboarding';
      resetDebugFlagsCache();
      expect(isFeatureEnabled('tutorial')).toBe(true);
      expect(isFeatureEnabled('onboarding')).toBe(true);
    });

    it('returns false when DEBUG_FLAGS not set', () => {
      delete process.env.DEBUG_FLAGS;
      resetDebugFlagsCache();
      expect(isFeatureEnabled('tutorial')).toBe(false);
    });

    it('returns false for empty feature name', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      expect(isFeatureEnabled('')).toBe(false);
    });

    it('returns true for any feature when wildcard is set', () => {
      process.env.DEBUG_FLAGS = ALL_FEATURES_FLAG;
      resetDebugFlagsCache();
      expect(isFeatureEnabled('tutorial')).toBe(true);
      expect(isFeatureEnabled('random.feature')).toBe(true);
    });

    it('supports namespace matching', () => {
      process.env.DEBUG_FLAGS = 'cheat';
      resetDebugFlagsCache();
      expect(isFeatureEnabled('cheat.economy')).toBe(true);
      expect(isFeatureEnabled('cheat.spawn')).toBe(true);
      expect(isFeatureEnabled('economy')).toBe(false);
    });

    it('supports multi-level namespace matching', () => {
      process.env.DEBUG_FLAGS = 'debug.system';
      resetDebugFlagsCache();
      expect(isFeatureEnabled('debug.system.foo')).toBe(true);
      expect(isFeatureEnabled('debug.system')).toBe(true);
      expect(isFeatureEnabled('debug.other')).toBe(false);
    });
  });

  describe('withFeature', () => {
    it('executes function when feature is enabled', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      const fn = jest.fn().mockReturnValue(42);
      const result = withFeature('tutorial', fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it('does not execute function when feature is disabled', () => {
      process.env.DEBUG_FLAGS = 'tutorial';
      resetDebugFlagsCache();
      const fn = jest.fn().mockReturnValue(42);
      const result = withFeature('onboarding', fn);
      expect(fn).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('returns undefined when feature is disabled', () => {
      delete process.env.DEBUG_FLAGS;
      resetDebugFlagsCache();
      const result = withFeature('tutorial', () => 'value');
      expect(result).toBeUndefined();
    });

    it('executes function when wildcard is enabled', () => {
      process.env.DEBUG_FLAGS = ALL_FEATURES_FLAG;
      resetDebugFlagsCache();
      const fn = jest.fn().mockReturnValue('ok');
      const result = withFeature('any.feature', fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe('ok');
    });
  });

  describe('listEnabledFeatures', () => {
    it('returns empty array when no flags set', () => {
      delete process.env.DEBUG_FLAGS;
      resetDebugFlagsCache();
      expect(listEnabledFeatures()).toEqual([]);
    });

    it('returns all enabled flags', () => {
      process.env.DEBUG_FLAGS = 'tutorial,onboarding';
      resetDebugFlagsCache();
      const features = listEnabledFeatures();
      expect(features).toHaveLength(2);
      expect(features).toContain('tutorial');
      expect(features).toContain('onboarding');
    });
  });

  describe('DebugFeatures constants', () => {
    it('exposes well-known feature names', () => {
      expect(DebugFeatures.Tutorial).toBe('tutorial');
      expect(DebugFeatures.Onboarding).toBe('onboarding');
      expect(DebugFeatures.CheatEconomy).toBe('cheat-economy');
      expect(DebugFeatures.QuickReset).toBe('quick-reset');
      expect(DebugFeatures.InjectTestData).toBe('inject-test-data');
    });

    it('works with isFeatureEnabled using constants', () => {
      process.env.DEBUG_FLAGS = DebugFeatures.Tutorial;
      resetDebugFlagsCache();
      expect(isFeatureEnabled(DebugFeatures.Tutorial)).toBe(true);
      expect(isFeatureEnabled(DebugFeatures.Onboarding)).toBe(false);
    });
  });
});
