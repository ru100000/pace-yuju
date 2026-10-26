# Email 登入與永久紀錄設定

目前網站已接好 Firebase Authentication（Email／密碼）與 Cloud Firestore。完成以下設定後，使用者登入同一個帳號，就能在不同裝置看到自己的運動紀錄。

1. 在 Firebase Console 建立專案，新增 Web App。
2. 在 Authentication > Sign-in method 啟用 Email/Password。
3. 在 Firestore Database 建立資料庫，將本專案的 `firestore.rules` 貼上並發布。
4. 在 Authentication > Settings > Authorized domains 加入正式網站網域（例如 `你的帳號.github.io`）。
5. 將 Web App 的設定值填入 `firebase-config.js`。

Firebase Web 設定值可以放在前端；真正的資料保護由 `firestore.rules` 負責，規則只允許登入者讀寫自己的 `/users/{uid}/records`。

沒有填設定時，網站會顯示「訪客模式」，紀錄只保存在目前裝置；這不是跨裝置永久保存。填好設定並部署後，首頁右上角會出現 Email 登入／註冊入口。
