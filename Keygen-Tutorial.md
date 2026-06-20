## Keygen tutorial - 
---

**Step 1 — keygen (one time)**
```powershell
keytool -genkey -v -keystore my-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key
```

create passkey.  
remember the passkey.  
if passkey or passphrase asked, that is your passkey, keep it safe.  
it is valid for 10,000 days.  
---

**Step 2 — sign**
```powershell
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore my-key.jks ".\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk" my-key
```

---

Replace `C:\Users\User` with your own username, or find your SDK path in Android Studio under Settings → SDK Manager.  

**Step 3 — zipalign**
```powershell
& "C:\Users\User\AppData\Local\Android\Sdk\build-tools\$(ls C:\Users\User\AppData\Local\Android\Sdk\build-tools | Select-Object -Last 1 | Select-Object -ExpandProperty Name)\zipalign.exe" -v 4 ".\src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk" app-signed.apk
```

---

Replace `C:\Users\User` with your own username, or find your SDK path in Android Studio under Settings → SDK Manager.  

**Step 4 — apksigner**
```powershell
& "C:\Users\User\AppData\Local\Android\Sdk\build-tools\$(ls C:\Users\User\AppData\Local\Android\Sdk\build-tools | Select-Object -Last 1 | Select-Object -ExpandProperty Name)\apksigner.bat" sign --ks my-key.jks --ks-key-alias my-key --out app-final.apk app-signed.apk
```

Install `app-final.apk`. Steps 1 and 2 only need to be rerun if you lose `my-key.jks`.
Run 2, 3, 4 if re-built.  
has 10k days validity

---

dest location (unsigned) - 
src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk

dest location (signed) - 
apk-final.apk