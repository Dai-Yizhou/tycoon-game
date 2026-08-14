import { GeneClass } from '../core/Gene';
import { GameStateSnapshot, Decision, DecisionType } from '../simulation/RealGameAdapter';
import { normalizeCellType, CellTypes, getExtra } from '@game/shared';

export class DecisionMaker {
  private gene: GeneClass;
  
  constructor(gene: GeneClass) {
    this.gene = gene;
  }
  
  makeDecision(state: GameStateSnapshot): DecisionType | Decision {
    const { money, credit, properties, currentCell, isAlive, investments, totalDebt, netWorth } = state;
    
    if (!isAlive) return { type: 'rollDice' };
    if (!currentCell) return { type: 'rollDice' };
    
    const cellType = normalizeCellType(currentCell);
    
    if (cellType === CellTypes.Property) {
      const owners = getExtra<string[]>(currentCell, 'owners', []);
      const ownerships = getExtra<Array<{ playerId: string; share: number }>>(currentCell, 'ownerships', []);
      const isOwner = owners?.includes(state.playerId) || ownerships?.some(o => o.playerId === state.playerId);
      const hasOwner = owners && owners.length > 0;
      
      if (!hasOwner) {
        return this.decideBuy(state);
      } else if (isOwner) {
        return this.decideUpgrade(state);
      } else {
        return this.decideCoBuy(state);
      }
    }
    
    if (cellType === CellTypes.Investment) {
      return this.decideInvest(state);
    }
    
    if (cellType === CellTypes.Event) {
      return this.decideEvent(state);
    }
    
    const bankDecision = this.decideBankStrategy(state);
    if (bankDecision) return bankDecision;
    
    return { type: 'rollDice' };
  }
  
