/**
 * 消防隊財產管理系統 - 雙引擎資料庫層 (IndexedDB & Firebase Firestore)
 *
 * 支援「漸進式增強」：
 * 1. 若 window.FIREBASE_CONFIG 已配置有效金鑰，自動升級為 Firebase 雲端同步模式，並啟用離線快取支援。
 * 2. 若未配置金鑰，則自動降級為本地 Dexie.js (IndexedDB) 單機模式。
 *
 * 所有對外函數（getAllPersonnel, getAllAssets 等）的 API 接口與回傳格式皆保持一致，內部自動依模式分流。
 *
 * @version 1.1.0
 */

(function () {
  'use strict';

  // ============================================================
  // 1. 全域命名空間與內部狀態
  // ============================================================

  window.DB = window.DB || {};

  /** 記錄目前是否啟用 Firebase 模式 */
  let isFirebaseMode = false;

  /** Firebase Firestore 實例 */
  let firestore = null;

  /** 本地 Dexie.js 資料庫實例 (本地模式主庫，雲端模式下做備份 fallback 或 settings 保留) */
  let db = null;

  // ============================================================
  // 2. 預設常數
  // ============================================================

  /** @type {string[]} 財產類別預設值 */
  window.DB.DEFAULT_CATEGORIES = [
    '個人裝備',
    '車輛裝備',
    '通訊器材',
    '救助器材',
    '救護器材',
    '消防衣物',
    '辦公設備',
    '其他'
  ];

  /** @type {string[]} 人員階級預設值 */
  window.DB.DEFAULT_RANKS = [
    '隊員',
    '小隊長',
    '分隊長',
    '副中隊長',
    '中隊長'
  ];

  /** @type {string[]} 財產狀態列舉 */
  window.DB.ASSET_CONDITIONS = ['堪用', '待修', '報廢', '遺失'];

  // ============================================================
  // 3. 模式輔助函數
  // ============================================================

  /**
   * 取得目前資料庫運行模式。
   * @returns {'firebase'|'local'} 運行模式
   */
  window.DB.getMode = function getMode() {
    return isFirebaseMode ? 'firebase' : 'local';
  };

  // ============================================================
  // 4. 初始化
  // ============================================================

  /**
   * 初始化資料庫。檢測 Firebase 設定並嘗試連接；失敗或未設定時使用本地 Dexie。
   *
   * @returns {Promise<Object>} 資料庫實例資訊
   * @throws {Error} 當資料庫初始化均失敗時拋出錯誤
   */
  window.DB.initDB = async function initDB() {
    try {
      const cfg = window.FIREBASE_CONFIG;
      const hasConfig = cfg && cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY' && cfg.projectId && cfg.projectId !== 'YOUR_PROJECT_ID';

      if (hasConfig) {
        try {
          if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK 尚未載入，請確認已在 index.html 引入 compat 腳本');
          }

          // 初始化 Firebase App (單例模式)
          if (firebase.apps.length === 0) {
            firebase.initializeApp(cfg);
          }

          firestore = firebase.firestore();

          // 啟用 Firestore 離線持久化快取 (Persistence) — 僅在非本地運行環境下啟用，避免本地多 Tab 與沙箱環境下的快取鎖定死鎖
          var isLocalEnv = window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1' || 
                           window.location.protocol === 'file:';
          if (!isLocalEnv) {
            try {
              await firestore.enablePersistence({ synchronizeTabs: true });
            } catch (pErr) {
              if (typeof window.Utils !== 'undefined' && window.Utils.logger) {
                window.Utils.logger.warn('[DB] Firestore 離線持久化啟用失敗或已在其他分頁啟用：', pErr.message);
              }
            }
          } else {
            if (typeof window.Utils !== 'undefined' && window.Utils.logger) {
              window.Utils.logger.info('[DB] 檢測到本地開發或運行環境，跳過離線持久化以防快取鎖定');
            }
          }

          isFirebaseMode = true;
          if (typeof window.Utils !== 'undefined' && window.Utils.logger) {
            window.Utils.logger.info('[DB] 成功啟用 Firebase Firestore 雲端即時同步模式');
          }
        } catch (fbError) {
          if (typeof window.Utils !== 'undefined' && window.Utils.logger) {
            window.Utils.logger.error('[DB] 初始化 Firebase 雲端失敗，降級至單機 Dexie 模式：', fbError.message);
          }
          isFirebaseMode = false;
        }
      } else {
        isFirebaseMode = false;
        if (typeof window.Utils !== 'undefined' && window.Utils.logger) {
          window.Utils.logger.info('[DB] 未配置 Firebase 設定，使用本地 Dexie (IndexedDB) 單機模式');
        }
      }

      // 初始化本地 Dexie.js (不論是否為 Firebase 模式都載入，做為 Fallback)
      if (typeof Dexie === 'undefined') {
        throw new Error('Dexie.js 尚未載入，請確認已引入 Dexie');
      }

      db = new Dexie('FireDeptAssetDB');
      db.version(1).stores({
        personnel: '++id, name, rank, status, *skills',
        assets: '++id, assetCode, name, category, condition, assignedTo, location',
        settings: 'key'
      });

      await db.open();
      await window.DB.initDefaultSettings();

      return {
        mode: window.DB.getMode(),
        localDb: db,
        firestore: firestore
      };
    } catch (error) {
      throw new Error('資料庫初始化失敗：' + error.message);
    }
  };

  /**
   * 寫入預設設定（僅在本地模式的設定表中寫入初始標記）。
   */
  window.DB.initDefaultSettings = async function initDefaultSettings() {
    try {
      if (isFirebaseMode) {
        // 在雲端模式下，檢查是否已初始化設定
        const categoriesDoc = await firestore.collection('settings').doc('categories').get();
        if (!categoriesDoc.exists) {
          await firestore.collection('settings').doc('categories').set({ value: window.DB.DEFAULT_CATEGORIES });
          await firestore.collection('settings').doc('ranks').set({ value: window.DB.DEFAULT_RANKS });
          await firestore.collection('settings').doc('assetConditions').set({ value: window.DB.ASSET_CONDITIONS });
          await firestore.collection('settings').doc('passwords').set({ value: { admin: 'admin', login: '12345678', readonly: '12345678' } });
          await firestore.collection('settings').doc('initialized').set({ value: true });
        }
      } else {
        // 本地模式
        const existing = await db.settings.get('initialized');
        if (existing) return;

        await db.settings.bulkPut([
          { key: 'categories', value: window.DB.DEFAULT_CATEGORIES },
          { key: 'ranks', value: window.DB.DEFAULT_RANKS },
          { key: 'assetConditions', value: window.DB.ASSET_CONDITIONS },
          { key: 'passwords', value: { admin: 'admin', login: '12345678', readonly: '12345678' } },
          { key: 'initialized', value: true }
        ]);
      }
    } catch (error) {
      throw new Error('寫入預設設定失敗：' + error.message);
    }
  };

  // ============================================================
  // 5. Settings CRUD (支援雙模式)
  // ============================================================

  window.DB.getSetting = async function getSetting(key) {
    try {
      if (isFirebaseMode) {
        const doc = await firestore.collection('settings').doc(key).get();
        return doc.exists ? doc.data().value : undefined;
      } else {
        const record = await db.settings.get(key);
        return record ? record.value : undefined;
      }
    } catch (error) {
      throw new Error('讀取設定「' + key + '」失敗：' + error.message);
    }
  };

  window.DB.setSetting = async function setSetting(key, value) {
    try {
      if (isFirebaseMode) {
        await firestore.collection('settings').doc(key).set({ value: value });
        return key;
      } else {
        return await db.settings.put({ key, value });
      }
    } catch (error) {
      throw new Error('寫入設定「' + key + '」失敗：' + error.message);
    }
  };

  // ============================================================
  // 6. Firebase 自增 ID 輔助函數
  // ============================================================

  /**
   * 產生分隊隔離的 Firestore 文件 ID。
   * 非 admin 分隊使用 `分隊名_數字` 格式，確保不同分隊的文件 ID 永不衝突。
   *
   * @param {number|string} id - 數字 ID
   * @param {string} [branch] - 分隊名稱，未提供時自動從 sessionStorage 取得
   * @returns {string} Firestore 文件 ID
   */
  function makeBranchDocId(id, branch) {
    var b = branch || sessionStorage.getItem('currentBranch') || 'admin';
    if (b === 'admin') return String(id);
    return b + '_' + String(id);
  }

  /**
   * 取得指定 Firestore 集合中的下一個自增數字 ID。
   *
   * @param {string} collectionName - 集合名稱 ('personnel' | 'assets')
   * @returns {Promise<number>} 下一個可用 ID
   */
  async function getNextFirebaseId(collectionName) {
    const snap = await firestore.collection(collectionName).orderBy('id', 'desc').limit(1).get();
    if (!snap.empty) {
      return (snap.docs[0].data().id || 0) + 1;
    }
    return 1;
  }

  // ============================================================
  // 7. Personnel CRUD (支援雙模式)
  // ============================================================

  window.DB.getAllPersonnel = async function getAllPersonnel(filters) {
    try {
      filters = filters || {};
      let results = [];

      if (isFirebaseMode) {
        // 從雲端獲取所有人員，並在前端進行過濾以避免複合索引限制
        const snap = await firestore.collection('personnel').get();
        snap.forEach(function (doc) {
          results.push(doc.data());
        });
      } else {
        // 本地模式
        results = await db.personnel.toArray();
      }

      // 分隊過濾
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';
      if (currentBranch !== 'admin') {
        results = results.filter(function (p) {
          return p.branch === currentBranch;
        });
      }

      // 1. 在職狀態篩選
      if (filters.status) {
        results = results.filter(function (p) {
          return p.status === filters.status;
        });
      }

      // 2. 階級篩選
      if (filters.rank) {
        results = results.filter(function (p) {
          return p.rank === filters.rank;
        });
      }

      // 3. 模糊搜尋
      if (filters.search) {
        const keyword = filters.search.toLowerCase();
        results = results.filter(function (p) {
          const nameMatch = p.name && p.name.toLowerCase().indexOf(keyword) !== -1;
          const phoneMatch = p.phone && p.phone.toLowerCase().indexOf(keyword) !== -1;
          return nameMatch || phoneMatch;
        });
      }

      // 4. 技能篩選
      if (filters.skill) {
        results = results.filter(function (p) {
          return Array.isArray(p.skills) && p.skills.indexOf(filters.skill) !== -1;
        });
      }

      return results;
    } catch (error) {
      throw new Error('查詢人員失敗：' + error.message);
    }
  };

  window.DB.getPersonnelById = async function getPersonnelById(id) {
    try {
      if (isFirebaseMode) {
        const doc = await firestore.collection('personnel').doc(makeBranchDocId(id)).get();
        return doc.exists ? doc.data() : undefined;
      } else {
        return await db.personnel.get(id);
      }
    } catch (error) {
      throw new Error('查詢人員（ID: ' + id + '）失敗：' + error.message);
    }
  };

  window.DB.addPersonnel = async function addPersonnel(data) {
    try {
      if (!data || !data.name || !data.name.trim()) {
        throw new Error('姓名為必填欄位');
      }

      const now = new Date().toISOString();
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      if (isFirebaseMode) {
        const id = await getNextFirebaseId('personnel');
        const record = {
          id: id,
          name: data.name.trim(),
          rank: data.rank || '',
          status: data.status || '在職',
          skills: Array.isArray(data.skills) ? data.skills : [],
          phone: data.phone || '',
          branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
          createdAt: now,
          updatedAt: now
        };
        await firestore.collection('personnel').doc(makeBranchDocId(id)).set(record);
        return id;
      } else {
        const record = {
          name: data.name.trim(),
          rank: data.rank || '',
          status: data.status || '在職',
          skills: Array.isArray(data.skills) ? data.skills : [],
          phone: data.phone || '',
          branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
          createdAt: now,
          updatedAt: now
        };
        return await db.personnel.add(record);
      }
    } catch (error) {
      throw new Error('新增人員失敗：' + error.message);
    }
  };

  window.DB.updatePersonnel = async function updatePersonnel(id, data) {
    try {
      data.updatedAt = new Date().toISOString();

      if (isFirebaseMode) {
        const ref = firestore.collection('personnel').doc(makeBranchDocId(id));
        const doc = await ref.get();
        if (!doc.exists) {
          throw new Error('找不到 ID 為 ' + id + ' 的人員');
        }
        await ref.update(data);
        return 1;
      } else {
        const existing = await db.personnel.get(id);
        if (!existing) {
          throw new Error('找不到 ID 為 ' + id + ' 的人員');
        }
        return await db.personnel.update(id, data);
      }
    } catch (error) {
      throw new Error('更新人員（ID: ' + id + '）失敗：' + error.message);
    }
  };

  window.DB.deletePersonnel = async function deletePersonnel(id) {
    try {
      if (isFirebaseMode) {
        const ref = firestore.collection('personnel').doc(makeBranchDocId(id));
        const doc = await ref.get();
        if (!doc.exists) {
          throw new Error('找不到 ID 為 ' + id + ' 的人員');
        }

        // 解除配發資產 (Firestore)
        const assetsSnap = await firestore.collection('assets').where('assignedTo', '==', id).get();
        const batch = firestore.batch();
        const now = new Date().toISOString();
        assetsSnap.forEach(function (aDoc) {
          batch.update(aDoc.ref, { assignedTo: null, updatedAt: now });
        });
        batch.delete(ref);
        await batch.commit();
      } else {
        // 本地模式
        const existing = await db.personnel.get(id);
        if (!existing) {
          throw new Error('找不到 ID 為 ' + id + ' 的人員');
        }

        await db.transaction('rw', db.personnel, db.assets, async function () {
          var assignedAssets = await db.assets.where('assignedTo').equals(id).toArray();
          var now = new Date().toISOString();
          for (var i = 0; i < assignedAssets.length; i++) {
            await db.assets.update(assignedAssets[i].id, { assignedTo: null, updatedAt: now });
          }
          await db.personnel.delete(id);
        });
      }
    } catch (error) {
      throw new Error('刪除人員（ID: ' + id + '）失敗：' + error.message);
    }
  };

  // ============================================================
  // 8. Assets CRUD (支援雙模式)
  // ============================================================

  window.DB.getAllAssets = async function getAllAssets(filters) {
    try {
      filters = filters || {};
      let results = [];

      if (isFirebaseMode) {
        let query = firestore.collection('assets');
        // 優先在雲端做單一主要篩選，剩餘回前端過濾，避免需要建立多條件複合索引
        if (filters.category) {
          query = query.where('category', '==', filters.category);
        } else if (filters.condition) {
          query = query.where('condition', '==', filters.condition);
        } else if (filters.assignedTo !== undefined && filters.assignedTo !== null) {
          query = query.where('assignedTo', '==', filters.assignedTo);
        } else if (filters.location) {
          query = query.where('location', '==', filters.location);
        }

        const snap = await query.get();
        snap.forEach(function (doc) {
          results.push(doc.data());
        });
      } else {
        // 本地模式
        if (filters.category) {
          results = await db.assets.where('category').equals(filters.category).toArray();
        } else if (filters.condition) {
          results = await db.assets.where('condition').equals(filters.condition).toArray();
        } else if (filters.assignedTo !== undefined && filters.assignedTo !== null) {
          results = await db.assets.where('assignedTo').equals(filters.assignedTo).toArray();
        } else if (filters.location) {
          results = await db.assets.where('location').equals(filters.location).toArray();
        } else {
          results = await db.assets.toArray();
        }
      }

      // 分隊過濾
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';
      if (currentBranch !== 'admin') {
        results = results.filter(function (a) {
          return a.branch === currentBranch;
        });
      }

      // 記憶體中過濾
      if (filters.category && isFirebaseMode) {
        // 已在雲端進行過 filter，其餘條件在記憶體內篩選
      } else if (filters.category) {
        // 本地篩選
      }

      if (filters.category && filters.condition) {
        results = results.filter(a => a.condition === filters.condition);
      }
      if (filters.category && filters.assignedTo !== undefined && filters.assignedTo !== null) {
        results = results.filter(a => a.assignedTo === filters.assignedTo);
      }
      if (filters.condition && filters.assignedTo !== undefined && filters.assignedTo !== null && !filters.category) {
        results = results.filter(a => a.assignedTo === filters.assignedTo);
      }
      if (filters.location && (filters.category || filters.condition || filters.assignedTo !== undefined)) {
        results = results.filter(a => a.location === filters.location);
      }

      // 模糊搜尋 (支持 品名、編號、備註、配發人員姓名)
      if (filters.search) {
        const keyword = filters.search.toLowerCase();
        const matchedPersonnelIds = [];

        // 查詢符合名字的人員 ID 列表
        try {
          const allPeople = await window.DB.getAllPersonnel();
          for (var i = 0; i < allPeople.length; i++) {
            var p = allPeople[i];
            if (p.name && p.name.toLowerCase().indexOf(keyword) !== -1) {
              matchedPersonnelIds.push(p.id);
            }
          }
        } catch (err) {
          // 靜默
        }

        results = results.filter(function (a) {
          const nameMatch = a.name && a.name.toLowerCase().indexOf(keyword) !== -1;
          const codeMatch = a.assetCode && a.assetCode.toLowerCase().indexOf(keyword) !== -1;
          const noteMatch = a.notes && a.notes.toLowerCase().indexOf(keyword) !== -1;
          const assignedMatch = a.assignedTo && matchedPersonnelIds.indexOf(a.assignedTo) !== -1;
          return nameMatch || codeMatch || noteMatch || assignedMatch;
        });
      }

      return results;
    } catch (error) {
      throw new Error('查詢財產失敗：' + error.message);
    }
  };

  window.DB.getAssetById = async function getAssetById(id) {
    try {
      if (isFirebaseMode) {
        const doc = await firestore.collection('assets').doc(makeBranchDocId(id)).get();
        return doc.exists ? doc.data() : undefined;
      } else {
        return await db.assets.get(id);
      }
    } catch (error) {
      throw new Error('查詢財產（ID: ' + id + '）失敗：' + error.message);
    }
  };

  window.DB.getAssetsByPersonnel = async function getAssetsByPersonnel(personnelId) {
    try {
      let results = [];

      if (isFirebaseMode) {
        const snap = await firestore.collection('assets').where('assignedTo', '==', personnelId).get();
        snap.forEach(doc => results.push(doc.data()));
      } else {
        results = await db.assets.where('assignedTo').equals(personnelId).toArray();
      }

      // 分隊過濾（與 getAllAssets 保持一致）
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';
      if (currentBranch !== 'admin') {
        results = results.filter(function (a) {
          return a.branch === currentBranch;
        });
      }

      return results;
    } catch (error) {
      throw new Error('查詢人員配發財產失敗：' + error.message);
    }
  };

  window.DB.addAsset = async function addAsset(data) {
    try {
      if (!data || !data.name || !data.name.trim()) {
        throw new Error('品名為必填欄位');
      }

      const now = new Date().toISOString();
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      if (isFirebaseMode) {
        const id = await getNextFirebaseId('assets');
        const record = {
          id: id,
          assetCode: data.assetCode || '',
          name: data.name.trim(),
          category: data.category || '其他',
          condition: data.condition || '堪用',
          assignedTo: data.assignedTo !== undefined ? data.assignedTo : null,
          location: data.location || '',
          spec: data.spec || '',
          acquiredDate: data.acquiredDate || '',
          expiryDate: data.expiryDate || '',
          photos: Array.isArray(data.photos) ? data.photos : [],
          notes: data.notes || '',
          branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
          createdAt: now,
          updatedAt: now
        };
        await firestore.collection('assets').doc(makeBranchDocId(id)).set(record);
        return id;
      } else {
        const record = {
          assetCode: data.assetCode || '',
          name: data.name.trim(),
          category: data.category || '其他',
          condition: data.condition || '堪用',
          assignedTo: data.assignedTo !== undefined ? data.assignedTo : null,
          location: data.location || '',
          spec: data.spec || '',
          acquiredDate: data.acquiredDate || '',
          expiryDate: data.expiryDate || '',
          photos: Array.isArray(data.photos) ? data.photos : [],
          notes: data.notes || '',
          branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
          createdAt: now,
          updatedAt: now
        };
        return await db.assets.add(record);
      }
    } catch (error) {
      throw new Error('新增財產失敗：' + error.message);
    }
  };

  window.DB.updateAsset = async function updateAsset(id, data) {
    try {
      data.updatedAt = new Date().toISOString();

      if (isFirebaseMode) {
        const ref = firestore.collection('assets').doc(makeBranchDocId(id));
        const doc = await ref.get();
        if (!doc.exists) {
          throw new Error('找不到 ID 為 ' + id + ' 的財產');
        }
        await ref.update(data);
        return 1;
      } else {
        const existing = await db.assets.get(id);
        if (!existing) {
          throw new Error('找不到 ID 為 ' + id + ' 的財產');
        }
        return await db.assets.update(id, data);
      }
    } catch (error) {
      throw new Error('更新財產（ID: ' + id + '）失敗：' + error.message);
    }
  };

  window.DB.deleteAsset = async function deleteAsset(id) {
    try {
      if (isFirebaseMode) {
        const ref = firestore.collection('assets').doc(makeBranchDocId(id));
        const doc = await ref.get();
        if (!doc.exists) {
          throw new Error('找不到 ID 為 ' + id + ' 的財產');
        }
        await ref.delete();
      } else {
        const existing = await db.assets.get(id);
        if (!existing) {
          throw new Error('找不到 ID 為 ' + id + ' 的財產');
        }
        await db.assets.delete(id);
      }
    } catch (error) {
      throw new Error('刪除財產（ID: ' + id + '）失敗：' + error.message);
    }
  };

  window.DB.bulkAddAssets = async function bulkAddAssets(items) {
    try {
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('批次新增需提供非空的財產資料陣列');
      }

      const now = new Date().toISOString();
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      if (isFirebaseMode) {
        // 取得開始自增 ID
        const startId = await getNextFirebaseId('assets');

        // Firestore Batch 每次寫入上限 500。我們將大陣列切片成 400 筆一包分批提交，防止溢位報錯。
        const chunks = [];
        let tempChunk = [];

        for (let i = 0; i < items.length; i++) {
          const data = items[i];
          if (!data.name || !data.name.trim()) {
            throw new Error('第 ' + (i + 1) + ' 筆資料缺少品名');
          }
          const record = {
            id: startId + i,
            assetCode: data.assetCode || '',
            name: data.name.trim(),
            category: data.category || '其他',
            condition: data.condition || '堪用',
            assignedTo: data.assignedTo !== undefined ? data.assignedTo : null,
            location: data.location || '',
            spec: data.spec || '',
            acquiredDate: data.acquiredDate || '',
            expiryDate: data.expiryDate || '',
            photos: Array.isArray(data.photos) ? data.photos : [],
            notes: data.notes || '',
            branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
            createdAt: now,
            updatedAt: now
          };
          tempChunk.push(record);
          if (tempChunk.length === 400) {
            chunks.push(tempChunk);
            tempChunk = [];
          }
        }
        if (tempChunk.length > 0) {
          chunks.push(tempChunk);
        }

        // 循序提交 batches
        for (let c = 0; c < chunks.length; c++) {
          const batch = firestore.batch();
          const chunk = chunks[c];
          for (let j = 0; j < chunk.length; j++) {
            const rec = chunk[j];
            const docRef = firestore.collection('assets').doc(makeBranchDocId(rec.id));
            batch.set(docRef, rec);
          }
          await batch.commit();
        }
        return items.length;
      } else {
        // 本地 Dexie
        const records = items.map(function (data, index) {
          if (!data.name || !data.name.trim()) {
            throw new Error('第 ' + (index + 1) + ' 筆資料缺少品名');
          }
          return {
            assetCode: data.assetCode || '',
            name: data.name.trim(),
            category: data.category || '其他',
            condition: data.condition || '堪用',
            assignedTo: data.assignedTo !== undefined ? data.assignedTo : null,
            location: data.location || '',
            spec: data.spec || '',
            acquiredDate: data.acquiredDate || '',
            expiryDate: data.expiryDate || '',
            photos: Array.isArray(data.photos) ? data.photos : [],
            notes: data.notes || '',
            branch: currentBranch !== 'admin' ? currentBranch : (data.branch || '雙福分隊'),
            createdAt: now,
            updatedAt: now
          };
        });
        await db.assets.bulkAdd(records);
        return records.length;
      }
    } catch (error) {
      throw new Error('批次新增財產失敗：' + error.message);
    }
  };

  // ============================================================
  // 9. Statistics (支援雙模式)
  // ============================================================

  window.DB.getDashboardStats = async function getDashboardStats() {
    try {
      let activePersonnel = 0;
      let allAssets = [];
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      if (isFirebaseMode) {
        // 在職人員
        const pSnap = await firestore.collection('personnel').where('status', '==', '在職').get();
        let pList = [];
        pSnap.forEach(doc => pList.push(doc.data()));
        if (currentBranch !== 'admin') {
          pList = pList.filter(p => p.branch === currentBranch);
        }
        activePersonnel = pList.length;

        // 所有財產
        const aSnap = await firestore.collection('assets').get();
        aSnap.forEach(doc => allAssets.push(doc.data()));
        if (currentBranch !== 'admin') {
          allAssets = allAssets.filter(a => a.branch === currentBranch);
        }
      } else {
        // 本地模式
        let pList = await db.personnel.where('status').equals('In-Service').toArray(); // 舊有結構可能為 '在職'，Dexie 中如果用 Equals 需注意
        // Fallback to in-service check
        pList = await db.personnel.where('status').equals('在職').toArray();
        if (currentBranch !== 'admin') {
          pList = pList.filter(p => p.branch === currentBranch);
        }
        activePersonnel = pList.length;
        
        allAssets = await db.assets.toArray();
        if (currentBranch !== 'admin') {
          allAssets = allAssets.filter(a => a.branch === currentBranch);
        }
      }

      const totalAssets = allAssets.length;

      // 各狀態統計
      const conditionBreakdown = {};
      window.DB.ASSET_CONDITIONS.forEach(c => { conditionBreakdown[c] = 0; });
      allAssets.forEach(a => {
        if (conditionBreakdown[a.condition] !== undefined) {
          conditionBreakdown[a.condition]++;
        }
      });

      // 各類別統計
      const categoryBreakdown = {};
      allAssets.forEach(a => {
        const cat = a.category || '其他';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      });

      // 未配發數量
      const unassignedCount = allAssets.filter(a => a.assignedTo === null || a.assignedTo === undefined).length;

      // 30 天內即將到期設備
      const now = new Date();
      const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const nowStr = now.toISOString().slice(0, 10);
      const futureStr = thirtyDays.toISOString().slice(0, 10);

      // 智慧到期日期獲取（若空則以購置日期+5年推算）
      const getExpiry = a => {
        let exp = a.expiryDate;
        if (!exp && a.acquiredDate) {
          try {
            var date = new Date(a.acquiredDate);
            if (!isNaN(date.getTime())) {
              date.setFullYear(date.getFullYear() + 5);
              exp = date.toISOString().slice(0, 10);
            }
          } catch (e) {}
        }
        return exp || '';
      };

      const expiringAssets = allAssets.filter(a => {
        const exp = getExpiry(a);
        return exp && exp >= nowStr && exp <= futureStr;
      });

      // 已到期設備
      const expiredAssets = allAssets.filter(a => {
        const exp = getExpiry(a);
        return exp && exp < nowStr;
      });

      // 最近 10 筆異動 (排序)
      const recentAssets = allAssets
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 10);

      return {
        totalPersonnel: activePersonnel,
        totalAssets: totalAssets,
        conditionBreakdown: conditionBreakdown,
        categoryBreakdown: categoryBreakdown,
        unassignedCount: unassignedCount,
        expiringAssets: expiringAssets,
        expiredAssets: expiredAssets,
        recentAssets: recentAssets
      };
    } catch (error) {
      throw new Error('取得儀表板統計失敗：' + error.message);
    }
  };

  // ============================================================
  // 10. Backup / Restore (支援雙模式，且防止 Firestore 寫入限制)
  // ============================================================

  window.DB.exportAllData = async function exportAllData() {
    try {
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';
      let personnel = [];
      let assets = [];
      let settings = [];

      if (isFirebaseMode) {
        // 匯出雲端
        let pRef = firestore.collection('personnel');
        let aRef = firestore.collection('assets');
        
        if (currentBranch !== 'admin') {
          const pSnap = await pRef.where('branch', '==', currentBranch).get();
          pSnap.forEach(doc => personnel.push(doc.data()));

          const aSnap = await aRef.where('branch', '==', currentBranch).get();
          aSnap.forEach(doc => assets.push(doc.data()));
          
          // 普通分隊不匯出全局 settings
          settings = [];
        } else {
          const pSnap = await pRef.get();
          pSnap.forEach(doc => personnel.push(doc.data()));

          const aSnap = await aRef.get();
          aSnap.forEach(doc => assets.push(doc.data()));

          const sSnap = await firestore.collection('settings').get();
          sSnap.forEach(doc => {
            settings.push({ key: doc.id, value: doc.data().value });
          });
        }
      } else {
        // 匯出本地
        if (currentBranch !== 'admin') {
          personnel = await db.personnel.where('branch').equals(currentBranch).toArray();
          assets = await db.assets.where('branch').equals(currentBranch).toArray();
          settings = [];
        } else {
          personnel = await db.personnel.toArray();
          assets = await db.assets.toArray();
          settings = await db.settings.toArray();
        }
      }

      return {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        branch: currentBranch,
        personnel: personnel,
        assets: assets,
        settings: settings
      };
    } catch (error) {
      throw new Error('匯出資料失敗：' + error.message);
    }
  };

  /**
   * 輔助函式：分批批次刪除指定 Firestore 集合內的所有文件。
   */
  async function clearFirestoreCollection(collectionName) {
    const snap = await firestore.collection(collectionName).get();
    if (snap.empty) return;

    const refs = [];
    snap.forEach(doc => refs.push(doc.ref));

    // 切片為 400 筆為一個 batch 進行刪除
    const chunks = [];
    let temp = [];
    for (let i = 0; i < refs.length; i++) {
      temp.push(refs[i]);
      if (temp.length === 400) {
        chunks.push(temp);
        temp = [];
      }
    }
    if (temp.length > 0) {
      chunks.push(temp);
    }

    for (let c = 0; c < chunks.length; c++) {
      const batch = firestore.batch();
      const chunk = chunks[c];
      for (let j = 0; j < chunk.length; j++) {
        batch.delete(chunk[j]);
      }
      await batch.commit();
    }
  }

  /**
   * 輔助函式：分批批次刪除指定 Firestore 集合內特定分隊的所有文件。
   */
  async function clearFirestoreCollectionByBranch(collectionName, branchName) {
    const snap = await firestore.collection(collectionName).where('branch', '==', branchName).get();
    if (snap.empty) return;

    const refs = [];
    snap.forEach(doc => refs.push(doc.ref));

    const chunks = [];
    let temp = [];
    for (let i = 0; i < refs.length; i++) {
      temp.push(refs[i]);
      if (temp.length === 400) {
        chunks.push(temp);
        temp = [];
      }
    }
    if (temp.length > 0) {
      chunks.push(temp);
    }

    for (let c = 0; c < chunks.length; c++) {
      const batch = firestore.batch();
      const chunk = chunks[c];
      for (let j = 0; j < chunk.length; j++) {
        batch.delete(chunk[j]);
      }
      await batch.commit();
    }
  }

  window.DB.importAllData = async function importAllData(backup) {
    try {
      if (!backup || typeof backup !== 'object') {
        throw new Error('備份資料格式不正確');
      }
      if (!Array.isArray(backup.personnel) || !Array.isArray(backup.assets) || !Array.isArray(backup.settings)) {
        throw new Error('備份資料缺少必要欄位（personnel、assets、settings）');
      }

      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      if (isFirebaseMode) {
        if (currentBranch !== 'admin') {
          // 普通分隊：僅清空該分隊在雲端的財產與人員資料，不影響其他分隊，亦不清除 settings
          await clearFirestoreCollectionByBranch('personnel', currentBranch);
          await clearFirestoreCollectionByBranch('assets', currentBranch);
        } else {
          // 管理員：全域清空
          await clearFirestoreCollection('personnel');
          await clearFirestoreCollection('assets');
          await clearFirestoreCollection('settings');
        }

        // 2. 寫入雲端 - Personnel
        if (backup.personnel.length > 0) {
          const pChunks = [];
          let temp = [];
          for (let i = 0; i < backup.personnel.length; i++) {
            temp.push(backup.personnel[i]);
            if (temp.length === 400) {
              pChunks.push(temp);
              temp = [];
            }
          }
          if (temp.length > 0) pChunks.push(temp);

          for (let c = 0; c < pChunks.length; c++) {
            const batch = firestore.batch();
            const chunk = pChunks[c];
            for (let j = 0; j < chunk.length; j++) {
              const rec = chunk[j];
              // 普通分隊強制重定向 branch 屬性至當前分隊，防止資料交叉污染
              rec.branch = currentBranch !== 'admin' ? currentBranch : (rec.branch || '雙福分隊');
              const docRef = firestore.collection('personnel').doc(makeBranchDocId(rec.id, currentBranch));
              batch.set(docRef, rec);
            }
            await batch.commit();
          }
        }

        // 3. 寫入雲端 - Assets
        if (backup.assets.length > 0) {
          const aChunks = [];
          let temp = [];
          for (let i = 0; i < backup.assets.length; i++) {
            temp.push(backup.assets[i]);
            if (temp.length === 400) {
              aChunks.push(temp);
              temp = [];
            }
          }
          if (temp.length > 0) aChunks.push(temp);

          for (let c = 0; c < aChunks.length; c++) {
            const batch = firestore.batch();
            const chunk = aChunks[c];
            for (let j = 0; j < chunk.length; j++) {
              const rec = chunk[j];
              // 普通分隊強制重定向 branch 屬性至當前分隊
              rec.branch = currentBranch !== 'admin' ? currentBranch : (rec.branch || '雙福分隊');
              const docRef = firestore.collection('assets').doc(makeBranchDocId(rec.id, currentBranch));
              batch.set(docRef, rec);
            }
            await batch.commit();
          }
        }

        // 4. 寫入雲端 - Settings (僅限管理員覆寫)
        let settingsCount = 0;
        if (currentBranch === 'admin' && backup.settings.length > 0) {
          const batch = firestore.batch();
          for (let i = 0; i < backup.settings.length; i++) {
            const record = backup.settings[i];
            const docRef = firestore.collection('settings').doc(record.key);
            batch.set(docRef, { value: record.value });
          }
          await batch.commit();
          settingsCount = backup.settings.length;
        }

        return {
          personnelCount: backup.personnel.length,
          assetsCount: backup.assets.length,
          settingsCount: settingsCount
        };
      } else {
        // 本地模式 (IndexedDB)
        if (currentBranch !== 'admin') {
          // 普通分隊：僅隔離操作 personnel 與 assets
          await db.transaction('rw', db.personnel, db.assets, async function () {
            await db.personnel.where('branch').equals(currentBranch).delete();
            await db.assets.where('branch').equals(currentBranch).delete();

            if (backup.personnel.length > 0) {
              backup.personnel.forEach(p => { p.branch = currentBranch; });
              await db.personnel.bulkAdd(backup.personnel);
            }
            if (backup.assets.length > 0) {
              backup.assets.forEach(a => { a.branch = currentBranch; });
              await db.assets.bulkAdd(backup.assets);
            }
          });

          return {
            personnelCount: backup.personnel.length,
            assetsCount: backup.assets.length,
            settingsCount: 0
          };
        } else {
          // 管理員：全域清除還原
          await db.transaction('rw', db.personnel, db.assets, db.settings, async function () {
            await db.personnel.clear();
            await db.assets.clear();
            await db.settings.clear();

            if (backup.personnel.length > 0) {
              backup.personnel.forEach(p => { p.branch = p.branch || '雙福分隊'; });
              await db.personnel.bulkAdd(backup.personnel);
            }
            if (backup.assets.length > 0) {
              backup.assets.forEach(a => { a.branch = a.branch || '雙福分隊'; });
              await db.assets.bulkAdd(backup.assets);
            }
            if (backup.settings.length > 0) {
              await db.settings.bulkAdd(backup.settings);
            }
          });

          return {
            personnelCount: backup.personnel.length,
            assetsCount: backup.assets.length,
            settingsCount: backup.settings.length
          };
        }
      }
    } catch (error) {
      throw new Error('還原資料失敗：' + error.message);
    }
  };

  /**
   * 建立雲端備份。
   * 將目前的全部資料匯出，並儲存至 Firestore 中的 backups 集合。
   * 備份名稱格式調整為 backup_分隊名稱_時間戳（例如：backup_雙福分隊_20260622_012308）。
   *
   * @returns {Promise<string>} 建立的備份 ID
   */
  window.DB.createCloudBackup = async function createCloudBackup() {
    try {
      if (!isFirebaseMode) {
        throw new Error('目前非 Firebase 雲端同步模式，無法建立雲端備份');
      }

      const backupData = await window.DB.exportAllData();
      const now = new Date();
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      // 格式化時間為 YYYYMMDD_HHmmss 格式
      const pad = function (num) {
        return String(num).padStart(2, '0');
      };
      const yyyy = now.getFullYear();
      const mm = pad(now.getMonth() + 1);
      const dd = pad(now.getDate());
      const hh = pad(now.getHours());
      const min = pad(now.getMinutes());
      const ss = pad(now.getSeconds());
      const formattedTime = yyyy + mm + dd + '_' + hh + min + ss;

      const backupId = 'backup_' + currentBranch + '_' + formattedTime;
      const record = {
        id: backupId,
        createdAt: now.toISOString(),
        branch: currentBranch,
        assetsCount: backupData.assets.length,
        personnelCount: backupData.personnel.length,
        dataJson: JSON.stringify(backupData)
      };

      await firestore.collection('backups').doc(backupId).set(record);
      return backupId;
    } catch (error) {
      throw new Error('建立雲端備份失敗：' + error.message);
    }
  };

  /**
   * 獲取所有雲端備份列表。
   * 非管理員登入時，僅回傳屬於該分隊的備份列表。
   *
   * @returns {Promise<Array<Object>>} 備份紀錄列表
   */
  window.DB.listCloudBackups = async function listCloudBackups() {
    try {
      if (!isFirebaseMode) {
        throw new Error('目前非 Firebase 雲端同步模式，無法讀取雲端備份');
      }

      const snap = await firestore.collection('backups').get({ source: 'server' });
      const results = [];
      snap.forEach(doc => {
        const data = doc.data();
        results.push({
          id: data.id,
          createdAt: data.createdAt,
          assetsCount: data.assetsCount,
          personnelCount: data.personnelCount,
          branch: data.branch || ''
        });
      });

      // 在前端依時間進行降序排序
      results.sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      // 分隊過濾
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';
      if (currentBranch !== 'admin') {
        return results.filter(function (b) {
          if (b.branch) {
            return b.branch === currentBranch;
          }
          // 針對沒有 branch 屬性的舊備份，若其 id 中含有分隊名稱也予以顯示
          return b.id.indexOf(currentBranch) !== -1;
        });
      }

      return results;
    } catch (error) {
      throw new Error('讀取雲端備份列表失敗：' + error.message);
    }
  };

  /**
   * 從雲端還原備份。
   * @param {string} backupId - 備份 ID
   * @returns {Promise<Object>} 還原結果統計
   */
  window.DB.restoreCloudBackup = async function restoreCloudBackup(backupId) {
    try {
      if (!isFirebaseMode) {
        throw new Error('目前非 Firebase 雲端同步模式，無法進行雲端還原');
      }

      const doc = await firestore.collection('backups').doc(backupId).get({ source: 'server' });
      if (!doc.exists) {
        throw new Error('找不到指定的備份檔案');
      }

      const backupData = JSON.parse(doc.data().dataJson);
      return await window.DB.importAllData(backupData);
    } catch (error) {
      throw new Error('雲端備份還原失敗：' + error.message);
    }
  };

  /**
   * 刪除指定的雲端備份。
   * 非管理員登入時，將驗證該備份是否屬於當前分隊，以防止越權刪除。
   *
   * @param {string} backupId - 備份 ID
   * @returns {Promise<boolean>} 是否刪除成功
   */
  window.DB.deleteCloudBackup = async function deleteCloudBackup(backupId) {
    try {
      if (!isFirebaseMode) {
        throw new Error('目前非 Firebase 雲端同步模式，無法刪除雲端備份');
      }

      const ref = firestore.collection('backups').doc(backupId);
      const doc = await ref.get({ source: 'server' });
      if (!doc.exists) {
        throw new Error('找不到指定的備份檔案');
      }

      const data = doc.data();
      const currentBranch = sessionStorage.getItem('currentBranch') || 'admin';

      // 權限檢查：非管理員僅能刪除所屬分隊的備份
      if (currentBranch !== 'admin') {
        if (data.branch && data.branch !== currentBranch) {
          throw new Error('您無權刪除其他分隊的備份');
        }
        if (!data.branch && backupId.indexOf(currentBranch) === -1) {
          throw new Error('您無權刪除此備份');
        }
      }

      await ref.delete();
      return true;
    } catch (error) {
      throw new Error('刪除雲端備份失敗：' + error.message);
    }
  };
})();
