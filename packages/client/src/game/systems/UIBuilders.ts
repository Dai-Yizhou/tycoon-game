/**
 * UI 构建器
 *
 * 管理游戏界面所有 DOM 元素的构建函数。
 */

import { t } from '@game/shared';
import {
  chatChannelDefs, activeChatChannels, selectedChatChannel,
  setChatBoxEl,
  setTopBarProsperityEl, setTopBarProsperityFillEl, setTopBarRegionFieldsEl,
  setTopBarTimeEl, setTeamPanelContentEl,
  setChatChannelContainer,
  setSelectedChatChannel,
} from '../../state/GameStore.js';

export function buildTopBar(page: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'player-info-bar';

  const nameItem = document.createElement('div');
  nameItem.className = 'pib-name';
  nameItem.innerHTML = `<span id="pib-username">${t('game.playerPlaceholder')}</span>`;
  bar.appendChild(nameItem);

  const timeItem = document.createElement('div');
  timeItem.className = 'pib-time';
  timeItem.id = 'pib-time';
  timeItem.innerHTML = `<span class="pib-time-icon">☀️</span><span class="pib-time-text" id="topbar-time">--:--</span><span class="pib-time-tz" id="topbar-tz">UTC+0</span>`;
  bar.appendChild(timeItem);

  const regionSection = document.createElement('div');
  regionSection.className = 'pib-region';

  const regionName = document.createElement('div');
  regionName.className = 'pib-region-name';
  regionName.id = 'pib-region-name';
  regionName.textContent = '—';
  regionName.title = t('game.currentRegion');
  regionSection.appendChild(regionName);

  const prosperityBar = document.createElement('div');
  prosperityBar.className = 'pib-region-bar';
  prosperityBar.innerHTML = `
    <span class="pib-v-icon" title="${t('game.regionProsperity')}">📈</span>
    <div class="pib-v-track" title="${t('game.prosperity')}">
      <div class="pib-v-fill pib-v-prosperity" id="pib-prosperity-fill" style="width: 100%"></div>
    </div>
    <span class="pib-v-num" id="pib-prosperity-val">100</span>
  `;
  regionSection.appendChild(prosperityBar);

  const dynamicFields = document.createElement('div');
  dynamicFields.className = 'pib-region-fields';
  dynamicFields.id = 'pib-region-fields';
  regionSection.appendChild(dynamicFields);
  bar.appendChild(regionSection);

  const teamBrief = document.createElement('div');
  teamBrief.className = 'pib-team-brief';
  teamBrief.id = 'team-brief';
  teamBrief.style.display = 'none';
  bar.appendChild(teamBrief);

  page.appendChild(bar);
  setTopBarTimeEl(document.getElementById('topbar-time'));
  setTopBarProsperityEl(document.getElementById('pib-prosperity-val'));
  setTopBarProsperityFillEl(document.getElementById('pib-prosperity-fill'));
  setTopBarRegionFieldsEl(document.getElementById('pib-region-fields'));
}

export function buildChatBox(page: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'chat-box';

  const header = document.createElement('div');
  header.className = 'chat-header';

  const channelContainer = document.createElement('div');
  channelContainer.className = 'chat-channels';
  for (const ch of chatChannelDefs) {
    const label = document.createElement('label');
    label.className = 'chat-channel-checkbox';
    label.title = t('chat.toggleChannel', { channel: t(ch.label) });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = activeChatChannels.has(ch.id);
    cb.dataset.channel = ch.id;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        activeChatChannels.add(ch.id);
      } else {
        activeChatChannels.delete(ch.id);
      }
      refreshChatMessages();
    });
    const span = document.createElement('span');
    span.className = 'chat-channel-label';
    span.textContent = t(ch.label);
    span.style.color = ch.color;
    label.appendChild(cb);
    label.appendChild(span);
    channelContainer.appendChild(label);
  }
  header.appendChild(channelContainer);
  setChatChannelContainer(channelContainer);

  const messages = document.createElement('div');
  messages.className = 'chat-messages';
  messages.id = 'chat-messages';

  const inputContainer = document.createElement('div');
  inputContainer.className = 'chat-input-container';
  inputContainer.style.cssText = 'display: flex; gap: 6px; padding: 6px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.2);';

  const sendChannel = document.createElement('select');
  sendChannel.className = 'chat-send-channel';
  for (const ch of chatChannelDefs.filter(ch => ch.id !== 'system')) {
    const option = document.createElement('option');
    option.value = ch.id;
    option.textContent = t(ch.label);
    option.selected = ch.id === selectedChatChannel;
    sendChannel.appendChild(option);
  }
  sendChannel.addEventListener('change', () => setSelectedChatChannel(sendChannel.value));

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  input.placeholder = t('chat.inputPlaceholder');
  input.style.cssText = 'flex: 1; padding: 4px 8px; font-size: 13px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background: rgba(0,0,0,0.3); color: #fff; outline: none;';
  input.maxLength = 200;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'chat-send-btn';
  sendBtn.textContent = t('chat.send');
  sendBtn.style.cssText = 'padding: 4px 12px; font-size: 13px; border: none; border-radius: 4px; background: #3b82f6; color: #fff; cursor: pointer; transition: background 0.2s;';
  sendBtn.addEventListener('mouseenter', () => { sendBtn.style.background = '#2563eb'; });
  sendBtn.addEventListener('mouseleave', () => { sendBtn.style.background = '#3b82f6'; });

  const sendMessage = () => {
    const msg = input.value.trim();
    if (!msg) return;
    const channel = selectedChatChannel;
    if (gameSocket) {
      gameSocket.emit('client.chat', { channel, content: msg }, (result) => {
        if (!result.ok) {
          addChatMessage(t('chat.sendFailed', { error: result.error || t('common.unknown') }), 'system');
        }
      });
    } else {
      addChatMessage(t('chat.you') + msg, channel);
    }
    input.value = '';
  };

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  inputContainer.appendChild(sendChannel);
  inputContainer.appendChild(input);
  inputContainer.appendChild(sendBtn);

  box.appendChild(header);
  box.appendChild(messages);
  box.appendChild(inputContainer);
  page.appendChild(box);
  setChatBoxEl(messages);
}

import { gameSocket } from '../../state/GameStore.js';
import { addChatMessage, refreshChatMessages } from './ChatSystem.js';

export function buildTeamPanel(page: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'team-panel';
  panel.innerHTML = `
    <div class="team-panel-title" title="${t('team.teamMembers')}">👥 ${t('team.panel')}</div>
    <div class="team-panel-content" id="team-content"></div>
    <div class="team-panel-actions">
      <button class="team-action-btn" title="${t('team.invitePlayers')}" onclick="window.showTeamInvite()">${t('team.invite')}</button>
      <button class="team-action-btn" title="${t('team.teamManagement')}" onclick="window.showTeamManagement()">${t('team.manage')}</button>
    </div>
  `;
  page.appendChild(panel);
  setTeamPanelContentEl(panel.querySelector('#team-content'));
}
