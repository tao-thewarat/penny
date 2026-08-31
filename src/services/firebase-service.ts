import {
  applicationDefault,
  cert,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.ts";

export function createFirebaseService(config: Config) {
  let app: App | undefined;
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

      db = getFirestore(this.app());
      db.settings({ ignoreUndefinedProperties: true });
      return db;
    },

    app(): App {
      if (app) return app;

      if (!this.isEnabled()) {
        throw new Error(
          "Firebase is not configured: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or GOOGLE_APPLICATION_CREDENTIALS)",
        );
      }

      app = initializeApp(
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
      return app;
    },

    /**
     * OAuth token for the Firestore Admin REST API, which firebase-admin does
     * not wrap. Index management is the only caller.
     */
    async accessToken(): Promise<string> {
      const token = await this.app().options.credential?.getAccessToken();
      if (!token?.access_token) {
        throw new Error("Could not mint an access token from the credentials");
      }
      return token.access_token;
    },

    projectId(): string {
      const projectId =
        config.firebaseProjectId ||
        this.app().options.projectId ||
        process.env["GOOGLE_CLOUD_PROJECT"] ||
        "";
      if (!projectId) {
        throw new Error("FIREBASE_PROJECT_ID is not set");
      }
      return projectId;
    },
  };
}

export type FirebaseService = ReturnType<typeof createFirebaseService>;