  private decideBuy(state: GameStateSnapshot): Decision {
    const { money, properties, investments, netWorth, totalDebt } = state;
    const { 
      buyThreshold, buyUrgency, riskTolerance, propertyDiversifyRatio, reserveRatio,
      emergencyReserveRatio, targetMonopolySize, lossAversion, gainSeeking,
      safetyFactor, longTermGainWeight
    } = this.gene;
    
    if (!state.currentCell) return { type: 'rollDice' };
    
    const price = getExtra<number>(state.currentCell, 'price', 0);
    if (price <= 0) return { type: 'rollDice' };
    
    const affordability = netWorth / price;
    
    const reserveAmount = netWorth * reserveRatio * 0.5;
    const emergencyReserve = 1000 + emergencyReserveRatio * 2000;
    const safetyBuffer = safetyFactor * 2000;
    const availableMoney = money + Math.max(0, 900 - totalDebt);
    
    const minRemaining = emergencyReserve + safetyBuffer;
    
    if (availableMoney - price < -800) {
      return { type: 'rollDice' };
    }
    
    let buyScore = 0;
    
    if (affordability > 3 + buyThreshold + buyUrgency) {
      buyScore += 4;
    } else if (affordability > 2 + buyThreshold) {
      buyScore += 3;
    } else if (affordability > 1 + buyThreshold) {
      buyScore += 2;
    } else if (affordability > 0.5) {
      buyScore += 1;
    }
    
    const propertyCount = properties.length;
    const investmentCount = investments.length;
    
    if (propertyCount < 2) {
      buyScore += 3;
    } else if (propertyCount < 5) {
      buyScore += 2;
    } else if (propertyCount < 10) {
      buyScore += 1;
    }
    
    buyScore += riskTolerance * 2.5;
    buyScore += gainSeeking * 2;
    buyScore -= lossAversion * 1.5;
    
    const diversificationBonus = propertyDiversifyRatio * (1 - Math.min(propertyCount / 15, 1));
    buyScore += diversificationBonus * 2;
    
    const monopolyBonus = targetMonopolySize * (1 - Math.min(propertyCount / 10, 1));
    buyScore += monopolyBonus * 1.5;
    
    const longTermBonus = longTermGainWeight * 2;
    buyScore += longTermBonus;
    
    const expectedROI = price * 0.06;
    const roiBonus = Math.min(expectedROI / 500, 2) * gainSeeking;
    buyScore += roiBonus;
    
    const debtRisk = totalDebt / Math.max(netWorth, 1);
    buyScore -= debtRisk * lossAversion * 2;
    
    const threshold = 3.5;
    
    if (buyScore > threshold + 1.5) {
      return { type: 'buy' };
    }
    
    if (buyScore > threshold && Math.random() < buyUrgency * 0.7 + 0.1) {
      return { type: 'buy' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideCoBuy(state: GameStateSnapshot): Decision {
    const { money, properties, netWorth, totalDebt } = state;
    const { buyUrgency, riskTolerance, gainSeeking, lossAversion, safetyFactor, tradeWillingness } = this.gene;
    
    if (!state.currentCell) return { type: 'rollDice' };
    
    const price = getExtra<number>(state.currentCell, 'price', 0);
    if (price <= 0) return { type: 'rollDice' };
    
    const ownerships = getExtra<Array<{ playerId: string; share: number; purchasePrice: number }>>(state.currentCell, 'ownerships', []);
    const totalOwners = ownerships?.length || 1;
    
    if (totalOwners >= 4) return { type: 'rollDice' };
    
    const cobuyShare = price / ((ownerships?.reduce((s, o) => s + o.purchasePrice, 0) || 0) + price);
    
    const availableMoney = money + Math.max(0, 800 - totalDebt);
    if (availableMoney - price < -600) {
      return { type: 'rollDice' };
    }
    
    let cobuyScore = 0;
    
    cobuyScore += tradeWillingness * 3;
    cobuyScore += gainSeeking * 1.5;
    cobuyScore += riskTolerance * 1.5;
    cobuyScore -= lossAversion * 1;
    
    const ownerPenalty = (totalOwners - 1) * 0.8;
    cobuyScore -= ownerPenalty;
    
    const propertyCount = properties.length;
    if (propertyCount < 3) {
      cobuyScore += 2;
    }
    
    const shareValue = cobuyShare * price * 0.1;
    cobuyScore += Math.min(shareValue / 200, 1.5);
    
    const debtRisk = totalDebt / Math.max(netWorth, 1);
    cobuyScore -= debtRisk * lossAversion * 1.5;
    
    const threshold = 2.5;
    
    if (cobuyScore > threshold + 1) {
      return { type: 'buy' };
    }
    
    if (cobuyScore > threshold && Math.random() < buyUrgency * 0.5 + 0.05) {
      return { type: 'buy' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideUpgrade(state: GameStateSnapshot): Decision {
    const { money, currentCell, properties, netWorth, totalDebt } = state;
    const { 
      upgradeThreshold, upgradeUrgency, riskTolerance, monopolyStrategy,
      gainSeeking, lossAversion, longTermGainWeight, safetyFactor,
      reserveRatio, targetMonopolySize
    } = this.gene;
    
    if (!currentCell) return { type: 'rollDice' };
    
    const currentLevel = getExtra<number>(currentCell, 'level', 0);
    const upgradeCosts = getExtra<number[]>(currentCell, 'upgradeCost', []);
    const maxLevel = upgradeCosts.length;
    
    if (currentLevel >= maxLevel) return { type: 'rollDice' };
    
    const upgradeCost = upgradeCosts[currentLevel] || 0;
    if (upgradeCost <= 0) return { type: 'rollDice' };
    
    const affordability = netWorth / upgradeCost;
    
    const availableMoney = money + Math.max(0, 700 - totalDebt);
    
    if (availableMoney - upgradeCost < -500) {
      return { type: 'rollDice' };
    }
    
    let upgradeScore = 0;
    
    if (affordability > 4 + upgradeThreshold + upgradeUrgency) {
      upgradeScore += 4;
    } else if (affordability > 3 + upgradeThreshold) {
      upgradeScore += 3;
    } else if (affordability > 1.5 + upgradeThreshold) {
      upgradeScore += 2;
    } else if (affordability > 1) {
      upgradeScore += 1;
    }
    
    upgradeScore += riskTolerance * 2;
    upgradeScore += gainSeeking * 1.5;
    upgradeScore -= lossAversion * 1;
    
    const levelBonus = (maxLevel - currentLevel) * monopolyStrategy;
    upgradeScore += levelBonus;
    
    const monopolyBonus = targetMonopolySize * 2;
    upgradeScore += monopolyBonus;
    
    const longTermBonus = longTermGainWeight * 2.5;
    upgradeScore += longTermBonus;
    
    const ownedProperties = properties.length;
    if (ownedProperties > 4) {
      upgradeScore += 1;
    }
    
    const myShare = properties.find(p => p.id === currentCell.id)?.share ?? 1.0;
    upgradeScore += myShare * 1.5;
    
    const debtRisk = totalDebt / Math.max(netWorth, 1);
    upgradeScore -= debtRisk * lossAversion;
    
    const threshold = 3;
    
    if (upgradeScore > threshold + 1) {
      return { type: 'upgrade' };
    }
    
    if (upgradeScore > threshold && Math.random() < upgradeUrgency * 0.6 + 0.1) {
      return { type: 'upgrade' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideInvest(state: GameStateSnapshot): Decision {
    const { money, investments, properties, netWorth, totalDebt } = state;
    const { 
      investmentThreshold, riskTolerance, gainSeeking, reserveRatio, investmentUrgency,
      investmentHoldTime, riskAdjustmentFactor, lossAversion, safetyFactor,
      shortTermGainWeight, longTermGainWeight, tradeWillingness
    } = this.gene;
    
    if (!state.currentCell) return { type: 'rollDice' };
    
    const price = getExtra<number>(state.currentCell, 'price', 5000);
    const owners = getExtra<string[]>(state.currentCell, 'owners', []);
    const hasOwner = owners && owners.length > 0;
    const isOwner = owners?.includes(state.playerId);
    
    if (isOwner) return { type: 'rollDice' };
    
    const availableMoney = money + Math.max(0, 700 - totalDebt);
    
    if (availableMoney - price < -500) {
      return { type: 'rollDice' };
    }
    
    const currentInvestments = investments.length;
    const maxInvestments = 8;
    
    let investScore = 0;
    
    const affordability = netWorth / price;
    if (affordability > 3 + investmentThreshold) {
      investScore += 4;
    } else if (affordability > 2 + investmentThreshold) {
      investScore += 3;
    } else if (affordability > 1 + investmentThreshold) {
      investScore += 2;
    } else if (affordability > 0.5) {
      investScore += 1;
    }
    
    investScore += riskTolerance * 3;
    investScore += gainSeeking * 2;
    investScore -= lossAversion * 2;
    
    const diversificationEffect = (1 - currentInvestments / maxInvestments) * riskAdjustmentFactor;
    investScore += diversificationEffect * 2;
    
    const holdTimeBonus = investmentHoldTime * longTermGainWeight * 2;
    investScore += holdTimeBonus;
    
    const shortTermBonus = (1 - investmentHoldTime) * shortTermGainWeight * 1.5;
    investScore += shortTermBonus;
    
    const propertyBalance = Math.abs(properties.length - investments.length) / Math.max(properties.length + investments.length, 1);
    investScore += propertyBalance * (1 - this.gene.propertyDiversifyRatio);
    
    if (hasOwner) {
      investScore += tradeWillingness * 1.5;
      investScore -= 0.5;
    }
    
    const debtRisk = totalDebt / Math.max(netWorth, 1);
    investScore -= debtRisk * lossAversion * 2;
    
    const threshold = 3;
    
    if (investScore > threshold + 1.5) {
      return { type: 'invest' };
    }
    
    if (investScore > threshold && Math.random() < investmentUrgency * 0.6 + 0.1) {
      return { type: 'invest' };
    }
    
    return { type: 'rollDice' };
  }
  
  private decideBankStrategy(state: GameStateSnapshot): Decision | null {
    const { money, credit, properties, investments, totalDebt, netWorth } = state;
    const { 
      loanThreshold, repayThreshold, lossAversion, emergencyReserveRatio,
      loanAmountRatio, interestTolerance, reserveRatio, riskTolerance,
      gainSeeking, safetyFactor
    } = this.gene;
    
    const lowMoneyThreshold = 2000 + loanThreshold * 8000;
    const urgentNeed = money < 1000 + emergencyReserveRatio * 1000;
    const minCreditForLoan = 20 + interestTolerance * 40;
    
    if (urgentNeed && credit > minCreditForLoan && totalDebt < credit * 50) {
      const ratio = Math.min(1, 0.3 + loanAmountRatio * 0.7);
      return { type: 'loan', loanAmountRatio: ratio };
    }
    
    const opportunityNeed = money < lowMoneyThreshold && credit > minCreditForLoan;
    const hasGoodOpportunity = properties.length + investments.length < 4;
    
    if (opportunityNeed && hasGoodOpportunity && riskTolerance > 0.5 && gainSeeking > 0.4) {
      if (totalDebt < credit * 80) {
        const ratio = 0.2 + loanAmountRatio * 0.6;
        return { type: 'loan', loanAmountRatio: ratio };
      }
    }
    
    const highMoney = money > 15000 + repayThreshold * 30000;
    const hasDebt = totalDebt > 500;
    const creditDeficit = 100 - credit;
    const repayUrgency = (creditDeficit / 100) * lossAversion * 2;
    
    if (highMoney && hasDebt && credit < 90) {
      const ratio = 0.3 + (1 - repayThreshold) * 0.6;
      return { type: 'repay', repayAmountRatio: Math.min(1, ratio + repayUrgency * 0.3) };
    }
    
    if (money > 8000 && hasDebt && credit < 60 && lossAversion > 0.6) {
      const ratio = 0.2 + lossAversion * 0.4;
      return { type: 'repay', repayAmountRatio: ratio };
    }
    
    if (money > 5000 && totalDebt > money * 2 && lossAversion > 0.7) {
      return { type: 'repay', repayAmountRatio: 0.4 };
    }
    
    return null;
  }
  
  private decideEvent(state: GameStateSnapshot): Decision {
    const { money, credit, properties, investments, totalDebt, netWorth } = state;
    const { riskTolerance, gainSeeking, lossAversion, safetyFactor, reserveRatio, tradeWillingness } = this.gene;
    
    const hasBuffer = money > 3000 + reserveRatio * 5000;
    const lowCredit = credit < 40;
    const highCredit = credit > 75;
    
    const events: Array<{ type: DecisionType; weight: number; params?: Partial<Decision> }> = [
      { type: 'rollDice', weight: 0.35 + safetyFactor * 0.15 },
      { type: 'invest', weight: hasBuffer ? riskTolerance * gainSeeking * 0.6 : 0.1 },
      { type: 'loan', weight: lowCredit ? (1 - lossAversion) * 0.4 : 0.1, params: { loanAmountRatio: 0.5 } },
      { type: 'repay', weight: highCredit ? lossAversion * 0.25 : 0.05, params: { repayAmountRatio: 0.5 } },
      { type: 'buy', weight: (properties.length < 3) ? gainSeeking * 0.35 : 0.1 }
    ];
    
    const totalWeight = events.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const event of events) {
      random -= event.weight;
      if (random <= 0) {
        if (event.type === 'invest' && (money < 3000 || investments.length >= 6)) return { type: 'rollDice' };
        if (event.type === 'loan' && (credit <= 20 || totalDebt > credit * 80)) return { type: 'rollDice' };
        if (event.type === 'repay' && (money < 2000 || totalDebt < 500)) return { type: 'rollDice' };
        if (event.type === 'buy' && properties.length >= 12) return { type: 'rollDice' };
        return { type: event.type, ...event.params };
      }
    }
    
    return { type: 'rollDice' };
  }
  
}
