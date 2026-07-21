/**
 * i18n 多语言支持模块
 *
 * 提供语言包加载、语言切换等功能。
 */

const zhCN: Record<string, unknown> = {
  "common": {
    "loading": "加载中...",
    "confirm": "确认",
    "cancel": "取消",
    "close": "关闭",
    "submit": "提交",
    "save": "保存",
    "reset": "重置",
    "start": "开始",
    "back": "返回",
    "next": "下一步",
    "prev": "上一步",
    "skip": "跳过",
    "success": "成功",
    "error": "错误",
    "warning": "警告",
    "info": "提示",
    "yes": "是",
    "no": "否"
  },
  "game": {
    "title": "大富翁.io",
    "subtitle": "经典棋盘游戏，全新多人体验",
    "startButton": "开始游戏",
    "loginButton": "登录",
    "guestButton": "游客模式",
    "registerButton": "注册账号"
  },
  "login": {
    "title": "登录",
    "username": "用户名",
    "password": "密码",
    "usernamePlaceholder": "请输入用户名",
    "passwordPlaceholder": "请输入密码",
    "loginSuccess": "登录成功",
    "loginFailed": "登录失败",
    "usernameRequired": "请输入用户名",
    "passwordRequired": "请输入密码",
    "invalidCredentials": "用户名或密码错误"
  },
  "register": {
    "title": "注册账号",
    "username": "用户名",
    "password": "密码",
    "confirmPassword": "确认密码",
    "usernamePlaceholder": "请输入用户名（3-20位字母数字下划线）",
    "passwordPlaceholder": "请输入密码（至少6位）",
    "confirmPasswordPlaceholder": "请再次输入密码",
    "registerSuccess": "注册成功",
    "registerFailed": "注册失败",
    "usernameExists": "用户名已存在",
    "usernameInvalid": "用户名格式不正确",
    "passwordTooShort": "密码长度不足",
    "passwordMismatch": "两次密码不一致"
  },
  "hud": {
    "money": "财产",
    "credit": "信用值",
    "alternateField": "备选数值",
    "players": "玩家列表",
    "online": "在线",
    "offline": "离线",
    "inJail": "在监狱",
    "bankrupt": "破产",
    "frozen": "冻结",
    "team": "队伍",
    "noTeam": "未组队"
  },
  "dice": {
    "roll": "掷骰",
    "rolling": "掷骰中...",
    "cooldown": "冷却",
    "cooldownSeconds": "秒",
    "result": "骰子结果",
    "moveSteps": "移动 {{count}} 步"
  },
  "cell": {
    "start": "起点",
    "property": "地产",
    "event": "事件格",
    "investment": "投资项目",
    "transport": "交通枢纽",
    "monument": "纪念碑",
    "jail": "监狱",
    "empty": "空白格"
  },
  "property": {
    "buyTitle": "购买地产",
    "upgradeTitle": "升级地产",
    "price": "价格",
    "rent": "租金",
    "level": "等级",
    "upgradeCost": "升级费用",
    "owner": "所有者",
    "coOwners": "合租者",
    "buyConfirm": "确认购买",
    "upgradeConfirm": "确认升级",
    "buySuccess": "购买成功",
    "upgradeSuccess": "升级成功",
    "insufficientMoney": "财产不足",
    "rentPaid": "支付租金 {{amount}}",
    "rentReceived": "收到租金 {{amount}}"
  },
  "event": {
    "triggered": "触发事件",
    "effect": "效果",
    "good": "好事",
    "bad": "坏事",
    "neutral": "中性事件"
  },
  "item": {
    "bag": "道具背包",
    "use": "使用",
    "sealOrder": "查封令",
    "reviveOrder": "复活令",
    "sealTarget": "查封目标",
    "reviveTarget": "复活目标",
    "useSuccess": "道具使用成功",
    "useFailed": "道具使用失败",
    "quantityLimit": "道具数量已达上限"
  },
  "talent": {
    "panel": "天赋面板",
    "learn": "学习",
    "unlearn": "取消",
    "toggle": "启用/禁用",
    "enabled": "已启用",
    "disabled": "已禁用",
    "points": "天赋值",
    "cost": "消耗",
    "reward": "奖励",
    "prerequisite": "前置",
    "conflict": "互斥",
    "vision": "视野",
    "creditEnable": "信用值系统",
    "bankEnable": "银行系统",
    "alternateEnable": "备选数值",
    "itemsEnable": "道具系统",
    "teamEnable": "组队系统"
  },
  "achievement": {
    "panel": "成就面板",
    "unlocked": "已解锁",
    "locked": "未解锁",
    "hidden": "隐藏成就",
    "progress": "进度",
    "reward": "奖励",
    "claim": "领取奖励",
    "claimed": "已领取",
    "category": {
      "wealth": "财富类",
      "credit": "信用类",
      "property": "地产类",
      "social": "社交类",
      "special": "特殊目标类",
      "survival": "生存类",
      "investment": "投资类",
      "monument": "纪念碑类"
    },
    "rarity": {
      "common": "普通",
      "rare": "稀有",
      "epic": "史诗",
      "legendary": "传说"
    }
  },
  "transport": {
    "title": "交通枢纽",
    "selectDestination": "选择目的地",
    "cost": "费用",
    "teleport": "传送",
    "teleportSuccess": "传送成功",
    "teleportFailed": "传送失败"
  },
  "monument": {
    "title": "纪念碑",
    "repair": "修缮",
    "repairCost": "修缮费用",
    "creditIncrease": "信用值增加",
    "prosperityIncrease": "繁荣度增加",
    "currentProsperity": "当前繁荣度",
    "repairSuccess": "修缮成功",
    "repairFailed": "修缮失败",
    "records": "纪念碑铭记"
  },
  "jail": {
    "title": "监狱",
    "inJail": "你被关进监狱",
    "releaseTime": "出狱时间",
    "cooldownExtended": "掷骰冷却延长",
    "creditPenalty": "信用值惩罚",
    "noRent": "监狱中无法收取租金"
  },
  "bank": {
    "title": "银行",
    "loan": "贷款",
    "repay": "还款",
    "loanAmount": "贷款金额",
    "interestRate": "利率",
    "currentLoan": "当前贷款",
    "loanSuccess": "贷款成功",
    "repaySuccess": "还款成功",
    "insufficientCredit": "信用值不足"
  },
  "bankruptcy": {
    "title": "破产",
    "bankrupt": "你已破产",
    "reviveTime": "复活时间",
    "propertiesClear": "地产已清除",
    "reviveOrderNeeded": "需要复活令"
  },
  "tutorial": {
    "welcome": "欢迎来到大富翁.io！",
    "step1": "点击掷骰按钮开始移动",
    "step2": "走到地产格可以购买地产",
    "step3": "路过他人地产需要支付租金",
    "step4": "在起点可以选择天赋",
    "step5": "完成！开始你的冒险吧",
    "skip": "跳过引导",
    "restart": "重新查看引导",
    "complete": "引导完成"
  },
  "error": {
    "network": "网络连接失败",
    "server": "服务器错误",
    "notFound": "资源不存在",
    "unauthorized": "未授权",
    "forbidden": "禁止访问",
    "invalidData": "数据格式错误"
  }
};

