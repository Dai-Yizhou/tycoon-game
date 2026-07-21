/**
 * 天赋系统统一导出
 */

export { TalentRegistry, createTalentRegistry } from './TalentRegistry.js';
export { TalentEffects, createTalentEffects, type TalentEffectResult, type GameFeature } from './TalentEffects.js';
export {
  BUILTIN_TALENTS,
  getBuiltinTalents,
  getTalentsByType,
  getVisionTalents,
  getFieldToggleTalents,
  getFeatureToggleTalents,
} from './talentTemplates.js';