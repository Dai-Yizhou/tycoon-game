import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gameLogic = readFileSync(resolve(__dirname, '../src/game/systems/GameLogic.ts'), 'utf8');
const modalSystem = readFileSync(resolve(__dirname, '../src/game/systems/ModalSystem.ts'), 'utf8');

describe('client actions are server-authoritative', () => {
  test('GameLogic handlers only emit socket requests, no local state mutations', () => {
    // 所有业务操作应通过 client.* 事件发送请求，而非直接修改本地状态
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.buyProperty'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.upgradeProperty'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.buyInvestment'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.repairMonument'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.getTransportDestinations'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.bankruptRestart'/);
    expect(gameLogic).toMatch(/gameSocket\.emit\('client\.rollDice'/);
  });

  test('ModalSystem handlers only emit socket requests, no local state mutations', () => {
    // 交通枢纽：只发送 client.useTransport 请求
    expect(modalSystem).toMatch(/gameSocket\.emit\('client\.useTransport'/);
    // 银行：只发送 client.bankLoan / client.bankRepay 请求
    expect(modalSystem).toMatch(/gameSocket\.emit\('client\.bankLoan'/);
    expect(modalSystem).toMatch(/gameSocket\.emit\('client\.bankRepay'/);
    // 道具：只发送 client.useItem 请求
    expect(modalSystem).toMatch(/gameSocket\.emit\('client\.useItem'/);
  });

  test('no direct setCurrentMoney or setCurrentPlayerPosition calls in business logic', () => {
    // 这些是旧代码中直接修改本地状态的调用，不应出现在业务逻辑中
    expect(gameLogic).not.toMatch(/setCurrentMoney\(/);
    expect(gameLogic).not.toMatch(/setCurrentPlayerPosition\(/);
    expect(gameLogic).not.toMatch(/setOwnedProperties\(/);
    expect(gameLogic).not.toMatch(/setPropertyLevels\(/);
    expect(gameLogic).not.toMatch(/setOwnedInvestments\(/);
    expect(gameLogic).not.toMatch(/setInvestmentShares\(/);
    expect(modalSystem).not.toMatch(/setCurrentMoney\(/);
    expect(modalSystem).not.toMatch(/setCurrentPlayerPosition\(/);
    expect(modalSystem).not.toMatch(/setLoanAmount\(/);
    expect(modalSystem).not.toMatch(/setIsBankrupt\(/);
    expect(modalSystem).not.toMatch(/setCanRoll\(/);
  });
});