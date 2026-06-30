/**
 * 消防隊財產管理系統 - 共用工具函數庫
 *
 * 所有函數掛載於 window.Utils 全域物件。
 * 禁止使用 ES Module export，禁止使用 console.log。
 *
 * @fileoverview 共用工具函數（Toast、Modal、圖片處理、日期、HTML、表單、下載、防抖、Logger）
 */

(function () {
  'use strict';

  // ============================================================
  // 常數定義
  // ============================================================

  /** @type {boolean} 開發模式旗標，依 hostname 自動判定 */
  const IS_DEV = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  /** Toast 自動關閉預設毫秒數 */
  const TOAST_DEFAULT_DURATION = 3000;

  /** 圖片壓縮最大寬高（px） */
  const IMAGE_MAX_DIMENSION = 1200;

  /** 圖片壓縮品質（0-1） */
  const IMAGE_QUALITY = 0.7;

  /** 圖片壓縮最大檔案大小（bytes） */
  const IMAGE_MAX_SIZE = 200 * 1024;

  /** Toast 退出動畫持續時間（ms） */
  const TOAST_EXIT_ANIMATION_MS = 300;

  // ============================================================
  // 1. Logger（必須最先定義，供其他函數使用）
  // ============================================================

  /**
   * Logger 物件，僅在開發模式輸出至 console。
   * 正式環境下所有方法皆為 no-op。
   *
   * @namespace
   * @property {Function} info  - 一般資訊日誌
   * @property {Function} warn  - 警告日誌
   * @property {Function} error - 錯誤日誌
   */
  const logger = {
    /**
     * 輸出一般資訊日誌
     * @param {...*} args - 任意數量的日誌參數
     */
    info: function () {
      if (IS_DEV) {
        Function.prototype.apply.call(console.info, console, arguments);
      }
    },

    /**
     * 輸出警告日誌
     * @param {...*} args - 任意數量的日誌參數
     */
    warn: function () {
      if (IS_DEV) {
        Function.prototype.apply.call(console.warn, console, arguments);
      }
    },

    /**
     * 輸出錯誤日誌
     * @param {...*} args - 任意數量的日誌參數
     */
    error: function () {
      if (IS_DEV) {
        Function.prototype.apply.call(console.error, console, arguments);
      }
    }
  };

  // ============================================================
  // 2. Toast 通知系統
  // ============================================================

  /**
   * Toast 類型對應的 SVG icon 路徑與色彩配置。
   * @type {Object<string, {icon: string, bgClass: string}>}
   */
  const TOAST_CONFIG = {
    success: {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      bgClass: 'toast-success'
    },
    warning: {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      bgClass: 'toast-warning'
    },
    error: {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      bgClass: 'toast-error'
    },
    info: {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
      bgClass: 'toast-info'
    }
  };

  /**
   * 確保 Toast 容器存在於 DOM 中。
   * @returns {HTMLElement} Toast 容器元素
   */
  function ensureToastContainer() {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText =
        'position:fixed;top:20px;right:20px;z-index:10000;' +
        'display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * 顯示 Toast 通知訊息。
   *
   * @param {string} message - 顯示的訊息文字
   * @param {'success'|'warning'|'error'|'info'} [type='info'] - 通知類型
   * @param {number} [duration=3000] - 自動關閉毫秒數，設 0 則不自動關閉
   * @returns {HTMLElement} 建立的 Toast 元素
   */
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = (typeof duration === 'number') ? duration : TOAST_DEFAULT_DURATION;

    var config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
    var container = ensureToastContainer();

    var toast = document.createElement('div');
    toast.className = 'toast ' + config.bgClass;
    toast.style.cssText =
      'pointer-events:auto;display:flex;align-items:center;gap:10px;' +
      'padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
      'animation:toastSlideIn 0.3s ease;min-width:280px;max-width:420px;';

    toast.innerHTML =
      '<span class="toast-icon" style="flex-shrink:0;display:flex;">' + config.icon + '</span>' +
      '<span class="toast-message" style="flex:1;">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;flex-shrink:0;opacity:0.7;" aria-label="關閉">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>';

    toast.querySelector('.toast-close').addEventListener('click', function () {
      removeToast(toast);
    });

    container.appendChild(toast);
    logger.info('[Toast]', type, message);

    if (duration > 0) {
      setTimeout(function () {
        removeToast(toast);
      }, duration);
    }

    return toast;
  }

  /**
   * 移除指定的 Toast 元素（含退出動畫）。
   *
   * @param {HTMLElement} toast - 要移除的 Toast DOM 元素
   */
  function removeToast(toast) {
    if (!toast || !toast.parentNode) {
      return;
    }
    toast.style.animation = 'toastSlideOut ' + TOAST_EXIT_ANIMATION_MS + 'ms ease forwards';
    setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, TOAST_EXIT_ANIMATION_MS);
  }

  // 注入 Toast 動畫 CSS（僅執行一次）
  (function injectToastStyles() {
    if (document.getElementById('utils-toast-styles')) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'utils-toast-styles';
    style.textContent =
      '@keyframes toastSlideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}' +
      '@keyframes toastSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}' +
      '.toast-success{background:#16a34a}' +
      '.toast-warning{background:#d97706}' +
      '.toast-error{background:#dc2626}' +
      '.toast-info{background:#2563eb}';
    document.head.appendChild(style);
  })();

  // ============================================================
  // 3. Modal 對話框
  // ============================================================

  /**
   * 開啟指定 ID 的 Modal。
   * 為 Modal 加上 active class 並設定 body overflow hidden。
   *
   * @param {string} modalId - Modal 元素的 DOM ID
   * @returns {HTMLElement|null} 開啟的 Modal 元素，找不到時回傳 null
   */
  function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) {
      logger.warn('[Modal] 找不到 Modal:', modalId);
      return null;
    }
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    logger.info('[Modal] 開啟:', modalId);
    return modal;
  }

  /**
   * 關閉指定 ID 的 Modal。
   * 移除 active class 並恢復 body overflow。
   *
   * @param {string} modalId - Modal 元素的 DOM ID
   * @returns {HTMLElement|null} 關閉的 Modal 元素，找不到時回傳 null
   */
  function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) {
      logger.warn('[Modal] 找不到 Modal:', modalId);
      return null;
    }
    modal.classList.remove('active');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    logger.info('[Modal] 關閉:', modalId);
    return modal;
  }

  /**
   * 顯示確認對話框，回傳 Promise<boolean>。
   * 動態建立 Modal，使用者點擊後自動移除。
   *
   * @param {string} title - 對話框標題
   * @param {string} message - 對話框內容訊息
   * @param {Object} [options] - 選項配置
   * @param {string} [options.confirmText='確認'] - 確認按鈕文字
   * @param {string} [options.cancelText='取消'] - 取消按鈕文字
   * @param {'danger'|'primary'|'warning'} [options.confirmStyle='primary'] - 確認按鈕樣式
   * @returns {Promise<boolean>} 使用者點擊確認回傳 true，取消回傳 false
   */
  function showConfirm(title, message, options) {
    options = options || {};
    var confirmText = options.confirmText || '確認';
    var cancelText = options.cancelText || '取消';
    var confirmStyle = options.confirmStyle || 'primary';

    /** 確認按鈕色彩對應 */
    var confirmColors = {
      danger: 'background:#dc2626;color:#fff;',
      primary: 'background:#2563eb;color:#fff;',
      warning: 'background:#d97706;color:#fff;'
    };
    var confirmBtnStyle = confirmColors[confirmStyle] || confirmColors.primary;

    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;' +
        'align-items:center;justify-content:center;z-index:10001;animation:fadeIn 0.2s ease;';

      var dialog = document.createElement('div');
      dialog.style.cssText =
        'background:#fff;border-radius:12px;padding:24px;max-width:420px;width:90%;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.3);';

      dialog.innerHTML =
        '<h3 style="margin:0 0 12px;font-size:18px;color:#1e293b;">' + escapeHtml(title) + '</h3>' +
        '<p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">' + escapeHtml(message) + '</p>' +
        '<div style="display:flex;justify-content:flex-end;gap:10px;">' +
          '<button class="confirm-cancel" style="padding:8px 20px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:14px;color:#374151;">' +
            escapeHtml(cancelText) +
          '</button>' +
          '<button class="confirm-ok" style="padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-size:14px;' + confirmBtnStyle + '">' +
            escapeHtml(confirmText) +
          '</button>' +
        '</div>';

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      /** 清除 Modal 並回傳結果 */
      function cleanup(result) {
        overlay.style.animation = 'fadeOut 0.15s ease forwards';
        setTimeout(function () {
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
        }, 150);
        resolve(result);
      }

      dialog.querySelector('.confirm-ok').addEventListener('click', function () {
        cleanup(true);
      });

      dialog.querySelector('.confirm-cancel').addEventListener('click', function () {
        cleanup(false);
      });

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          cleanup(false);
        }
      });
    });
  }

  // 注入 Confirm 動畫 CSS
  (function injectConfirmStyles() {
    if (document.getElementById('utils-confirm-styles')) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'utils-confirm-styles';
    style.textContent =
      '@keyframes fadeIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes fadeOut{from{opacity:1}to{opacity:0}}';
    document.head.appendChild(style);
  })();

  // ============================================================
  // 4. 圖片處理
  // ============================================================

  /**
   * 壓縮圖片檔案為 Base64 字串。
   * 限制最大寬高 1200px、品質 0.7、最大 200KB。
   * 若壓縮後仍超過 200KB，會逐步降低品質直到符合限制。
   *
   * @param {File} file - 圖片檔案物件（來自 input[type=file]）
   * @returns {Promise<string>} 壓縮後的 Base64 Data URL 字串
   * @throws {Error} 非圖片檔案或讀取失敗時拋出錯誤
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('僅支援圖片檔案，收到類型: ' + (file ? file.type : 'undefined')));
        return;
      }

      var reader = new FileReader();

      reader.onerror = function () {
        reject(new Error('讀取檔案失敗: ' + file.name));
      };

      reader.onload = function (e) {
        var img = new Image();

        img.onerror = function () {
          reject(new Error('載入圖片失敗: ' + file.name));
        };

        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');

            var width = img.width;
            var height = img.height;

            // 等比例縮放至最大寬高
            if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
              var ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // 逐步降低品質直到檔案大小符合限制
            var quality = IMAGE_QUALITY;
            var dataUrl = canvas.toDataURL('image/jpeg', quality);

            while (dataUrl.length > IMAGE_MAX_SIZE * 1.37 && quality > 0.1) {
              quality -= 0.1;
              dataUrl = canvas.toDataURL('image/jpeg', quality);
            }

            logger.info(
              '[compressImage] 原始:',
              file.size, 'bytes -> 壓縮後:',
              Math.round(dataUrl.length * 0.73), 'bytes (品質:', quality.toFixed(1) + ')'
            );

            resolve(dataUrl);
          } catch (err) {
            reject(new Error('壓縮圖片時發生錯誤: ' + err.message));
          }
        };

        img.src = /** @type {string} */ (e.target.result);
      };

      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // 5. 日期格式化
  // ============================================================

  /**
   * 將日期格式化為 YYYY-MM-DD 字串。
   *
   * @param {Date|string|number} date - Date 物件、ISO 字串或時間戳
   * @returns {string} 格式化後的日期字串，輸入無效時回傳空字串
   */
  function formatDate(date) {
    var d = toDateObject(date);
    if (!d) {
      return '';
    }
    var year = d.getFullYear();
    var month = padZero(d.getMonth() + 1);
    var day = padZero(d.getDate());
    return year + '-' + month + '-' + day;
  }

  /**
   * 將日期格式化為 YYYY-MM-DD HH:mm 字串。
   *
   * @param {Date|string|number} date - Date 物件、ISO 字串或時間戳
   * @returns {string} 格式化後的日期時間字串，輸入無效時回傳空字串
   */
  function formatDateTime(date) {
    var d = toDateObject(date);
    if (!d) {
      return '';
    }
    var hours = padZero(d.getHours());
    var minutes = padZero(d.getMinutes());
    return formatDate(d) + ' ' + hours + ':' + minutes;
  }

  /**
   * 計算指定日期距今天數。
   * 正值表示未來日期，負值表示過去日期。
   *
   * @param {Date|string|number} date - Date 物件、ISO 字串或時間戳
   * @returns {number} 距今天數（整數），輸入無效時回傳 NaN
   */
  function daysFromNow(date) {
    var d = toDateObject(date);
    if (!d) {
      return NaN;
    }
    var now = new Date();
    // 清除時分秒，僅比較日期
    var target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diffMs = target.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * 將輸入轉為有效的 Date 物件。
   * @param {Date|string|number} input - 日期輸入
   * @returns {Date|null} 有效的 Date 物件或 null
   * @private
   */
  function toDateObject(input) {
    if (!input) {
      return null;
    }
    var d = (input instanceof Date) ? input : new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * 將西元日期字串轉為民國日期（例如：2025-10-21 轉為 114/10/21）。
   * @param {Date|string|number} date - 日期輸入
   * @returns {string} 民國格式日期，無效時回傳原值或 "-"
   */
  function formatMinguoDate(date) {
    if (!date) {
      return '-';
    }
    var d = toDateObject(date);
    if (!d) {
      if (typeof date === 'string') {
        var clean = date.replace(/-/g, '/').trim();
        return clean || '-';
      }
      return '-';
    }
    var adYear = d.getFullYear();
    var minguoYear = adYear - 1911;
    var month = padZero(d.getMonth() + 1);
    var day = padZero(d.getDate());
    return minguoYear + '/' + month + '/' + day;
  }

  /**
   * 數字補零至兩位。
   * @param {number} num - 要補零的數字
   * @returns {string} 補零後的字串
   * @private
   */
  function padZero(num) {
    return num < 10 ? '0' + num : String(num);
  }

  // ============================================================
  // 6. HTML 工具
  // ============================================================

  /**
   * HTML 特殊字元轉義（XSS 防護）。
   * 處理 &, <, >, ", ' 五種字元。
   *
   * @param {string} str - 需轉義的原始字串
   * @returns {string} 轉義後的安全字串
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') {
      return '';
    }
    var map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, function (char) {
      return map[char];
    });
  }

  /**
   * 財產狀態對應的 Badge 樣式配置。
   * @type {Object<string, {label: string, bg: string, color: string}>}
   */
  var CONDITION_STYLES = {
    '堪用': { label: '堪用', bg: '#dcfce7', color: '#166534' },
    '待修': { label: '待修', bg: '#fef3c7', color: '#92400e' },
    '報廢': { label: '報廢', bg: '#fee2e2', color: '#991b1b' },
    '遺失': { label: '遺失', bg: '#e0e7ff', color: '#3730a3' }
  };

  /**
   * 根據財產狀態回傳對應樣式的 HTML Badge 字串。
   * 支援狀態：堪用、待修、報廢、遺失。
   *
   * @param {string} condition - 財產狀態字串
   * @returns {string} 包含內聯樣式的 span HTML 字串
   */
  function renderConditionBadge(condition) {
    var style = CONDITION_STYLES[condition] || { label: condition || '未知', bg: '#f1f5f9', color: '#475569' };
    return (
      '<span style="' +
        'display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;' +
        'background:' + style.bg + ';color:' + style.color + ';">' +
        escapeHtml(style.label) +
      '</span>'
    );
  }

  /**
   * 取得姓名首字（用於頭像顯示）。
   *
   * @param {string} name - 姓名字串
   * @returns {string} 姓名的第一個字元，輸入為空時回傳 '?'
   */
  function getInitial(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return '?';
    }
    return name.trim().charAt(0);
  }

  // ============================================================
  // 7. 表單工具
  // ============================================================

  /**
   * 從 form 元素收集所有具名欄位的資料。
   * 支援 input、select、textarea，含 checkbox 布林值處理。
   *
   * @param {HTMLFormElement|string} form - form DOM 元素或其 ID 字串
   * @returns {Object<string, string|boolean>} 表單資料鍵值物件
   */
  function getFormData(form) {
    var formEl = (typeof form === 'string') ? document.getElementById(form) : form;
    if (!formEl || formEl.tagName !== 'FORM') {
      logger.warn('[getFormData] 無效的 form 元素');
      return {};
    }

    var data = {};
    var elements = formEl.elements;

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.disabled) {
        continue;
      }

      switch (el.type) {
        case 'checkbox':
          data[el.name] = el.checked;
          break;
        case 'radio':
          if (el.checked) {
            data[el.name] = el.value;
          }
          break;
        case 'file':
          // 跳過 file 類型，由呼叫端自行處理
          break;
        default:
          data[el.name] = el.value;
      }
    }

    return data;
  }

  /**
   * 重設表單所有欄位為預設值。
   *
   * @param {HTMLFormElement|string} form - form DOM 元素或其 ID 字串
   */
  function resetForm(form) {
    var formEl = (typeof form === 'string') ? document.getElementById(form) : form;
    if (!formEl || formEl.tagName !== 'FORM') {
      logger.warn('[resetForm] 無效的 form 元素');
      return;
    }
    formEl.reset();
    logger.info('[resetForm] 表單已重設');
  }

  // ============================================================
  // 8. 檔案下載
  // ============================================================

  /**
   * 觸發瀏覽器下載指定內容的檔案。
   *
   * @param {string} content - 檔案文字內容
   * @param {string} filename - 下載檔名
   * @param {string} [mimeType='text/plain'] - MIME 類型
   */
  function downloadFile(content, filename, mimeType) {
    mimeType = mimeType || 'text/plain';
    var blob = new Blob([content], { type: mimeType });
    downloadBlob(blob, filename);
  }

  /**
   * 觸發瀏覽器下載 Blob 物件。
   *
   * @param {Blob} blob - 要下載的 Blob 物件
   * @param {string} filename - 下載檔名
   */
  function downloadBlob(blob, filename) {
    try {
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      // 延遲釋放 URL，確保下載已觸發
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (anchor.parentNode) {
          anchor.parentNode.removeChild(anchor);
        }
      }, 100);
      logger.info('[downloadBlob] 已觸發下載:', filename);
    } catch (err) {
      logger.error('[downloadBlob] 下載失敗:', err.message);
    }
  }

  // ============================================================
  // 9. 防抖
  // ============================================================

  /**
   * 防抖函數，延遲執行直到停止觸發一段時間後才執行。
   *
   * @param {Function} fn - 要防抖的目標函數
   * @param {number} [delay=300] - 延遲毫秒數
   * @returns {Function} 包裝後的防抖函數
   */
  function debounce(fn, delay) {
    delay = (typeof delay === 'number') ? delay : 300;
    var timer = null;

    return function () {
      var context = this;
      var args = arguments;

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(function () {
        fn.apply(context, args);
        timer = null;
      }, delay);
    };
  }

  // ============================================================
  // 掛載至 window.Utils
  // ============================================================

  window.Utils = {
    // Toast 通知系統
    showToast: showToast,
    removeToast: removeToast,

    // Modal 對話框
    openModal: openModal,
    closeModal: closeModal,
    showConfirm: showConfirm,

    // 圖片處理
    compressImage: compressImage,

    // 日期格式化
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatMinguoDate: formatMinguoDate,
    daysFromNow: daysFromNow,

    // HTML 工具
    escapeHtml: escapeHtml,
    renderConditionBadge: renderConditionBadge,
    getInitial: getInitial,

    // 表單工具
    getFormData: getFormData,
    resetForm: resetForm,

    // 檔案下載
    downloadFile: downloadFile,
    downloadBlob: downloadBlob,

    // 防抖
    debounce: debounce,

    // Logger
    logger: logger
  };

  logger.info('[Utils] 共用工具函數庫已載入，版本: 1.0.0');
})();
