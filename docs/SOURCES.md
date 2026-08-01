# Fuentes técnicas verificadas

Consultadas: 2026-07-31. Las versiones exactas se contrastaron además con el
registro oficial npm mediante `npm view`.

- [Capacitor 8 — política de soporte y requisitos](https://capacitorjs.com/docs/main/reference/support-policy):
  Node 22+, Xcode 26+, Android Studio 2025.2.1+, iOS 15+ y Android API 24+.
- [Capacitor — incorporación a una web existente](https://capacitorjs.com/):
  instalación de Core/CLI y plataformas Android/iOS.
- [Firebase — gestión de Functions](https://firebase.google.com/docs/functions/manage-functions):
  runtime Node 22, ESM soportado y opciones en código.
- [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure):
  instalación, puertos, reglas y requisitos Java.
- [Firestore Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore):
  aviso de requisito Java 21 en una próxima versión; por eso v2 estandarizará
  directamente JDK 21 LTS.
- [Google Play — target API](https://developer.android.com/google/play/requirements/target-sdk):
  nuevas apps/actualizaciones deberán apuntar a API 36 desde el 31-08-2026.
- [Archivo oficial de Node 22.23.2](https://nodejs.org/en/download/archive/v22.23.2).

Paquetes fijados:

- [@capacitor/core](https://www.npmjs.com/package/@capacitor/core) 8.4.2 y
  plataformas alineadas.
- [firebase](https://www.npmjs.com/package/firebase) 12.17.0.
- [firebase-admin](https://www.npmjs.com/package/firebase-admin) 14.2.0.
- [firebase-functions](https://www.npmjs.com/package/firebase-functions) 7.3.2.
- [firebase-tools](https://www.npmjs.com/package/firebase-tools) 15.25.0.
- [TypeScript 6 compatibility](https://www.npmjs.com/package/@typescript/typescript6)
  6.0.2: Capacitor carga Compiler API y no es compatible con el paquete nativo
  TypeScript 7 usado inicialmente.

Estas fuentes deben revisarse al inicio de cada fase nativa/backend y antes de
cada release; políticas, SDKs y requisitos de tiendas cambian.
