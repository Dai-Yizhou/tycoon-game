/**
 * 管理工具入口
 *
 * 功能：
 * - 管理员登录（通过 ADMIN_TOKEN）
 * - 玩家管理：查看列表、修改数值、冻结、踢出
 * - 时代管理：触发结算、切换时代
 */
import { EraManager, EraInfo } from './era/era-manager.js';
import './style.css';

import { io, Socket } from 'socket.io-client';

const eraManager = new EraManager();

// 状态
let socket: Socket | null = null;
let isLoggedIn = false;
let currentEditingPlayerId: string | null = null;

// 玩家数据类型
interface PlayerInfo {
  id: string;
  username: string;
  status: string;
  position: { cellId: number };
  values: Record<string, { id: string; name: string; current: number }>;
  teamId: string | null;
  lastActiveAt: number;
}

function bootstrap(): void {
  // 登录表单
  const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
  const loginError = document.getElementById('login-error') as HTMLElement | null;

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(loginForm);
      const token = formData.get('token') as string;
      const serverUrl = formData.get('serverUrl') as string;

      // 连接到服务器
      try {
        socket = io(serverUrl, {
          transports: ['websocket'],
          reconnection: false,
        });

        socket.on('connect', () => {
          console.info('[admin] Connected to server');
          // 发送登录请求
          socket?.emit('client.adminLogin', { token }, (result: { ok: boolean; error?: string; data?: { sessionTimeout: number } }) => {
            if (result.ok) {
              isLoggedIn = true;
              showAdminPanel();
              loadPlayers();
              if (loginError) loginError.style.display = 'none';
              console.info('[admin] Login successful');
            } else {
              if (loginError) {
                loginError.textContent = `登录失败: ${result.error || '未知错误'}`;
                loginError.style.display = 'block';
              }
              socket?.disconnect();
              socket = null;
            }
          });
        });

        socket.on('connect_error', (err) => {
          if (loginError) {
            loginError.textContent = `连接失败: ${err.message}`;
            loginError.style.display = 'block';
          }
          socket = null;
        });
      } catch (err) {
        if (loginError) {
          loginError.textContent = `连接异常: ${err}`;
          loginError.style.display = 'block';
        }
      }
    });
  }

  // 刷新玩家列表按钮
  const refreshBtn = document.getElementById('btn-refresh-players') as HTMLButtonElement | null;
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadPlayers();
    });
  }

  // 退出登录按钮
  const logoutBtn = document.getElementById('btn-logout') as HTMLButtonElement | null;
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      isLoggedIn = false;
      showLoginPage();
    });
  }

  // 时代管理按钮（原有功能）
  const settleBtn = document.getElementById('btn-settle') as HTMLButtonElement | null;
  const switchBtn = document.getElementById('btn-switch-era') as HTMLButtonElement | null;

  const placeholderEra: EraInfo = {
    id: 'era-1',
    name: '时代 1（占位）',
    mapId: 'map-placeholder',
    startAt: new Date().toISOString(),
    status: 'active',
  };
  eraManager.setCurrent(placeholderEra);

  const eraEl = document.getElementById('current-era');
  const mapEl = document.getElementById('current-map');
  if (eraEl) eraEl.textContent = placeholderEra.name;
  if (mapEl) mapEl.textContent = placeholderEra.mapId;

  if (settleBtn) {
    settleBtn.addEventListener('click', () => {
      const result = eraManager.triggerSettlement();
      console.info('[admin] settlement:', result);
      if (switchBtn) switchBtn.disabled = !result.success;
    });
  }

  // 修改数值对话框
  const editModal = document.getElementById('edit-value-modal') as HTMLElement | null;
  const editForm = document.getElementById('edit-value-form') as HTMLFormElement | null;
  const cancelEditBtn = document.getElementById('btn-cancel-edit') as HTMLButtonElement | null;

  if (cancelEditBtn && editModal) {
    cancelEditBtn.addEventListener('click', () => {
      editModal.style.display = 'none';
      currentEditingPlayerId = null;
    });
  }

  if (editForm && editModal) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentEditingPlayerId || !socket) return;

      const formData = new FormData(editForm);
      const fieldId = formData.get('fieldId') as string;
      const value = parseInt(formData.get('value') as string, 10);

      socket.emit('client.adminSetPlayerValue', { playerId: currentEditingPlayerId, fieldId, value }, (result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          editModal.style.display = 'none';
          currentEditingPlayerId = null;
          loadPlayers();
          console.info('[admin] Value updated successfully');
        } else {
          alert(`修改失败: ${result.error}`);
        }
      });
    });
  }

  console.info('[admin] bootstrap complete');
}

