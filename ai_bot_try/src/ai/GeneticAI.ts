import { Genome } from '../core/Genome';
import { GameStateSnapshot, Decision } from '../simulation/RealGameAdapter';
import { DecisionMaker } from './DecisionMaker';

export class GeneticAI {
  private genome: Genome;
  private decisionMaker: DecisionMaker;
  
  constructor(genome: Genome) {
    this.genome = genome;
    this.decisionMaker = new DecisionMaker(genome.gene);
  }
  
  decide(state: GameStateSnapshot): Decision {
    return this.decisionMaker.makeDecision(state);
  }
  
  getGenome(): Genome {
    return this.genome;
  }
}