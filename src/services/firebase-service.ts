import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";

export function createFirebaseService(config: Config) {
  let db: Firestore | undefined;

  const hasInlineCredentials =
    config.firebaseProjectId !== "" &&
    config.firebaseClientEmail !== "" &&
    config.firebasePrivateKey !== "";

  /** Set by `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS. */
  const hasAmbientCredentials = Boolean(process.env["GOOGLE_APPLICATION_CREDENTIALS"]);

  return {
    isEnabled(): boolean {
      return hasInlineCredentials || hasAmbientCredentials;
    },

    firestore(): Firestore {
      if (db) return db;

      if (!this.isEnabled()) {
        throw new Error(
          "Firebase is not configured: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or GOOGLE_APPLICATION_CREDENTIALS)",
        );
      }

      // initializeApp โยน error ถ้าเรียกซ้ำ — reuse app เดิมเวลา --watch รีสตาร์ท
      const app =
        getApps()[0] ??
        initializeApp(
          hasInlineCredentials
            ? {
                credential: cert({
                  projectId: config.firebaseProjectId,
                  clientEmail: config.firebaseClientEmail,
                  privateKey: config.firebasePrivateKey,
                }),
              }
            : { credential: applicationDefault() },
        );

      db = getFirestore(app);
      db.settings({ ignoreUndefinedProperties: true });
      return db;
    },
  };
}

export type FirebaseService = ReturnType<typeof createFirebaseService>;
