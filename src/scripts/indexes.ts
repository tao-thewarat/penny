/**
 * Creates the composite indexes in firestore.indexes.json.
 *
 * `firebase deploy --only firestore:indexes` needs the Firebase CLI and an
 * interactive login; the bot already holds a service account, so this talks to
 * the Firestore Admin REST API with it instead. Creating an index is additive
 * and one that already exists is left alone.
 */
import { readFile } from "node:fs/promises";
import { config } from "../config.ts";
import { createFirebaseService } from "../services/firebase-service.ts";

type IndexField = {
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
  arrayConfig?: "CONTAINS";
};

type IndexDefinition = {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
};

const INDEX_FILE = new URL("../../firestore.indexes.json", import.meta.url);

const file = JSON.parse(await readFile(INDEX_FILE, "utf8")) as {
  indexes?: IndexDefinition[];
};
const indexes = file.indexes ?? [];

if (indexes.length === 0) {
  console.error("No indexes listed in firestore.indexes.json");
  process.exit(1);
}

const firebase = createFirebaseService(config);
const projectId = firebase.projectId();
const token = await firebase.accessToken();

let created = 0;
let existed = 0;

for (const index of indexes) {
  const label = `${index.collectionGroup}(${index.fields
    .map((field) => field.fieldPath)
    .join(", ")})`;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${index.collectionGroup}/indexes`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      queryScope: index.queryScope,
      fields: index.fields,
    }),
  });

  if (response.ok) {
    created += 1;
    console.log(`created  ${label}`);
    continue;
  }

  const body = await response.text();
  // Firestore answers 409 when an equivalent index is already in place.
  if (response.status === 409) {
    existed += 1;
    console.log(`exists   ${label}`);
    continue;
  }

  if (response.status === 403) {
    console.error(
      [
        `failed   ${label}: the service account cannot create indexes.`,
        "",
        'Grant it "Cloud Datastore Index Admin" (roles/datastore.indexAdmin) at',
        `  https://console.cloud.google.com/iam-admin/iam?project=${projectId}`,
        "or add the index by hand at",
        `  https://console.firebase.google.com/project/${projectId}/firestore/indexes`,
        "",
        "Summaries still work without it — the app falls back to a slower query.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.error(`failed   ${label}: HTTP ${response.status} ${body}`);
  process.exit(1);
}

console.log(
  `\n${created} created, ${existed} already present in ${projectId}.` +
    (created > 0 ? " New indexes take a minute or two to finish building." : ""),
);
