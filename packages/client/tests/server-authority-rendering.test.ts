import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gameLogic = readFileSync(resolve(__dirname, '../src/game/systems/GameLogic.ts'), 'utf8');
const gamePage = readFileSync(resolve(__dirname, '../src/pages/GamePage.ts'), 'utf8');
const modalSystem = readFileSync(resolve(__dirname, '../src/game/systems/ModalSystem.ts'), 'utf8');

describe('server-authoritative client rendering', () => {
  test('business actions emit client requests instead of mutating authoritative state locally', () => {
    expect(gameLogic).toMatch(/client\.buyProperty/);
    expect(gameLogic).toMatch(/client\.upgradeProperty/);
    expect(gameLogic).toMatch(/client\.buyInvestment/);
    expect(gameLogic).toMatch(/client\.buyInvestment/);
    expect(gameLogic).toMatch(/client\.repairMonument/);
    expect(gameLogic).not.toMatch(/setCurrentMoney\(currentMoney - price\)/);
    expect(gameLogic).not.toMatch(/setCurrentMoney\(currentMoney - cost\)/);
    expect(gameLogic).not.toMatch(/setOwnedProperties\(/);
    expect(gameLogic).not.toMatch(/setPropertyLevels\(/);
    expect(gameLogic).not.toMatch(/setOwnedInvestments\(/);
    expect(gameLogic).not.toMatch(/setInvestmentShares\(/);
    expect(gameLogic).not.toMatch(/setActionUsedThisTurn\(true\)/);
  });

  test('ModalSystem uses server requests instead of local state mutations', () => {
    // Transport modal: should emit client.useTransport, not local setCurrentMoney
    expect(modalSystem).toMatch(/client\.useTransport/);
    expect(modalSystem).not.toMatch(/setCurrentMoney\(currentMoney - cost\)/);
    expect(modalSystem).not.toMatch(/setCurrentPlayerPosition\(/);
    expect(modalSystem).not.toMatch(/setPlayerDisplayPos\(/);
    expect(modalSystem).not.toMatch(/setCameraTarget\(/);
    expect(modalSystem).not.toMatch(/setActionUsedThisTurn\(true\)/);

    // Bank modal: should emit client.bankLoan / client.bankRepay
    expect(modalSystem).toMatch(/client\.bankLoan/);
    expect(modalSystem).toMatch(/client\.bankRepay/);
    expect(modalSystem).not.toMatch(/setCurrentMoney\(currentMoney \+ amount\)/);
    expect(modalSystem).not.toMatch(/setLoanAmount\(loanAmount \+ amount\)/);
    expect(modalSystem).not.toMatch(/setCurrentMoney\(currentMoney - totalRepay\)/);

    // Item modals: should emit client.useItem
    expect(modalSystem).toMatch(/client\.useItem/);
    expect(modalSystem).not.toMatch(/items\[itemIndex\]\.count--/);
    expect(modalSystem).not.toMatch(/setCurrentCredit\(/);
    expect(modalSystem).not.toMatch(/setIsBankrupt\(false\)/);
    expect(modalSystem).not.toMatch(/setCanRoll\(true\)/);
  });

  test('GamePage delegates socket lifecycle to SocketEventHandler', () => {
    expect(gamePage).toMatch(/registerSocketHandlers\(socket/);
    expect(gamePage).toMatch(/unregisterSocketHandlers\(gameSocket\)/);
    expect(gamePage).not.toMatch(/socket\.on\('server\./);
  });
});