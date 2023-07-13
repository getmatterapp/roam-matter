import Extension from "./extension";

declare global {
  interface Window {
    roamMatter: Extension;
  }
}

export const maxNumWrites = 20;
export const syncJitterRange = 3;
export const intervalSyncMinutes = 1;
export const syncCooldownMinutes = 1;
export const syncStaleMinutes = 6;
export const syncIntervals: { [key: string]: number } = {
  "Manual": -1,
  "Every half hour": 30,
  "Every hour": 60,
  "Every 12 hours": 60 * 12,
  "Every 24 hours": 60 * 24,
}


export const syncLocationArticlePage = 'Article Page';
export const syncLocationDailyNote = 'Daily Note';
export const syncLocationArticlePageAndDailyNote = 'Article Page & Daily Note';
export const syncLocations = [
  syncLocationArticlePage,
  syncLocationDailyNote,
  syncLocationArticlePageAndDailyNote,
]