import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

/**
 * App Check para la web.
 *
 * Certifica que quien llama a las callables es esta app y no un script con la
 * API key copiada. No autentica al jugador —de eso va Auth— sino al cliente.
 *
 * La clave de sitio de reCAPTCHA v3 es **pública por diseño**: viaja en el
 * cliente y es la mitad visible del par. La secreta se queda en Firebase y nunca
 * toca este código.
 *
 * Fase de despliegue: las callables llevan `enforceAppCheck: false` y la consola
 * está en modo Monitor. Firebase registra qué proporción de llamadas traería un
 * token válido sin bloquear a nadie, que es lo que permite descubrir un fallo de
 * reCAPTCHA en algún navegador antes de que deje a esos jugadores fuera. Cuando
 * las métricas estén limpias, se activa Enforce en la consola.
 */
export const RECAPTCHA_V3_SITE_KEY = '6Lf0SHItAAAAAMEtGWLoaDFLXoLNcU_JffP5wIaY';

export interface AppCheckSetup {
  /** Instancia viva, o `null` si el navegador no pudo inicializarla. */
  readonly appCheck: AppCheck | null;
  /** Motivo de un arranque fallido, para diagnóstico; nunca se muestra al jugador. */
  readonly reason: string | null;
}

/**
 * Arranca App Check sin poder tumbar la app.
 *
 * Un fallo aquí (red caída, reCAPTCHA bloqueado por una extensión, dominio no
 * autorizado) **no puede impedir jugar**: el juego es local y funciona sin nube.
 * Lo único que se pierde es publicar y consultar rankings, y eso se degrada
 * solo. Por eso se traga la excepción en vez de propagarla.
 */
export function startAppCheck(
  app: FirebaseApp,
  siteKey: string = RECAPTCHA_V3_SITE_KEY,
): AppCheckSetup {
  try {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return { appCheck, reason: null };
  } catch (error) {
    return {
      appCheck: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
