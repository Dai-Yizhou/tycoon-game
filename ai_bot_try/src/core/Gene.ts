export interface Gene {
  buyThreshold: number;
  buyUrgency: number;
  upgradeThreshold: number;
  upgradeUrgency: number;
  propertyDiversifyRatio: number;
  targetMonopolySize: number;
  
  investmentThreshold: number;
  investmentUrgency: number;
  investmentHoldTime: number;
  riskAdjustmentFactor: number;
  
  loanThreshold: number;
  loanAmountRatio: number;
  repayThreshold: number;
  interestTolerance: number;
  reserveRatio: number;
  emergencyReserveRatio: number;
  
  pathPreference: number;
  shortTermGainWeight: number;
  longTermGainWeight: number;
  safetyFactor: number;
  
  
  teamPreference: number;
  teamTrustThreshold: number;
  tradeWillingness: number;
  
  riskTolerance: number;
  monopolyStrategy: number;
  lossAversion: number;
  gainSeeking: number;
}

export const GENE_PARAMS: (keyof Gene)[] = [
  'buyThreshold', 'buyUrgency', 'upgradeThreshold', 'upgradeUrgency',
  'propertyDiversifyRatio', 'targetMonopolySize',
  'investmentThreshold', 'investmentUrgency', 'investmentHoldTime',
  'riskAdjustmentFactor',
  'loanThreshold', 'loanAmountRatio', 'repayThreshold', 'interestTolerance',
  'reserveRatio', 'emergencyReserveRatio',
  'pathPreference', 'shortTermGainWeight', 'longTermGainWeight', 'safetyFactor',
  'teamPreference', 'teamTrustThreshold', 'tradeWillingness',
  'riskTolerance', 'monopolyStrategy', 'lossAversion', 'gainSeeking'
];

export class GeneClass implements Gene {
  buyThreshold: number = 0;
  buyUrgency: number = 0;
  upgradeThreshold: number = 0;
  upgradeUrgency: number = 0;
  propertyDiversifyRatio: number = 0;
  targetMonopolySize: number = 0;
  
  investmentThreshold: number = 0;
  investmentUrgency: number = 0;
  investmentHoldTime: number = 0;
  riskAdjustmentFactor: number = 0;
  
  loanThreshold: number = 0;
  loanAmountRatio: number = 0;
  repayThreshold: number = 0;
  interestTolerance: number = 0;
  reserveRatio: number = 0;
  emergencyReserveRatio: number = 0;
  
  pathPreference: number = 0;
  shortTermGainWeight: number = 0;
  longTermGainWeight: number = 0;
  safetyFactor: number = 0;
  
  
  teamPreference: number = 0;
  teamTrustThreshold: number = 0;
  tradeWillingness: number = 0;
  
  riskTolerance: number = 0;
  monopolyStrategy: number = 0;
  lossAversion: number = 0;
  gainSeeking: number = 0;
  
  constructor(values?: Partial<Gene>) {
    if (values) {
      this.buyThreshold = values.buyThreshold ?? 0;
      this.buyUrgency = values.buyUrgency ?? 0;
      this.upgradeThreshold = values.upgradeThreshold ?? 0;
      this.upgradeUrgency = values.upgradeUrgency ?? 0;
      this.propertyDiversifyRatio = values.propertyDiversifyRatio ?? 0;
      this.targetMonopolySize = values.targetMonopolySize ?? 0;
      
      this.investmentThreshold = values.investmentThreshold ?? 0;
      this.investmentUrgency = values.investmentUrgency ?? 0;
      this.investmentHoldTime = values.investmentHoldTime ?? 0;
      this.riskAdjustmentFactor = values.riskAdjustmentFactor ?? 0;
      
      this.loanThreshold = values.loanThreshold ?? 0;
      this.loanAmountRatio = values.loanAmountRatio ?? 0;
      this.repayThreshold = values.repayThreshold ?? 0;
      this.interestTolerance = values.interestTolerance ?? 0;
      this.reserveRatio = values.reserveRatio ?? 0;
      this.emergencyReserveRatio = values.emergencyReserveRatio ?? 0;
      
      this.pathPreference = values.pathPreference ?? 0;
      this.shortTermGainWeight = values.shortTermGainWeight ?? 0;
      this.longTermGainWeight = values.longTermGainWeight ?? 0;
      this.safetyFactor = values.safetyFactor ?? 0;
      
      
      this.teamPreference = values.teamPreference ?? 0;
      this.teamTrustThreshold = values.teamTrustThreshold ?? 0;
      this.tradeWillingness = values.tradeWillingness ?? 0;
      
      this.riskTolerance = values.riskTolerance ?? 0;
      this.monopolyStrategy = values.monopolyStrategy ?? 0;
      this.lossAversion = values.lossAversion ?? 0;
      this.gainSeeking = values.gainSeeking ?? 0;
    }
  }
  
  static random(): GeneClass {
    const values: Gene = {} as Gene;
    for (const param of GENE_PARAMS) {
      values[param] = Math.random();
    }
    return new GeneClass(values);
  }
  
  static fromArray(values: number[]): GeneClass {
    const gene: Gene = {} as Gene;
    for (let i = 0; i < GENE_PARAMS.length; i++) {
      gene[GENE_PARAMS[i]] = values[i] ?? Math.random();
    }
    return new GeneClass(gene);
  }
  
  toArray(): number[] {
    return GENE_PARAMS.map(param => this[param]);
  }
  
  clone(): GeneClass {
    return GeneClass.fromArray(this.toArray());
  }
}
