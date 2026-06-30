/**
 * 消防隊財產管理系統 - 主控應用程式
 *
 * 依賴：window.DB（IndexedDB 資料庫層）、window.Utils（共用工具函數）
 * 額外依賴：XLSX（SheetJS，用於 Excel 匯入匯出，透過 CDN 載入）
 * 額外依賴：lucide（圖示庫，動態渲染後需呼叫 lucide.createIcons()）
 *
 * 使用 IIFE 封裝，僅暴露 window.App。
 *
 * @fileoverview 主控應用程式邏輯（路由、儀表板、財產管理、人員管理、照片處理、Excel 匯入、資料維護）
 * @version 1.0.0
 */

(function () {
  'use strict';

  // ============================================================
  // 取得依賴參考
  // ============================================================

  var DB = window.DB;
  var Utils = window.Utils;
  var logger = Utils.logger;

  // ============================================================
  // 模組內部狀態
  // ============================================================

  /** @type {string} 當前頁面名稱 */
  var currentPage = 'dashboard';

  /** @type {boolean} 是否已經綁定過事件 */
  var isEventsBound = false;

  /** @type {string[]} 暫存照片陣列（base64） */
  var currentPhotos = [];

  /** @type {Array<Object>} Excel 匯入暫存解析結果 */
  var importParsedRows = [];

  /** @type {Array<Object>} Excel 匯入有效列 */
  var importValidRows = [];

  /** @type {number} Excel 匯入錯誤列數 */
  var importErrorCount = 0;

  /** @type {Array<number>} 被選中的人員 ID 陣列（多選） */
  var selectedPersonnelIds = [];

  /** @type {number} 搜尋防抖延遲毫秒數 */
  var DEBOUNCE_DELAY = 300;

  /** @type {Array<Object>} 在職人員列表，供就地編輯使用 */
  var activePersonnelList = [];

  // ============================================================
  // Excel 欄位對應表
  // ============================================================

  /**
   * 中文欄名與資料庫欄位名稱的對應表。
   * 用於 Excel 匯入時將中文表頭轉換為資料庫欄位。
   * @type {Object<string, string>}
   */
  var EXCEL_COLUMN_MAP = {
    '財產編號': 'assetCode',
    '品名': 'name',
    '類別': 'category',
    '狀態': 'condition',
    '規格': 'spec',
    '存放位置': 'location',
    '配發人員': 'assignedTo',
    '取得日期': 'acquiredDate',
    '到期日期': 'expiryDate',
    '備註': 'notes'
  };

  // ============================================================
  // 1. 初始化與路由
  // ============================================================

  /**
   * 應用程式初始化入口。
   * 初始化資料庫、綁定所有事件監聽、根據 URL hash 導航至對應頁面。
   *
   * @returns {Promise<void>}
   */
  /**
   * 應用程式初始化入口。
   * 初始化資料庫、檢查登入狀態。
   *
   * @returns {Promise<void>}
   */
  async function init() {
    try {
      logger.info('[App] 開始初始化應用程式');

      // 初始化主題
      var savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light') {
        document.body.classList.add('theme-light');
      }

      await DB.initDB();
      logger.info('[App] 資料庫初始化完成');

      await loadAndRenderBranches();

      bindLoginEvents();

      // 檢查登入狀態
      var isLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
      if (isLoggedIn) {
        showMainApp();
      } else {
        showLoginApp();
      }

      logger.info('[App] 應用程式初始化入口執行完成');
    } catch (error) {
      logger.error('[App] 初始化失敗：', error.message);
      Utils.showToast('系統初始化失敗：' + error.message, 'error');
    }
  }

  /**
   * 載入並渲染分隊下拉選單及管理清單。
   */
  async function loadAndRenderBranches() {
    try {
      var branches = await DB.getSetting('branches');
      if (!branches || !Array.isArray(branches)) {
        branches = ["雙福分隊", "三和分隊"];
        await DB.setSetting('branches', branches);
      }

      // 1. 渲染登入介面分隊下拉選單
      var loginBranchSelect = document.getElementById('login-branch');
      if (loginBranchSelect) {
        var loginHtml = '';
        for (var i = 0; i < branches.length; i++) {
          loginHtml += '<option value="' + Utils.escapeHtml(branches[i]) + '">' + Utils.escapeHtml(branches[i]) + '</option>';
        }
        loginHtml += '<option value="admin">系統管理員 (admin)</option>';
        loginBranchSelect.innerHTML = loginHtml;
      }

      // 2. 渲染管理員側邊欄分隊切換選單
      var switcherSelect = document.getElementById('admin-branch-switcher');
      if (switcherSelect) {
        var switcherHtml = '<option value="admin">所有分隊</option>';
        for (var j = 0; j < branches.length; j++) {
          switcherHtml += '<option value="' + Utils.escapeHtml(branches[j]) + '">' + Utils.escapeHtml(branches[j]) + '</option>';
        }
        switcherSelect.innerHTML = switcherHtml;
      }

      // 3. 渲染設定頁面的分隊管理列表
      renderBranchSettingsList(branches);

    } catch (err) {
      logger.error('[App] 載入分隊清單失敗：', err.message);
    }
  }

  /**
   * 渲染設定頁面的分隊清單。
   *
   * @param {Array<string>} branches - 分隊名稱陣列
   */
  function renderBranchSettingsList(branches) {
    var listContainer = document.getElementById('branch-list');
    if (!listContainer) return;

    var html = '';
    for (var i = 0; i < branches.length; i++) {
      var branchName = branches[i];
      html +=
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;">' +
          '<span style="font-weight:600;color:var(--text-primary);">' + Utils.escapeHtml(branchName) + '</span>' +
          '<button class="btn btn-sm btn-ghost btn-danger" data-action="delete-branch" data-branch="' + Utils.escapeHtml(branchName) + '" title="刪除分隊" style="padding:4px 8px;">' +
            '<i data-lucide="trash-2" style="width:16px;height:16px;"></i>' +
          '</button>' +
        '</div>';
    }
    listContainer.innerHTML = html;
    
    // 刷新圖示
    if (typeof refreshIcons === 'function') {
      refreshIcons();
    }

    // 綁定刪除按鈕事件
    var deleteBtns = listContainer.querySelectorAll('[data-action="delete-branch"]');
    for (var j = 0; j < deleteBtns.length; j++) {
      deleteBtns[j].addEventListener('click', async function () {
        var targetBranch = this.getAttribute('data-branch');
        if (!targetBranch) return;

        if (confirm('確定要刪除「' + targetBranch + '」嗎？\n注意：這只會從選單中移除該分隊，資料庫中的現有數據不會被刪除。')) {
          try {
            var currentBranches = await DB.getSetting('branches') || [];
            var index = currentBranches.indexOf(targetBranch);
            if (index > -1) {
              currentBranches.splice(index, 1);
              await DB.setSetting('branches', currentBranches);
              Utils.showToast('分隊已刪除', 'success');
              await loadAndRenderBranches();
            }
          } catch (err) {
            Utils.showToast('刪除分隊失敗：' + err.message, 'error');
          }
        }
      });
    }
  }

  /**
   * 顯示登入畫面。
   */
  function showLoginApp() {
    var loginOverlay = document.getElementById('login-overlay');
    var appLayout = document.getElementById('app-layout');
    if (loginOverlay) loginOverlay.style.display = 'flex';
    if (appLayout) appLayout.style.display = 'none';
  }

  /**
   * 顯示主要內容區。
   */
  async function showMainApp() {
    var loginOverlay = document.getElementById('login-overlay');
    var appLayout = document.getElementById('app-layout');
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appLayout) appLayout.style.display = 'flex';

    // 設定側邊欄資訊
    var branch = sessionStorage.getItem('currentBranch') || '雙福分隊';
    var role = sessionStorage.getItem('userRole') || 'viewer';
    
    var branchNameEl = document.getElementById('sidebar-branch-name');
    var roleNameEl = document.getElementById('sidebar-role-name');
    
    if (branchNameEl) {
      branchNameEl.textContent = branch === 'admin' ? '系統管理員' : branch;
    }
    if (roleNameEl) {
      roleNameEl.textContent = role === 'editor' ? '管理權限 (可讀寫)' : '唯讀權限';
    }

    // 處理管理員切換器
    var switcherContainer = document.getElementById('admin-branch-switcher-container');
    var switcher = document.getElementById('admin-branch-switcher');
    if (switcherContainer && switcher) {
      if (sessionStorage.getItem('currentBranch') === 'admin' || (branch === 'admin' && role === 'editor')) {
        switcherContainer.style.display = 'block';
        switcher.value = sessionStorage.getItem('currentBranch') || 'admin';
      } else {
        switcherContainer.style.display = 'none';
      }
    }

    if (!isEventsBound) {
      bindNavigation();
      bindMobileSidebar();
      bindThemeEvents();
      bindAssetEvents();
      bindPersonnelEvents();
      bindSettingsEvents();
      bindLightboxEvents();
      bindImportEvents();
      isEventsBound = true;
    }

    // 根據 URL hash 決定初始頁面
    var hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash, true);

    // 監聽 hashchange 事件
    if (!window.hasHashListener) {
      window.addEventListener('hashchange', function () {
        var page = window.location.hash.replace('#', '') || 'dashboard';
        navigateTo(page);
      });
      window.hasHashListener = true;
    }

    applyRolePermissions();
  }

  /**
   * 登入與登出事件綁定。
   */
  function bindLoginEvents() {
    var loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        
        var branchSelect = document.getElementById('login-branch');
        var passwordInput = document.getElementById('login-password');
        
        if (!branchSelect || !passwordInput) return;
        
        var selectedBranch = branchSelect.value;
        var enteredPassword = passwordInput.value;
        
        // 讀取密碼設定
        var passwords = await DB.getSetting('passwords') || { admin: 'admin', login: '12345678', readonly: '12345678' };
        
        var loginSuccess = false;
        var currentBranch = selectedBranch;
        var userRole = 'viewer';
        
        // 1. 管理員密碼或萬能密碼 'admin'
        if (enteredPassword === 'admin' || enteredPassword === passwords.admin) {
          loginSuccess = true;
          userRole = 'editor';
        } 
        // 2. 實體分隊的登陸密碼 (可讀寫)
        else if (selectedBranch !== 'admin' && enteredPassword === passwords.login) {
          loginSuccess = true;
          userRole = 'editor';
        }
        // 3. 實體分隊的唯讀密碼
        else if (selectedBranch !== 'admin' && enteredPassword === passwords.readonly) {
          loginSuccess = true;
          userRole = 'viewer';
        }
        
        if (loginSuccess) {
          sessionStorage.setItem('isLoggedIn', 'true');
          sessionStorage.setItem('currentBranch', currentBranch);
          sessionStorage.setItem('userRole', userRole);
          
          passwordInput.value = '';
          Utils.showToast('登入成功！', 'success');
          showMainApp();
        } else {
          Utils.showToast('密碼錯誤，請重新輸入！', 'error');
        }
      });
    }

    // 登出按鈕
    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        sessionStorage.clear();
        Utils.showToast('已登出系統', 'info');
        showLoginApp();
      });
    }

    // 管理員切換分隊事件
    var switcher = document.getElementById('admin-branch-switcher');
    if (switcher) {
      switcher.addEventListener('change', function () {
        var newBranch = this.value;
        sessionStorage.setItem('currentBranch', newBranch);
        Utils.showToast('已切換檢視至：' + (newBranch === 'admin' ? '所有分隊' : newBranch), 'success');
        navigateTo(currentPage, true);
      });
    }
  }

  /**
   * 根據使用者角色限制 UI 操作權限。
   */
  function applyRolePermissions() {
    var role = sessionStorage.getItem('userRole') || 'viewer';
    var els = document.querySelectorAll('#btn-add-asset, #btn-import-excel, #btn-add-personnel, #btn-export-json, #btn-import-json, #btn-confirm-import, [data-action="edit"], [data-action="delete"]');
    var btnSavePasswords = document.getElementById('btn-save-passwords');
    
    if (role === 'viewer') {
      for (var i = 0; i < els.length; i++) {
        els[i].style.display = 'none';
      }
      if (btnSavePasswords) btnSavePasswords.style.display = 'none';
    } else {
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = '';
      }
      if (btnSavePasswords) btnSavePasswords.style.display = 'block';
    }

    // 分隊管理卡片權限控制：僅限管理員(admin)登入且具備編輯權限時顯示
    var cardBranchSettings = document.getElementById('card-branch-settings');
    var currentBranch = sessionStorage.getItem('currentBranch') || '';
    if (cardBranchSettings) {
      if (currentBranch === 'admin' && role === 'editor') {
        cardBranchSettings.style.display = 'block';
      } else {
        cardBranchSettings.style.display = 'none';
      }
    }
  }

  /**
   * 綁定側邊欄導航項目的 click 事件。
   */
  function bindNavigation() {
    var navItems = document.querySelectorAll('.nav-item[data-page]');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener('click', function (e) {
        e.preventDefault();
        var page = this.getAttribute('data-page');
        if (page) {
          navigateTo(page);
          try {
            window.location.hash = page;
          } catch (hErr) {
            logger.warn('[App] 更新 Hash 失敗：', hErr.message);
          }
        }
      });
    }
    logger.info('[App] 導航事件綁定完成');
  }

  /**
   * 綁定手機版 sidebar toggle 按鈕事件。
   * 切換 sidebar 的顯示狀態。
   */
  function bindMobileSidebar() {
    var hamburger = document.getElementById('sidebar-toggle');
    if (hamburger) {
      hamburger.addEventListener('click', function () {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar) {
          sidebar.classList.toggle('mobile-open');
        }
      });
    }

    // 點擊背景遮罩關閉側邊欄
    var backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar) {
          sidebar.classList.remove('mobile-open');
        }
      });
    }

    // 點擊導航項目後在手機版自動收起 sidebar
    var navItems = document.querySelectorAll('.nav-item[data-page]');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener('click', function () {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar && window.innerWidth <= 1024) {
          sidebar.classList.remove('mobile-open');
        }
      });
    }
  }

  /**
   * 綁定主題切換事件。
   */
  function bindThemeEvents() {
    var btn = document.getElementById('btn-theme-toggle');
    if (!btn) {
      return;
    }

    btn.addEventListener('click', function () {
      var isLight = document.body.classList.contains('theme-light');
      if (isLight) {
        document.body.classList.remove('theme-light');
        localStorage.setItem('theme', 'dark');
        updateThemeUI(false);
      } else {
        document.body.classList.add('theme-light');
        localStorage.setItem('theme', 'light');
        updateThemeUI(true);
      }
    });

    // 初始化 UI 狀態
    var isInitiallyLight = document.body.classList.contains('theme-light');
    updateThemeUI(isInitiallyLight);
  }

  /**
   * 更新主題按鈕的文字狀態。
   * @param {boolean} isLight - 是否為淺色模式
   */
  function updateThemeUI(isLight) {
    var textEl = document.querySelector('#btn-theme-toggle .theme-text');
    if (textEl) {
      textEl.textContent = isLight ? '深色模式' : '淺色模式';
    }
  }

  /**
   * 路由導航函數。
   * 切換頁面容器的 hidden 屬性，更新導航項目的 active 狀態，
   * 並呼叫對應頁面的渲染函數。
   *
   * @param {string} page - 目標頁面名稱（dashboard / assets / personnel / settings）
   */
  function navigateTo(page, force) {
    var validPages = ['dashboard', 'assets', 'personnel', 'settings'];
    if (validPages.indexOf(page) === -1) {
      page = 'dashboard';
    }

    // 避免重複導航與渲染
    if (!force && currentPage === page) {
      var targetPage = document.getElementById('page-' + page);
      if (targetPage && !targetPage.classList.contains('hidden')) {
        return;
      }
    }

    currentPage = page;

    // 切換頁面容器 hidden 與 class 狀態
    var pageContainers = document.querySelectorAll('.page-container');
    for (var i = 0; i < pageContainers.length; i++) {
      pageContainers[i].hidden = true;
      pageContainers[i].classList.add('hidden');
    }
    var targetPage = document.getElementById('page-' + page);
    if (targetPage) {
      targetPage.hidden = false;
      targetPage.classList.remove('hidden');
    }

    // 更新 nav-item active 狀態
    var navItems = document.querySelectorAll('.nav-item[data-page]');
    for (var j = 0; j < navItems.length; j++) {
      navItems[j].classList.remove('active');
      if (navItems[j].getAttribute('data-page') === page) {
        navItems[j].classList.add('active');
      }
    }

    // 呼叫對應的渲染函數
    switch (page) {
      case 'dashboard':
        renderDashboard();
        break;
      case 'assets':
        renderAssetsPage();
        break;
      case 'personnel':
        // 切換頁面時清空人員選取狀態
        selectedPersonnelIds = [];
        renderPersonnelPage();
        break;
      case 'settings':
        renderSettingsPage();
        break;
    }

    applyRolePermissions();
    logger.info('[App] 導航至頁面：', page);
  }

  // ============================================================
  // 2. 儀表板模組
  // ============================================================

  /**
   * 渲染儀表板頁面。
   * 呼叫 getDashboardStats() 取得統計資料，填入各統計卡片數值、
   * 類別分布圖與到期清單。
   *
   * @returns {Promise<void>}
   */
  async function renderDashboard() {
    try {
      var stats = await DB.getDashboardStats();

      // 填入統計卡片數值
      setTextContent('stat-total-assets', stats.totalAssets || 0);
      setTextContent('stat-active-personnel', stats.totalPersonnel || 0);
      setTextContent('stat-repair-count',
        (stats.conditionBreakdown && stats.conditionBreakdown['待修']) || 0
      );
      setTextContent('stat-expiring-count',
        (stats.expiringAssets && stats.expiringAssets.length) || 0
      );

      // 渲染類別分布圖已不需要
      // renderCategoryChart(stats.categoryBreakdown || {});

      var personnelMap = await buildPersonnelMap();

      // 渲染即將到期與已到期清單
      renderExpiringTable(stats.expiringAssets || [], personnelMap);
      renderExpiredTable(stats.expiredAssets || [], personnelMap);

      refreshIcons();
      logger.info('[App] 儀表板渲染完成');
    } catch (error) {
      logger.error('[App] 儀表板渲染失敗：', error.message);
      Utils.showToast('儀表板載入失敗：' + error.message, 'error');
    }
  }

  /**
   * 渲染類別分布水平長條圖。
   * 計算各類別的百分比寬度，以 div 方式呈現。
   *
   * @param {Object<string, number>} byCategory - 類別與數量的對應物件
   */
  function renderCategoryChart(byCategory) {
    var container = document.getElementById('category-chart');
    if (!container) {
      return;
    }

    var keys = Object.keys(byCategory);
    if (keys.length === 0) {
      container.innerHTML =
        '<div style="text-align:center;color:var(--text-secondary);padding:20px;">' +
        '尚無財產資料' +
        '</div>';
      return;
    }

    // 找出最大值作為百分比基準
    var maxVal = 0;
    for (var k = 0; k < keys.length; k++) {
      if (byCategory[keys[k]] > maxVal) {
        maxVal = byCategory[keys[k]];
      }
    }

    var barColors = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
    ];

    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var catName = keys[i];
      var count = byCategory[catName];
      var pct = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
      var color = barColors[i % barColors.length];

      html +=
        '<div class="chart-bar-row" style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
          '<span class="chart-label" style="min-width:80px;font-size:13px;color:var(--text-secondary);text-align:right;">' +
            Utils.escapeHtml(catName) +
          '</span>' +
          '<div class="chart-bar-track" style="flex:1;height:24px;background:var(--bg-secondary);border-radius:6px;overflow:hidden;">' +
            '<div class="chart-bar-fill" style="width:' + pct + '%;height:100%;background:' + color +
              ';border-radius:6px;transition:width 0.6s ease;min-width:' + (count > 0 ? '2px' : '0') + ';"></div>' +
          '</div>' +
          '<span class="chart-count" style="min-width:32px;font-size:13px;font-weight:600;color:var(--text-primary);">' +
            count +
          '</span>' +
        '</div>';
    }

    container.innerHTML = html;
  }

  /**
   * 渲染到期清單表格。
   * 顯示 30 天內即將到期的財產列表。
   *
   * @param {Array<Object>} expiringSoon - 即將到期的財產陣列
   */
  function renderExpiringTable(expiringSoon, personnelMap) {
    var tbody = document.querySelector('#expiring-table tbody');
    var emptyEl = document.getElementById('expiring-empty');
    if (!tbody) {
      return;
    }

    if (expiringSoon.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:20px;">' +
        '30 天內無到期財產' +
        '</td></tr>';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    var html = '';
    for (var i = 0; i < expiringSoon.length; i++) {
      var asset = expiringSoon[i];
      
      // 日期推算 fallback
      var expiryToShow = asset.expiryDate;
      if (!expiryToShow && asset.acquiredDate) {
        try {
          var date = new Date(asset.acquiredDate);
          if (!isNaN(date.getTime())) {
            date.setFullYear(date.getFullYear() + 5);
            expiryToShow = date.toISOString().slice(0, 10);
          }
        } catch (e) {}
      }

      var daysLeft = Utils.daysFromNow(expiryToShow);
      var expiryDisplay = expiryToShow ? Utils.formatMinguoDate(expiryToShow) : '-';
      var urgencyClass = daysLeft <= 7 ? 'color:#dc2626;font-weight:600;' : 'color:#d97706;';

      var assignedName = '未配發';
      if (asset.assignedTo && personnelMap && personnelMap[asset.assignedTo]) {
        assignedName = personnelMap[asset.assignedTo];
      }

      html +=
        '<tr>' +
          '<td>' + Utils.escapeHtml(asset.assetCode || '-') + '</td>' +
          '<td title="配發人員：' + Utils.escapeHtml(assignedName) + '" style="cursor:help;">' + Utils.escapeHtml(asset.name || '-') + '</td>' +
          '<td>' + Utils.escapeHtml(expiryDisplay) + '</td>' +
          '<td style="' + urgencyClass + '">' + daysLeft + ' 天</td>' +
        '</tr>';
    }

    tbody.innerHTML = html;
  }

  /**
   * 渲染已到期清單表格。
   *
   * @param {Array<Object>} expired - 已到期的財產陣列
   */
  function renderExpiredTable(expired, personnelMap) {
    var tbody = document.querySelector('#expired-table tbody');
    var emptyEl = document.getElementById('expired-empty');
    if (!tbody) {
      return;
    }

    if (expired.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:var(--text-secondary);padding:20px;">' +
        '無已到期財產' +
        '</td></tr>';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    var html = '';
    for (var i = 0; i < expired.length; i++) {
      var asset = expired[i];
      
      // 日期推算 fallback
      var expiryToShow = asset.expiryDate;
      if (!expiryToShow && asset.acquiredDate) {
        try {
          var date = new Date(asset.acquiredDate);
          if (!isNaN(date.getTime())) {
            date.setFullYear(date.getFullYear() + 5);
            expiryToShow = date.toISOString().slice(0, 10);
          }
        } catch (e) {}
      }

      // 計算逾期天數 (已過期天數為正數)
      var daysLeft = Utils.daysFromNow(expiryToShow);
      var daysExpired = Math.abs(daysLeft);
      var expiryDisplay = expiryToShow ? Utils.formatMinguoDate(expiryToShow) : '-';

      var assignedName = '未配發';
      if (asset.assignedTo && personnelMap && personnelMap[asset.assignedTo]) {
        assignedName = personnelMap[asset.assignedTo];
      }

      html +=
        '<tr>' +
          '<td>' + Utils.escapeHtml(asset.assetCode || '-') + '</td>' +
          '<td title="配發人員：' + Utils.escapeHtml(assignedName) + '" style="cursor:help;">' + Utils.escapeHtml(asset.name || '-') + '</td>' +
          '<td>' + Utils.escapeHtml(expiryDisplay) + '</td>' +
          '<td style="color:#dc2626;font-weight:600;">已逾期 ' + daysExpired + ' 天</td>' +
        '</tr>';
    }

    tbody.innerHTML = html;
  }

  // ============================================================
  // 3. 財產管理模組
  // ============================================================

  /**
   * 綁定財產管理頁面的所有事件。
   * 包含新增按鈕、匯入按鈕、搜尋輸入、篩選下拉、Modal overlay 關閉等。
   */
  function bindAssetEvents() {
    // 新增財產按鈕
    var btnAdd = document.getElementById('btn-add-asset');
    if (btnAdd) {
      btnAdd.addEventListener('click', function () {
        openAssetModal();
      });
    }

    // 匯入 Excel 按鈕
    var btnImport = document.getElementById('btn-import-excel');
    if (btnImport) {
      btnImport.addEventListener('click', function () {
        openImportModal();
      });
    }

    // 搜尋輸入（防抖與 Enter 立即觸發）
    var searchInput = document.querySelector('#asset-search');
    if (searchInput) {
      var searchTimer = null;
      var triggerSearch = function () {
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = null;
        }
        loadAssets();
      };

      searchInput.addEventListener('input', function () {
        if (searchTimer) {
          clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(triggerSearch, DEBOUNCE_DELAY);
      });

      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerSearch();
        }
      });
    }

    // 篩選下拉
    var filterCategory = document.getElementById('filter-category');
    var filterCondition = document.getElementById('filter-condition');
    var filterAssigned = document.getElementById('filter-assigned');

    if (filterCategory) {
      filterCategory.addEventListener('change', function () { loadAssets(); });
    }
    if (filterCondition) {
      filterCondition.addEventListener('change', function () { loadAssets(); });
    }
    if (filterAssigned) {
      filterAssigned.addEventListener('change', function () { loadAssets(); });
    }

    // 儲存財產按鈕
    var btnSave = document.getElementById('btn-save-asset');
    if (btnSave) {
      btnSave.addEventListener('click', function (e) {
        e.preventDefault();
        saveAsset();
      });
    }

    // 匯出當前清單 PDF 按鈕
    var btnExportAssetsPdf = document.getElementById('btn-export-assets-pdf');
    if (btnExportAssetsPdf) {
      btnExportAssetsPdf.addEventListener('click', function () {
        exportAssetsPdf();
      });
    }

    // 連動計算購置日期 + 使用年限 = 到期日期
    var assetAcquired = document.getElementById('asset-acquired');
    var assetLifespan = document.getElementById('asset-lifespan');
    if (assetAcquired && assetLifespan) {
      var autoCalculateExpiry = function () {
        var acquiredVal = assetAcquired.value;
        var lifespanVal = parseInt(assetLifespan.value, 10);
        if (acquiredVal && !isNaN(lifespanVal) && lifespanVal > 0) {
          var date = new Date(acquiredVal);
          date.setFullYear(date.getFullYear() + lifespanVal);
          document.getElementById('asset-expiry').value = date.toISOString().slice(0, 10);
        }
      };
      assetAcquired.addEventListener('change', autoCalculateExpiry);
      assetLifespan.addEventListener('input', autoCalculateExpiry);
    }

    // 財產 Modal overlay 點擊關閉
    var assetOverlay = document.getElementById('asset-modal-overlay');
    if (assetOverlay) {
      assetOverlay.addEventListener('click', function (e) {
        if (e.target === assetOverlay) {
          Utils.closeModal('asset-modal-overlay');
          currentPhotos = [];
        }
      });
    }

    // 財產 Modal 關閉與取消按鈕
    var assetClose = document.getElementById('asset-modal-close');
    if (assetClose) {
      assetClose.addEventListener('click', function () {
        Utils.closeModal('asset-modal-overlay');
        currentPhotos = [];
      });
    }

    var assetCancel = document.getElementById('asset-modal-cancel');
    if (assetCancel) {
      assetCancel.addEventListener('click', function () {
        Utils.closeModal('asset-modal-overlay');
        currentPhotos = [];
      });
    }

    // 財產表格操作按鈕（事件委派）
    var assetsTbody = document.getElementById('assets-tbody');
    if (assetsTbody) {
      assetsTbody.addEventListener('click', function (e) {
        var target = e.target.closest('[data-action]');
        if (!target) {
          return;
        }
        var action = target.getAttribute('data-action');
        var id = parseInt(target.getAttribute('data-id'), 10);

        if (action === 'edit') {
          openAssetModal(id);
        } else if (action === 'delete') {
          deleteAsset(id);
        } else if (action === 'lightbox') {
          var src = target.getAttribute('data-src');
          if (src) {
            openLightbox(src);
          }
        }
      });

      // 財產表格就地編輯 (Inline Editing)
      assetsTbody.addEventListener('click', function (e) {
        var role = sessionStorage.getItem('userRole') || 'viewer';
        if (role !== 'editor') {
          return; // 唯讀使用者禁止就地編輯
        }

        var cellAssigned = e.target.closest('.inline-edit-assigned');
        var cellLocation = e.target.closest('.inline-edit-location');

        if (cellAssigned) {
          handleInlineEditAssigned(cellAssigned);
        } else if (cellLocation) {
          handleInlineEditLocation(cellLocation);
        }
      });
    }

    // 設定照片上傳
    setupPhotoUpload();
  }

  /**
   * 渲染財產管理頁面。
   * 載入篩選下拉選項並呼叫 loadAssets() 載入資料。
   *
   * @returns {Promise<void>}
   */
  async function renderAssetsPage() {
    try {
      // 填入類別篩選下拉
      await populateCategorySelect('filter-category', true);

      // 填入狀態篩選下拉
      populateConditionSelect('filter-condition', true);

      // 填入配發人員篩選下拉
      await populatePersonnelSelect('filter-assigned', true);

      // 載入財產列表
      await loadAssets();

      logger.info('[App] 財產頁面渲染完成');
    } catch (error) {
      logger.error('[App] 財產頁面渲染失敗：', error.message);
      Utils.showToast('財產頁面載入失敗：' + error.message, 'error');
    }
  }

  /**
   * 根據目前篩選條件載入財產資料並渲染表格。
   *
   * @returns {Promise<void>}
   */
  async function loadAssets() {
    try {
      var filters = {};

      var searchInput = document.querySelector('#asset-search');
      if (searchInput && searchInput.value.trim()) {
        filters.search = searchInput.value.trim();
      }

      var filterCategory = document.getElementById('filter-category');
      if (filterCategory && filterCategory.value) {
        filters.category = filterCategory.value;
      }

      var filterCondition = document.getElementById('filter-condition');
      if (filterCondition && filterCondition.value) {
        filters.condition = filterCondition.value;
      }

      var filterAssigned = document.getElementById('filter-assigned');
      if (filterAssigned && filterAssigned.value) {
        if (filterAssigned.value === 'unassigned') {
          filters.assignedTo = null;
        } else {
          filters.assignedTo = parseInt(filterAssigned.value, 10);
        }
      }

      var assets = await DB.getAllAssets(filters);
      var personnelMap = await buildPersonnelMap();
      activePersonnelList = await DB.getAllPersonnel({ status: '在職' });
      renderAssetsTable(assets, personnelMap);
    } catch (error) {
      logger.error('[App] 載入財產列表失敗：', error.message);
      Utils.showToast('載入財產列表失敗：' + error.message, 'error');
    }
  }

  /**
   * 渲染財產表格 tbody。
   * 每列顯示：財產編號、品名、類別、狀態 badge、配發人員名、照片縮圖、操作按鈕。
   *
   * @param {Array<Object>} assets - 財產陣列
   * @param {Object<number, string>} personnelMap - 人員 ID 與姓名的對應物件
   */
  function renderAssetsTable(assets, personnelMap) {
    var tbody = document.getElementById('assets-tbody');
    var emptyState = document.getElementById('assets-empty');

    if (!tbody) {
      return;
    }

    if (assets.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) {
        emptyState.classList.remove('hidden');
        emptyState.hidden = false;
      }
      return;
    }

    if (emptyState) {
      emptyState.classList.add('hidden');
      emptyState.hidden = true;
    }

    var html = '';
    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var assignedName = '-';
      if (asset.assignedTo && personnelMap[asset.assignedTo]) {
        assignedName = personnelMap[asset.assignedTo];
      }

      // 到期日期為空時自動用購置日期 + 5 年計算並顯示
      var expiryToShow = asset.expiryDate;
      if (!expiryToShow && asset.acquiredDate) {
        try {
          var date = new Date(asset.acquiredDate);
          if (!isNaN(date.getTime())) {
            date.setFullYear(date.getFullYear() + 5);
            expiryToShow = date.toISOString().slice(0, 10);
          }
        } catch (e) {
          expiryToShow = '';
        }
      }
      var expiryDisplay = expiryToShow ? Utils.formatMinguoDate(expiryToShow) : '';
      var acquiredDisplay = asset.acquiredDate ? Utils.formatMinguoDate(asset.acquiredDate) : '-';

      // 照片縮圖（僅顯示第一張）
      var photoHtml = '<span style="color:var(--text-secondary);font-size:12px;">-</span>';
      if (asset.photos && asset.photos.length > 0) {
        photoHtml =
          '<img src="' + asset.photos[0] + '" ' +
            'alt="財產照片" ' +
            'style="width:40px;height:40px;object-fit:cover;border-radius:6px;cursor:pointer;" ' +
            'data-action="lightbox" data-src="' + asset.photos[0] + '" data-id="' + asset.id + '" />';
      }

      var indexNum = i + 1;

      html +=
        '<tr>' +
          '<td style="text-align:center;font-weight:600;color:var(--text-secondary);">' + indexNum + '</td>' +
          '<td>' + Utils.escapeHtml(asset.assetCode || '-') + '</td>' +
          '<td title="配發人員：' + Utils.escapeHtml(assignedName === '-' ? '未配發' : assignedName) + '" style="cursor:help;">' + Utils.escapeHtml(asset.name || '-') + '</td>' +
          '<td>' + Utils.escapeHtml(asset.category || '-') + '</td>' +
          '<td class="inline-edit-assigned" data-id="' + asset.id + '" data-value="' + (asset.assignedTo || '') + '">' + Utils.escapeHtml(assignedName) + '</td>' +
          '<td style="text-align:center;">' + Utils.escapeHtml(acquiredDisplay) + '</td>' +
          '<td style="text-align:center;">' + Utils.escapeHtml(expiryDisplay) + '</td>' +
          '<td class="inline-edit-location" data-id="' + asset.id + '">' + Utils.escapeHtml(asset.location || '分隊') + '</td>' +
          '<td>' + photoHtml + '</td>' +
          '<td>' +
            '<div style="display:flex;gap:6px;">' +
              '<button class="btn btn-sm btn-ghost" data-action="edit" data-id="' + asset.id + '" title="編輯">' +
                '<i data-lucide="pencil" style="width:16px;height:16px;"></i>' +
              '</button>' +
              '<button class="btn btn-sm btn-ghost btn-danger" data-action="delete" data-id="' + asset.id + '" title="刪除">' +
                '<i data-lucide="trash-2" style="width:16px;height:16px;"></i>' +
              '</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
    }

    tbody.innerHTML = html;
    refreshIcons();
    applyRolePermissions();
  }

  /**
   * 開啟財產新增或編輯 Modal。
   * 編輯模式下填入現有資料。
   *
   * @param {number} [id] - 財產 ID（不傳則為新增模式）
   * @returns {Promise<void>}
   */
  async function openAssetModal(id) {
    try {
      var titleEl = document.getElementById('asset-modal-title');
      var form = document.getElementById('asset-form');
      var idField = document.getElementById('asset-id');

      if (form) {
        Utils.resetForm(form);
      }
      currentPhotos = [];

      // 載入人員下拉選單
      await populatePersonnelSelect('asset-assigned', false);

      // 載入類別下拉選單
      await populateCategorySelect('asset-category', false);

      // 載入狀態下拉選單
      populateConditionSelect('asset-condition', false);

      if (id) {
        // 編輯模式
        if (titleEl) {
          titleEl.textContent = '編輯財產';
        }

        var asset = await DB.getAssetById(id);
        if (!asset) {
          Utils.showToast('找不到該筆財產資料', 'error');
          return;
        }

        if (idField) { idField.value = asset.id; }
        setFieldValue('asset-code', asset.assetCode);
        setFieldValue('asset-name', asset.name);
        setFieldValue('asset-category', asset.category);
        setFieldValue('asset-condition', asset.condition);
        setFieldValue('asset-assigned', asset.assignedTo || '');
        setFieldValue('asset-location', asset.location);
        setFieldValue('asset-acquired', asset.acquiredDate);
        // 到期日期未填時，自動依據購置日期 + 使用年限（預設 5 年）計算填入編輯 Modal
        var calculatedExpiry = asset.expiryDate;
        if (!calculatedExpiry && asset.acquiredDate) {
          try {
            var date = new Date(asset.acquiredDate);
            if (!isNaN(date.getTime())) {
              date.setFullYear(date.getFullYear() + 5);
              calculatedExpiry = date.toISOString().slice(0, 10);
            }
          } catch (e) {}
        }
        setFieldValue('asset-expiry', calculatedExpiry);
        setFieldValue('asset-spec', asset.spec);
        setFieldValue('asset-notes', asset.notes);

        // 反推使用年限
        if (asset.acquiredDate && asset.expiryDate) {
          var acqYear = new Date(asset.acquiredDate).getFullYear();
          var expYear = new Date(asset.expiryDate).getFullYear();
          var lifespan = expYear - acqYear;
          setFieldValue('asset-lifespan', lifespan > 0 ? lifespan : 5);
        } else {
          setFieldValue('asset-lifespan', 5);
        }

        // 載入現有照片
        if (asset.photos && asset.photos.length > 0) {
          currentPhotos = asset.photos.slice();
        }
      } else {
        // 新增模式
        if (titleEl) {
          titleEl.textContent = '新增財產';
        }
        if (idField) { idField.value = ''; }
        setFieldValue('asset-lifespan', 5);
      }

      renderPhotoGrid();
      Utils.openModal('asset-modal-overlay');
    } catch (error) {
      logger.error('[App] 開啟財產 Modal 失敗：', error.message);
      Utils.showToast('開啟財產表單失敗：' + error.message, 'error');
    }
  }

  /**
   * 儲存財產資料（新增或更新）。
   * 收集表單資料與照片陣列，呼叫 DB.addAsset 或 DB.updateAsset。
   *
   * @returns {Promise<void>}
   */
  async function saveAsset() {
    try {
      var role = sessionStorage.getItem('userRole') || 'viewer';
      if (role !== 'editor') {
        Utils.showToast('權限不足，無法進行此操作！', 'error');
        return;
      }

      var idField = document.getElementById('asset-id');
      var id = idField && idField.value ? parseInt(idField.value, 10) : null;

      var data = {
        assetCode: getFieldValue('asset-code'),
        name: getFieldValue('asset-name'),
        category: getFieldValue('asset-category'),
        condition: getFieldValue('asset-condition'),
        assignedTo: getFieldValue('asset-assigned') ? parseInt(getFieldValue('asset-assigned'), 10) : null,
        location: getFieldValue('asset-location'),
        acquiredDate: getFieldValue('asset-acquired'),
        expiryDate: getFieldValue('asset-expiry'),
        spec: getFieldValue('asset-spec'),
        notes: getFieldValue('asset-notes'),
        photos: currentPhotos.slice()
      };

      if (!data.name || !data.name.trim()) {
        Utils.showToast('品名為必填欄位', 'warning');
        return;
      }

      if (id) {
        await DB.updateAsset(id, data);
        Utils.showToast('財產已更新', 'success');
      } else {
        await DB.addAsset(data);
        Utils.showToast('財產已新增', 'success');
      }

      Utils.closeModal('asset-modal-overlay');
      currentPhotos = [];
      await loadAssets();

      // 若在儀表板，同步更新
      if (currentPage === 'dashboard') {
        await renderDashboard();
      }
    } catch (error) {
      logger.error('[App] 儲存財產失敗：', error.message);
      Utils.showToast('儲存失敗：' + error.message, 'error');
    }
  }

  /**
   * 刪除指定 ID 的財產。
   * 先顯示確認對話框，確認後呼叫 DB.deleteAsset。
   *
   * @param {number} id - 財產 ID
   * @returns {Promise<void>}
   */
  async function deleteAsset(id) {
    try {
      var role = sessionStorage.getItem('userRole') || 'viewer';
      if (role !== 'editor') {
        Utils.showToast('權限不足，無法進行此操作！', 'error');
        return;
      }

      var confirmed = await Utils.showConfirm(
        '刪除財產',
        '確定要刪除此筆財產資料嗎？此操作無法復原。',
        { confirmText: '刪除', confirmStyle: 'danger' }
      );

      if (!confirmed) {
        return;
      }

      await DB.deleteAsset(id);
      Utils.showToast('財產已刪除', 'success');
      await loadAssets();

      if (currentPage === 'dashboard') {
        await renderDashboard();
      }
    } catch (error) {
      logger.error('[App] 刪除財產失敗：', error.message);
      Utils.showToast('刪除失敗：' + error.message, 'error');
    }
  }

  // ============================================================
  // 4. 照片處理模組
  // ============================================================

  /**
   * 設定照片上傳區域的事件綁定。
   * 包含拖放、點擊觸發檔案選擇、file input change 事件。
   */
  function setupPhotoUpload() {
    var uploadZone = document.getElementById('photo-upload-zone');
    var photoInput = document.getElementById('photo-input');

    if (uploadZone && photoInput) {
      // 點擊上傳區域觸發檔案選擇
      uploadZone.addEventListener('click', function () {
        photoInput.click();
      });

      // 拖曳事件
      uploadZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.add('drag-over');
      });

      uploadZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('drag-over');
      });

      uploadZone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
          addPhotos(e.dataTransfer.files);
        }
      });

      // file input change
      photoInput.addEventListener('change', function () {
        if (photoInput.files && photoInput.files.length > 0) {
          addPhotos(photoInput.files);
          photoInput.value = '';
        }
      });
    }
  }

  /**
   * 壓縮並加入照片到暫存陣列。
   * 每張照片會顯示壓縮中的 loading 提示。
   *
   * @param {FileList} files - 使用者選取的檔案列表
   * @returns {Promise<void>}
   */
  async function addPhotos(files) {
    try {
      Utils.showToast('正在處理照片，請稍候...', 'info', 2000);

      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) {
          Utils.showToast('「' + file.name + '」不是圖片檔案，已跳過', 'warning');
          continue;
        }

        var base64 = await Utils.compressImage(file);
        currentPhotos.push(base64);
      }

      renderPhotoGrid();
      Utils.showToast('照片已加入', 'success');
    } catch (error) {
      logger.error('[App] 照片處理失敗：', error.message);
      Utils.showToast('照片處理失敗：' + error.message, 'error');
    }
  }

  /**
   * 從暫存陣列移除指定索引的照片。
   *
   * @param {number} index - 照片在 currentPhotos 中的索引
   */
  function removePhoto(index) {
    if (index >= 0 && index < currentPhotos.length) {
      currentPhotos.splice(index, 1);
      renderPhotoGrid();
    }
  }

  /**
   * 渲染照片預覽網格。
   * 每張照片包含縮圖與移除按鈕。
   */
  function renderPhotoGrid() {
    var grid = document.getElementById('photo-grid');
    if (!grid) {
      return;
    }

    if (currentPhotos.length === 0) {
      grid.innerHTML = '';
      return;
    }

    var html = '';
    for (var i = 0; i < currentPhotos.length; i++) {
      html +=
        '<div class="photo-item" style="position:relative;display:inline-block;margin:4px;">' +
          '<img src="' + currentPhotos[i] + '" ' +
            'alt="照片 ' + (i + 1) + '" ' +
            'style="width:80px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;" ' +
            'onclick="window.App.openLightbox(this.src)" />' +
          '<button type="button" class="photo-remove-btn" ' +
            'onclick="window.App.removePhoto(' + i + ')" ' +
            'style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;' +
              'background:#dc2626;color:#fff;border:2px solid #fff;cursor:pointer;' +
              'display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;padding:0;">' +
            '&times;' +
          '</button>' +
        '</div>';
    }

    grid.innerHTML = html;
  }

  /**
   * 開啟 lightbox 大圖檢視。
   *
   * @param {string} src - 圖片來源（base64 或 URL）
   */
  function openLightbox(src) {
    var overlay = document.getElementById('lightbox-overlay');
    var img = document.getElementById('lightbox-img');

    if (overlay && img) {
      img.src = src;
      overlay.classList.add('active');
      overlay.style.display = 'flex';
    }
  }

  /**
   * 綁定 lightbox 關閉事件。
   * 點擊 overlay 時關閉 lightbox。
   */
  function bindLightboxEvents() {
    var overlay = document.getElementById('lightbox-overlay');
    if (overlay) {
      overlay.addEventListener('click', function () {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
        var img = document.getElementById('lightbox-img');
        if (img) {
          img.src = '';
        }
      });
    }
  }

  // ============================================================
  // 5. Excel 匯入模組
  // ============================================================

  /**
   * 綁定 Excel 匯入相關事件。
   */
  function bindImportEvents() {
    // 下載範本按鈕
    var btnTemplate = document.getElementById('btn-download-template');
    if (btnTemplate) {
      btnTemplate.addEventListener('click', function () {
        downloadTemplate();
      });
    }

    // 確認匯入按鈕
    var btnConfirm = document.getElementById('btn-confirm-import');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', function () {
        confirmImport();
      });
    }

    // 匯入 Modal overlay 點擊關閉
    var importOverlay = document.getElementById('import-modal-overlay');
    if (importOverlay) {
      importOverlay.addEventListener('click', function (e) {
        if (e.target === importOverlay) {
          Utils.closeModal('import-modal-overlay');
        }
      });
    }

    // 匯入 Modal 關閉與取消按鈕
    var importClose = document.getElementById('import-modal-close');
    if (importClose) {
      importClose.addEventListener('click', function () {
        Utils.closeModal('import-modal-overlay');
      });
    }

    var importCancel = document.getElementById('import-modal-cancel');
    if (importCancel) {
      importCancel.addEventListener('click', function () {
        Utils.closeModal('import-modal-overlay');
      });
    }

    // 設定 Excel 上傳
    setupExcelUpload();
  }

  /**
   * 設定 Excel 檔案上傳區域的事件綁定。
   * 包含拖放與 file input change 事件。
   */
  function setupExcelUpload() {
    var dropZone = document.getElementById('excel-drop-zone');
    var excelInput = document.getElementById('excel-input');

    if (dropZone && excelInput) {
      dropZone.addEventListener('click', function () {
        excelInput.click();
      });

      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleExcelFile(e.dataTransfer.files[0]);
        }
      });

      excelInput.addEventListener('change', function () {
        if (excelInput.files && excelInput.files.length > 0) {
          handleExcelFile(excelInput.files[0]);
          excelInput.value = '';
        }
      });
    }
  }

  /**
   * 開啟 Excel 匯入 Modal。
   * 重置內部狀態並切換至上傳步驟。
   */
  function openImportModal() {
    importParsedRows = [];
    importValidRows = [];
    importErrorCount = 0;

    // 顯示上傳步驟，隱藏預覽步驟
    var stepUpload = document.getElementById('import-step-upload');
    var stepPreview = document.getElementById('import-step-preview');
    if (stepUpload) {
      stepUpload.classList.remove('hidden');
      stepUpload.hidden = false;
    }
    if (stepPreview) {
      stepPreview.classList.add('hidden');
      stepPreview.hidden = true;
    }

    var btnConfirm = document.getElementById('btn-confirm-import');
    if (btnConfirm) {
      btnConfirm.setAttribute('disabled', 'true');
    }

    Utils.openModal('import-modal-overlay');
  }

  /**
   * 處理使用者上傳的 Excel 檔案。
   * 解析檔案內容，對應欄位名稱，驗證必填欄位，
   * 並切換至預覽步驟顯示解析結果。
   *
   * @param {File} file - 使用者選取的 Excel 檔案
   * @returns {Promise<void>}
   */
  async function handleExcelFile(file) {
    try {
      if (typeof XLSX === 'undefined') {
        Utils.showToast('XLSX 函式庫尚未載入，無法匯入 Excel', 'error');
        return;
      }

      Utils.showToast('正在解析 Excel 檔案...', 'info', 2000);

      var arrayBuffer = await readFileAsArrayBuffer(file);
      var workbook = XLSX.read(arrayBuffer, { type: 'array' });

      // 取第一個 sheet
      var sheetName = workbook.SheetNames[0];
      var sheet = workbook.Sheets[sheetName];
      var jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (jsonRows.length === 0) {
        Utils.showToast('Excel 檔案中無任何資料', 'warning');
        return;
      }

      // 取得所有人員以供名稱比對
      var allPersonnel = await DB.getAllPersonnel();
      var personnelNameMap = {};
      for (var p = 0; p < allPersonnel.length; p++) {
        personnelNameMap[allPersonnel[p].name] = allPersonnel[p].id;
      }

      // 欄位對應與驗證
      importParsedRows = [];
      importValidRows = [];
      importErrorCount = 0;

      for (var i = 0; i < jsonRows.length; i++) {
        var raw = jsonRows[i];
        var mapped = {};
        var errors = [];

        // 將中文欄名轉為資料庫欄位名
        var rawKeys = Object.keys(raw);
        for (var k = 0; k < rawKeys.length; k++) {
          var chineseName = rawKeys[k].trim();
          var dbField = EXCEL_COLUMN_MAP[chineseName];
          if (dbField) {
            mapped[dbField] = String(raw[rawKeys[k]]).trim();
          }
        }

        // 處理配發人員：依名稱比對為人員 ID
        if (mapped.assignedTo) {
          var matchedId = personnelNameMap[mapped.assignedTo];
          if (matchedId) {
            mapped.assignedTo = matchedId;
          } else {
            errors.push('找不到人員「' + mapped.assignedTo + '」');
            mapped.assignedTo = null;
          }
        } else {
          mapped.assignedTo = null;
        }

        // 處理狀態：若為「良好」或「正常」自動轉換為「堪用」；若填寫其他無效狀態則報錯
        if (mapped.condition) {
          mapped.condition = mapped.condition.trim();
          if (mapped.condition === '良好' || mapped.condition === '正常') {
            mapped.condition = '堪用';
          }
          if (DB.ASSET_CONDITIONS.indexOf(mapped.condition) === -1) {
            errors.push('無效的狀態「' + mapped.condition + '」，僅支援：' + DB.ASSET_CONDITIONS.join('、'));
          }
        } else {
          mapped.condition = '堪用';
        }

        // 驗證必填欄位
        if (!mapped.assetCode) {
          errors.push('缺少財產編號');
        }
        if (!mapped.name) {
          errors.push('缺少品名');
        }

        var parsedRow = {
          data: mapped,
          errors: errors,
          isValid: errors.length === 0,
          rowIndex: i + 1
        };

        importParsedRows.push(parsedRow);

        if (parsedRow.isValid) {
          importValidRows.push(mapped);
        } else {
          importErrorCount++;
        }
      }

      // 切換至預覽步驟
      var stepUpload = document.getElementById('import-step-upload');
      var stepPreview = document.getElementById('import-step-preview');
      if (stepUpload) {
        stepUpload.classList.add('hidden');
        stepUpload.hidden = true;
      }
      if (stepPreview) {
        stepPreview.classList.remove('hidden');
        stepPreview.hidden = false;
      }

      // 顯示統計
      var statsEl = document.getElementById('import-stats');
      if (statsEl) {
        statsEl.innerHTML =
          '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">' +
            '<span>總筆數：<strong>' + importParsedRows.length + '</strong></span>' +
            '<span style="color:#16a34a;">有效：<strong>' + importValidRows.length + '</strong></span>' +
            '<span style="color:#dc2626;">錯誤：<strong>' + importErrorCount + '</strong></span>' +
          '</div>';
      }

      // 渲染預覽表格
      renderImportPreview(importParsedRows);

      // 根據是否有有效列啟用/禁用確認匯入按鈕
      var btnConfirm = document.getElementById('btn-confirm-import');
      if (btnConfirm) {
        if (importValidRows.length > 0) {
          btnConfirm.removeAttribute('disabled');
        } else {
          btnConfirm.setAttribute('disabled', 'true');
        }
      }

      Utils.showToast('Excel 解析完成，共 ' + importParsedRows.length + ' 筆', 'success');
    } catch (error) {
      logger.error('[App] Excel 解析失敗：', error.message);
      Utils.showToast('Excel 解析失敗：' + error.message, 'error');
    }
  }

  /**
   * 渲染匯入預覽表格。
   * 有錯誤的列標示為紅色背景。
   *
   * @param {Array<Object>} rows - 解析後的列資料陣列
   */
  function renderImportPreview(rows) {
    var table = document.getElementById('import-preview-table');
    if (!table) {
      return;
    }

    var html =
      '<table class="data-table" style="width:100%;font-size:13px;">' +
        '<thead><tr>' +
          '<th>列</th><th>財產編號</th><th>品名</th><th>類別</th><th>狀態</th><th>錯誤</th>' +
        '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowStyle = row.isValid ? '' : 'background:#fef2f2;';

      html +=
        '<tr style="' + rowStyle + '">' +
          '<td>' + row.rowIndex + '</td>' +
          '<td>' + Utils.escapeHtml(row.data.assetCode || '') + '</td>' +
          '<td>' + Utils.escapeHtml(row.data.name || '') + '</td>' +
          '<td>' + Utils.escapeHtml(row.data.category || '') + '</td>' +
          '<td>' + Utils.escapeHtml(row.data.condition || '') + '</td>' +
          '<td style="color:#dc2626;">' + Utils.escapeHtml(row.errors.join('、')) + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    table.innerHTML = html;
  }

  /**
   * 確認匯入有效列至資料庫。
   * 呼叫 DB.bulkAddAssets 寫入資料。
   *
   * @returns {Promise<void>}
   */
  async function confirmImport() {
    try {
      if (importValidRows.length === 0) {
        Utils.showToast('沒有有效的資料可匯入', 'warning');
        return;
      }

      var confirmed = await Utils.showConfirm(
        '確認匯入',
        '即將匯入 ' + importValidRows.length + ' 筆有效資料，是否繼續？',
        { confirmText: '匯入', confirmStyle: 'primary' }
      );

      if (!confirmed) {
        return;
      }

      var count = await DB.bulkAddAssets(importValidRows);
      Utils.showToast('成功匯入 ' + count + ' 筆財產', 'success');
      Utils.closeModal('import-modal-overlay');

      // 重置狀態
      importParsedRows = [];
      importValidRows = [];
      importErrorCount = 0;

      // 重新載入財產列表
      if (currentPage === 'assets') {
        await loadAssets();
      }
      if (currentPage === 'dashboard') {
        await renderDashboard();
      }
    } catch (error) {
      logger.error('[App] 匯入失敗：', error.message);
      Utils.showToast('匯入失敗：' + error.message, 'error');
    }
  }

  /**
   * 下載 Excel 範本檔案。
   * 使用 XLSX 函式庫產生包含正確欄位名稱的空白範本。
   */
  function downloadTemplate() {
    try {
      if (typeof XLSX === 'undefined') {
        Utils.showToast('XLSX 函式庫尚未載入，無法產生範本', 'error');
        return;
      }

      var headers = ['財產編號', '品名', '類別', '狀態', '規格', '存放位置', '配發人員', '取得日期', '到期日期', '備註'];
      var exampleRow = {
        '財產編號': 'EQ-2026-001',
        '品名': '無線電對講機',
        '類別': '通訊器材',
        '狀態': '堪用',
        '規格': 'Motorola GP328',
        '存放位置': '通訊室',
        '配發人員': '',
        '取得日期': '2026-01-15',
        '到期日期': '2028-01-15',
        '備註': ''
      };

      var wsData = [headers];
      var exampleValues = [];
      for (var h = 0; h < headers.length; h++) {
        exampleValues.push(exampleRow[headers[h]] || '');
      }
      wsData.push(exampleValues);

      var ws = XLSX.utils.aoa_to_sheet(wsData);

      // 設定欄寬
      ws['!cols'] = headers.map(function () {
        return { wch: 18 };
      });

      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '財產匯入範本');

      var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([wbout], { type: 'application/octet-stream' });
      Utils.downloadBlob(blob, '財產匯入範本.xlsx');

      Utils.showToast('範本已下載', 'success');
    } catch (error) {
      logger.error('[App] 下載範本失敗：', error.message);
      Utils.showToast('下載範本失敗：' + error.message, 'error');
    }
  }

  /**
   * 將 File 物件讀取為 ArrayBuffer。
   *
   * @param {File} file - 檔案物件
   * @returns {Promise<ArrayBuffer>} ArrayBuffer 結果
   */
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        resolve(e.target.result);
      };
      reader.onerror = function () {
        reject(new Error('讀取檔案失敗：' + file.name));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ============================================================
  // 6. 人員管理模組
  // ============================================================

  /**
   * 綁定人員管理頁面的所有事件。
   */
  function bindPersonnelEvents() {
    // 新增人員按鈕
    var btnAdd = document.getElementById('btn-add-personnel');
    if (btnAdd) {
      btnAdd.addEventListener('click', function () {
        openPersonnelModal();
      });
    }

    // 匯出 PDF 報表按鈕
    var btnExportPdf = document.getElementById('btn-export-personnel-pdf');
    if (btnExportPdf) {
      btnExportPdf.addEventListener('click', function () {
        exportPersonnelPdf();
      });
    }

    // 警消 / 義消快速篩選按鈕
    var btnFilterPolice = document.getElementById('btn-filter-police');
    var btnFilterVolunteer = document.getElementById('btn-filter-volunteer');
    if (btnFilterPolice && btnFilterVolunteer) {
      btnFilterPolice.addEventListener('click', function () {
        this.classList.toggle('active');
        btnFilterVolunteer.classList.remove('active');
        renderPersonnelPage();
      });
      btnFilterVolunteer.addEventListener('click', function () {
        this.classList.toggle('active');
        btnFilterPolice.classList.remove('active');
        renderPersonnelPage();
      });
    }

    // 搜尋輸入（防抖與 Enter 立即觸發）
    var searchInput = document.querySelector('#personnel-search');
    if (searchInput) {
      var searchTimer = null;
      var triggerSearch = function () {
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = null;
        }
        renderPersonnelPage();
      };

      searchInput.addEventListener('input', function () {
        if (searchTimer) {
          clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(triggerSearch, DEBOUNCE_DELAY);
      });

      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          triggerSearch();
        }
      });
    }

    // 儲存人員按鈕
    var btnSave = document.getElementById('btn-save-personnel');
    if (btnSave) {
      btnSave.addEventListener('click', function (e) {
        e.preventDefault();
        savePersonnel();
      });
    }

    // 人員 Modal overlay 點擊關閉
    var personnelOverlay = document.getElementById('personnel-modal-overlay');
    if (personnelOverlay) {
      personnelOverlay.addEventListener('click', function (e) {
        if (e.target === personnelOverlay) {
          Utils.closeModal('personnel-modal-overlay');
        }
      });
    }

    // 人員 Modal 關閉與取消按鈕
    var personnelClose = document.getElementById('personnel-modal-close');
    if (personnelClose) {
      personnelClose.addEventListener('click', function () {
        Utils.closeModal('personnel-modal-overlay');
      });
    }

    var personnelCancel = document.getElementById('personnel-modal-cancel');
    if (personnelCancel) {
      personnelCancel.addEventListener('click', function () {
        Utils.closeModal('personnel-modal-overlay');
      });
    }

    // 人員配發清單 Modal overlay 點擊關閉
    var assetsOverlay = document.getElementById('personnel-assets-overlay');
    if (assetsOverlay) {
      assetsOverlay.addEventListener('click', function (e) {
        if (e.target === assetsOverlay) {
          Utils.closeModal('personnel-assets-overlay');
        }
      });
    }

    // 人員配發清單 關閉按鈕
    var assetsClose = document.getElementById('personnel-assets-close');
    if (assetsClose) {
      assetsClose.addEventListener('click', function () {
        Utils.closeModal('personnel-assets-overlay');
      });
    }

    var assetsModalClose = document.getElementById('personnel-assets-modal-close');
    if (assetsModalClose) {
      assetsModalClose.addEventListener('click', function () {
        Utils.closeModal('personnel-assets-overlay');
      });
    }
  }

  /**
   * 渲染人員管理頁面。
   * 取得所有人員並渲染卡片網格。
   *
   * @returns {Promise<void>}
   */
  async function renderPersonnelPage() {
    try {
      var filters = {};
      var searchInput = document.querySelector('#personnel-search');
      if (searchInput && searchInput.value.trim()) {
        filters.search = searchInput.value.trim();
      }

      // 對象篩選（警消 / 義消快速篩選）
      var btnFilterPolice = document.getElementById('btn-filter-police');
      var btnFilterVolunteer = document.getElementById('btn-filter-volunteer');
      if (btnFilterPolice && btnFilterPolice.classList.contains('active')) {
        filters.rank = '警消';
      } else if (btnFilterVolunteer && btnFilterVolunteer.classList.contains('active')) {
        filters.rank = '義消';
      }

      var personnel = await DB.getAllPersonnel(filters);
      await renderPersonnelGrid(personnel);

      logger.info('[App] 人員頁面渲染完成');
    } catch (error) {
      logger.error('[App] 人員頁面渲染失敗：', error.message);
      Utils.showToast('人員頁面載入失敗：' + error.message, 'error');
    }
  }

  /**
   * 渲染人員卡片網格。
   * 每張卡片顯示：首字頭像、姓名、對象、狀態、配發數量、操作按鈕。
   *
   * @param {Array<Object>} personnel - 人員陣列
   * @returns {Promise<void>}
   */
  async function renderPersonnelGrid(personnel) {
    var grid = document.getElementById('personnel-grid');
    var emptyState = document.getElementById('personnel-empty');
    var role = sessionStorage.getItem('userRole') || 'viewer';

    if (!grid) {
      return;
    }

    if (personnel.length === 0) {
      grid.innerHTML = '';
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }

    if (emptyState) {
      emptyState.hidden = true;
    }

    // 取得每位人員的配發數量
    var html = '';
    for (var i = 0; i < personnel.length; i++) {
      var person = personnel[i];
      var assetCount = 0;

      try {
        var assets = await DB.getAssetsByPersonnel(person.id);
        assetCount = assets.length;
      } catch (err) {
        logger.warn('[App] 取得人員配發數量失敗：', err.message);
      }

      var statusBadgeClass = person.status === '在職' ? 'badge-success' : 'badge-danger';
      var initial = Utils.getInitial(person.name);

      // 頭像背景色（依 ID 產生不同色相）
      var hue = (person.id * 47) % 360;
      var avatarBg = 'hsl(' + hue + ', 60%, 50%)';

      // 檢查是否已被選取
      var isSelected = selectedPersonnelIds.indexOf(person.id) !== -1;
      var selectedCardClass = isSelected ? 'selected' : '';

      html +=
        '<div class="personnel-card ' + selectedCardClass + '" data-id="' + person.id + '" onclick="window.App.toggleSelectPersonnel(event, ' + person.id + ')">' +
          '<div class="personnel-card-header">' +
            '<div class="personnel-avatar" style="background:' + avatarBg + ';">' +
              Utils.escapeHtml(initial) +
            '</div>' +
            '<div style="flex:1; min-width: 0;">' +
              '<div style="font-weight:600;font-size:16px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                Utils.escapeHtml(person.name) +
              '</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);">' +
                Utils.escapeHtml(person.rank || '-') +
              '</div>' +
              '</div>' +
            '<span class="badge ' + statusBadgeClass + '">' +
              Utils.escapeHtml(person.status || '在職') +
            '</span>' +
          '</div>' +
          '<div class="personnel-card-body">' +
            '<div class="personnel-meta">' +
              '<div class="personnel-meta-item">' +
                '<span class="personnel-meta-label">配發數量</span>' +
                '<span class="personnel-meta-value"><strong>' + assetCount + '</strong> 項</span>' +
              '</div>' +
              '<div class="personnel-meta-item">' +
                '<span class="personnel-meta-label">聯絡電話</span>' +
                '<span class="personnel-meta-value">' + Utils.escapeHtml(person.phone || '-') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="personnel-card-footer">' +
            '<div style="display:flex;gap:4px;margin-left:auto;">' +
              '<button class="btn btn-sm btn-ghost" onclick="window.App.viewPersonnelAssets(' + person.id + '); event.stopPropagation();" title="查看配發">' +
                '<i data-lucide="package" style="width:16px;height:16px;"></i>' +
              '</button>' +
              (role === 'editor' ?
                '<button class="btn btn-sm btn-ghost" onclick="window.App.openPersonnelModal(' + person.id + '); event.stopPropagation();" title="編輯">' +
                  '<i data-lucide="pencil" style="width:16px;height:16px;"></i>' +
                '</button>' +
                '<button class="btn btn-sm btn-ghost btn-danger" onclick="window.App.deletePersonnel(' + person.id + '); event.stopPropagation();" title="刪除">' +
                  '<i data-lucide="trash-2" style="width:16px;height:16px;"></i>' +
                '</button>' : ''
              ) +
            '</div>' +
          '</div>' +
        '</div>';
    }

    grid.innerHTML = html;
    refreshIcons();
    applyRolePermissions();
  }

  /**
   * 切換人員卡片的勾選狀態（供多選 PDF 使用）
   */
  function toggleSelectPersonnel(event, id) {
    // 排除點擊卡片底部的功能按鈕
    if (event.target.closest('button') || event.target.closest('.personnel-card-footer')) {
      return;
    }
    
    // 找到卡片 DOM 元素
    var card = event.currentTarget;
    if (!card) {
      return;
    }
    
    var idx = selectedPersonnelIds.indexOf(id);
    if (idx === -1) {
      selectedPersonnelIds.push(id);
      card.classList.add('selected');
    } else {
      selectedPersonnelIds.splice(idx, 1);
      card.classList.remove('selected');
    }
  }

  /**
   * 開啟人員新增或編輯 Modal。
   *
   * @param {number} [id] - 人員 ID（不傳則為新增模式）
   * @returns {Promise<void>}
   */
  async function openPersonnelModal(id) {
    try {
      var titleEl = document.getElementById('personnel-modal-title');
      var form = document.getElementById('personnel-form');
      var idField = document.getElementById('personnel-id');

      if (form) {
        Utils.resetForm(form);
      }

      if (id) {
        // 編輯模式
        if (titleEl) {
          titleEl.textContent = '編輯人員';
        }

        var person = await DB.getPersonnelById(id);
        if (!person) {
          Utils.showToast('找不到該筆人員資料', 'error');
          return;
        }

        if (idField) { idField.value = person.id; }
        setFieldValue('personnel-name', person.name);
        setFieldValue('personnel-rank', person.rank);
        setFieldValue('personnel-status', person.status);
        setFieldValue('personnel-phone', person.phone);
      } else {
        // 新增模式
        if (titleEl) {
          titleEl.textContent = '新增人員';
        }
        if (idField) { idField.value = ''; }
      }

      Utils.openModal('personnel-modal-overlay');
    } catch (error) {
      logger.error('[App] 開啟人員 Modal 失敗：', error.message);
      Utils.showToast('開啟人員表單失敗：' + error.message, 'error');
    }
  }

  /**
   * 儲存人員資料（新增或更新）。
   *
   * @returns {Promise<void>}
   */
  async function savePersonnel() {
    try {
      var role = sessionStorage.getItem('userRole') || 'viewer';
      if (role !== 'editor') {
        Utils.showToast('權限不足，無法進行此操作！', 'error');
        return;
      }

      var idField = document.getElementById('personnel-id');
      var id = idField && idField.value ? parseInt(idField.value, 10) : null;

      var data = {
        name: getFieldValue('personnel-name'),
        rank: getFieldValue('personnel-rank'),
        status: getFieldValue('personnel-status'),
        phone: getFieldValue('personnel-phone')
      };

      if (!data.name || !data.name.trim()) {
        Utils.showToast('姓名為必填欄位', 'warning');
        return;
      }

      if (id) {
        await DB.updatePersonnel(id, data);
        Utils.showToast('人員已更新', 'success');
      } else {
        await DB.addPersonnel(data);
        Utils.showToast('人員已新增', 'success');
      }

      Utils.closeModal('personnel-modal-overlay');
      await renderPersonnelPage();

      if (currentPage === 'dashboard') {
        await renderDashboard();
      }
    } catch (error) {
      logger.error('[App] 儲存人員失敗：', error.message);
      Utils.showToast('儲存失敗：' + error.message, 'error');
    }
  }

  /**
   * 刪除指定 ID 的人員。
   * 先顯示確認對話框，確認後呼叫 DB.deletePersonnel。
   *
   * @param {number} id - 人員 ID
   * @returns {Promise<void>}
   */
  async function deletePersonnel(id) {
    try {
      var role = sessionStorage.getItem('userRole') || 'viewer';
      if (role !== 'editor') {
        Utils.showToast('權限不足，無法進行此操作！', 'error');
        return;
      }

      var confirmed = await Utils.showConfirm(
        '刪除人員',
        '確定要刪除此人員嗎？其名下配發的財產將自動解除配發關係。此操作無法復原。',
        { confirmText: '刪除', confirmStyle: 'danger' }
      );

      if (!confirmed) {
        return;
      }

      await DB.deletePersonnel(id);
      Utils.showToast('人員已刪除', 'success');
      await renderPersonnelPage();

      if (currentPage === 'dashboard') {
        await renderDashboard();
      }
    } catch (error) {
      logger.error('[App] 刪除人員失敗：', error.message);
      Utils.showToast('刪除失敗：' + error.message, 'error');
    }
  }

  /**
   * 檢視指定人員的配發清單。
   * 開啟配發清單 Modal，顯示該人員名下所有財產。
   *
   * @param {number} id - 人員 ID
   * @returns {Promise<void>}
   */
  async function viewPersonnelAssets(id) {
    try {
      var person = await DB.getPersonnelById(id);
      if (!person) {
        Utils.showToast('找不到該筆人員資料', 'error');
        return;
      }

      var assets = await DB.getAssetsByPersonnel(id);

      // 設定標題
      var titleEl = document.getElementById('personnel-assets-title');
      if (titleEl) {
        titleEl.textContent = person.name + ' 的配發清單';
      }

      // 渲染摘要
      var summaryEl = document.getElementById('personnel-assets-summary');
      if (summaryEl) {
        var conditionCounts = {};
        for (var c = 0; c < DB.ASSET_CONDITIONS.length; c++) {
          conditionCounts[DB.ASSET_CONDITIONS[c]] = 0;
        }
        for (var a = 0; a < assets.length; a++) {
          var cond = assets[a].condition;
          if (conditionCounts[cond] !== undefined) {
            conditionCounts[cond]++;
          }
        }

        var summaryHtml =
          '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">' +
            '<span>總數：<strong>' + assets.length + '</strong></span>';

        var condKeys = Object.keys(conditionCounts);
        for (var s = 0; s < condKeys.length; s++) {
          if (conditionCounts[condKeys[s]] > 0) {
            summaryHtml +=
              '<span>' + Utils.escapeHtml(condKeys[s]) + '：<strong>' + conditionCounts[condKeys[s]] + '</strong></span>';
          }
        }

        summaryHtml += '</div>';
        summaryEl.innerHTML = summaryHtml;
      }

      // 渲染表格
      var tbody = document.getElementById('personnel-assets-tbody');
      var emptyState = document.getElementById('personnel-assets-empty');

      if (tbody) {
        if (assets.length === 0) {
          tbody.innerHTML = '';
          if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.hidden = false;
          }
        } else {
          if (emptyState) {
            emptyState.classList.add('hidden');
            emptyState.hidden = true;
          }

          var html = '';
          for (var i = 0; i < assets.length; i++) {
            var asset = assets[i];
            html +=
              '<tr>' +
                '<td>' + Utils.escapeHtml(asset.assetCode || '-') + '</td>' +
                '<td>' + Utils.escapeHtml(asset.name || '-') + '</td>' +
                '<td>' + Utils.escapeHtml(asset.category || '-') + '</td>' +
                '<td>' + Utils.renderConditionBadge(asset.condition) + '</td>' +
                '<td>' + Utils.escapeHtml(asset.location || '-') + '</td>' +
              '</tr>';
          }
          tbody.innerHTML = html;
        }
      }

      Utils.openModal('personnel-assets-overlay');
    } catch (error) {
      logger.error('[App] 檢視配發清單失敗：', error.message);
      Utils.showToast('載入配發清單失敗：' + error.message, 'error');
    }
  }

  // ============================================================
  // 7. 資料維護模組
  // ============================================================

  /**
   * 綁定資料維護（設定）頁面的所有事件。
   */
  function bindSettingsEvents() {
    // 匯出 JSON
    var btnExport = document.getElementById('btn-export-json');
    if (btnExport) {
      btnExport.addEventListener('click', function () {
        exportJSON();
      });
    }

    // 匯入 JSON
    var btnImportJson = document.getElementById('btn-import-json');
    var importJsonInput = document.getElementById('import-json-input');

    if (btnImportJson && importJsonInput) {
      btnImportJson.addEventListener('click', function () {
        importJsonInput.click();
      });

      importJsonInput.addEventListener('change', function () {
        if (importJsonInput.files && importJsonInput.files.length > 0) {
          importJSON(importJsonInput.files[0]);
          importJsonInput.value = '';
        }
      });
    }

    // 儲存密碼設定
    var btnSavePasswords = document.getElementById('btn-save-passwords');
    if (btnSavePasswords) {
      btnSavePasswords.addEventListener('click', async function () {
        var loginPwdInput = document.getElementById('settings-login-pwd');
        var readonlyPwdInput = document.getElementById('settings-readonly-pwd');
        var adminPwdInput = document.getElementById('settings-admin-pwd');
        
        if (!loginPwdInput || !readonlyPwdInput || !adminPwdInput) return;
        
        var loginPwd = loginPwdInput.value.trim();
        var readonlyPwd = readonlyPwdInput.value.trim();
        
        // 唯讀與分隊帳號權限防護：非管理員(admin)登入者不可修改 admin 密碼
        var branch = sessionStorage.getItem('currentBranch') || '';
        var passwords = await DB.getSetting('passwords') || { admin: 'admin', login: '12345678', readonly: '12345678' };
        var adminPwd = branch === 'admin' ? adminPwdInput.value.trim() : passwords.admin;
        
        if (!loginPwd || !readonlyPwd || !adminPwd) {
          Utils.showToast('密碼欄位不可為空', 'warning');
          return;
        }
        
        try {
          await DB.setSetting('passwords', {
            admin: adminPwd,
            login: loginPwd,
            readonly: readonlyPwd
          });
          Utils.showToast('密碼設定已儲存', 'success');
          renderSettingsPage();
        } catch (err) {
          Utils.showToast('儲存密碼失敗：' + err.message, 'error');
        }
      });
    }

    // 雲端備份（預留）
    var btnCloudBackup = document.getElementById('btn-cloud-backup');
    if (btnCloudBackup) {
      btnCloudBackup.addEventListener('click', function () {
        cloudBackup();
      });
    }

    // 雲端還原（預留）
    var btnCloudRestore = document.getElementById('btn-cloud-restore');
    if (btnCloudRestore) {
      btnCloudRestore.addEventListener('click', function () {
        cloudRestore();
      });
    }

    // 新增分隊事件
    var btnAddBranch = document.getElementById('btn-add-branch');
    var newBranchInput = document.getElementById('new-branch-input');
    if (btnAddBranch && newBranchInput) {
      btnAddBranch.addEventListener('click', async function () {
        var newBranchName = newBranchInput.value.trim();
        if (!newBranchName) {
          Utils.showToast('分隊名稱不可為空', 'warning');
          return;
        }

        try {
          var currentBranches = await DB.getSetting('branches') || ["雙福分隊", "三和分隊"];
          if (currentBranches.indexOf(newBranchName) > -1) {
            Utils.showToast('該分隊已存在', 'warning');
            return;
          }

          currentBranches.push(newBranchName);
          await DB.setSetting('branches', currentBranches);
          newBranchInput.value = '';
          Utils.showToast('分隊新增成功！', 'success');
          await loadAndRenderBranches();
        } catch (err) {
          Utils.showToast('新增分隊失敗：' + err.message, 'error');
        }
      });

      // 支援 Enter 鍵新增
      newBranchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          btnAddBranch.click();
        }
      });
    }
  }

  /**
   * 渲染資料維護頁面。
   * 載入類別清單並渲染。
   *
   * @returns {Promise<void>}
   */
  async function renderSettingsPage() {
    try {
      // 雲端備份按鈕狀態控制
      var mode = DB.getMode();
      var btnCloudBackup = document.getElementById('btn-cloud-backup');
      var btnCloudRestore = document.getElementById('btn-cloud-restore');
      if (mode === 'firebase') {
        if (btnCloudBackup) {
          btnCloudBackup.removeAttribute('disabled');
          btnCloudBackup.removeAttribute('title');
          btnCloudBackup.className = 'btn btn-primary';
        }
        if (btnCloudRestore) {
          btnCloudRestore.removeAttribute('disabled');
          btnCloudRestore.removeAttribute('title');
          btnCloudRestore.className = 'btn btn-secondary';
        }
      } else {
        if (btnCloudBackup) {
          btnCloudBackup.setAttribute('disabled', 'true');
          btnCloudBackup.setAttribute('title', '僅限 Firebase 模式使用');
          btnCloudBackup.className = 'btn btn-ghost';
        }
        if (btnCloudRestore) {
          btnCloudRestore.setAttribute('disabled', 'true');
          btnCloudRestore.setAttribute('title', '僅限 Firebase 模式使用');
          btnCloudRestore.className = 'btn btn-ghost';
        }
      }

      await renderCategoryList();

      // 載入密碼設定並填入輸入框
      var passwords = await DB.getSetting('passwords') || { admin: 'admin', login: '12345678', readonly: '12345678' };
      setFieldValue('settings-login-pwd', passwords.login);
      setFieldValue('settings-readonly-pwd', passwords.readonly);
      setFieldValue('settings-admin-pwd', passwords.admin);
      
      // 根據登入帳號分隊控制管理員密碼修改的顯示權限 (僅 admin 可看見與修改)
      var branch = sessionStorage.getItem('currentBranch') || '';
      var adminPwdGroup = document.getElementById('settings-admin-pwd-group');
      if (adminPwdGroup) {
        if (branch === 'admin') {
          adminPwdGroup.style.display = '';
        } else {
          adminPwdGroup.style.display = 'none';
        }
      }

      // 動態更新系統資訊的筆數
      var personnel = await DB.getAllPersonnel();
      var assets = await DB.getAllAssets();

      setTextContent('info-asset-count', assets.length);
      setTextContent('info-personnel-count', personnel.length);

      // 限制密碼卡片的顯示 (僅限管理員或編輯者，唯讀隱藏)
      applyRolePermissions();

      // 動態更新運行模式與資料庫引擎資訊
      var mode = DB.getMode();
      if (mode === 'firebase') {
        setTextContent('info-db-name', 'Firestore (Cloud)');
        var engineEl = document.getElementById('info-db-engine');
        if (engineEl) {
          engineEl.innerHTML = '<span class="badge badge-success" style="padding:2px 8px;font-size:12px;background:#16a34a;color:#fff;border-radius:4px;">Firebase (雲端同步模式)</span>';
        }
      } else {
        setTextContent('info-db-name', 'FireDeptAssets (Local)');
        var engineEl = document.getElementById('info-db-engine');
        if (engineEl) {
          engineEl.innerHTML = 'Dexie.js (本地 IndexedDB)';
        }
      }

      logger.info('[App] 設定頁面渲染完成');
    } catch (error) {
      logger.error('[App] 設定頁面渲染失敗：', error.message);
      Utils.showToast('設定頁面載入失敗：' + error.message, 'error');
    }
  }

  /**
   * 匯出所有資料為 JSON 檔案並觸發下載。
   *
   * @returns {Promise<void>}
   */
  async function exportJSON() {
    try {
      var data = await DB.exportAllData();
      var json = JSON.stringify(data, null, 2);
      var timestamp = Utils.formatDate(new Date()).replace(/-/g, '');
      var filename = '財產管理備份_' + timestamp + '.json';

      Utils.downloadFile(json, filename, 'application/json');
      Utils.showToast('資料已匯出', 'success');
    } catch (error) {
      logger.error('[App] 匯出 JSON 失敗：', error.message);
      Utils.showToast('匯出失敗：' + error.message, 'error');
    }
  }

  /**
   * 匯入 JSON 備份檔案還原資料。
   * 讀取檔案後先確認，再呼叫 DB.importAllData。
   *
   * @param {File} file - 使用者選取的 JSON 檔案
   * @returns {Promise<void>}
   */
  async function importJSON(file) {
    var loadingToast = null;
    try {
      var text = await readFileAsText(file);
      var backup = JSON.parse(text);

      var personnelCount = (backup.personnel && backup.personnel.length) || 0;
      var assetsCount = (backup.assets && backup.assets.length) || 0;

      var confirmed = await Utils.showConfirm(
        '還原備份資料',
        '此操作會清除現有所有資料並寫入備份內容。' +
        '\n\n備份包含：' + personnelCount + ' 位人員、' + assetsCount + ' 筆財產。' +
        '\n\n確定要繼續嗎？',
        { confirmText: '還原', confirmStyle: 'danger' }
      );

      if (!confirmed) {
        return;
      }

      // 顯示正在還原的 loading Toast
      loadingToast = Utils.showToast('正在還原備份資料，請稍候...', 'info', 0);

      var result = await DB.importAllData(backup);

      // 關閉 loading Toast
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }

      Utils.showToast(
        '還原完成：' + result.personnelCount + ' 位人員、' + result.assetsCount + ' 筆財產',
        'success'
      );

      // 還原完成後自動跳轉至儀表板，以便使用者直觀看到結果
      window.location.hash = 'dashboard';
    } catch (error) {
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }
      logger.error('[App] 匯入 JSON 失敗：', error.message);
      Utils.showToast('還原失敗：' + error.message, 'error');
    }
  }

  /**
   * 渲染類別管理清單。
   * 每個類別項目帶有刪除按鈕，底部有新增輸入框。
   *
   * @returns {Promise<void>}
   */
  async function renderCategoryList() {
    try {
      var container = document.getElementById('category-list');
      if (!container) {
        return;
      }

      var categories = await DB.getSetting('categories');
      if (!categories) {
        categories = DB.DEFAULT_CATEGORIES.slice();
      }

      var html =
        '<div style="margin-bottom:12px;">';

      for (var i = 0; i < categories.length; i++) {
        html +=
          '<div class="category-item" style="display:flex;align-items:center;justify-content:space-between;' +
            'padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;' +
            'background:var(--bg-primary);">' +
            '<span style="font-size:14px;color:var(--text-primary);">' +
              Utils.escapeHtml(categories[i]) +
            '</span>' +
            '<button class="btn btn-sm btn-ghost btn-danger" ' +
              'onclick="window.App.removeCategory(\'' + Utils.escapeHtml(categories[i]).replace(/'/g, "\\'") + '\')" ' +
              'title="移除類別">' +
              '<i data-lucide="x" style="width:14px;height:14px;"></i>' +
            '</button>' +
          '</div>';
      }

      html += '</div>';

      // 新增類別輸入框
      html +=
        '<div style="display:flex;gap:8px;">' +
          '<input type="text" id="new-category-input" ' +
            'placeholder="輸入新類別名稱" ' +
            'style="flex:1;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;' +
              'font-size:14px;background:var(--bg-primary);color:var(--text-primary);" />' +
          '<button class="btn btn-sm btn-primary" onclick="window.App.addCategory()" ' +
            'style="white-space:nowrap;">' +
            '新增類別' +
          '</button>' +
        '</div>';

      container.innerHTML = html;
      refreshIcons();
    } catch (error) {
      logger.error('[App] 渲染類別清單失敗：', error.message);
      Utils.showToast('類別清單載入失敗：' + error.message, 'error');
    }
  }

  /**
   * 新增自訂類別至設定中。
   * 從輸入框取得名稱，寫入 DB settings。
   *
   * @returns {Promise<void>}
   */
  async function addCategory() {
    try {
      var input = document.getElementById('new-category-input');
      if (!input || !input.value.trim()) {
        Utils.showToast('請輸入類別名稱', 'warning');
        return;
      }

      var newCat = input.value.trim();
      var categories = await DB.getSetting('categories');
      if (!categories) {
        categories = DB.DEFAULT_CATEGORIES.slice();
      }

      // 檢查是否已存在
      if (categories.indexOf(newCat) !== -1) {
        Utils.showToast('類別「' + newCat + '」已存在', 'warning');
        return;
      }

      categories.push(newCat);
      await DB.setSetting('categories', categories);

      Utils.showToast('類別已新增', 'success');
      await renderCategoryList();
    } catch (error) {
      logger.error('[App] 新增類別失敗：', error.message);
      Utils.showToast('新增類別失敗：' + error.message, 'error');
    }
  }

  /**
   * 從設定中移除指定類別。
   *
   * @param {string} cat - 要移除的類別名稱
   * @returns {Promise<void>}
   */
  async function removeCategory(cat) {
    try {
      var confirmed = await Utils.showConfirm(
        '移除類別',
        '確定要移除類別「' + cat + '」嗎？已使用此類別的財產不會被刪除。',
        { confirmText: '移除', confirmStyle: 'warning' }
      );

      if (!confirmed) {
        return;
      }

      var categories = await DB.getSetting('categories');
      if (!categories) {
        categories = DB.DEFAULT_CATEGORIES.slice();
      }

      var index = categories.indexOf(cat);
      if (index !== -1) {
        categories.splice(index, 1);
        await DB.setSetting('categories', categories);
        Utils.showToast('類別已移除', 'success');
        await renderCategoryList();
      }
    } catch (error) {
      logger.error('[App] 移除類別失敗：', error.message);
      Utils.showToast('移除類別失敗：' + error.message, 'error');
    }
  }

  /**
   * 執行雲端備份。
   */
  async function cloudBackup() {
    var loadingToast = null;
    try {
      if (DB.getMode() !== 'firebase') {
        Utils.showToast('僅能在 Firebase 模式下使用雲端備份', 'warning');
        return;
      }

      var confirmed = await Utils.showConfirm(
        '雲端備份',
        '即將把目前所有人員、財產與設定資料備份至雲端，這將會建立一筆新的歷史備份點。確定要繼續嗎？',
        { confirmText: '備份', confirmStyle: 'primary' }
      );

      if (!confirmed) {
        return;
      }

      loadingToast = Utils.showToast('正在建立雲端備份，請稍候...', 'info', 0);
      var backupId = await DB.createCloudBackup();
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }

      Utils.showToast('雲端備份建立完成！備份點：' + backupId, 'success');
      await renderSettingsPage();
    } catch (error) {
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }
      logger.error('[App] 建立雲端備份失敗：', error.message);
      Utils.showToast('雲端備份失敗：' + error.message, 'error');
    }
  }

  /**
   * 執行雲端還原。
   */
  async function cloudRestore() {
    var loadingToast = null;
    try {
      if (DB.getMode() !== 'firebase') {
        Utils.showToast('僅能在 Firebase 模式下使用雲端還原', 'warning');
        return;
      }

      loadingToast = Utils.showToast('正在載入備份列表，請稍候...', 'info', 0);
      var startTime = Date.now();
      var backups = await DB.listCloudBackups();
      var elapsedTime = Date.now() - startTime;
      if (elapsedTime < 600) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 600 - elapsedTime);
        });
      }
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }

      if (backups.length === 0) {
        Utils.showToast('目前雲端沒有任何備份記錄', 'warning');
        return;
      }

      showCloudRestoreModal(backups);
    } catch (error) {
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }
      logger.error('[App] 雲端還原失敗：', error.message);
      Utils.showToast('無法取得雲端備份：' + error.message, 'error');
    }
  }

  /**
   * 動態顯示雲端備份還原的選擇視窗。
   * @param {Array<Object>} backups - 歷史備份列表
   */
  function showCloudRestoreModal(backups) {
    var oldOverlay = document.getElementById('cloud-restore-modal-overlay');
    if (oldOverlay) {
      oldOverlay.remove();
    }

    var overlay = document.createElement('div');
    overlay.id = 'cloud-restore-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    
    var modal = document.createElement('div');
    modal.className = 'modal';
    
    var header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<h3>選擇雲端備份進行還原</h3><button class="modal-close" id="cloud-restore-modal-close" type="button"><i data-lucide="x"></i></button>';
    
    var body = document.createElement('div');
    body.className = 'modal-body';
    body.style.maxHeight = '400px';
    body.style.overflowY = 'auto';
    
    var listHtml = '<div style="display:flex;flex-direction:column;gap:10px;">';
    for (var i = 0; i < backups.length; i++) {
      var b = backups[i];
      var formattedTime = Utils.formatDateTime(new Date(b.createdAt));
      listHtml += 
        '<div class="backup-restore-item" data-id="' + b.id + '" style="display:flex;align-items:center;justify-content:space-between;' +
          'padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);cursor:pointer;' +
          'transition:all 0.2s ease;">' +
          '<div style="flex:1;">' +
            '<div style="font-weight:600;color:var(--text-primary);font-size:14px;">' + b.id + '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">備份時間：' + formattedTime + '</div>' +
            '<div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">資料：人員 ' + b.personnelCount + ' 位 / 財產 ' + b.assetsCount + ' 筆</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<button class="btn btn-sm btn-ghost" style="white-space:nowrap;pointer-events:none;">選擇</button>' +
            '<button class="btn btn-sm btn-danger btn-delete-backup" data-id="' + b.id + '" style="white-space:nowrap;padding:4px 8px;font-size:12px;">刪除</button>' +
          '</div>' +
        '</div>';
    }
    listHtml += '</div>';
    body.innerHTML = listHtml;
    
    var footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = '<button class="btn btn-ghost" id="cloud-restore-modal-cancel" type="button">取消</button>';
    
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // 延遲加上 active 以實現 CSS transition 動畫
    setTimeout(function () {
      overlay.classList.add('active');
    }, 10);
    
    var closeBtn = overlay.querySelector('#cloud-restore-modal-close');
    var cancelBtn = overlay.querySelector('#cloud-restore-modal-cancel');
    var closeFn = function() {
      overlay.classList.remove('active');
      setTimeout(function() {
        overlay.remove();
      }, 250);
    };
    closeBtn.addEventListener('click', closeFn);
    cancelBtn.addEventListener('click', closeFn);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closeFn();
      }
    });
    
    var items = overlay.querySelectorAll('.backup-restore-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        var backupId = this.getAttribute('data-id');
        closeFn();
        triggerCloudRestore(backupId);
      });
    }

    var deleteBtns = overlay.querySelectorAll('.btn-delete-backup');
    for (var k = 0; k < deleteBtns.length; k++) {
      deleteBtns[k].addEventListener('click', async function(e) {
        e.stopPropagation(); // 阻止觸發選擇還原事件
        var backupId = this.getAttribute('data-id');

        var confirmed = await Utils.showConfirm(
          '永久刪除備份',
          '確定要永久刪除備份點「' + backupId + '」嗎？\n\n注意：此操作將無法復原！',
          { confirmText: '確定刪除', confirmStyle: 'danger' }
        );

        if (!confirmed) {
          return;
        }

        var deleteToast = Utils.showToast('正在刪除雲端備份，請稍候...', 'info', 0);
        try {
          await DB.deleteCloudBackup(backupId);
          if (deleteToast) {
            Utils.removeToast(deleteToast);
          }
          Utils.showToast('雲端備份已成功刪除！', 'success');
          closeFn();
          // 重新載入列表以更新 UI 顯示
          await cloudRestore();
        } catch (err) {
          if (deleteToast) {
            Utils.removeToast(deleteToast);
          }
          logger.error('[App] 刪除雲端備份失敗：', err.message);
          Utils.showToast('刪除失敗：' + err.message, 'error');
        }
      });
    }
    
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  }

  /**
   * 觸發備份還原。
   * @param {string} backupId - 備份 ID
   */
  async function triggerCloudRestore(backupId) {
    var loadingToast = null;
    try {
      var confirmed = await Utils.showConfirm(
        '雲端備份還原確認',
        '確定要將系統還原至該備份點「' + backupId + '」嗎？\n\n注意：這將完全覆蓋目前雲端與本地的所有資料，且不可復原！',
        { confirmText: '確定還原', confirmStyle: 'danger' }
      );

      if (!confirmed) {
        return;
      }

      loadingToast = Utils.showToast('正在下載並還原備份，請稍候...', 'info', 0);
      var startTime = Date.now();
      var result = await DB.restoreCloudBackup(backupId);
      var elapsedTime = Date.now() - startTime;
      if (elapsedTime < 600) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 600 - elapsedTime);
        });
      }
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }

      Utils.showToast(
        '雲端還原完成！共還原：' + result.personnelCount + ' 位人員、' + result.assetsCount + ' 筆財產',
        'success'
      );
      window.location.hash = 'dashboard';
    } catch (error) {
      if (loadingToast) {
        Utils.removeToast(loadingToast);
      }
      logger.error('[App] 雲端還原失敗：', error.message);
      Utils.showToast('雲端還原失敗：' + error.message, 'error');
    }
  }

  // ============================================================
  // 8. 工具函數
  // ============================================================

  /**
   * 建立人員 ID 與姓名的對應 Map。
   * 用於財產表格中顯示配發人員名稱。
   *
   * @returns {Promise<Object<number, string>>} ID→姓名對應物件
   */
  async function buildPersonnelMap() {
    try {
      var personnel = await DB.getAllPersonnel();
      var map = {};
      for (var i = 0; i < personnel.length; i++) {
        map[personnel[i].id] = personnel[i].name;
      }
      return map;
    } catch (error) {
      logger.error('[App] 建立人員 Map 失敗：', error.message);
      return {};
    }
  }

  /**
   * 填入人員下拉選單。
   * 從資料庫取得所有在職人員，產生 option 元素。
   *
   * @param {string} selectId - select 元素的 DOM ID
   * @param {boolean} [includeAllOption=false] - 是否在最前方加入「全部」選項
   * @returns {Promise<void>}
   */
  async function populatePersonnelSelect(selectId, includeAllOption) {
    try {
      var select = document.getElementById(selectId);
      if (!select) {
        return;
      }

      // 清空現有選項
      select.innerHTML = '';

      if (includeAllOption) {
        var allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = '全部人員';
        select.appendChild(allOpt);
      } else {
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- 請選擇 --';
        select.appendChild(emptyOpt);
      }

      var personnel = await DB.getAllPersonnel({ status: '在職' });
      for (var i = 0; i < personnel.length; i++) {
        var opt = document.createElement('option');
        opt.value = personnel[i].id;
        opt.textContent = personnel[i].name;
        select.appendChild(opt);
      }
    } catch (error) {
      logger.error('[App] 填入人員下拉選單失敗：', error.message);
    }
  }

  /**
   * 填入類別下拉選單。
   * 從資料庫設定取得類別清單，產生 option 元素。
   *
   * @param {string} selectId - select 元素的 DOM ID
   * @param {boolean} [includeAllOption=false] - 是否在最前方加入「全部」選項
   * @returns {Promise<void>}
   */
  async function populateCategorySelect(selectId, includeAllOption) {
    try {
      var select = document.getElementById(selectId);
      if (!select) {
        return;
      }

      // 清空現有選項
      select.innerHTML = '';

      if (includeAllOption) {
        var allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = '全部類別';
        select.appendChild(allOpt);
      } else {
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- 請選擇 --';
        select.appendChild(emptyOpt);
      }

      var categories = await DB.getSetting('categories');
      if (!categories) {
        categories = DB.DEFAULT_CATEGORIES;
      }

      for (var i = 0; i < categories.length; i++) {
        var opt = document.createElement('option');
        opt.value = categories[i];
        opt.textContent = categories[i];
        select.appendChild(opt);
      }
    } catch (error) {
      logger.error('[App] 填入類別下拉選單失敗：', error.message);
    }
  }

  /**
   * 填入狀態下拉選單。
   * 從資料庫設定（DB.ASSET_CONDITIONS）取得狀態清單，產生 option 元素。
   *
   * @param {string} selectId - select 元素的 DOM ID
   * @param {boolean} [includeAllOption=false] - 是否在最前方加入「全部」選項
   */
  function populateConditionSelect(selectId, includeAllOption) {
    try {
      var select = document.getElementById(selectId);
      if (!select) {
        return;
      }

      // 清空現有選項
      select.innerHTML = '';

      if (includeAllOption) {
        var allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = '所有狀態';
        select.appendChild(allOpt);
      } else {
        var emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '-- 請選擇 --';
        select.appendChild(emptyOpt);
      }

      var conditions = DB.ASSET_CONDITIONS;
      for (var i = 0; i < conditions.length; i++) {
        var opt = document.createElement('option');
        opt.value = conditions[i];
        opt.textContent = conditions[i];
        select.appendChild(opt);
      }
    } catch (error) {
      logger.error('[App] 填入狀態下拉選單失敗：', error.message);
    }
  }

  /**
   * 安全地設定元素的 textContent。
   *
   * @param {string} elementId - 元素的 DOM ID
   * @param {string|number} text - 要設定的文字內容
   */
  function setTextContent(elementId, text) {
    var el = document.getElementById(elementId);
    if (el) {
      el.textContent = String(text);
    }
  }

  /**
   * 安全地設定表單欄位的值。
   *
   * @param {string} fieldId - 表單欄位的 DOM ID
   * @param {string|number} value - 要設定的值
   */
  function setFieldValue(fieldId, value) {
    var el = document.getElementById(fieldId);
    if (el) {
      el.value = value !== undefined && value !== null ? String(value) : '';
    }
  }

  /**
   * 安全地取得表單欄位的值。
   *
   * @param {string} fieldId - 表單欄位的 DOM ID
   * @returns {string} 欄位值，找不到時回傳空字串
   */
  function getFieldValue(fieldId) {
    var el = document.getElementById(fieldId);
    return el ? el.value : '';
  }

  /**
   * 將 File 物件讀取為純文字。
   *
   * @param {File} file - 檔案物件
   * @returns {Promise<string>} 檔案文字內容
   */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        resolve(e.target.result);
      };
      reader.onerror = function () {
        reject(new Error('讀取檔案失敗：' + file.name));
      };
      reader.readAsText(file);
    });
  }

  /**
   * 呼叫 lucide.createIcons() 刷新動態渲染的圖示。
   * 若 lucide 尚未載入則靜默跳過。
   */
  function refreshIcons() {
    try {
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
      }
    } catch (error) {
      logger.warn('[App] 刷新圖示失敗：', error.message);
    }
  }

  // ============================================================
  // 掛載至 window.App
  // ============================================================

  /**
   * 匯出所選人員的個人配發財產清單報表 (HTML 列印引擎另存 PDF)
   */
  async function exportPersonnelPdf() {
    if (selectedPersonnelIds.length === 0) {
      Utils.showToast('請先點選人員卡片進行多選！', 'warning');
      return;
    }
    
    Utils.showToast('正在產生 PDF 報表，請稍候...', 'info', 2000);
    
    var html = 
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
        '<meta charset="UTF-8">' +
        '<title>個人配發財產清單報表</title>' +
        '<style>' +
          'body { font-family: "Microsoft JhengHei", sans-serif; padding: 0; margin: 0; background: #fff; color: #000; }' +
          '.print-container { width: 100%; max-width: 800px; margin: 0 auto; padding: 20px; box-sizing: border-box; }' +
          '.report-page { page-break-after: always; padding: 20px; border: 1px solid #ddd; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }' +
          '@media print { .report-page { page-break-after: always; border: none; box-shadow: none; padding: 0; margin: 0; } .print-container { padding: 0; } }' +
          '.report-header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 10px; }' +
          '.report-header h2 { margin: 0 0 5px 0; font-size: 24px; }' +
          '.report-meta { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 15px; }' +
          '.report-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }' +
          '.report-table th, .report-table td { border: 1px solid #000; padding: 8px 12px; font-size: 13px; text-align: left; }' +
          '.report-table th { background-color: #f2f2f2; font-weight: bold; }' +
          '.signatures { margin-top: 60px; display: flex; justify-content: space-between; }' +
          '.signature-line { width: 220px; text-align: center; border-top: 1px dashed #000; padding-top: 8px; font-size: 14px; }' +
        '</style>' +
      '</head>' +
      '<body>' +
        '<div class="print-container">';
        
    for (var i = 0; i < selectedPersonnelIds.length; i++) {
      var pId = selectedPersonnelIds[i];
      var person = await DB.getPersonnelById(pId);
      if (!person) continue;
      
      var assets = await DB.getAssetsByPersonnel(pId);
      var printDate = Utils.formatDate(new Date());
      
      html += 
        '<div class="report-page">' +
          '<div class="report-header">' +
            '<h2>個人配發財產清單報表</h2>' +
            '<div style="font-size: 14px; color: #555; margin-top: 5px;">消防隊財產管理系統</div>' +
          '</div>' +
          '<div class="report-meta">' +
            '<div><strong>姓名：</strong>' + Utils.escapeHtml(person.name) + '（' + Utils.escapeHtml(person.rank || '-') + '）</div>' +
            '<div><strong>列印日期：</strong>' + printDate + '</div>' +
          '</div>' +
          '<table class="report-table">' +
            '<thead>' +
              '<tr>' +
                '<th style="width: 50px; text-align:center;">#</th>' +
                '<th style="width: 150px;">財產編號</th>' +
                '<th>品名</th>' +
                '<th style="width: 100px;">類別</th>' +
                '<th style="width: 80px;">狀態</th>' +
                '<th style="width: 120px;">存放位置</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>';
            
      if (assets.length === 0) {
        html += '<tr><td colspan="6" style="text-align:center;color:#666;">此人員目前無配發任何財產</td></tr>';
      } else {
        for (var j = 0; j < assets.length; j++) {
          var a = assets[j];
          html += 
            '<tr>' +
              '<td style="text-align:center;">' + (j + 1) + '</td>' +
              '<td>' + Utils.escapeHtml(a.assetCode || '-') + '</td>' +
              '<td>' + Utils.escapeHtml(a.name || '-') + '</td>' +
              '<td>' + Utils.escapeHtml(a.category || '-') + '</td>' +
              '<td>' + Utils.escapeHtml(a.condition || '-') + '</td>' +
              '<td>' + Utils.escapeHtml(a.location || '-') + '</td>' +
            '</tr>';
        }
      }
      
      html += 
            '</tbody>' +
          '</table>' +
          '<div class="signatures">' +
            '<div class="signature-line">領用人簽章</div>' +
            '<div class="signature-line">財產管理主辦人簽章</div>' +
          '</div>' +
        '</div>';
    }
    
    html += 
        '</div>' +
        '<script>' +
          'window.onload = function() { window.print(); };' +
        '</script>' +
      '</body>' +
      '</html>';
      
    var printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      Utils.showToast('無法開啟列印視窗，請檢查瀏覽器是否封鎖快顯視窗！', 'error');
    }
  }

  /**
   * 匯出當前篩選條件下的財產清單報表 (HTML 列印引擎另存 PDF)
   */
  async function exportAssetsPdf() {
    Utils.showToast('正在產生 PDF 報表，請稍候...', 'info', 2000);
    
    var filters = {};
    var searchInput = document.querySelector('#asset-search');
    if (searchInput && searchInput.value.trim()) {
      filters.search = searchInput.value.trim();
    }
    var filterCategory = document.getElementById('filter-category');
    if (filterCategory && filterCategory.value) {
      filters.category = filterCategory.value;
    }
    var filterCondition = document.getElementById('filter-condition');
    if (filterCondition && filterCondition.value) {
      filters.condition = filterCondition.value;
    }
    var filterAssigned = document.getElementById('filter-assigned');
    if (filterAssigned && filterAssigned.value) {
      if (filterAssigned.value === 'unassigned') {
        filters.assignedTo = null;
      } else {
        filters.assignedTo = parseInt(filterAssigned.value, 10);
      }
    }
    
    var assets = await DB.getAllAssets(filters);
    var personnelMap = await buildPersonnelMap();
    var printDate = Utils.formatMinguoDate(new Date());
    var branch = sessionStorage.getItem('currentBranch') || '雙福分隊';
    var branchDisplayName = branch === 'admin' ? '所有分隊' : branch;
    
    var html = 
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
        '<meta charset="UTF-8">' +
        '<title>財產清單報表</title>' +
        '<style>' +
          'body { font-family: "Microsoft JhengHei", sans-serif; padding: 20px; background: #fff; color: #000; }' +
          '.report-header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 10px; }' +
          '.report-header h2 { margin: 0 0 5px 0; font-size: 24px; }' +
          '.report-meta { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 15px; }' +
          '.report-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }' +
          '.report-table th, .report-table td { border: 1px solid #000; padding: 8px 10px; font-size: 12px; text-align: left; }' +
          '.report-table th { background-color: #f2f2f2; font-weight: bold; }' +
          '.signatures { margin-top: 50px; display: flex; justify-content: space-between; }' +
          '.signature-line { width: 220px; text-align: center; border-top: 1px dashed #000; padding-top: 8px; font-size: 14px; }' +
        '</style>' +
      '</head>' +
      '<body>' +
        '<div class="report-header">' +
          '<h2>消防隊財產清單報表</h2>' +
          '<div style="font-size: 14px; color: #555; margin-top: 5px;">分隊：' + branchDisplayName + '</div>' +
        '</div>' +
        '<div class="report-meta">' +
          '<div><strong>統計筆數：</strong>' + assets.length + ' 筆</div>' +
          '<div><strong>列印日期：</strong>' + printDate + '</div>' +
        '</div>' +
        '<table class="report-table">' +
          '<thead>' +
            '<tr>' +
              '<th style="width: 40px; text-align:center;">#</th>' +
              '<th style="width: 140px;">財產編號</th>' +
              '<th>品名</th>' +
              '<th style="width: 100px;">類別</th>' +
              '<th style="width: 90px;">配發人員</th>' +
              '<th style="width: 90px; text-align:center;">購置日期</th>' +
              '<th style="width: 90px; text-align:center;">到期日期</th>' +
              '<th style="width: 120px;">存放位置</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>';
          
    if (assets.length === 0) {
      html += '<tr><td colspan="8" style="text-align:center;color:#666;">無符合篩選條件的財產資料</td></tr>';
    } else {
      for (var i = 0; i < assets.length; i++) {
        var a = assets[i];
        var assignedName = '-';
        if (a.assignedTo && personnelMap[a.assignedTo]) {
          assignedName = personnelMap[a.assignedTo];
        }

        // 到期日期為空時自動用購置日期 + 5 年計算並顯示
        var expiryToShow = a.expiryDate;
        if (!expiryToShow && a.acquiredDate) {
          try {
            var date = new Date(a.acquiredDate);
            if (!isNaN(date.getTime())) {
              date.setFullYear(date.getFullYear() + 5);
              expiryToShow = date.toISOString().slice(0, 10);
            }
          } catch (e) {
            expiryToShow = '';
          }
        }
        var expiryDisplay = expiryToShow ? Utils.formatMinguoDate(expiryToShow) : '';
        var acquiredDisplay = a.acquiredDate ? Utils.formatMinguoDate(a.acquiredDate) : '-';

        html += 
          '<tr>' +
            '<td style="text-align:center;">' + (i + 1) + '</td>' +
            '<td>' + Utils.escapeHtml(a.assetCode || '-') + '</td>' +
            '<td>' + Utils.escapeHtml(a.name || '-') + '</td>' +
            '<td>' + Utils.escapeHtml(a.category || '-') + '</td>' +
            '<td>' + Utils.escapeHtml(assignedName) + '</td>' +
            '<td style="text-align:center;">' + Utils.escapeHtml(acquiredDisplay) + '</td>' +
            '<td style="text-align:center;">' + Utils.escapeHtml(expiryDisplay) + '</td>' +
            '<td>' + Utils.escapeHtml(a.location || '分隊') + '</td>' +
          '</tr>';
      }
    }
    
    html += 
          '</tbody>' +
        '</table>' +
        '<div class="signatures">' +
          '<div class="signature-line">經手人簽章</div>' +
          '<div class="signature-line">財產管理主辦人簽章</div>' +
        '</div>' +
        '<script>' +
          'window.onload = function() { window.print(); };' +
        '</script>' +
      '</body>' +
      '</html>';
      
    var printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      Utils.showToast('無法開啟列印視窗，請檢查瀏覽器是否封鎖快顯視窗！', 'error');
    }
  }

  // ============================================================
  // 掛載至 window.App
  // ============================================================

  /**
   * 處理配發人員的就地下拉選單編輯
   * @param {HTMLTableCellElement} td 
   */
  function handleInlineEditAssigned(td) {
    if (td.querySelector('select')) {
      return; // 已經在編輯狀態
    }

    var assetId = parseInt(td.getAttribute('data-id'), 10);
    var currentValue = td.getAttribute('data-value'); // 原本的人員 ID 或是 ""
    var currentText = td.textContent.trim();

    // 建立 select 元素
    var select = document.createElement('select');
    select.className = 'filter-select';
    select.style.width = '100%';
    select.style.padding = '4px 20px 4px 6px';
    select.style.backgroundPosition = 'right 6px center';
    select.style.fontSize = '12px';
    select.style.height = 'auto';
    select.style.minWidth = 'auto';
    select.style.border = '1px solid var(--color-primary)';

    // 加入「未配發」選項
    var optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '-';
    select.appendChild(optEmpty);

    // 加入在職人員選項
    for (var i = 0; i < activePersonnelList.length; i++) {
      var opt = document.createElement('option');
      opt.value = activePersonnelList[i].id;
      opt.textContent = activePersonnelList[i].name;
      if (String(activePersonnelList[i].id) === String(currentValue)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

    // 清空 td 並填入 select
    td.textContent = '';
    td.appendChild(select);
    select.focus();

    // 保存更新的函數
    var isSaving = false;
    var saveChange = async function () {
      if (isSaving) return;
      isSaving = true;

      var newValue = select.value; // 字串 ID 或是 ""
      var newAssignedTo = newValue ? parseInt(newValue, 10) : null;
      var newText = select.options[select.selectedIndex].textContent;

      if (String(newValue) !== String(currentValue)) {
        try {
          // 只更新 assignedTo 欄位
          await DB.updateAsset(assetId, { assignedTo: newAssignedTo });
          td.setAttribute('data-value', newValue || '');
          td.textContent = newText;
          Utils.showToast('配發人員已更新', 'success');
        } catch (err) {
          logger.error('[App] 就地更新配發人員失敗：', err.message);
          Utils.showToast('更新失敗：' + err.message, 'error');
          td.textContent = currentText; // 還原
        }
      } else {
        td.textContent = currentText; // 未更改，還原
      }
    };

    // 監聽 blur 儲存
    select.addEventListener('blur', saveChange);
    // 監聽 change 儲存並失去焦點
    select.addEventListener('change', function () {
      select.blur();
    });
  }

  /**
   * 處理存放位置的就地文字編輯
   * @param {HTMLTableCellElement} td 
   */
  function handleInlineEditLocation(td) {
    if (td.querySelector('input')) {
      return; // 已經在編輯狀態
    }

    var assetId = parseInt(td.getAttribute('data-id'), 10);
    var currentText = td.textContent.trim();

    // 建立 input 元素
    var input = document.createElement('input');
    input.type = 'text';
    input.value = currentText === '分隊' ? '' : currentText; // 如果是預設的「分隊」，點開後清空方便輸入
    input.style.width = '100%';
    input.style.padding = '4px 8px';
    input.style.borderRadius = '4px';
    input.style.border = '1px solid var(--color-primary)';
    input.style.background = 'var(--bg-primary)';
    input.style.color = 'var(--text-primary)';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '12px';

    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    var isSaving = false;
    var saveChange = async function () {
      if (isSaving) return;
      isSaving = true;

      var newText = input.value.trim() || '分隊'; // 如果為空，預設為「分隊」

      if (newText !== currentText) {
        try {
          await DB.updateAsset(assetId, { location: newText });
          td.textContent = newText;
          Utils.showToast('存放位置已更新', 'success');
        } catch (err) {
          logger.error('[App] 就地更新存放位置失敗：', err.message);
          Utils.showToast('更新失敗：' + err.message, 'error');
          td.textContent = currentText; // 還原
        }
      } else {
        td.textContent = currentText; // 未更改，還原
      }
    };

    // 監聽 blur 儲存
    input.addEventListener('blur', saveChange);
    // 監聽 Enter 儲存並失去焦點
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = currentText; // 放棄修改
        input.blur();
      }
    });
  }

  window.App = {
    init: init,
    navigateTo: navigateTo,

    // 財產模組（供 HTML 事件呼叫）
    openAssetModal: openAssetModal,
    saveAsset: saveAsset,
    deleteAsset: deleteAsset,
    exportAssetsPdf: exportAssetsPdf,

    // 照片模組（供 HTML 事件呼叫）
    removePhoto: removePhoto,
    openLightbox: openLightbox,

    // 人員模組（供 HTML 事件呼叫）
    openPersonnelModal: openPersonnelModal,
    savePersonnel: savePersonnel,
    deletePersonnel: deletePersonnel,
    viewPersonnelAssets: viewPersonnelAssets,
    toggleSelectPersonnel: toggleSelectPersonnel,
    exportPersonnelPdf: exportPersonnelPdf,

    // 資料維護模組（供 HTML 事件呼叫）
    addCategory: addCategory,
    removeCategory: removeCategory,

    // Excel 匯入（供 HTML 事件呼叫）
    openImportModal: openImportModal,
    confirmImport: confirmImport,
    downloadTemplate: downloadTemplate
  };

  logger.info('[App] 主控應用程式模組已載入，版本: 1.1.0');
})();