function showLoginPage(): void {
  const loginPage = document.getElementById('login-page') as HTMLElement | null;
  const adminPanel = document.getElementById('admin-panel') as HTMLElement | null;
  if (loginPage) loginPage.style.display = 'block';
  if (adminPanel) adminPanel.style.display = 'none';
}

function showAdminPanel(): void {
  const loginPage = document.getElementById('login-page') as HTMLElement | null;
  const adminPanel = document.getElementById('admin-panel') as HTMLElement | null;
  if (loginPage) loginPage.style.display = 'none';
  if (adminPanel) adminPanel.style.display = 'block';
}

function loadPlayers(): void {
  if (!socket || !isLoggedIn) return;

  socket.emit('client.adminGetPlayers', {}, (result: {
    ok: boolean;
    error?: string;
    data?: { players: PlayerInfo[]; count: number };
  }) => {
    if (result.ok && result.data) {
      renderPlayers(result.data.players);
    } else {
      console.error('[admin] Failed to load players:', result.error);
    }
  });
}

function renderPlayers(players: PlayerInfo[]): void {
  const tbody = document.getElementById('players-list') as HTMLTableSectionElement | null;
  if (!tbody) return;

  if (players.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="placeholder">暂无在线玩家</td></tr>';
    return;
  }

  tbody.innerHTML = players.map((p) => {
    const moneyValue = p.values['money']?.current ?? 0;
    const teamDisplay = p.teamId ? `队伍 ${p.teamId.slice(0, 8)}` : '无';
    const statusDisplay = p.status === 'frozen' ? '<span class="status-frozen">冻结</span>' : '<span class="status-normal">正常</span>';

    return `
      <tr data-player-id="${p.id}">
        <td class="player-id">${p.id.slice(0, 8)}</td>
        <td class="player-name">${p.username}</td>
        <td class="player-status">${statusDisplay}</td>
        <td class="player-pos">格子 ${p.position.cellId}</td>
        <td class="player-money">${moneyValue}</td>
        <td class="player-team">${teamDisplay}</td>
        <td class="player-actions">
          <button class="action-btn edit-btn" data-action="edit" data-player-id="${p.id}" data-player-name="${p.username}">修改</button>
          <button class="action-btn freeze-btn" data-action="freeze" data-player-id="${p.id}" ${p.status === 'frozen' ? 'disabled' : ''}>冻结</button>
          <button class="action-btn unfreeze-btn" data-action="unfreeze" data-player-id="${p.id}" ${p.status !== 'frozen' ? 'disabled' : ''}>解冻</button>
          <button class="action-btn kick-btn" data-action="kick" data-player-id="${p.id}">踢出</button>
        </td>
      </tr>
    `;
  }).join('');

  // 绑定操作按钮事件
  tbody.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', handlePlayerAction);
  });
}

function handlePlayerAction(e: Event): void {
  const btn = e.currentTarget as HTMLButtonElement;
  const action = btn.dataset.action;
  const playerId = btn.dataset.playerId;
  const playerName = btn.dataset.playerName;

  if (!action || !playerId || !socket) return;

  switch (action) {
    case 'edit':
      showEditModal(playerId, playerName || '');
      break;
    case 'freeze':
      socket.emit('client.adminFreezePlayer', { playerId }, (result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          loadPlayers();
          console.info('[admin] Player frozen:', playerId);
        } else {
          alert(`冻结失败: ${result.error}`);
        }
      });
      break;
    case 'unfreeze':
      socket.emit('client.adminUnfreezePlayer', { playerId }, (result: { ok: boolean; error?: string }) => {
        if (result.ok) {
          loadPlayers();
          console.info('[admin] Player unfrozen:', playerId);
        } else {
          alert(`解冻失败: ${result.error}`);
        }
      });
      break;
    case 'kick':
      if (confirm(`确定要踢出玩家 ${playerName}？`)) {
        socket.emit('client.adminKickPlayer', { playerId }, (result: { ok: boolean; error?: string }) => {
          if (result.ok) {
            loadPlayers();
            console.info('[admin] Player kicked:', playerId);
          } else {
            alert(`踢出失败: ${result.error}`);
          }
        });
      }
      break;
  }
}

function showEditModal(playerId: string, playerName: string): void {
  const modal = document.getElementById('edit-value-modal') as HTMLElement | null;
  const playerNameEl = document.getElementById('modal-player-name') as HTMLElement | null;
  const valueInput = document.getElementById('edit-new-value') as HTMLInputElement | null;

  if (modal && playerNameEl) {
    currentEditingPlayerId = playerId;
    playerNameEl.textContent = `玩家: ${playerName}`;
    modal.style.display = 'flex';
    if (valueInput) {
      valueInput.value = '';
      valueInput.focus();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}