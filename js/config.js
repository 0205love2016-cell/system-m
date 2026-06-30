/**
 * 消防隊財產管理系統 - 雲端同步金鑰設定檔
 *
 * 【如何啟用雲端同步】
 * 1. 造訪 Firebase 官網 (https://console.firebase.google.com/) 並建立免費專案。
 * 2. 在專案中啟用「Cloud Firestore」資料庫。
 * 3. 在專案設定中新增一個「網頁應用程式 (Web App)」，系統會生成一組 SDK 設定物件。
 * 4. 將該物件的金鑰與設定值複製並替換下方 window.FIREBASE_CONFIG 中的對應欄位。
 * 5. 存檔後重新整理網頁，系統即會自動升級為雲端即時同步模式！
 *
 * 【注意事項】
 * - 若未配置此金鑰（保持預設的 "YOUR_API_KEY"），系統會自動降級為本地單機模式，資料仍可安全儲存於本機。
 */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAsQh_DS_i6msrcgBQ7d3CjtzdqkOoIuTI",
  authDomain: "asset-management-system-ae8e7.firebaseapp.com",
  projectId: "asset-management-system-ae8e7",
  storageBucket: "asset-management-system-ae8e7.firebasestorage.app",
  messagingSenderId: "35310943923",
  appId: "1:353110943923:web:afe059fdf9cdc8feae28c6"
};