const enUS: Record<string, unknown> = {
  "common": {
    "loading": "Loading...",
    "confirm": "Confirm",
    "cancel": "Cancel",
    "close": "Close",
    "submit": "Submit",
    "save": "Save",
    "reset": "Reset",
    "start": "Start",
    "back": "Back",
    "next": "Next",
    "prev": "Previous",
    "skip": "Skip",
    "success": "Success",
    "error": "Error",
    "warning": "Warning",
    "info": "Info",
    "yes": "Yes",
    "no": "No"
  },
  "game": {
    "title": "Monopoly.io",
    "subtitle": "Classic board game, new multiplayer experience",
    "startButton": "Start Game",
    "loginButton": "Login",
    "guestButton": "Guest Mode",
    "registerButton": "Register"
  },
  "login": {
    "title": "Login",
    "username": "Username",
    "password": "Password",
    "usernamePlaceholder": "Enter username",
    "passwordPlaceholder": "Enter password",
    "loginSuccess": "Login successful",
    "loginFailed": "Login failed",
    "usernameRequired": "Username is required",
    "passwordRequired": "Password is required",
    "invalidCredentials": "Invalid credentials"
  },
  "register": {
    "title": "Register",
    "username": "Username",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "usernamePlaceholder": "Enter username (3-20 alphanumeric characters)",
    "passwordPlaceholder": "Enter password (at least 6 characters)",
    "confirmPasswordPlaceholder": "Confirm password",
    "registerSuccess": "Registration successful",
    "registerFailed": "Registration failed",
    "usernameExists": "Username already exists",
    "usernameInvalid": "Invalid username format",
    "passwordTooShort": "Password too short",
    "passwordMismatch": "Passwords do not match"
  },
  "hud": {
    "money": "Money",
    "credit": "Credit",
    "alternateField": "Alternate Value",
    "players": "Players",
    "online": "Online",
    "offline": "Offline",
    "inJail": "In Jail",
    "bankrupt": "Bankrupt",
    "frozen": "Frozen",
    "team": "Team",
    "noTeam": "No Team"
  },
  "dice": {
    "roll": "Roll",
    "rolling": "Rolling...",
    "cooldown": "Cooldown",
    "cooldownSeconds": "seconds",
    "result": "Dice Result",
    "moveSteps": "Move {{count}} steps"
  },
  "cell": {
    "start": "Start",
    "property": "Property",
    "event": "Event",
    "investment": "Investment",
    "transport": "Transport",
    "monument": "Monument",
    "jail": "Jail",
    "empty": "Empty"
  },
  "property": {
    "buyTitle": "Buy Property",
    "upgradeTitle": "Upgrade Property",
    "price": "Price",
    "rent": "Rent",
    "level": "Level",
    "upgradeCost": "Upgrade Cost",
    "owner": "Owner",
    "coOwners": "Co-owners",
    "buyConfirm": "Confirm Purchase",
    "upgradeConfirm": "Confirm Upgrade",
    "buySuccess": "Purchase successful",
    "upgradeSuccess": "Upgrade successful",
    "insufficientMoney": "Insufficient funds",
    "rentPaid": "Paid rent {{amount}}",
    "rentReceived": "Received rent {{amount}}"
  },
  "event": {
    "triggered": "Event triggered",
    "effect": "Effect",
    "good": "Good",
    "bad": "Bad",
    "neutral": "Neutral"
  },
  "item": {
    "bag": "Item Bag",
    "use": "Use",
    "sealOrder": "Seal Order",
    "reviveOrder": "Revive Order",
    "sealTarget": "Seal Target",
    "reviveTarget": "Revive Target",
    "useSuccess": "Item used successfully",
    "useFailed": "Failed to use item",
    "quantityLimit": "Item quantity limit reached"
  },
  "talent": {
    "panel": "Talent Panel",
    "learn": "Learn",
    "unlearn": "Unlearn",
    "toggle": "Toggle",
    "enabled": "Enabled",
    "disabled": "Disabled",
    "points": "Talent Points",
    "cost": "Cost",
    "reward": "Reward",
    "prerequisite": "Prerequisite",
    "conflict": "Conflict",
    "vision": "Vision",
    "creditEnable": "Credit System",
    "bankEnable": "Bank System",
    "alternateEnable": "Alternate Values",
    "itemsEnable": "Item System",
    "teamEnable": "Team System"
  },
  "achievement": {
    "panel": "Achievement Panel",
    "unlocked": "Unlocked",
    "locked": "Locked",
    "hidden": "Hidden",
    "progress": "Progress",
    "reward": "Reward",
    "claim": "Claim",
    "claimed": "Claimed",
    "category": {
      "wealth": "Wealth",
      "credit": "Credit",
      "property": "Property",
      "social": "Social",
      "special": "Special",
      "survival": "Survival",
      "investment": "Investment",
      "monument": "Monument"
    },
    "rarity": {
      "common": "Common",
      "rare": "Rare",
      "epic": "Epic",
      "legendary": "Legendary"
    }
  },
  "transport": {
    "title": "Transport Hub",
    "selectDestination": "Select Destination",
    "cost": "Cost",
    "teleport": "Teleport",
    "teleportSuccess": "Teleport successful",
    "teleportFailed": "Teleport failed"
  },
  "monument": {
    "title": "Monument",
    "repair": "Repair",
    "repairCost": "Repair Cost",
    "creditIncrease": "Credit Increase",
    "prosperityIncrease": "Prosperity Increase",
    "currentProsperity": "Current Prosperity",
    "repairSuccess": "Repair successful",
    "repairFailed": "Repair failed",
    "records": "Monument Records"
  },
  "jail": {
    "title": "Jail",
    "inJail": "You are in jail",
    "releaseTime": "Release Time",
    "cooldownExtended": "Roll cooldown extended",
    "creditPenalty": "Credit penalty",
    "noRent": "Cannot collect rent in jail"
  },
  "bank": {
    "title": "Bank",
    "loan": "Loan",
    "repay": "Repay",
    "loanAmount": "Loan Amount",
    "interestRate": "Interest Rate",
    "currentLoan": "Current Loan",
    "loanSuccess": "Loan successful",
    "repaySuccess": "Repay successful",
    "insufficientCredit": "Insufficient credit"
  },
  "bankruptcy": {
    "title": "Bankruptcy",
    "bankrupt": "You are bankrupt",
    "reviveTime": "Revive Time",
    "propertiesClear": "Properties cleared",
    "reviveOrderNeeded": "Revive Order required"
  },
  "tutorial": {
    "welcome": "Welcome to Monopoly.io!",
    "step1": "Click roll to start moving",
    "step2": "Buy properties when you land on them",
    "step3": "Pay rent when passing others' properties",
    "step4": "Choose talents at start",
    "step5": "Complete! Start your adventure",
    "skip": "Skip Tutorial",
    "restart": "Restart Tutorial",
    "complete": "Tutorial Complete"
  },
  "error": {
    "network": "Network connection failed",
    "server": "Server error",
    "notFound": "Resource not found",
    "unauthorized": "Unauthorized",
    "forbidden": "Forbidden",
    "invalidData": "Invalid data format"
  }
};

export type LocaleCode = 'zh-CN' | 'en-US';

const locales: Record<LocaleCode, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

let currentLocale: LocaleCode = 'zh-CN';

export function setLocale(locale: LocaleCode): void {
  if (locales[locale]) {
    currentLocale = locale;
  }
}

export function getLocale(): LocaleCode {
  return currentLocale;
}

export function getCurrentLocaleData(): Record<string, unknown> {
  return locales[currentLocale];
}

export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let value: unknown = locales[currentLocale];

  for (const part of parts) {
    if (typeof value === 'object' && value !== null && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  if (params) {
    let result = value;
    for (const [paramKey, paramValue] of Object.entries(params)) {
      result = result.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramValue));
    }
    return result;
  }

  return value;
}

export function getSupportedLocales(): LocaleCode[] {
  return Object.keys(locales) as LocaleCode[];
}

export { zhCN, enUS };
