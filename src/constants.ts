import toConfigPageName from "roamjs-components/util/toConfigPageName";


declare global {
  interface Window {
    roamMatterSyncInterval: number;
    roamMatterIsSyncing: boolean;
  }
}

export const configPage = toConfigPageName('matter');
export const extensionId = "roam-matter";
export const authConfigKey = "authentication";
export const syncIntervalKey = "sync interval";
export const syncStatusMessage = "Sync in progress...";
export const maxNumWrites = 20;
